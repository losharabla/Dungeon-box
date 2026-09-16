/**
 * Headless full-run simulator.
 *
 * SRP: drive the real {@link Game} through complete runs with a synthetic
 * player, using a stubbed canvas so the whole stack (combat, AI, bosses,
 * rooms, dungeons, shop, ultimates) is exercised without a browser.
 *
 * Run with:  node tools/simulate-run.mjs [runs] [seconds]
 */

import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

/* ============================================================
   Browser environment shim
   ============================================================ */

/** Minimal 2D context: every call is a no-op, gradients chain cleanly. */
function makeStubContext() {
  const gradient = { addColorStop() {} };
  /**
   * @type {any}
   */
  const ctx = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineDashOffset: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    setLineDash() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
    arcTo() {}, ellipse() {}, quadraticCurveTo() {}, rect() {},
    fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    fillText() {}, strokeText() {}, clip() {}, setTransform() {}, measureText: () => ({ width: 0 }),
  };
  return ctx;
}

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= /** @type {any} */ ({
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
});

/* ============================================================
   Import the game stack
   ============================================================ */

const { Game } = await import('../src/game/Game.js');
const { RenderSystem, Camera } = await import('../src/rendering/RenderSystem.js');
const { SceneRenderer } = await import('../src/rendering/SceneRenderer.js');
const { getBoss } = await import('../src/data/bosses.js');
const { getEnemy } = await import('../src/data/enemies.js');

/* ============================================================
   Harness
   ============================================================ */

const DT = CONFIG.loop.fixedStep;

/**
 * A synthetic "player brain": move toward a goal, fire at the nearest
 * enemy. This is what lets a full run complete without human input.
 *
 * Note: `Game.update` takes the aim point in *screen* space and converts it
 * through the camera, so the brain converts its world-space target back the
 * same way a real mouse position would arrive.
 */
class BotBrain {
  constructor() {
    /** @type {{x: number, y: number}} */
    this.move = { x: 0, y: 0 };
    /** @type {{x: number, y: number}} screen-space aim */
    this.aim = { x: CONFIG.view.width / 2, y: CONFIG.view.height / 2 };
    this.attackHeld = false;
    this.attackPressed = false;
    this.ultPressed = false;

    /** Unstick bookkeeping: detects "commands given but not moving". */
    this._lastX = 0;
    this._lastY = 0;
    this._stuckTime = 0;
    this._unstickAngle = 0;
  }

