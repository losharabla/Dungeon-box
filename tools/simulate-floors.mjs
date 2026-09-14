/**
 * Campaign test: descend through every floor and rotate all bosses.
 *
 * The synthetic player uses a grid pathfinder (see `NavGrid.mjs`) rather
 * than raw steering, because the point of this test is to validate the
 * game's content and state transitions — the bot must not be the thing
 * that fails.
 *
 * `verify-arenas.mjs` complements this: it proves every arena is clearable
 * in isolation, so a rare stall here can be attributed to long-horizon bot
 * behaviour rather than to an unwinnable room.
 *
 * Run with:  node tools/simulate-floors.mjs
 */

import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';
import { NavGrid } from './NavGrid.mjs';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');
const { BOSS_ORDER } = await import('../src/data/bosses.js');

/**
 * Play one floor to its boss and report the outcome.
 *
 * Navigation uses a grid pathfinder rather than raw steering: the point of
 * this test is to validate the game's content and state transitions, so the
 * synthetic player must not be the thing that fails.
 *
 * @param {any} game
 * @param {any} player
 * @param {number} maxSeconds
 */
function playFloor(game, player, maxSeconds = 900) {
  const toScreen = (wx, wy) => ({
    x: wx - game.camera.x + CONFIG.view.width / 2,
    y: wy - game.camera.y + CONFIG.view.height / 2,
  });

  let doorArmed = true;
  /** @type {string[]} */
  const bossesThisFloor = [];

  /** @type {NavGrid|null} rebuilt whenever the room changes */
  let nav = null;
  let navRoomId = '';
  /** @type {Array<{x: number, y: number}>} */
  let path = [];
  let pathGoalX = 0;
  let pathGoalY = 0;
  let repathTimer = 0;

  const unsubscribe = game.bus.on('room:bossSpawned', ({ boss }) => {
    bossesThisFloor.push(boss.bossId);
  });

  const dt = CONFIG.loop.fixedStep;
  let elapsed = 0;
  /** @type {string[]} rolling trail so a stall is inspectable */
  const trail = [];

  while (elapsed < maxSeconds) {
    const rt = game.rooms.runtime;
    if (!rt) break;

    if (Math.floor(elapsed) % 120 === 0 && Math.floor(elapsed) !== Math.floor(elapsed - dt)) {
      const node = game.run.currentNode();
      const doorInfo = rt.room.doors
        .map((d) => `${d.side}:${d.open ? 'open' : 'SHUT'}:t=${d.targetRoomId}:d=${Math.hypot(player.x - (d.rect.x + d.rect.w / 2), player.y - (d.rect.y + d.rect.h / 2)).toFixed(0)}`)
        .join(' | ');
      trail.push(
        `t=${elapsed.toFixed(0)} room=${rt.nodeId}/${rt.type} cleared=${rt.cleared}`
        + ` wave=${rt.waveIndex}/${rt.waveDefs?.length ?? 0}`
        + ` alive=${game.registry.enemies.filter((e) => e.alive).length}`
        + ` pos=(${player.x.toFixed(0)},${player.y.toFixed(0)}) next=[${node?.next}]`
        + ` sealed=${rt.room.sealed} pathLen=${path.length}`
        + ` foes=[${game.registry.enemies.filter((e) => e.alive).map((e) => `${e.kind}@${e.x.toFixed(0)},${e.y.toFixed(0)}:hp${e.hp.toFixed(0)}`).join(' ')}]`,
      );
      if (trail.length > 8) trail.shift();
    }

    // Invincible: this test measures reachability and state transitions,
    // not balance. HP is topped up *after* the update below, so a single
    // large burst cannot kill the player between two healing frames.
    player.hp = player.maxHp;

    const enemies = game.registry.enemies.filter((e) => e.alive);
    const target = enemies[0];

    // --- Support rooms: use once, then leave -----------------------------
    if ((rt.type === 'shop' || rt.type === 'healing') && !rt.cleared) {
      const c = rt.room.center;
      if (Math.hypot(player.x - c.x, player.y - c.y) < 110) {
        const res = game.interact();
        if (res && res.kind === 'shop') {
          for (const item of rt.shopStock ?? []) {
            if (!item.sold && player.canAfford(item.price)) game.buy(item);
          }
        }
        rt.cleared = true;
      }
    }

    // --- Door travel ------------------------------------------------------
    if (rt.cleared || rt.type === 'start') {
      const node = game.run.currentNode();
      if (node && node.next.length > 0) {
        let inDoorway = false;
        for (const door of rt.room.doors) {
          if (!door.open) continue;
          const cx = door.rect.x + door.rect.w / 2;
          const cy = door.rect.y + door.rect.h / 2;
          if (Math.hypot(player.x - cx, player.y - cy) < 34) { inDoorway = true; break; }
        }
        if (!inDoorway) doorArmed = true;
        else if (doorArmed) {
          doorArmed = false;
          game.travelTo(node.next[0]);
          continue;
        }
      }
    }

    // --- Goal selection ---------------------------------------------------
    let goalX = rt.room.center.x;
    let goalY = rt.room.center.y;
    let engaging = false;

    if (target && !rt.cleared) {
      goalX = target.x;
      goalY = target.y;
      engaging = true;
      // A shieldbearer blocks the arc it faces (§11.7), so chasing its body
      // walks straight into the shield. Instead, approach from a *fixed*
      // side: pick the perpendicular direction the player is already on and
      // orbit to it. A rotating target point makes the bot circle forever
      // without ever committing to a flank.
      if (target.kind === 'shieldbearer') {
        const toPlayer = Math.atan2(player.y - target.y, player.x - target.x);
        // Which side of the shield's facing is the player already closest to?
        let sideSign = Math.sin(toPlayer - target.facing) >= 0 ? 1 : -1;
        // ...but always prefer the side nearest a wall-free approach.
        if (sideSign === 0) sideSign = 1;
        const flankAngle = target.facing + sideSign * (target.def.blockArc + 0.5);
        goalX = target.x + Math.cos(flankAngle) * (target.radius + 26);
        goalY = target.y + Math.sin(flankAngle) * (target.radius + 26);
      }
    } else {
      const node = game.run.currentNode();
      const want = node && node.next.length > 0 ? String(node.next[0]) : null;
      const open = rt.room.doors.filter((d) => d.open);
      const door = (want && open.find((d) => d.targetRoomId === want)) || open[0];
      if (door) {
        goalX = door.rect.x + door.rect.w / 2;
        goalY = door.rect.y + door.rect.h / 2;
      }
    }

    // --- Navigation -------------------------------------------------------
    // Rebuild the grid when the room changes (or when a room clears, since
    // the opening doors change the walkable space), then follow a path to
    // the current goal. Pathfinding rather than raw steering is what keeps
    // this test measuring the game instead of the bot's wall-avoidance.
    const navKey = `${rt.nodeId}:${rt.cleared ? 1 : 0}`;
    if (navRoomId !== navKey) {
      navRoomId = navKey;
      nav = new NavGrid(rt.room.bounds, game.collisionWorld, player.radius);
      path = [];
      repathTimer = 0;
    }

    // Recompute the path when the goal moves meaningfully, or periodically
    // so a shifting enemy does not invalidate it.
    repathTimer -= dt;
    const goalShifted = Math.hypot(goalX - pathGoalX, goalY - pathGoalY) > 50;
    if (nav && (path.length === 0 || goalShifted || repathTimer <= 0)) {
      path = nav.findPath(player.x, player.y, goalX, goalY);
      pathGoalX = goalX;
      pathGoalY = goalY;
      repathTimer = 0.5;
    }

    // Consume waypoints as they are reached.
    while (path.length > 0) {
      const wp = path[0];
      if (Math.hypot(wp.x - player.x, wp.y - player.y) < 26) path.shift();
      else break;
    }

    // --- Repulsion --------------------------------------------------------
    // Enemies push the bot aside, but only lightly: the path is the primary
    // driver, and over-weighting repulsion is what causes a bot to stall
    // against a wall while trying to avoid a crowd.
    let repX = 0;
    let repY = 0;
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const keep = e.kind === 'boss' ? 90 : 42;
      if (d < keep) {
        const w = (keep - d) / keep;
        repX += (dx / d) * w;
        repY += (dy / d) * w;
      }
    }

    // --- Head toward the next waypoint, or straight at the goal ----------
    const navX = path.length > 0 ? path[0].x : goalX;
    const navY = path.length > 0 ? path[0].y : goalY;
    let mx = navX - player.x;
    let my = navY - player.y;

    // Hold the preferred firing distance instead of walking into the body.
    // Backing off is applied *perpendicular to the path* rather than by
    // reversing it: reversing can drive a cornered bot further into the
    // corner, where it can no longer see a route out.
    const want = player.classId === 'warrior' ? 30 : 190;
    if (engaging) {
      const distToTarget = Math.hypot(goalX - player.x, goalY - player.y);
      const inWeaponRange = distToTarget <= (player.classId === 'warrior'
        ? player.weapon.range + 20
        : 620);
      if (inWeaponRange && distToTarget < want * 0.75) {
        const away = Math.atan2(player.y - goalY, player.x - goalX);
        // Blend a gentle retreat into the path direction, keeping forward
        // progress so the bot never stalls.
        mx = mx * 0.45 + Math.cos(away) * 0.55;
        my = my * 0.45 + Math.sin(away) * 0.55;
      }
    }

    mx += repX * 0.5;
    my += repY * 0.5;

    const ml = Math.hypot(mx, my);
    if (ml > 0.001) { mx /= ml; my /= ml; } else { mx = 0; my = 0; }

    game.update(dt, {
      move: { x: mx, y: my },
      aim: target ? toScreen(target.x, target.y) : toScreen(goalX, goalY),
      attackHeld: Boolean(target) && !rt.cleared,
      attackPressed: Boolean(target) && !rt.cleared,
      ultPressed: player.ultReady,
    });

    elapsed += dt;

    // Restore HP immediately after the step so no single burst can end the
    // run while this test is only checking progression.
    player.alive = true;
    player.hp = player.maxHp;

    // The boss room clearing ends the floor.
    if (rt.type === 'boss' && rt.cleared) {
      unsubscribe();
      return { ok: true, elapsed, bosses: bossesThisFloor, room: rt };
    }
  }

  unsubscribe();
  return { ok: false, elapsed, bosses: bossesThisFloor, room: game.rooms.runtime, trail };
}

