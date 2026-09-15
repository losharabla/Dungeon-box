/**
 * Frame-cost probe and assertion.
 *
 * Counts the per-frame drawing operations the renderers actually issue, in
 * three scenes: an empty room, a busy arena, a boss fight, and then fails the
 * run if the busy arena has regressed past its gradient budget.
 *
 * `createRadialGradient` / `createLinearGradient` are the expensive ones in a
 * browser: each allocates a gradient object and forces the rasteriser to
 * resample it per pixel, which is why a frame with thousands of them drops
 * the framerate long before any game logic does. Soft blobs (glow, shadow)
 * therefore reuse one cached unit gradient per colour, painted through the
 * context transform, and the frame budget below asserts that this actually
 * holds.
 *
 * Two details make the numbers mean something:
 *
 *   - the recorder exposes `getTransform()`, because that is the capability
 *     the render helpers use to detect a real Canvas 2D context; without it
 *     the probe would measure the headless fallback path rather than the path
 *     a player's browser takes;
 *   - the measured frame is a *steady-state* frame: the scene is drawn once
 *     to warm the caches, and only the second frame is counted. In the
 *     browser a canvas context lives for the whole session, so a per-frame
 *     cost that only appears on the first frame is not a per-frame cost.
 *
 * Run with:  node tools/frame-cost.mjs
 * Exits 1 when a budget is missed.
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');
const { SceneRenderer } = await import('../src/rendering/SceneRenderer.js');
const { RenderSystem } = await import('../src/rendering/RenderSystem.js');
const { getWeapon } = await import('../src/data/weapons.js');

/**
 * Per-frame ceilings for the busy arena, the scene a player actually fights
 * in. Baseline before the glow/shadow caching was 38 radial / 5 linear; the
 * gradient budget here is the regression guard.
 */
const BUDGETS = {
  'busy arena (many enemies)': { radial: 15, linear: 25 },
  /**
   * The Staff of the Void pierces every body in its path and detonates on half
   * of them, so it lands ~13x the hits of a normal weapon and used to multiply
   * everything downstream: labels, impact bursts and draw calls.
   *
   * These ceilings are what the *fixed* build measures (`tools/perf-profile.mjs`
   * reports the same scene), with headroom for a different combat roll. If a
   * future change reintroduces one effect per hit, at least one of them trips.
   */
  'void staff (piercing pack)': { fillText: 60, arc: 600, save: 420 },
};

/**
 * Counts that are not context operations but bound the same thing: how many
 * particles a frame is asked to carry, and how hard the emission budget is
 * being hit. `peakDropped` is the honest one - a build that blows the budget
 * is silently dropping effects the player was promised.
 */
const WORK_BUDGETS = {
  'void staff (piercing pack)': { particles: 420, peakDropped: 160 },
};

/**
 * Painted device-pixels per frame divided by viewport pixels: how many full
 * screen passes the GPU must blend, in source order, whatever the number of
 * draw calls. Call-count budgets hide the expensive kind of frame - a
 * handful of full-viewport gradient fills costs more than a hundred 2px
 * rects - so this is the number that actually predicts FPS.
 */
const AREA_BUDGETS = {
  'empty start room': 10,
  'busy arena (many enemies)': 14,
  'boss fight (golem)': 14,
  'void staff (piercing pack)': 14,
};

