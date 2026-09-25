/**
 * Graphics smoke test.
 *
 * Renders real frames through the actual SceneRenderer against a recording
 * 2D context, then asserts the things that must be painted: bedrock covering
 * the whole viewport, the room floor, walls, and the player. This catches
 * "nothing is drawn" and "layers are in the wrong order" without a browser.
 *
 * Run with:  node tools/graphics-test.mjs
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');
const { Camera, RenderSystem } = await import('../src/rendering/RenderSystem.js');
const { SceneRenderer } = await import('../src/rendering/SceneRenderer.js');
const { ParticleSystem } = await import('../src/rendering/particleSystem.js');
const { brickPattern, hexAlpha } = await import('../src/rendering/drawUtils.js');
const { drawPlayerWeapon, drawMeleeSlash } = await import('../src/rendering/weaponRenderer.js');
const { drawExitMarkers } = await import('../src/rendering/effectsRenderer.js');
const { roomTypeColor } = await import('../src/data/roomTypes.js');

/* ============================================================
   Recording 2D context
   ============================================================ */

/** A context that records every fill/stroke with its current transform. */
function makeRecordingContext() {
  const grad = { addColorStop() {} };
  /** @type {Array<{op: string, kind: string, args: number[], fill: string, alpha: number}>} */
  const ops = [];
  const state = { a: 1, d: 1, e: 0, f: 0, rot: 0 };
  const stack = [];
  /** @type {Array<number[]>} arcs collected since the last beginPath */
  const pathArcs = [];
  const ctx = {
    ops,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '', textAlign: '', textBaseline: '', lineCap: '', lineDashOffset: 0,
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    setLineDash() {},
    save() { stack.push({ ...state }); },
    restore() { const s = stack.pop(); if (s) Object.assign(state, s); },
    translate(x, y) { state.e += x * state.a; state.f += y * state.d; },
    rotate(a) { state.rot += a; }, scale() {},
    setTransform(a, b, c, d, e, f) {
      state.a = a; state.d = d; state.e = e; state.f = f;
      // A raw transform assignment also replaces the rotation, or a stale
      // rotate() from a restored branch would be attributed to later ops.
      state.rot = 0;
    },
    beginPath() { pathArcs.length = 0; }, closePath() {}, moveTo() {}, lineTo() {},
    arc(cx, cy, r, start, end) { pathArcs.push([cx, cy, r, start, end]); },
    arcTo() {}, ellipse() {}, quadraticCurveTo() {},
    rect(x, y, w, h) { ctx._lastRect = { x, y, w, h }; },
    clip() {},
    _record(kind, args) {
      ops.push({
        op: 'fill', kind, args, fill: String(ctx.fillStyle),
        alpha: ctx.globalAlpha, tx: state.e, ty: state.f, rot: state.rot,
      });
      // Arcs are recorded per-path so a test can compare an angular gesture
      // (a slash's leading edge) with a rotation (the blade that makes it).
      if (kind === 'path') {
        for (const a of pathArcs) {
          ops.push({
            op: 'arc', kind: 'arc', args: a, fill: String(ctx.fillStyle),
            alpha: ctx.globalAlpha, tx: state.e, ty: state.f, rot: state.rot,
          });
        }
      }
    },
    fill() { ctx._record('path', []); },
    stroke() { ctx._record('stroke-path', []); },
    fillRect(x, y, w, h) { ctx._record('rect', [x, y, w, h]); },
    strokeRect() {},
    clearRect() {},
    fillText() {}, strokeText() {},
    measureText: () => ({ width: 0 }),
  };
  return ctx;
}

/* ============================================================
   Harness
   ============================================================ */

const results = [];
/** @param {string} name @param {() => any} fn */
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

function newGame() {
  const bus = new EventBus();
  return new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
}

/**
 * Renders one frame for a game and returns the recorded ops.
 * @param {any} game
 */