  /**
   * @param {any} game
   * @param {(wx: number, wy: number) => {x: number, y: number}} toScreen
   * @param {number} time elapsed seconds, for flanking oscillation
   */
  think(game, toScreen, time) {
    const player = game.getPlayer();
    const rt = game.rooms.runtime;
    if (!player || !rt) return;

    const room = rt.room;
    const enemies = game.registry.enemies.filter((/** @type {any} */ e) => e.alive);

    // --- Aim at the nearest enemy, else at the room centre ---------------
    let target = null;
    let bestD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < bestD) { bestD = d; target = e; }
    }

    const aimWorld = target
      ? { x: target.x, y: target.y }
      : { x: room.center.x, y: room.center.y };
    this.aim = toScreen(aimWorld.x, aimWorld.y);

    // --- Pick a goal -----------------------------------------------------
    // While enemies remain, the goal *is* the enemy: a bot that only kites
    // never finishes a wave, which would stall every run.
    let goalX = room.center.x;
    let goalY = room.center.y;
    let engaging = false;

    if (target) {
      goalX = target.x;
      goalY = target.y;
      engaging = true;

      // Shieldbearers block the arc they are facing (§11.7), so a bot that
      // walks straight in can never hurt one. Circle to its flank instead —
      // this is the counterplay the mechanic is designed around.
      if (target.kind === 'shieldbearer') {
        const toPlayer = Math.atan2(player.y - target.y, player.x - target.x);
        // Aim for a point behind the shield, offset around the bearer.
        const behind = target.facing + Math.PI;
        const flankAngle = behind + Math.sin(time * 0.8) * 0.6;
        goalX = target.x + Math.cos(flankAngle) * (target.radius + 34);
        goalY = target.y + Math.sin(flankAngle) * (target.radius + 34);
        void toPlayer;
      }
    } else if (rt.cleared || rt.type === 'start' || rt.type === 'shop' || rt.type === 'healing') {
      // Any room whose content is done: head for an open door. Room type is
      // deliberately not special-cased here — once a support room has been
      // used it must be left exactly like a cleared arena, otherwise the bot
      // parks on the shop counter forever.
      const node = game.run.currentNode();
      const want = node && node.next.length > 0 ? String(node.next[0]) : null;
      const open = rt.room.doors.filter((/** @type {any} */ d) => d.open);
      const door = (want && open.find((/** @type {any} */ d) => d.targetRoomId === want)) || open[0];
      if (door) {
        goalX = door.rect.x + door.rect.w / 2;
        goalY = door.rect.y + door.rect.h / 2;
      }
    }

    // --- Repel from nearby enemies (kiting) ------------------------------
    let repX = 0;
    let repY = 0;
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      // Ranged classes keep their distance; the warrior closes in.
      const keepAway = player.classId === 'warrior'
        ? (e.kind === 'boss' ? 70 : 20)
        : (e.kind === 'boss' ? 300 : 170);
      if (d < keepAway) {
        const w = (keepAway - d) / keepAway;
        repX += (dx / d) * w;
        repY += (dy / d) * w;
      }
    }

    // --- Blend goal attraction with enemy repulsion ----------------------
    const gx = goalX - player.x;
    const gy = goalY - player.y;
    const gd = Math.hypot(gx, gy) || 1;

    // When engaging, aim to sit at a comfortable firing distance rather
    // than walking into the enemy's body.
    const desiredDist = player.classId === 'warrior' ? 30 : 190;
    let attract = 1;
    if (engaging) {
      if (gd < desiredDist * 0.75) attract = -0.6;   // back off
      else if (gd < desiredDist) attract = 0.15;     // hold position
      else attract = 1;                              // close in
    }
    // Suppress goal-seeking while actively fleeing a crowd.
    const fleeing = Math.hypot(repX, repY) > 1.2;
    if (fleeing) attract = 0;

    let mx = (gx / gd) * attract + repX * 1.3;
    let my = (gy / gd) * attract + repY * 1.3;

    // --- Unstick: steer along walls instead of pressing into them --------
    // A human naturally slides around an obstacle; without this a simple
    // steer-toward-goal bot jams against a wall and never reaches the exit.
    //
    // The strategy: when the direct heading stops producing movement, rotate
    // the heading *consistently* in one direction (never resetting back to
    // the blocked angle) and keep the rotation until progress resumes. This
    // traces the wall contour until an opening appears.
    const moved = Math.hypot(player.x - this._lastX, player.y - this._lastY);
    const wanted = Math.hypot(mx, my) > 0.05;
    if (wanted && moved < 0.5) {
      this._stuckTime++;
    } else if (moved > 1.5) {
      // Real progress: forget the detour and steer at the goal again.
      this._stuckTime = 0;
      this._unstickAngle = 0;
    }

    this._lastX = player.x;
    this._lastY = player.y;

    if (this._stuckTime > 6) {
      this._unstickAngle += 0.30;
      const a = Math.atan2(my, mx) + this._unstickAngle;
      mx = Math.cos(a);
      my = Math.sin(a);
    }

    const ml = Math.hypot(mx, my);
    if (ml > 0.001) { mx /= ml; my /= ml; } else { mx = 0; my = 0; }

    this.move = { x: mx, y: my };

    // --- Attack whenever a target is in reach ----------------------------
    const reach = player.classId === 'warrior' ? player.weapon.range + 20 : 640;
    const inReach = Boolean(target) && bestD < reach;
    this.attackHeld = inReach;
    this.attackPressed = inReach;
    // --- Fire the ultimate as soon as it is charged ----------------------
    this.ultPressed = player.ultReady;
  }
}

/**
 * Run one complete game and report what happened.
 * @param {object} opts
 * @param {string} opts.classId
 * @param {string} opts.ultimateId
 * @param {number} opts.maxSeconds
 * @param {number} opts.seed
 * @param {boolean} [opts.godMode] ignore death so the run reaches the boss
 */