/* ============================================================
   Driver
   ============================================================ */

/**
 * Play a full three-floor campaign with one class/ultimate pair.
 * @param {string} classId
 * @param {string} ultId
 * @param {number} seed
 */
function campaign(classId, ultId, seed) {
  const bus = new EventBus();
  const state = new StateMachine(bus, 'menu');

  const game = new Game({
    bus,
    state,
    callbacks: {
      onStateChange: () => {},
      onRoomCleared: () => {},
      onBossSpawned: () => {},
      onPlayerDeath: () => {},
      onNotice: () => {},
    },
  });

  game.startRun(classId, ultId, seed);
  const player = game.getPlayer();

  /** @type {string[]} */
  const bosses = [];
  let failure = '';
  /** @type {string[]} trail from the last floor played, for diagnostics */
  let lastTrail = [];

  // The campaign length is game data (CONFIG.run.floors), not a constant the
  // test invents: if the two ever disagree, the victory screen would offer a
  // floor the generator cannot deliver.
  const totalFloors = CONFIG.run.floors;
  for (let floor = 0; floor < totalFloors; floor++) {
    // A generous per-floor budget: a real player clears a floor in a couple
    // of minutes, so a longer limit only avoids failing the test on a slow
    // synthetic clear rather than on a genuine progression bug.
    const result = playFloor(game, player, 1800);
    const bossId = result.bosses[0] ?? '(none)';
    bosses.push(bossId);
    lastTrail = result.trail ?? [];

    if (!result.ok) { failure = `floor ${floor + 1} (${bossId}) not cleared`; break; }
    if (bossId !== BOSS_ORDER[floor]) {
      failure = `floor ${floor + 1} boss was ${bossId}, expected ${BOSS_ORDER[floor]}`;
      break;
    }
    if (floor < totalFloors - 1) {
      game.nextFloor();
      if (game.run.floorIndex !== floor + 1) {
        failure = `nextFloor did not advance (floorIndex=${game.run.floorIndex})`;
        break;
      }
    }
  }

  return { game, player, bosses, failure, trail: lastTrail };
}