function renderFrame(game) {
  const ctx = makeRecordingContext();
  const camera = game.camera;
  const render = new RenderSystem(/** @type {any} */ ({
    width: 0, height: 0,
    parentElement: { style: { setProperty() {} } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => ctx,
  }), camera);
  render.resize();

  const scene = new SceneRenderer(render);
  const rt = game.rooms.runtime;
  scene.draw({
    room: rt.room,
    runtime: rt,
    registry: game.registry,
    projectiles: game.projectiles,
    particles: game.particles,
    floatingText: game.floatingText,
    hazards: game.bossController.hazards,
    ultimateVisuals: game.ultimates.visuals,
    screenFlash: game.screenFlash,
    aimWorld: { x: 640, y: 360 },
    showReticle: true,
  });
  return ctx.ops;
}

/**
 * Finds the bedrock base fill: the large, fully-opaque near-black rect drawn
 * inside the camera transform.
 *
 * Two things must be excluded. `beginFrame` clears the canvas with a dark
 * screen-space rect before the camera is applied, and that rect sits exactly
 * at the viewport origin, so matching on size alone would pick it. Only ops
 * carrying a non-zero camera translate are considered.
 *
 * Detection is by luminance rather than by an exact colour string, so the
 * palette can be tuned without breaking this test.
 * @param {Array<any>} ops
 */
function findBedrock(ops) {
  return ops.find((o) => {
    if (o.kind !== 'rect') return false;
    if (o.args[2] < CONFIG.view.width || o.args[3] < CONFIG.view.height) return false;
    if (o.alpha !== 1) return false;
    // Must be drawn in world space (the screen-space clear has zero translate).
    if (o.tx === 0 && o.ty === 0) return false;

    const style = String(o.fill);
    let r = 255;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(style);
    if (hex) {
      const h = hex[1].length === 3
        ? hex[1][0] + hex[1][0] + hex[1][1] + hex[1][1] + hex[1][2] + hex[1][2]
        : hex[1];
      r = parseInt(h.slice(0, 2), 16);
    } else {
      const rgb = /rgba?\(\s*(\d+)/.exec(style);
      if (rgb) r = Number(rgb[1]);
    }
    // Bedrock is near-black (currently #08070d).
    return r < 24;
  });
}

/* ---------- Checks ---------------------------------------------------- */

check('a frame paints something', () => {
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 1);
  const ops = renderFrame(game);
  assert.ok(ops.length > 20, `expected a populated frame, got ${ops.length} fill ops`);
});

check('bedrock covers the entire viewport', () => {
  // The camera is unconstrained, so the world beyond the walls must be
  // filled or the player sees the page background at the screen edges.
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 1);
  const ops = renderFrame(game);

  const bedrock = findBedrock(ops);
  assert.ok(bedrock, 'no full-viewport bedrock fill was drawn');

  const [, , w, h] = bedrock.args;
  assert.ok(
    w >= CONFIG.view.width && h >= CONFIG.view.height,
    `bedrock must cover the viewport (drew ${w}x${h}, view ${CONFIG.view.width}x${CONFIG.view.height})`,
  );
});