function simulateRun({ classId, ultimateId, maxSeconds, seed, godMode = false }) {
  const bus = new EventBus();
  const state = new StateMachine(bus, 'menu');

  /** @type {any[]} */
  const notices = [];
  /** @type {any[]} */
  const timeline = [];
  let deathReported = false;
  let victoryReported = false;
  /** @type {any} */
  let activeReward = null;

  const game = new Game({
    bus,
    state,
    callbacks: {
      onStateChange: () => {},
      onRoomCleared: (rt) => {
        timeline.push({ t: game.run.elapsed, event: `room_cleared:${rt.type}` });
        if (rt.reward && rt.reward.length > 0) activeReward = rt.reward;
        if (rt.type === 'boss') {
          const bossId = game.spawner.lastBossId;
          if (bossId === 'executioner') victoryReported = true;
        }
      },
      onBossSpawned: (boss) => {
        timeline.push({ t: game.run.elapsed, event: `boss_spawned:${boss.bossId}` });
      },
      onPlayerDeath: () => { deathReported = true; },
      onNotice: (text) => notices.push(text),
    },
  });

  game.startRun(classId, ultimateId, seed);
  state.force('playing');

  const brain = new BotBrain();

  /** Converts a world point into the screen space `Game.update` expects. */
  const toScreen = (/** @type {number} */ wx, /** @type {number} */ wy) => {
    const cam = game.camera;
    return {
      x: wx - cam.x + CONFIG.view.width / 2,
      y: wy - cam.y + CONFIG.view.height / 2,
    };
  };

  /** Door-travel hysteresis flag, mirroring main.js. */
  let doorArmed = true;

  /** @type {any} */
  let stats = null;
  let ultimatesUsed = 0;
  let shopVisits = 0;
  let healingVisits = 0;
  let roomsEntered = 0;
  let purchases = 0;
  let rewardsTaken = 0;
  let weaponsChanged = 0;

  let lastRoomId = '';
  let lastWeapon = '';
  let maxFloor = 0;

  bus.on('room:entered', () => { roomsEntered++; });
  bus.on('shop:purchase', () => { purchases++; });
  bus.on('progression:ultimateActivated', () => { ultimatesUsed++; });

  let elapsed = 0;
  let steps = 0;
  /** @type {string[]} rolling trail used to explain a stalled run */
  const debugTrail = [];

  while (elapsed < maxSeconds) {
    // --- Interaction: visit shop/healing, take rewards, travel ----------
    const rt = game.rooms.runtime;
    const player = game.getPlayer();
    if (!rt || !player) break;

    if (rt.id !== undefined && rt.nodeId !== lastRoomId) {
      lastRoomId = rt.nodeId;
    }

    // Keep player weapons fresh so we detect the swap path.
    if (player.weaponId !== lastWeapon) {
      if (lastWeapon !== '') weaponsChanged++;
      lastWeapon = player.weaponId;
    }

    // Take any pending reward immediately.
    if (activeReward && activeReward.length > 0) {
      // Prefer a weapon if one is offered occasionally, else the upgrade.
      const pick = activeReward.find((/** @type {any} */ r) => r.kind === 'weapon')
        ?? activeReward[0];
      game.takeReward(pick);
      rewardsTaken++;
      activeReward = null;
    }

    // Walk into support rooms and use them once.
    if ((rt.type === 'shop' || rt.type === 'healing') && !rt.cleared) {
      const c = rt.room.center;
      const d = Math.hypot(player.x - c.x, player.y - c.y);
      if (d < 110) {
        const result = game.interact();
        if (result) {
          if (result.kind === 'shop') {
            shopVisits++;
            for (const item of rt.shopStock ?? []) {
              if (!item.sold && player.canAfford(item.price)) {
                if (game.buy(item)) purchases++;
              }
            }
          } else if (result.kind === 'healing') {
            healingVisits++;
          }
        }
        // Whether or not the interaction resolved, the room's content is
        // spent: clear it so the door home opens and progress continues.
        rt.cleared = true;
      }
    }

    // --- Think and step -------------------------------------------------
    // Drive the door-travel logic the same way main.js does, including the
    // re-arm hysteresis so arriving in a room does not chain-teleport. The
    // doorway query is the game's own, so the bot leaves exactly the rooms a
    // player can leave: a support room no longer has to be consumed first.
    const enteredDoor = game.doorAtPlayer(34);
    const node = game.run.currentNode();
    if (node && node.next.length > 0) {
      if (!enteredDoor) doorArmed = true;
      else if (doorArmed) {
        doorArmed = false;
        game.travelTo(Number(enteredDoor.targetRoomId));
        continue;
      }
    }

    brain.think(game, toScreen, elapsed);

    game.update(DT, {
      move: brain.move,
      aim: brain.aim,
      attackHeld: brain.attackHeld,
      attackPressed: brain.attackPressed,
      ultPressed: brain.ultPressed,
    });

    // --- Keep the bot alive when god mode is requested ------------------
    // "God mode" means the harness ignores incoming damage entirely, so a
    // run can traverse the whole floor chain (all three bosses) in bounded
    // time and any crash in late content is still caught.
    if (godMode && player.alive && player.hp < player.maxHp) {
      player.hp = player.maxHp;
    }

    elapsed += DT;
    steps++;
    maxFloor = Math.max(maxFloor, game.run.floorIndex);

    if (deathReported) break;
    if (victoryReported) break;
    // Stop once the run reports itself over.
    if (!game.run.active && deathReported) break;

    // Diagnostic: report a stalled run so the failure is inspectable
    // rather than silently truncated by the time limit.
    if (steps % (60 * 120) === 0) {
      const node = game.run.currentNode();
      debugTrail.push(
        `t=${elapsed.toFixed(0)} room=${rt.nodeId}/${rt.type} cleared=${rt.cleared}`
        + ` wave=${rt.waveIndex}/${rt.waveDefs?.length ?? 0} alive=${game.registry.enemies.filter((e) => e.alive).length}`
        + ` pos=(${player.x.toFixed(0)},${player.y.toFixed(0)}) next=[${node?.next}]`
        + ` visited=${game.run.visitedNodes.size}`,
      );
      if (debugTrail.length > 12) debugTrail.shift();
    }
  }

  stats = game.getStats();

  return {
    classId,
    ultimateId,
    elapsed,
    steps,
    alive: game.getPlayer()?.alive ?? false,
    hp: game.getPlayer()?.hp ?? 0,
    maxHp: game.getPlayer()?.maxHp ?? 0,
    weapon: game.getPlayer()?.weapon.name ?? '',
    gold: game.getPlayer()?.gold ?? 0,
    floor: maxFloor,
    deathReported,
    victoryReported,
    roomsEntered,
    shopVisits,
    healingVisits,
    purchases,
    rewardsTaken,
    weaponsChanged,
    ultimatesUsed,
    kills: stats.kills,
    damageDealt: stats.damageDealt,
    damageTaken: stats.damageTaken,
    notices: notices.length,
    timeline,
    debugTrail,
    errors: collectErrors(),
  };
}