const stats = {
  radial: 0, linear: 0, save: 0, restore: 0, fillText: 0,
  arc: 0, fill: 0, fillRect: 0, stroke: 0, clip: 0, blit: 0,
  painted: 0, path: 0,
};
/** A context that records into nowhere - used by offscreen bake canvases. */
function makeSilentContext() {
  const grad = { addColorStop() {} };
  const noop = () => {};
  const target = {
    canvas: { width: 0, height: 0 },
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    measureText: () => ({ width: 0 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    // Painted primitives per bake surface: proves the layer was really drawn,
    // not just allocated with the right rect.
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

/** The bake path needs a canvas factory; a browser has one, this stubs it. */
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

/**
 * A recording context: no pixels, just call counts and painted area.
 *
 * Areas are tracked in *device* pixels, i.e. multiplied by the scale the
 * renderer's current transform applies, because fillrate - how many times a
 * screen pixel gets blended - is what predicts FPS, not the number of calls.
 * save/restore must snapshot the transform or every `glow` scale leaks into
 * the next measurement.
 *
 * This context also implements `drawImage`, and the harness below hands
 * `document.createElement('canvas')` a stub - so what gets measured here is
 * the *baked* path the browser takes, not the live fallback the recording
 * contexts of graphics-test deliberately keep exercising.
 */
function makeRecorder() {
  const grad = { addColorStop() {} };
  const tf = { a: 1, d: 1 };
  const stack = [];
  const count = (key) => () => { stats[key]++; };
  return {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    lineCap: 'butt', lineDashOffset: 0, font: '', textAlign: 'left', textBaseline: 'top',
    createRadialGradient: () => { stats.radial++; return grad; },
    createLinearGradient: () => { stats.linear++; return grad; },
    setLineDash() {},
    save() { stats.save++; stack.push({ ...tf }); },
    restore() { stats.restore++; const s = stack.pop(); if (s) Object.assign(tf, s); },
    translate() {}, rotate() {},
    scale(x, y) { tf.a *= Math.abs(x); tf.d *= Math.abs(y ?? x); },
    setTransform(a, _b, _c, d) { tf.a = Math.abs(a) || 1; tf.d = Math.abs(d) || 1; },
    beginPath() { stats.path = 0; },
    closePath() {}, moveTo() {}, lineTo() {},
    arc(_cx, _cy, r) { stats.arc++; stats.path = Math.max(stats.path, Math.PI * r * r); },
    arcTo() {}, quadraticCurveTo() {},
    rect(_x, _y, w, h) { stats.path = Math.max(stats.path, Math.abs(w * h)); },
    ellipse(_cx, _cy, rx, ry) { stats.arc++; stats.path = Math.max(stats.path, Math.PI * rx * ry); },
    fill() { stats.fill++; stats.painted += stats.path * tf.a * tf.d; stats.path = 0; },
    stroke: count('stroke'),
    fillRect(_x, _y, w, h) { stats.fillRect++; stats.painted += Math.abs(w * h) * tf.a * tf.d; },
    // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh): the destination rect is
    // in world units and carries the area a blit really costs.
    drawImage(_img, ...a) {
      stats.blit++;
      const [dw, dh] = a.length >= 8 ? [a[6], a[7]] : [a[2] ?? 0, a[3] ?? 0];
      stats.painted += Math.abs(dw * dh) * tf.a * tf.d;
    },
    strokeRect() {}, clearRect() {},
    fillText: count('fillText'), strokeText() {},
    clip: count('clip'),
    measureText: () => ({ width: 0 }),
    // A real CanvasRenderingContext2D has this; the render helpers probe it to
    // decide whether the context honours a gradient painted through the CTM.
    getTransform: () => ({ a: tf.a, b: 0, c: 0, d: tf.d, e: 0, f: 0 }),
  };
}

/**
 * One scene: run the simulation for a while, then draw two frames and report
 * the operation counts of the second (steady state).
 */
/**
 * One scene: run the simulation for a while, then draw two frames and report
 * the operation counts of the second (steady state).
 * @param {string} label
 * @param {(game: any) => void} setup
 * @param {{classId?: string, ultimateId?: string, weaponId?: string}} [opts]
 */
function measure(label, setup, opts = {}) {
  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun(opts.classId ?? 'gunner', opts.ultimateId ?? 'ricochet', 99);
  if (opts.weaponId) game.getPlayer().equip(getWeapon(opts.weaponId));
  setup(game);

  // Simulate long enough for the scene to reach steady state (projectiles,
  // particles, and status effects all up).
  const p = game.getPlayer();
  for (let i = 0; i < 60 * 4; i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 },
      aim: { x: p.x + 300, y: p.y },
      attackHeld: true, attackPressed: i === 0, ultPressed: i === 120,
    });
  }

  const canvas = {
    width: CONFIG.view.width, height: CONFIG.view.height,
    clientWidth: CONFIG.view.width, clientHeight: CONFIG.view.height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: CONFIG.view.width, height: CONFIG.view.height }),
    getContext: makeRecorder,
  };
  const render = new RenderSystem(canvas, game.camera);
  const scene = new SceneRenderer(render);
  scene.update(1 / 60);
  const rt = game.rooms.runtime;

  const frame = () => scene.draw({
    room: rt.room, runtime: rt, registry: game.registry,
    projectiles: game.projectiles, particles: game.particles,
    floatingText: game.floatingText, hazards: game.bossController.hazards,
    ultimateVisuals: game.ultimates.visuals, screenFlash: game.screenFlash,
    aimWorld: { x: p.x + 300, y: p.y }, showReticle: true,
  });

  // A fresh game every process start, so one scene's cold caches cannot be
  // charged to another scene's steady-state figure.
  frame();
  const before = { ...stats };
  frame();

  const frameStats = {
    radial: stats.radial - before.radial,
    linear: stats.linear - before.linear,
    save: stats.save - before.save,
    fillRect: stats.fillRect - before.fillRect,
    arc: stats.arc - before.arc,
    fill: stats.fill - before.fill,
    stroke: stats.stroke - before.stroke,
    fillText: stats.fillText - before.fillText,
    clip: stats.clip - before.clip,
    blit: stats.blit - before.blit,
    overdraw: (stats.painted - before.painted) / (CONFIG.view.width * CONFIG.view.height),
  };
  measured.push({ label, stats: frameStats, game, scene, room: rt.room });

  console.log(
    `${label.padEnd(24)} radial ${String(frameStats.radial).padStart(4)}` +
    ` linear ${String(frameStats.linear).padStart(3)}` +
    ` save ${String(frameStats.save).padStart(4)}` +
    ` fillRect ${String(frameStats.fillRect).padStart(4)}` +
    ` arc ${String(frameStats.arc).padStart(4)}` +
    ` fill ${String(frameStats.fill).padStart(4)}` +
    ` stroke ${String(frameStats.stroke).padStart(4)}` +
    ` fillText ${String(frameStats.fillText).padStart(4)}` +
    ` clip ${String(frameStats.clip).padStart(3)}` +
    ` blit ${String(frameStats.blit).padStart(2)}` +
    ` | overdraw ${frameStats.overdraw.toFixed(1)}x` +
    ` | part ${String(game.particles.count).padStart(3)}` +
    ` (-${String(game.particles.peakDropped).padStart(3)})` +
    ` proj ${String(game.projectiles.projectiles.length).padStart(2)}` +
    ` en ${game.registry.enemies.filter((e) => e.alive).length}` +
    ` lbl ${String(game.floatingText.texts.length).padStart(3)}` +
    ` (merged ${game.floatingText.merged})`,
  );
}