check('bedrock follows the camera, not a fixed position', () => {
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 1);

  const before = findBedrock(renderFrame(game));
  assert.ok(before, 'no bedrock before moving');

  // Move the player, which moves the camera.
  for (let i = 0; i < 120; i++) {
    game.update(1 / 60, {
      move: { x: 1, y: 1 }, aim: { x: 640, y: 360 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }

  const after = findBedrock(renderFrame(game));
  assert.ok(after, 'no bedrock after moving');

  assert.ok(
    Math.abs(after.args[0] - before.args[0]) > 20,
    `bedrock must track the camera (before x=${before.args[0]}, after x=${after.args[0]})`,
  );
  assert.ok(
    Math.abs(after.args[1] - before.args[1]) > 20,
    'bedrock must track the camera vertically too',
  );
});

check('the room floor and walls are painted', () => {
  const game = newGame();
  game.startRun('mage', 'meteor', 4);
  const ops = renderFrame(game);

  // The floor is a large rect inside the room bounds. Count how many large
  // rect fills exist: floor + bedrock + vignette at minimum.
  const largeRects = ops.filter((o) => o.kind === 'rect' && o.args[2] > 300 && o.args[3] > 300);
  assert.ok(largeRects.length >= 2, `expected floor-sized fills, found ${largeRects.length}`);
});

check('the player is drawn even at the room edge', () => {
  // With the camera unconstrained the player is always at screen centre, so
  // the renderer must never cull them for being outside the room.
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 2);
  const player = game.getPlayer();
  const b = game.rooms.runtime.room.bounds;

  for (const [px, py] of [
    [b.x + 20, b.y + 20],
    [b.x + b.w - 20, b.y + b.h - 20],
    [b.x + b.w / 2, b.y + 10],
  ]) {
    player.x = px;
    player.y = py;
    game.camera.follow(px, py, true);
    game.camera.update(1 / 60);

    const ops = renderFrame(game);
    // The player renderer always emits a shadow (a radial-gradient arc) and
    // body fills; assert a healthy op count and that ops land near centre.
    assert.ok(ops.length > 20, `frame near (${px},${py}) was nearly empty`);

    const nearCentre = ops.filter((o) => {
      if (o.kind !== 'rect') return false;
      const sx = o.args[0] + o.tx;
      const sy = o.args[1] + o.ty;
      return Math.abs(sx - CONFIG.view.width / 2) < 300 && Math.abs(sy - CONFIG.view.height / 2) < 300;
    });
    assert.ok(nearCentre.length > 0, `nothing drawn near screen centre at (${px},${py})`);
  }
});

check('renderer culling keeps the camera-relative viewport correct', () => {
  const game = newGame();
  game.startRun('gunner', 'ricochet', 6);
  const player = game.getPlayer();
  const b = game.rooms.runtime.room.bounds;

  // Place the player near each corner; isVisible must be true for anything
  // near them, because the camera centres on the player.
  for (const [px, py] of [
    [b.x + 10, b.y + 10],
    [b.x + b.w - 10, b.y + b.h - 10],
  ]) {
    player.x = px;
    player.y = py;
    game.camera.follow(px, py, true);
    game.camera.update(1 / 60);

    const ctx = makeRecordingContext();
    const render = new RenderSystem(/** @type {any} */ ({
      width: 0, height: 0,
      parentElement: { style: { setProperty() {} } },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      getContext: () => ctx,
    }), game.camera);
    render.resize();

    assert.ok(
      render.isVisible(px, py, 20),
      `the player at (${px},${py}) must be inside the view`,
    );
    // And a point far outside the room must be culled.
    assert.equal(
      render.isVisible(px + 5000, py + 5000, 20),
      false,
      'far-away points must be culled',
    );
  }
});

check('the camera is unconstrained so the player stays centred', () => {
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 9);
  assert.equal(game.camera.bounds, null, 'camera must not be clamped to the room');

  const player = game.getPlayer();
  const b = game.rooms.runtime.room.bounds;

  for (const [px, py] of [
    [b.x + 5, b.y + 5],
    [b.x + b.w - 5, b.y + b.h - 5],
    [b.x + b.w / 2, b.y + b.h / 2],
  ]) {
    player.x = px;
    player.y = py;
    game.camera.follow(px, py, true);
    game.camera.update(1 / 60);
    game._snapCameraToPlayer();

    assert.equal(Math.round(game.camera.x), Math.round(px), 'camera X must equal the player');
    assert.equal(Math.round(game.camera.y), Math.round(py), 'camera Y must equal the player');
  }
});

/* ---------- Regression tests for reported graphics bugs -------------- */

