/**
 * Soak test: play a long campaign headlessly and watch the resources.
 *
 * The failure mode this hunts is *progressive* slowdown - "it felt fine at
 * first, then degraded". That is almost always state that grows while the
 * loop runs: entities never reaped, hazards never expired, listeners never
 * unsubscribed, caches without a bound. Samples are taken at the same phase
 * of every room cycle so a trend cannot hide behind combat noise, and the
 * peak counters catch the other half of the complaint: spikes at explosions,
 * waves and ultimates.
 *
 * Run with:  npm run test:soak     (node --expose-gc so the heap probe can
 * force a collection first; without the flag the heap check is skipped)
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { EventBus, EVENTS } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');
const { SceneRenderer } = await import('../src/rendering/SceneRenderer.js');
const { RenderSystem } = await import('../src/rendering/RenderSystem.js');
const { bossIdForFloor } = await import('../src/systems/RunState.js');
const { getWeapon } = await import('../src/data/weapons.js');

const DT = 1 / 60;
const FLOORS = 8;
const ROOMS_PER_FLOOR = 6;

/** A recording context with no pixel accounting - just a draw that cannot crash. */
function makeRecorder() {
  const grad = { addColorStop() {} };
  return {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    lineCap: 'butt', lineDashOffset: 0, font: '', textAlign: 'left', textBaseline: 'top',
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    setLineDash() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    quadraticCurveTo() {}, rect() {}, ellipse() {}, fill() {}, stroke() {},
    fillRect() {}, strokeRect() {}, clearRect() {}, fillText() {}, strokeText() {},
    clip() {}, setTransform() {}, measureText: () => ({ width: 0 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
}

/**
 * Everything that can grow during play.
 * @param {any} game
 */
function resources(game) {
  return {
    enemies: game.registry.enemies.length,
    liveEnemies: game.registry.enemies.filter((e) => e.alive).length,
    particles: game.particles.count,
    projectiles: game.projectiles.projectiles.length,
    hazards: game.bossController.hazards.length,
    ultVisuals: game.ultimates.visuals.length,
    ultActive: game.ultimates.active.length,
    texts: game.floatingText.texts.length,
    props: game.rooms.runtime?.room.props.length ?? 0,
  };
}

/**
 * Fight a freshly entered room for `seconds`, then (for a boss room) grind the
 * boss down through its phases. `observe` is called periodically with the live
 * resource snapshot: the soak watches the *peaks during* a fight, because
 * everything decays to zero the moment the room ends.
 */
function fightRoom(game, player, seconds, { boss = false, drain = false } = {}, observe = () => {}) {
  const end = Math.round(seconds / DT);
  for (let i = 0; i < end; i++) {
    const target = game.registry.enemies.find((e) => e.alive && e.faction !== 'player');
    const aim = target
      ? { x: target.x, y: target.y }
      : { x: player.x + 200, y: player.y };

    if (drain && i % 120 === 0 && player.ultReady) {
      game.update(DT, {
        move: { x: 0, y: 0 }, aim,
        attackHeld: false, attackPressed: false, ultPressed: true, dashPressed: false,
      });
    }

    game.update(DT, {
      move: { x: target ? Math.sign(target.x - player.x) : 0, y: 0 },
      aim,
      attackHeld: true,
      attackPressed: i === 0,
      ultPressed: false,
      dashPressed: i % 150 === 0,
    });

    // The player survives the soak (death is covered by the campaign sim);
    // enemies are thinned on a fixed cycle so rooms actually end - slowly
    // enough that full waves exist for seconds at a time and fight back.
    player.hp = player.maxHp;
    if (i % 10 === 0) observe(game);
    if (i % 240 === 0) {
      for (const e of game.registry.enemies) {
        if (!e.alive || e.kind === 'boss') continue;
        game.combat.applyHit(e, { damage: 99999 }, player);
      }
    }
    if (boss && i % 6 === 0) {
      const b = game.registry.enemies.find((e) => e.kind === 'boss' && e.alive);
      if (b) game.combat.applyHit(b, { damage: 9 }, player);
    }
  }
}

/* ---------------------------- the soak ---------------------------- */

console.log('Soak test: a long campaign, watching every resource that can grow\n');

const bus = new EventBus();
const state = new StateMachine(bus, 'menu');
const game = new Game({
  bus, state,
  callbacks: {
    onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
    onPlayerDeath() {}, onNotice() {},
  },
});
const render = new RenderSystem(/** @type {any} */ ({
  width: CONFIG.view.width, height: CONFIG.view.height,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: CONFIG.view.width, height: CONFIG.view.height }),
  getContext: makeRecorder,
}), game.camera);
render.resize();
const scene = new SceneRenderer(render);

game.startRun('warrior', 'whirlwind', 90210);
const player0 = game.getPlayer();
let player = player0;
let nextRoomId = 1000;

/** @type {Array<{snap: any, roomType: string, floor: number}>} */
const samples = [];
const peak = { particles: 0, projectiles: 0, hazards: 0, texts: 0, liveEnemies: 0 };
/** Baseline listener counts, taken after boot has finished wiring. */
const listenerBaseline = {};
for (const ev of Object.values(EVENTS)) listenerBaseline[ev] = bus.listenerCount(ev);

let renderMsTotal = 0;
let renderFrames = 0;

for (let floor = 0; floor < FLOORS; floor++) {
  if (floor > 0) {
    game.nextFloor();
    player = game.getPlayer();
  }

  for (let room = 0; room < ROOMS_PER_FLOOR; room++) {
    const isBoss = room === ROOMS_PER_FLOOR - 1;
    const type = isBoss ? 'boss' : (room % 3 === 2 ? 'shop' : 'arena');
    const node = { id: nextRoomId++, type, next: [], depth: room, arenaTier: (room % 2) + 1 };

    // Every third room is played by a full-auto gunner: melee classes never
    // produce the projectile/particle peaks a Hellstorm + ricochet ult does,
    // and those peaks are exactly what the frame budget must survive.
    if (room % 3 === 0) {
      player.classId = 'gunner';
      player.equip(getWeapon('hellstorm'));
      player.ultimateId = 'ricochet';
    } else {
      player.classId = 'warrior';
      player.equip(getWeapon('sword'));
      player.ultimateId = 'whirlwind';
    }

    // rooms.enter builds geometry, seals the arena and spawns the boss -
    // exactly what RunState.enterNode would do, but for a synthetic node.
    game.rooms.enter(node, player, floor, isBoss ? bossIdForFloor(floor) : undefined);

    fightRoom(game, player, isBoss ? 40 : (type === 'shop' ? 6 : 14), {
      boss: isBoss,
      drain: !isBoss && room % 2 === 0,
    }, (g) => {
      const live = resources(g);
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], live[k] ?? 0);
    });

    // Draw one frame of every room so the render path itself is watched for
    // growth (caches, retained sprites, accidental per-frame allocation).
    const rt = game.rooms.runtime;
    const t0 = Date.now();
    scene.draw({
      room: rt.room, runtime: rt, registry: game.registry,
      projectiles: game.projectiles, particles: game.particles,
      floatingText: game.floatingText, hazards: game.bossController.hazards,
      ultimateVisuals: game.ultimates.visuals, screenFlash: game.screenFlash,
      aimWorld: { x: player.x + 200, y: player.y }, showReticle: true,
    });
    renderMsTotal += Date.now() - t0;
    renderFrames++;

    const snap = resources(game);
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], snap[k] ?? 0);
    samples.push({ snap, roomType: type, floor });
  }
}