/** Collect any console.error output produced during the run. */
let consoleErrors = [];
function collectErrors() {
  const out = consoleErrors.slice();
  consoleErrors = [];
  return out;
}

const realError = console.error;
console.error = (...args) => {
  consoleErrors.push(args.map(String).join(' '));
  realError(...args);
};

/* ============================================================
   Driver
   ============================================================ */

const runsRequested = Number(process.argv[2] ?? 6);
const maxSeconds = Number(process.argv[3] ?? 900);

const CLASSES = [
  { classId: 'warrior', ultimateId: 'whirlwind' },
  { classId: 'warrior', ultimateId: 'invulnerability' },
  { classId: 'warrior', ultimateId: 'berserker_strike' },
  { classId: 'mage', ultimateId: 'meteor' },
  { classId: 'mage', ultimateId: 'chain_lightning' },
  { classId: 'mage', ultimateId: 'time_stop' },
  { classId: 'gunner', ultimateId: 'bullet_storm' },
  { classId: 'gunner', ultimateId: 'ricochet' },
  { classId: 'gunner', ultimateId: 'combat_stim' },
];

console.log(`Simulating ${runsRequested} full runs (max ${maxSeconds}s simulated each)\n`);

let totalFailures = 0;
const summaries = [];

for (let i = 0; i < runsRequested; i++) {
  const cfg = CLASSES[i % CLASSES.length];
  const seed = 5000 + i * 137;
  // Alternating god mode keeps half the runs focused on reaching and
  // exercising the late content (all three bosses), while the others
  // measure whether an ordinary run can survive.
  const godMode = i % 2 === 1;

  const label = `${cfg.classId}/${cfg.ultimateId}${godMode ? ' [god]' : ''}`;
  process.stdout.write(`  run ${i + 1}/${runsRequested}  ${label} ... `);

  const result = simulateRun({
    ...cfg,
    maxSeconds,
    seed,
    godMode,
  });
  summaries.push(result);

  const reachedBoss = result.timeline.some((e) => String(e.event).startsWith('boss_spawned'));
  const bossCleared = result.timeline.some((e) => String(e.event) === 'room_cleared:boss');
  const problems = [];
  if (result.errors.length > 0) problems.push(`${result.errors.length} console errors`);
  if (result.steps === 0) problems.push('no simulation steps');
  if (!godMode && !result.alive && !result.deathReported) {
    problems.push('died without reporting death');
  }
  if (result.damageDealt <= 0) problems.push('dealt no damage');
  if (result.kills <= 0) problems.push('killed nothing');
  if (godMode && result.roomsEntered < 3) {
    problems.push(`god-mode run stalled after only ${result.roomsEntered} room(s)`);
  }
  if (godMode && !reachedBoss) {
    problems.push('god-mode run never reached the boss arena');
  }
  // An invincible run must be able to finish the boss; a failure here means
  // the boss fight is unwinnable rather than merely hard.
  if (godMode && reachedBoss && !bossCleared) {
    problems.push('god-mode run could not defeat the boss');
  }

  if (problems.length > 0) {
    totalFailures++;
    console.log(`FAIL - ${problems.join(', ')}`);
    for (const err of result.errors.slice(0, 4)) console.log(`      ${err}`);
    for (const line of (result.debugTrail ?? []).slice(-6)) console.log(`      ${line}`);
  } else {
    console.log(
      `ok  kills=${result.kills} dmg=${Math.round(result.damageDealt)} `
      + `rooms=${result.roomsEntered} gold=${result.gold} floor=${result.floor + 1} `
      + `${reachedBoss ? 'BOSS' : 'no-boss'} ${result.victoryReported ? 'VICTORY' : ''}`,
    );
  }
}