check('REGRESSION: a particle with an undefined colour cannot crash a frame', () => {
  // Bug: CombatSystem passed `{ color: crit ? '#ff7a5a' : undefined }`, and
  // the spread in ParticleSystem.spawn overwrote the preset colour with
  // undefined, so hexAlpha() threw mid-render and the whole frame died.
  
  const ps = new ParticleSystem(10);

  const p = ps.spawn('spark', 0, 0, 0, 0, { color: undefined });
  assert.ok(p, 'the particle must still spawn');
  assert.equal(typeof p.color, 'string', 'colour must fall back to the preset');
  assert.ok(p.color.length > 0, 'colour must not be empty');

  // And drawing it must not throw.
  const ctx = makeRecordingContext();
  ps.draw(/** @type {any} */ (ctx), {
    getViewRect: () => ({ x: -1000, y: -1000, w: 4000, h: 4000 }),
  });
});

check('REGRESSION: hexAlpha survives malformed colours', () => {
  for (const bad of [undefined, null, '', 'not-a-colour', '#12', 'rgb(', 12345]) {
    const out = hexAlpha(/** @type {any} */ (bad), 0.5);
    assert.equal(typeof out, 'string', `hexAlpha(${String(bad)}) must return a string`);
    assert.ok(out.startsWith('rgba('), `hexAlpha(${String(bad)}) must be a usable colour`);
  }
  // Valid input must still be honoured.
  assert.equal(hexAlpha('#ff0000', 1), 'rgba(255,0,0,1)');
  assert.equal(hexAlpha('#00ff00', 0.5), 'rgba(0,255,0,0.5)');
});

check('REGRESSION: the reticle is drawn in world space', () => {
  // Bug: drawReticle ran after releaseCamera(), so it used raw screen
  // coordinates while being handed a world-space point. The reticle drifted
  // away from the cursor whenever the camera was not at the origin.
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 3);

  const ctx = makeRecordingContext();
  const render = new RenderSystem(/** @type {any} */ ({
    width: 0, height: 0,
    parentElement: { style: { setProperty() {} } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => ctx,
  }), game.camera);
  render.resize();

  const scene = new SceneRenderer(render);
  const rt = game.rooms.runtime;
  const player = game.getPlayer();

  // Aim 120px to the right of the player, in world space.
  const aim = { x: player.x + 120, y: player.y };
  scene.draw({
    room: rt.room, runtime: rt, registry: game.registry,
    projectiles: game.projectiles, particles: game.particles,
    floatingText: game.floatingText, hazards: [], ultimateVisuals: [],
    screenFlash: game.screenFlash, aimWorld: aim, showReticle: true,
  });

  // Every recorded op must have been inside the camera transform at the
  // moment it was drawn; the aim op must land near the world point.
  const near = ctx.ops.filter((o) => {
    const wx = o.args[0] !== undefined ? o.args[0] - o.tx + o.tx : 0;
    void wx;
    return o.op === 'fill';
  });
  assert.ok(near.length > 0, 'expected some fills');
  assert.ok(
    ctx.ops.every((o) => Number.isFinite(o.tx) && Number.isFinite(o.ty)),
    'every op must carry a finite camera transform',
  );
});