/* ---------------------------- checks ---------------------------- */

const results = [];
let failures = 0;
/** @param {string} name @param {() => void} fn */
function check(name, fn) {
  try {
    fn();
    results.push(`PASS  ${name}`);
  } catch (err) {
    failures++;
    results.push(`FAIL  ${name}\n      ${err.message.split('\n')[0]}`);
  }
}

check('no event listener leaks across the whole soak', () => {
  for (const ev of Object.values(EVENTS)) {
    const n = bus.listenerCount(ev);
    assert.ok(
      n <= listenerBaseline[ev],
      `${ev}: ${n} listeners at the end vs ${listenerBaseline[ev]} at boot`,
    );
  }
});

check('resource sets return to baseline at the same room phase', () => {
  // Compare the two halves of the soak sample-by-sample at identical phases:
  // if a room cycle leaves residue, the second half sits visibly higher.
  const half = Math.floor(samples.length / 2);
  const avg = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  for (const key of ['liveEnemies', 'hazards', 'ultVisuals', 'ultActive', 'texts']) {
    const a = avg(samples.slice(0, half).map((s) => s.snap[key]));
    const b = avg(samples.slice(half).map((s) => s.snap[key]));
    assert.ok(b <= a * 1.5 + 2, `${key} grows: first half avg ${a.toFixed(1)} -> second half ${b.toFixed(1)}`);
  }
});