/** @type {Array<{label: string, stats: any, game: any}>} */
const measured = [];

/* ---------- scenes ---------- */

measure('empty start room', (game) => {
  for (const e of game.registry.enemies) e.kill();
});

measure('busy arena (many enemies)', (game) => {
  const rt = game.rooms.runtime;
  rt.cleared = true;
  for (let i = 0; i < 18; i++) {
    game.spawner.spawnEnemy(['goblin', 'skeleton', 'slime', 'orc', 'enemy_mage'][i % 5],
      game.getPlayer().x + 120 + i * 18, game.getPlayer().y + (i % 3) * 40);
  }
});

measure('boss fight (golem)', (game) => {
  game.run.enterNode(game.run.plan.bossId, game.getPlayer());
});

/**
 * The exotic-weapon case: a piercing shot that detonates inside a packed
 * crowd. This is the scene that regressed when every hit produced its own
 * damage label and its own full impact burst, so it is measured explicitly.
 */
measure('void staff (piercing pack)', (game) => {
  const rt = game.rooms.runtime;
  rt.cleared = true;
  const p = game.getPlayer();
  const types = ['goblin', 'skeleton', 'slime', 'orc', 'enemy_mage'];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const enemy = game.spawner.spawnEnemy(
        types[(r * 4 + c) % types.length],
        p.x + 150 + c * 46,
        p.y - 69 + r * 46,
      );
      // Target dummies: the crowd must survive to be hit again next volley,
      // otherwise the scene measures an empty room after two shots.
      enemy.hp = 100000;
      enemy.maxHp = 100000;
    }
  }
}, { classId: 'mage', ultimateId: 'meteor', weaponId: 'staff_of_the_void' });