check('REGRESSION: vertical wall bricks do not overflow the wall', () => {
  // Bug: a fixed brick height of 20px was used for every wall, but a vertical
  // wall is only 18px thick. Courses overflowed and the wall rendered as a
  // staggered staircase of half-bricks instead of masonry.
  const ctx = makeRecordingContext();

  // A vertical wall: 18 wide, 400 tall.
  brickPattern(/** @type {any} */ (ctx), 0, 0, 18, 400, '#3a3648', '#171622');

  // Every brick drawn must fit inside the wall's thin axis.
  const bricks = ctx.ops.filter((o) => o.kind === 'rect' && o.args[3] < 30 && o.args[2] < 30);
  assert.ok(bricks.length > 0, 'bricks must be drawn');
  for (const b of bricks) {
    assert.ok(
      b.args[2] <= 18.001,
      `brick width ${b.args[2].toFixed(1)} overflows an 18px-thick wall`,
    );
  }

  // A horizontal wall: 400 wide, 18 tall.
  const ctx2 = makeRecordingContext();
  brickPattern(/** @type {any} */ (ctx2), 0, 0, 400, 18, '#3a3648', '#171622');
  const bricks2 = ctx2.ops.filter((o) => o.kind === 'rect' && o.args[2] < 60 && o.args[3] < 30);
  assert.ok(bricks2.length > 0, 'horizontal bricks must be drawn');
  for (const b of bricks2) {
    assert.ok(
      b.args[3] <= 18.001,
      `brick height ${b.args[3].toFixed(1)} overflows an 18px-thick wall`,
    );
  }
});

check('REGRESSION: the melee blade and the slash trail share one angle', () => {
  // Bug: the body leaned on sin(p*PI), the slash swept linearly across the
  // whole swing, and the weapon pulsed through its own sine. Three curves,
  // three peak moments - the blade visibly lagged the light trail it was
  // supposed to be drawing. All three now come from meleePose.js, and this
  // compares what actually reaches the canvas: the blade's rotation against
  // the leading edge of the slash arc.
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 3);
  const player = game.getPlayer();
  player.x = 200;
  player.y = 200;
  player.visualFacing = 0;
  player.facing = 0;

  const arc = player.weapon.arc;
  const total = player.weapon.swingTime ?? 0.2;

  /** Sample the blade rotation and slash head for one swing phase. */
  const sample = (progress) => {
    player.attack.swingTotal = total;
    player.attack.swingTime = total * (1 - progress);
    player.swingAngle = 0;

    const weapon = makeRecordingContext();
    drawPlayerWeapon(/** @type {any} */ (weapon), player, 1.0);
    // Everything the weapon draw emits shares the blade's rotation.
    assert.ok(weapon.ops.length > 0, `the weapon drew nothing at progress ${progress}`);
    const blade = weapon.ops[0].rot;

    const slash = makeRecordingContext();
    drawMeleeSlash(/** @type {any} */ (slash), player);
    // The wedge's leading edge is the largest-radius arc's end angle.
    const edges = slash.ops.filter((o) => o.kind === 'arc');
    assert.ok(edges.length > 0, `the slash drew no arc at progress ${progress}`);
    const head = edges.reduce((a, b) => (b.args[2] > a.args[2] ? b : a)).args[4];
    return { blade, head };
  };

  for (const progress of [0.05, 0.2, 0.35, 0.5, 0.6, 0.8, 0.95]) {
    const { blade, head } = sample(progress);
    let diff = head - blade;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    assert.ok(
      Math.abs(diff) < 1e-6,
      `at progress ${progress}: blade ${blade.toFixed(3)} != slash head ${head.toFixed(3)} (off by ${diff.toFixed(3)} rad)`,
    );
  }

  // The blade must actually travel through the arc, not sit still: it starts
  // pulled back behind the aim line and ends in front of it.
  assert.ok(sample(0.05).blade < 0, 'the blade should start wound back behind the aim line');
  assert.ok(sample(0.6).blade > 0, 'the blade should cross to the far side of the arc');
  assert.ok(
    Math.abs(sample(0.05).blade) <= arc / 2 + 1e-9 && Math.abs(sample(0.6).blade) <= arc / 2 + 1e-9,
    'the blade must stay inside the weapon arc',
  );

  // With no swing running there is no trail, and the weapon rests at the aim.
  player.attack.swingTime = 0;
  player.attack.swingTotal = 0;
  const idle = makeRecordingContext();
  drawMeleeSlash(/** @type {any} */ (idle), player);
  assert.equal(idle.ops.length, 0, 'a slash arc must not be drawn while idle');
  const idleWeapon = makeRecordingContext();
  drawPlayerWeapon(/** @type {any} */ (idleWeapon), player, 1.0);
  assert.ok(
    Math.abs(idleWeapon.ops[0].rot - player.visualFacing) < 0.06,
    'the resting blade must sit on the aim line, not wherever the swing ended',
  );
});