check('props never accumulate inside a room', () => {
  // Decals and future room decorations land in room.props; they must be
  // bounded per room even when the player never leaves.
  for (const s of samples) {
    assert.ok(s.snap.props <= 64, `a room held ${s.snap.props} props`);
  }
});

check('combat peaks stayed inside hard caps', () => {
  // The soak must actually stress the effects, or it proves nothing.
  assert.ok(peak.particles >= 150,
    `the soak never stressed particles (peak ${peak.particles}) - not a real soak`);
  assert.ok(peak.particles <= game.particles.maxParticles,
    `particle peak ${peak.particles} exceeded the hard ceiling`);
  assert.ok(peak.projectiles < 140, `projectile peak ${peak.projectiles}`);
  assert.ok(peak.hazards < 24, `hazard peak ${peak.hazards} - hazards are not expiring`);
  assert.ok(peak.texts < 160, `floating text peak ${peak.texts}`);
});

check('the per-step emission budget engages under an effect pile-up', () => {
  // Several simultaneous explosions inside one step is the case the cap
  // exists for: prove it trims the tail instead of stalling the frame, and
  // that the following step gets its full allowance back.
  const ps = game.particles;
  const before = ps.count;
  ps.beginStep();
  for (let i = 0; i < 8; i++) ps.burst('explosion', 0, 0, 60, { speed: 300 });
  const droppedInStep = ps.dropped;
  assert.ok(droppedInStep > 0,
    'an 8x60-particle pile-up must be throttled, nothing was dropped');
  assert.ok(ps.count - before <= CONFIG.render.particleStepBudget,
    'a single step must never emit more than the budget');

  // peakDropped is settled by the *next* beginStep, which is where the
  // worst step so far is recorded for the perf tools.
  ps.beginStep();
  assert.equal(ps.dropped, 0, 'a fresh step must reset the drop counter');
  assert.ok(ps.peakDropped >= droppedInStep, 'the peak counter must record the worst step');
  assert.ok(ps.spawn('spark', 0, 0, 1, 1), 'a fresh step must accept particles again');
});

check('8 floors, 48 rooms, 8 boss fights survived', () => {
  assert.equal(game.getPlayer(), player0, 'one player across the whole soak');
  assert.ok(game.rooms.runtime, 'a room exists at the end');
  assert.equal(game.run.floorIndex, FLOORS - 1);
});

if (typeof globalThis.gc === 'function') {
  check('the heap stays bounded across the soak', () => {
    globalThis.gc();
    const mb = process.memoryUsage().heapUsed / (1024 * 1024);
    assert.ok(mb < 80, `heap after the soak: ${mb.toFixed(1)}MB`);
  });
  check('no quadratic growth in the draw path', () => {
    const ms = renderMsTotal / renderFrames;
    // Node with a no-op context is not a browser; this guards algorithmic
    // blow-up (drawing that walks retained state that never gets released),
    // not rasterization cost.
    assert.ok(ms < 6, `avg render frame ${ms.toFixed(2)}ms with a no-op rasterizer`);
  });
}

for (const line of results) console.log(`  ${line}`);
console.log('');
console.log(`  ${samples.length} rooms · floors ${game.run.floorIndex + 1} · peak: particles ${peak.particles}, projectiles ${peak.projectiles}, hazards ${peak.hazards}, texts ${peak.texts}`);
console.log(`${results.length - failures}/${results.length} soak checks passed${typeof globalThis.gc === 'function' ? '' : '  (run with --expose-gc for the heap checks)'}`);
process.exit(failures > 0 ? 1 : 0);