/* ============================================================
   Coverage report
   ============================================================ */

const totals = summaries.reduce((acc, r) => ({
  kills: acc.kills + r.kills,
  damage: acc.damage + r.damageDealt,
  rooms: acc.rooms + r.roomsEntered,
  rewards: acc.rewards + r.rewardsTaken,
  purchases: acc.purchases + r.purchases,
  shop: acc.shop + r.shopVisits,
  healing: acc.healing + r.healingVisits,
  ults: acc.ults + r.ultimatesUsed,
  weapons: acc.weapons + r.weaponsChanged,
}), {
  kills: 0, damage: 0, rooms: 0, rewards: 0, purchases: 0,
  shop: 0, healing: 0, ults: 0, weapons: 0,
});

const bossesSeen = new Set();
for (const s of summaries) {
  for (const e of s.timeline) {
    const m = /^boss_spawned:(.+)$/.exec(String(e.event));
    if (m) bossesSeen.add(m[1]);
  }
}

console.log('\n--- coverage across runs ---');
console.log(`  kills            ${totals.kills}`);
console.log(`  damage dealt     ${Math.round(totals.damage)}`);
console.log(`  rooms entered    ${totals.rooms}`);
console.log(`  rewards taken    ${totals.rewards}`);
console.log(`  shop visits      ${totals.shop}  (purchases: ${totals.purchases})`);
console.log(`  healing visits   ${totals.healing}`);
console.log(`  ultimates used   ${totals.ults}`);
console.log(`  weapon swaps     ${totals.weapons}`);
console.log(`  bosses seen      ${[...bossesSeen].join(', ') || 'none'}`);

console.log('');
console.log(totalFailures === 0
  ? `All ${runsRequested} simulated runs completed without errors`
  : `${totalFailures}/${runsRequested} runs reported problems`);

process.exit(totalFailures > 0 ? 1 : 0);