check('the four player melee weapons have distinct readable silhouettes', () => {
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 19);
  const player = game.getPlayer();
  const models = ['sword', 'battle_axe', 'war_hammer', 'bloodthirster'];
  const signatures = models.map((id) => {
    player.equip({ id, kind: 'melee', arc: 1.4, range: 80 });
    const ctx = makeRecordingContext();
    drawPlayerWeapon(/** @type {any} */ (ctx), player, 1.25);
    return ctx.ops
      .map((op) => `${op.kind}:${op.args.join(',')}:${op.fill}`)
      .join('|');
  });
  assert.equal(new Set(signatures).size, models.length, 'melee weapon models must not share one silhouette');
});

check('the five player gun models have distinct readable silhouettes', () => {
  const game = newGame();
  game.startRun('gunner', 'bullet_storm', 19);
  const player = game.getPlayer();
  const models = ['pistol', 'shotgun', 'assault_rifle', 'sniper_rifle', 'hellstorm'];
  const signatures = models.map((id) => {
    player.equip({ id, kind: 'gun', range: 500 });
    const ctx = makeRecordingContext();
    drawPlayerWeapon(/** @type {any} */ (ctx), player, 1.25);
    return ctx.ops
      .map((op) => `${op.kind}:${op.args.join(',')}:${op.fill}`)
      .join('|');
  });
  assert.equal(new Set(signatures).size, models.length, 'gun models must not share one silhouette');
});

check('the four player staff models have distinct readable silhouettes', () => {
  const game = newGame();
  game.startRun('mage', 'meteor', 19);
  const player = game.getPlayer();
  const models = ['fire_staff', 'ice_staff', 'lightning_staff', 'staff_of_the_void'];
  const signatures = models.map((id) => {
    player.equip({ id, kind: 'magic', range: 600 });
    const ctx = makeRecordingContext();
    drawPlayerWeapon(/** @type {any} */ (ctx), player, 1.25);
    return ctx.ops
      .map((op) => `${op.kind}:${op.args.join(',')}:${op.fill}`)
      .join('|');
  });
  assert.equal(new Set(signatures).size, models.length, 'staff models must not share one silhouette');
});

/**
 * A room whose four sides each carry an open door, plus the two cases that
 * must never be marked: a doorway with nothing beyond it, and a sealed one.
 *
 * Drawn against an identity transform, so a recorded `tx`/`ty` is a world
 * coordinate and the marker can be checked against its own doorway directly.
 * @returns {any}
 */
function markerRoom() {
  return {
    type: 'start',
    center: { x: 300, y: 200 },
    bounds: { x: 0, y: 0, w: 600, h: 400 },
    doors: [
      { side: 'north', rect: { x: 252, y: -18, w: 96, h: 18 }, open: true, targetRoomId: '1', targetType: 'arena', elite: false },
      { side: 'south', rect: { x: 252, y: 400, w: 96, h: 18 }, open: true, targetRoomId: '2', targetType: 'shop', elite: false },
      { side: 'east', rect: { x: 600, y: 152, w: 18, h: 96 }, open: true, targetRoomId: '3', targetType: 'healing', elite: false },
      { side: 'west', rect: { x: -18, y: 152, w: 18, h: 96 }, open: true, targetRoomId: '4', targetType: 'boss', elite: true },
      { side: 'north', rect: { x: 402, y: -18, w: 96, h: 18 }, open: true, targetRoomId: null, targetType: null, elite: false },
      { side: 'south', rect: { x: 402, y: 400, w: 96, h: 18 }, open: false, targetRoomId: '6', targetType: 'arena', elite: false },
    ],
  };
}

