/**
 * Frame profile: where the time actually goes, per weapon.
 *
 * SRP: measure one scene at a time and attribute the cost. `frame-cost.mjs`
 * asserts painted *area* budgets for three fixed scenes; this probe exists to
 * answer "why is this weapon heavy?" with numbers instead of a guess, so it
 * counts work (hits, area hits, particles, texts, events) and *times* the
 * simulation and the render separately.
 *
 * Attribution method: every collaborator the systems call is wrapped before the
 * scene runs, so a counter increments on the real call rather than on a
 * reimplementation of it. Nothing in `src/` is modified or special-cased.
 *
 * Run with:  node tools/perf-profile.mjs
 */

import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');
const { SceneRenderer } = await import('../src/rendering/SceneRenderer.js');
const { RenderSystem } = await import('../src/rendering/RenderSystem.js');
const { getWeapon } = await import('../src/data/weapons.js');

const FRAME = 1 / 60;

/**
 * Seed `Math.random` for the whole run.
 *
 * Combat rolls (crit, explosion chance) and every particle's velocity come from
 * `Math.random`, so two runs of the same scene differ by tens of percent in
 * live-particle count. Without a seed a "before" and "after" number cannot be
 * compared: the difference is smaller than the noise it is being read from.
 */
const SEED = Number(process.argv[2] ?? 20260915);
let _rngState = SEED >>> 0 || 1;
Math.random = () => {
  _rngState = (_rngState + 0x6d2b79f5) >>> 0;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ============================================================
   Render recorder (same contract as frame-cost.mjs)
   ============================================================ */

function makeSilentContext() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  const target = {
    canvas: { width: 0, height: 0 },
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    measureText: () => ({ width: 0 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    ops: 0,
  };
  for (const op of ['fillRect', 'fill', 'stroke', 'strokeRect']) {
    target[op] = () => { target.ops++; };
  }
  return new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : noop),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

globalThis.document = {
  getElementById: () => null,
  documentElement: { style: { setProperty() {} } },
  createElement: (tag) => {
    if (tag !== 'canvas') return { style: {} };
    const el = { width: 0, height: 0 };
    const ctx = makeSilentContext();
    el.getContext = () => ctx;
    el.__ctx = ctx;
    return el;
  },
};

/** Painted area and call counts, in device pixels. */
function makeRecorder(out) {
  const grad = { addColorStop() {} };
  const tf = { a: 1, d: 1 };
  const stack = [];
  let pathArea = 0;
  return {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    lineCap: 'butt', lineDashOffset: 0, font: '', textAlign: 'left', textBaseline: 'top',
    createRadialGradient: () => { out.radial++; return grad; },
    createLinearGradient: () => { out.linear++; return grad; },
    setLineDash() {},
    save() { out.save++; stack.push({ ...tf }); },
    restore() { out.restore++; const s = stack.pop(); if (s) Object.assign(tf, s); },
    translate() {}, rotate() {},
    scale(x, y) { tf.a *= Math.abs(x); tf.d *= Math.abs(y ?? x); },
    setTransform(a, _b, _c, d) { tf.a = Math.abs(a) || 1; tf.d = Math.abs(d) || 1; },
    beginPath() { pathArea = 0; },
    closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, quadraticCurveTo() {},
    arc(_cx, _cy, r) { out.arc++; pathArea = Math.max(pathArea, Math.PI * r * r); },
    rect(_x, _y, w, h) { pathArea = Math.max(pathArea, Math.abs(w * h)); },
    ellipse(_cx, _cy, rx, ry) { out.arc++; pathArea = Math.max(pathArea, Math.PI * rx * ry); },
    fill() { out.fill++; out.painted += pathArea * tf.a * tf.d; pathArea = 0; },
    stroke() { out.stroke++; },
    fillRect(_x, _y, w, h) { out.fillRect++; out.painted += Math.abs(w * h) * tf.a * tf.d; },
    drawImage(_img, ...a) {
      out.blit++;
      const [dw, dh] = a.length >= 8 ? [a[6], a[7]] : [a[2] ?? 0, a[3] ?? 0];
      out.painted += Math.abs(dw * dh) * tf.a * tf.d;
    },
    strokeRect() {}, clearRect() {},
    fillText() { out.fillText++; },
    strokeText() {},
    clip() { out.clip++; },
    measureText: () => ({ width: 0 }),
    getTransform: () => ({ a: tf.a, b: 0, c: 0, d: tf.d, e: 0, f: 0 }),
  };
}

/* ============================================================
   Instrumentation
   ============================================================ */

/**
 * Wrap a method so every call is counted, keeping the original semantics.
 * @param {any} target
 * @param {string} name
 * @param {Record<string, number>} counters
 * @param {string} key
 */
function count(target, name, counters, key = name) {
  const original = target[name];
  if (typeof original !== 'function') return;
  target[name] = function wrapped(...args) {
    counters[key] = (counters[key] ?? 0) + 1;
    return original.apply(this, args);
  };
}

/**
 * Build a scene: a dense pack in front of the player, a given weapon, the
 * trigger held.
 *
 * The pack is a grid pinned in place every frame. That matters for three
 * reasons: the geometry is identical for every weapon, so the comparison is
 * fair; the enemies stay inside each other's 74 px blast radius, which is
 * exactly the arrangement a piercing explosive is built for; and their AI
 * stops contributing variance to the measurement.
 *
 * @param {object} opts
 * @param {string} opts.weaponId
 * @param {number} [opts.cols]
 * @param {number} [opts.rows]
 * @param {number} [opts.spacing]
 * @param {number} [opts.seconds]
 * @returns {any}
 */
function buildScene({ weaponId, cols = 4, rows = 4, spacing = 46, seconds = 6 }) {
  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun('mage', 'meteor', 1234);

  const player = game.getPlayer();
  player.equip(getWeapon(weaponId));

  const rt = game.rooms.runtime;
  rt.cleared = true;

  /** @type {Array<{enemy: any, x: number, y: number}>} */
  const pack = [];
  const types = ['goblin', 'skeleton', 'slime', 'orc', 'enemy_mage'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = player.x + 150 + c * spacing;
      const y = player.y - ((rows - 1) * spacing) / 2 + r * spacing;
      const enemy = game.spawner.spawnEnemy(types[(r * cols + c) % types.length], x, y);
      pack.push({ enemy, x, y });
    }
  }

  const counters = {};
  count(game.combat, 'applyHit', counters, 'applyHit');
  count(game.combat, 'applyAreaHit', counters, 'applyAreaHit');
  count(game.particles, 'burst', counters, 'burst');
  count(game.particles, 'cone', counters, 'cone');
  count(game.floatingText, 'addDamage', counters, 'damageLabels');
  count(game.floatingText, 'add', counters, 'floatingText');
  if (game.decals) count(game.decals, 'add', counters, 'decals');
  count(game.projectiles, 'explode', counters, 'explode');
  count(bus, 'emit', counters, 'events');

  const steps = Math.round(seconds / FRAME);
  /** @type {number[]} */
  const windowMs = [0, 0, 0];
  /** @type {number[]} */
  const samples = [];
  for (let i = 0; i < steps; i++) {
    // Target dummies: pinned and topped up, so the fight never ends and both
    // weapons are measured against the same crowd.
    for (const slot of pack) {
      const e = slot.enemy;
      if (!e.alive) {
        // Revive in place rather than respawning: no new entities, no new ids.
        e.alive = true;
        e.hp = e.maxHp;
      }
      e.hp = e.maxHp;
      e.x = slot.x;
      e.y = slot.y;
      e.vx = 0;
      e.vy = 0;
    }

    const t0 = process.hrtime.bigint();
    game.update(FRAME, {
      move: { x: 0, y: 0 },
      aim: { x: player.x + 400, y: player.y },
      attackHeld: true, attackPressed: i === 0, ultPressed: false,
    });
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    counters.simMs = (counters.simMs ?? 0) + ms;
    counters.frames = (counters.frames ?? 0) + 1;
    samples.push(ms);
    // Three windows: a cost that only appears late is an accumulation bug, not
    // an expensive weapon, and the two need completely different fixes.
    const third = Math.min(2, Math.floor((i / steps) * 3));
    windowMs[third] += ms;
  }

  // A mean hides the thing a player actually feels: one 8 ms spike stalls a
  // 16.6 ms frame budget far more than a uniformly slightly-slow scene.
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const budget = samples.filter((ms) => ms > CONFIG.loop.fixedStep * 1000 * 0.25).length;

  return {
    game,
    bus,
    counters,
    steps,
    pack,
    windowMs,
    windowFrames: steps / 3,
    p50: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
    spikes: budget,
  };
}

/**
 * Time the render of the same scene.
 * @param {any} scene
 * @returns {{ops: any, msPerFrame: number}}
 */
function measureRender(scene) {
  const { game } = scene;
  const canvas = {
    width: CONFIG.view.width, height: CONFIG.view.height,
    clientWidth: CONFIG.view.width, clientHeight: CONFIG.view.height,
    getBoundingClientRect: () => ({
      left: 0, top: 0, width: CONFIG.view.width, height: CONFIG.view.height,
    }),
    getContext: () => makeRecorder(ops),
  };
  const ops = {
    radial: 0, linear: 0, save: 0, restore: 0, fillText: 0,
    arc: 0, fill: 0, fillRect: 0, stroke: 0, clip: 0, blit: 0, painted: 0,
  };
  const render = new RenderSystem(canvas, game.camera);
  const renderer = new SceneRenderer(render);
  renderer.update(FRAME);
  const rt = game.rooms.runtime;
  const player = game.getPlayer();

  const frame = () => renderer.draw({
    room: rt.room, runtime: rt, registry: game.registry,
    projectiles: game.projectiles, particles: game.particles,
    floatingText: game.floatingText, hazards: game.bossController.hazards,
    ultimateVisuals: game.ultimates.visuals, screenFlash: game.screenFlash,
    aimWorld: { x: player.x + 400, y: player.y }, showReticle: true,
  });

  frame(); // warm the caches: only steady-state frames are comparable

  const rounds = 60;
  const readOps = () => ({ ...ops });
  const resetOps = () => { for (const key of Object.keys(ops)) ops[key] = 0; };
  const timeFrames = () => {
    const t = process.hrtime.bigint();
    for (let i = 0; i < rounds; i++) frame();
    return Number(process.hrtime.bigint() - t) / 1e6 / rounds;
  };

  resetOps();
  const withTextMs = timeFrames();
  const withText = readOps();

  // Attribute the cost of the floating damage numbers: the same scene, drawn
  // with the labels removed. The delta is what the numbers themselves cost.
  const savedTexts = game.floatingText.texts.splice(0, game.floatingText.texts.length);
  const textCount = savedTexts.length;
  resetOps();
  const noTextMs = timeFrames();
  const noText = readOps();
  game.floatingText.texts.push(...savedTexts);

  for (const key of Object.keys(ops)) ops[key] = withText[key] / rounds;
  void noText;

  return {
    ops,
    msPerFrame: withTextMs,
    textCount,
    textMs: withTextMs - noTextMs,
  };
}

/* ============================================================
   Run
   ============================================================ */

const SCENES = [
  { label: 'fire_staff (baseline)', weaponId: 'fire_staff' },
  { label: 'ice_staff', weaponId: 'ice_staff' },
  { label: 'sniper_rifle (pierce 6)', weaponId: 'sniper_rifle' },
  { label: 'staff_of_the_void', weaponId: 'staff_of_the_void' },
  { label: 'void, 5x6 pack (30)', weaponId: 'staff_of_the_void', cols: 6, rows: 5, seconds: 8 },
  { label: 'fire, 5x6 pack (30)', weaponId: 'fire_staff', cols: 6, rows: 5, seconds: 8 },
];

console.log('');
console.log('simulation, 4x4 pack pinned in front (unless noted), trigger held:');
console.log(
  '  weapon                    mean   p50   p95    max  spikes  hits/f  area/f  expl/f  burst/f  dmgLbl  merged  events/f  part  proj',
);

/** @type {Array<any>} */
const results = [];
for (const spec of SCENES) {
  // Every scene starts from the same stream, so two weapons meet identical
  // combat rolls and particle jitter and the comparison is not read off noise.
  _rngState = (SEED ^ (spec.label.length * 2654435761)) >>> 0 || 1;
  const scene = buildScene(spec);
  const { counters, steps, game, p50, p95, max, spikes } = scene;
  const per = (key) => (counters[key] ?? 0) / steps;
  console.log(
    `  ${spec.label.padEnd(24)}`
    + `${(counters.simMs / steps).toFixed(3).padStart(6)}`
    + `${p50.toFixed(3).padStart(6)}`
    + `${p95.toFixed(3).padStart(6)}`
    + `${max.toFixed(2).padStart(7)}`
    + `${String(spikes).padStart(8)}`
    + `${per('applyHit').toFixed(1).padStart(8)}`
    + `${per('applyAreaHit').toFixed(1).padStart(8)}`
    + `${per('explode').toFixed(1).padStart(8)}`
    + `${per('burst').toFixed(1).padStart(9)}`
    + `${per('damageLabels').toFixed(1).padStart(8)}`
    + `${String(game.floatingText.merged).padStart(8)}`
    + `${per('events').toFixed(1).padStart(10)}`
    + `${String(game.particles.count).padStart(6)}`
    + `${String(game.projectiles.count).padStart(6)}`,
  );
  const render = measureRender(scene);
  results.push({ ...spec, counters, steps, render, game });
}

console.log('');
console.log('render, steady-state frame (device pixels, per frame):');
console.log(
  '  weapon                   total ms  of which  texts  overdraw   fill  fillRect   arc  stroke  fillText  save',
);
for (const r of results) {
  const o = r.render.ops;
  const overdraw = o.painted / (CONFIG.view.width * CONFIG.view.height);
  console.log(
    `  ${r.label.padEnd(24)}`
    + `${r.render.msPerFrame.toFixed(3).padStart(8)}`
    + `${r.render.textMs.toFixed(3).padStart(10)}`
    + `${String(r.render.textCount).padStart(7)}`
    + `${overdraw.toFixed(1).padStart(9)}x`
    + `${Math.round(o.fill).toString().padStart(7)}`
    + `${Math.round(o.fillRect).toString().padStart(9)}`
    + `${Math.round(o.arc).toString().padStart(6)}`
    + `${Math.round(o.stroke).toString().padStart(8)}`
    + `${Math.round(o.fillText).toString().padStart(9)}`
    + `${Math.round(o.save).toString().padStart(6)}`,
  );
}

console.log('');
console.log('particles by kind (live population at the end of the sim):');
for (const r of results) {
  /** @type {Map<string, number>} */
  const kinds = new Map();
  for (const p of r.game.particles.particles) {
    kinds.set(p.kind ?? p.preset ?? '?', (kinds.get(p.kind ?? p.preset ?? '?') ?? 0) + 1);
  }
  const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  ${r.label.padEnd(24)} ${top.map(([k, n]) => `${k}:${n}`).join('  ') || '(none)'}`);
  console.log(`  ${''.padEnd(24)} dropped by the step budget: peak ${r.game.particles.peakDropped}`);
}

console.log('');