const CASES = [
  ['warrior', 'whirlwind'],
  ['warrior', 'berserker_strike'],
  ['mage', 'meteor'],
  ['mage', 'time_stop'],
  ['gunner', 'ricochet'],
  ['gunner', 'combat_stim'],
];

console.log('Campaign test: descend through every floor and rotate all bosses\n');

let failures = 0;

for (const [classId, ultId] of CASES) {
  const { game, player, bosses, failure, trail } = campaign(classId, ultId, 20240607);

  if (failure) {
    failures++;
    console.log(`  FAIL  ${classId}/${ultId}: ${failure}`);
    console.log(`        bosses=${bosses.join(' -> ')} kills=${player.stats.kills}`);
    for (const line of (trail ?? []).slice(-5)) console.log(`        ${line}`);
  } else {
    console.log(
      `  PASS  ${classId}/${ultId}: ${bosses.join(' -> ')}`
      + `  kills=${player.stats.kills} dmg=${Math.round(player.stats.damageDealt)}`
      + ` gold=${player.gold} weapon=${player.weapon.name}`,
    );
  }
  void game;
}

console.log('');
if (failures > 0) {
  console.log(`${failures}/${CASES.length} campaigns failed`);
  process.exit(1);
}
console.log(`All ${CASES.length} campaigns completed: every class reaches and defeats all three bosses`);