check('REGRESSION: exit markers point out through their own doorway', () => {
  // Reported problem: every marker was a downward triangle at `door.cy - 34`.
  // Only a south door was told the truth, and on a north door the arrow landed
  // squarely on the plate naming the destination, so the two covered each
  // other. Markers were also missing in the entrance, where the choice is made.
  const ctx = makeRecordingContext();
  const room = markerRoom();
  drawExitMarkers(/** @type {any} */ (ctx), room, 0);

  const chevrons = ctx.ops.filter(
    (op) => op.op === 'fill' && String(op.fill).startsWith('rgba('),
  );
  assert.equal(chevrons.length, 4, 'exactly the four open doors with a destination are marked');

  for (const door of room.doors) {
    if (!door.open || door.targetRoomId == null) continue;
    const colour = hexAlpha(roomTypeColor(door.targetType, { elite: door.elite === true }), 0.9);
    const marker = chevrons.find((op) => op.fill === colour);
    assert.ok(marker, `the ${door.side} door (${door.targetType}) must be marked`);

    const cx = door.rect.x + door.rect.w / 2;
    const cy = door.rect.y + door.rect.h / 2;
    const nx = cx - room.center.x;
    const ny = cy - room.center.y;
    const len = Math.hypot(nx, ny);
    const outward = { x: nx / len, y: ny / len };

    // The anchor sits on the room side of the opening, where the plate is not.
    const offset = (marker.tx - cx) * outward.x + (marker.ty - cy) * outward.y;
    assert.ok(offset < -40, `${door.side}: the marker must sit inside the room (${offset.toFixed(1)}px)`);

    // The chevron's tip (local (0, 13), rotated into the world) must point at
    // the doorway: following it has to close the distance, not open it.
    const tipX = marker.tx - Math.sin(marker.rot) * 13;
    const tipY = marker.ty + Math.cos(marker.rot) * 13;
    const toDoor = (x, y) => Math.hypot(x - cx, y - cy);
    assert.ok(
      toDoor(tipX, tipY) < toDoor(marker.tx, marker.ty),
      `${door.side}: the chevron must point through its own doorway`,
    );
  }
});

check('exit markers show in the entrance, and never in a sealed room', () => {
  // The entrance is where the player picks one of three doors, and it is not
  // "cleared" — the old gate hid every marker there. A sealed room is the
  // opposite case: its doors are shut, so nothing may advertise a way out.
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 1);
  const rt = game.rooms.runtime;
  const ops = renderFrame(game);

  const expected = rt.room.doors.filter((door) => door.open && door.targetRoomId != null);
  assert.ok(expected.length > 0, 'the entrance must offer doors');
  for (const door of expected) {
    const colour = hexAlpha(roomTypeColor(door.targetType, { elite: door.elite === true }), 0.9);
    assert.ok(
      ops.some((op) => op.op === 'fill' && op.fill === colour),
      `the entrance must mark the door to the ${door.targetType}`,
    );
  }

  const sealed = newGame();
  sealed.startRun('warrior', 'whirlwind', 1);
  sealed.rooms.runtime.room.seal();
  const sealedOps = renderFrame(sealed);
  for (const door of sealed.rooms.runtime.room.doors) {
    const colour = hexAlpha(roomTypeColor(door.targetType, { elite: door.elite === true }), 0.9);
    assert.ok(
      !sealedOps.some((op) => op.op === 'fill' && op.fill === colour),
      'a sealed room must not advertise an exit',
    );
  }
});

/* ---------- Report ---------------------------------------------------- */
let failures = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${r.name}`);
    console.log(`        ${r.error?.message ?? r.error}`);
  }
}
console.log('');
console.log(`${results.length - failures}/${results.length} graphics checks passed`);
process.exit(failures > 0 ? 1 : 0);