/* ---------- baked layers ---------- */

/**
 * The wall/vignette layers are baked once per room and blitted every frame,
 * so a bake rectangle that does not cover `room.walls` silently crops the
 * masonry and the room renders as a bare rectangle. No headless pixel test
 * can see this (the browser takes the baked path, tools do not), so the
 * coverage is asserted structurally here, where the baked path runs.
 */
let bakeFailures = 0;
for (const { label, scene, room } of measured) {
  const bake = scene.baker.current;
  if (!bake) {
    console.log(`  FAIL  ${label}: the bake path did not run in this harness`);
    bakeFailures++;
    continue;
  }
  const layer = bake.walls;
  if (!layer.canvas.__ctx || layer.canvas.__ctx.ops === 0) {
    console.log(`  FAIL  ${label}: the baked wall layer was allocated but nothing was painted into it`);
    bakeFailures++;
  }
  for (const wall of room.walls) {
    const covers = layer.x <= wall.x && layer.y <= wall.y
      && layer.x + layer.w >= wall.x + wall.w
      && layer.y + layer.h >= wall.y + wall.h;
    if (!covers) {
      console.log(`  FAIL  ${label}: baked wall layer does not cover wall ` +
        `{x:${wall.x}, y:${wall.y}, w:${wall.w}, h:${wall.h}}`);
      bakeFailures++;
    }
  }
  if (!bakeFailures) {
    console.log(`  PASS  ${label}: the baked wall layer covers all ${room.walls.length} wall blocks`);
  }
}
if (bakeFailures === 0) {
  console.log('  PASS  every wall block is inside the baked wall layer');
}

/* ---------- assertions ---------- */

console.log('');

let failures = 0;
for (const { label, stats: s, game } of measured) {
  const budget = BUDGETS[label];
  if (budget) {
    for (const [op, max] of Object.entries(budget)) {
      try {
        assert.ok(
          s[op] <= max,
          `${label}: ${op} per frame ${s[op]} exceeds budget ${max}`,
        );
        console.log(`  PASS  ${label}: ${op} ${s[op]} <= ${max}`);
      } catch (err) {
        failures++;
        console.log(`  FAIL  ${err.message}`);
      }
    }
  }
  const area = AREA_BUDGETS[label];
  if (area !== undefined) {
    try {
      assert.ok(
        s.overdraw <= area,
        `${label}: painted ${s.overdraw.toFixed(1)}x the viewport exceeds budget ${area}x`,
      );
      console.log(`  PASS  ${label}: overdraw ${s.overdraw.toFixed(1)}x <= ${area}x`);
    } catch (err) {
      failures++;
      console.log(`  FAIL  ${err.message}`);
    }
  }

  const work = WORK_BUDGETS[label];
  if (work) {
    const actual = {
      particles: game.particles.count,
      peakDropped: game.particles.peakDropped,
    };
    for (const [key, max] of Object.entries(work)) {
      try {
        assert.ok(
          actual[key] <= max,
          `${label}: ${key} ${actual[key]} exceeds budget ${max}`,
        );
        console.log(`  PASS  ${label}: ${key} ${actual[key]} <= ${max}`);
      } catch (err) {
        failures++;
        console.log(`  FAIL  ${err.message}`);
      }
    }
  }
}

if (failures > 0) {
  console.log('');
  console.log(`${failures} frame-cost budget(s) missed`);
  process.exit(1);
}
console.log('  PASS  all frame-cost budgets met');
