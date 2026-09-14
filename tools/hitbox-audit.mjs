/**
 * @fileoverview Hitbox audit: compare what is *drawn* with what can be *hit*.
 *
 * Enemy sprites are drawn standing above their ground point, while collision
 * used a circle centred on that point. The two only agree near the feet, so
 * anything aimed at a torso or head flew through it. This tool measures the
 * real painted silhouette of every enemy (and boss) through the actual
 * renderer, then reports how much of it the hit volume covers.
 *
 * The measuring context tracks the full affine transform and the path being
 * built, so arcs, ellipses, curves and rotated rectangles all contribute
 * their true screen extent. Gradients (ground shadows, glows) and additive
 * ('lighter') passes are excluded: they are atmosphere, not body.
 *
 * Usage:  node tools/hitbox-audit.mjs [--verbose]
 * Exits 1 when a drawn body is not adequately covered by its hit volume.
 */

import { CONFIG } from '../src/core/Config.js';
import { ENEMIES } from '../src/data/enemies.js';
import { BOSSES } from '../src/data/bosses.js';
import { pointVsHitVolume } from '../src/core/Collision.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Enemy } = await import('../src/entities/Enemy.js');
const { Boss } = await import('../src/entities/Boss.js');
const { drawEnemy } = await import('../src/rendering/entityRenderer.js');
const { drawBoss } = await import('../src/rendering/bossRenderer.js');

const VERBOSE = process.argv.includes('--verbose');

/* ============================================================
   Measuring context
   ============================================================ */

/**
 * A 2D context that records the screen-space bounding box of everything
 * painted in solid colour.
 */
function makeMeasureContext() {
  /** @type {Array<object>} */
  const stack = [];
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  /** Points of the path currently being built, in local space. */
  let path = [];
  let composite = 'source-over';

  const emptyBox = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const body = emptyBox();
  const additive = emptyBox();
  /**
   * Every boundary point painted in solid colour. Testing these is stricter
   * than it looks: a filled path is contained in the convex hull of its own
   * boundary, so if the whole outline sits inside the (convex) hit volume,
   * the whole filled body does too. Sampling a bounding box instead would
   * punish round bodies for the empty corners of their box.
   */
  const outline = [];

  /** @param {any} box @param {number} x @param {number} y */
  const grow = (box, x, y) => {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
  };

  /** @param {number} x @param {number} y */
  const toScreen = (x, y) => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });

  /** @param {number} x @param {number} y */
  const point = (x, y) => {
    const p = toScreen(x, y);
    grow(composite === 'lighter' ? additive : body, p.x, p.y);
    if (composite !== 'lighter' && outline.length < 60000) outline.push(p);
  };

  /** Paint-style test: a gradient object is an effect, a string is a body. */
  const isSolid = (/** @type {any} */ style) => typeof style === 'string';

  const commit = (/** @type {any} */ style) => {
    if (!isSolid(style)) return;
    for (const p of path) point(p.x, p.y);
  };

  const push = (/** @type {number} */ x, /** @type {number} */ y) => path.push({ x, y });

  return {
    body,
    additive,
    outline,
    get globalCompositeOperation() { return composite; },
    set globalCompositeOperation(v) { composite = v; },
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineDashOffset: 0,
    font: '',
    textAlign: '',
    textBaseline: '',

    save() {
      stack.push({ m: { ...m }, composite });
    },
    restore() {
      const s = stack.pop();
      if (s) {
        m = s.m;
        composite = s.composite;
      }
    },
    translate(x, y) {
      m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y };
    },
    rotate(r) {
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      m = {
        a: m.a * cos + m.c * sin,
        b: m.b * cos + m.d * sin,
        c: m.a * -sin + m.c * cos,
        d: m.b * -sin + m.d * cos,
        e: m.e,
        f: m.f,
      };
    },
    scale(x, y) {
      m = { a: m.a * x, b: m.b * x, c: m.c * y, d: m.d * y, e: m.e, f: m.f };
    },
    setTransform(a, b, c, d, e, f) {
      m = { a, b, c, d, e, f };
    },
    getTransform() {
      return { ...m };
    },

    beginPath() { path = []; },
    closePath() {},
    moveTo(x, y) { push(x, y); },
    lineTo(x, y) {
      // Densify straight edges too. Body parts are separate polygons that
      // overlap; without points along their edges, two crossing polygons look
      // like two disconnected blobs and the silhouette splits in the middle.
      const last = path[path.length - 1];
      if (!last) { push(x, y); return; }
      const span = Math.hypot(x - last.x, y - last.y);
      const steps = Math.max(1, Math.ceil(span / 3));
      for (let i = 1; i <= steps; i++) {
        push(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps);
      }
    },
    quadraticCurveTo(cx, cy, x, y) {
      // Flatten by arc length (~3px per step) so clustering sees a dense,
      // evenly spaced outline on shapes of every size.
      const last = path[path.length - 1] ?? { x: 0, y: 0 };
      const span = Math.hypot(cx - last.x, cy - last.y) + Math.hypot(x - cx, y - cy);
      const steps = Math.max(4, Math.ceil(span / 3));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        push(
          u * u * last.x + 2 * u * t * cx + t * t * x,
          u * u * last.y + 2 * u * t * cy + t * t * y,
        );
      }
    },
    arc(cx, cy, r, start, end) {
      const span = Math.abs(end - start);
      const steps = Math.max(8, Math.ceil((r * span) / 3));
      for (let i = 0; i <= steps; i++) {
        const a = start + (end - start) * (i / steps);
        push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    },
    ellipse(cx, cy, rx, ry, rot, start, end) {
      const span = Math.abs(end - start);
      const steps = Math.max(12, Math.ceil((Math.max(rx, ry) * span) / 3));
      for (let i = 0; i <= steps; i++) {
        const a = start + (end - start) * (i / steps);
        const px = Math.cos(a) * rx;
        const py = Math.sin(a) * ry;
        push(cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot));
      }
    },
    arcTo(x1, y1, x2, y2) { push(x1, y1); push(x2, y2); },
    rect(x, y, w, h) { push(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h); },
    clip() {},
    fill() { commit(this.fillStyle); },
    stroke() { commit(this.strokeStyle); },
    fillRect(x, y, w, h) {
      if (!isSolid(this.fillStyle)) return;
      point(x, y); point(x + w, y); point(x + w, y + h); point(x, y + h);
    },
    strokeRect(x, y, w, h) {
      if (!isSolid(this.strokeStyle)) return;
      point(x, y); point(x + w, y); point(x + w, y + h); point(x, y + h);
    },
    clearRect() {},
    fillText() {},
    strokeText() {},
    setLineDash() {},
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
}

/* ============================================================
   Measurement
   ============================================================ */

/**
 * @param {(ctx: any) => void} draw
 * @returns {{body: any, additive: any, outline: Array<{x: number, y: number}>}}
 */
function measure(draw) {
  const ctx = makeMeasureContext();
  draw(ctx);
  return { body: ctx.body, additive: ctx.additive, outline: ctx.outline };
}

/**
 * Fraction of the painted outline that the hit volume contains.
 *
 * This is the number that matters: a body can be "mostly" covered and still
 * let a shot through the head, or through a shoulder.
 *
 * @param {Array<{x: number, y: number}>} outline
 * @param {{x: number, y: number, radius: number, height: number}} volume
 * @returns {{covered: number, total: number, worst: {x: number, y: number}|null}}
 */
function coverage(outline, volume) {
  let covered = 0;
  /** @type {{x: number, y: number}|null} */
  let worst = null;
  let worstY = Infinity;

  for (const p of outline) {
    if (pointVsHitVolume(p.x, p.y, 0, volume)) {
      covered++;
    } else if (p.y < worstY) {
      worstY = p.y;
      worst = p;
    }
  }
  return { covered, total: outline.length, worst };
}

/**
 * Split painted outline points into connected silhouettes.
 *
 * A skeleton's bow, an enemy mage's orbiting focus and an executioner's
 * spinning blades are painted a few pixels away from the body, and they
 * rotate with facing, so no static box can describe them. The body is the
 * largest connected silhouette; anything detached is reported, not required.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [link] distance at which two points count as connected
 * @returns {{body: Array<{x: number, y: number}>, props: Array<{x: number, y: number}>}}
 */
function splitSilhouette(points, link = 4) {
  const cell = link;
  /** @type {Map<string, number[]>} */
  const grid = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

  points.forEach((p, i) => {
    const k = keyOf(p.x, p.y);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });

  const parent = points.map((_, i) => i);
  const find = (/** @type {number} */ i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) { const next = parent[i]; parent[i] = root; i = next; }
    return root;
  };
  const union = (/** @type {number} */ a, /** @type {number} */ b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const link2 = link * link;
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(`${cx + ox},${cy + oy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const q = points[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          if (dx * dx + dy * dy <= link2) union(i, j);
        }
      }
    }
  });

  /** @type {Map<number, number[]>} */
  const groups = new Map();
  points.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });

  let biggest = [];
  for (const list of groups.values()) {
    if (list.length > biggest.length) biggest = list;
  }
  const inBody = new Set(biggest);
  return {
    body: biggest.map((i) => points[i]),
    props: points.filter((_, i) => !inBody.has(i)),
  };
}

/** Axis-aligned box of a point list. */
function boxOf(/** @type {Array<{x: number, y: number}>} */ points) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  return box;
}


/** The volume combat actually tests, taken from the entity itself. */
function volumeOf(/** @type {any} */ e) {
  if (typeof e.getHitVolume === 'function') {
    const v = e.getHitVolume();
    // Report it in world space at the origin, where the art was measured.
    return { ...v, x: 0, y: 0 };
  }
  return { x: 0, y: 0, radius: e.hitRadius ?? e.radius };
}

/** @param {any} e @param {any} box */
function describe(e, box) {
  return {
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    top: box.minY,     // relative to the ground point at y = 0
    bottom: box.maxY,
    // Appendages such as a shield, a bow or spinning blades rotate with
    // facing, so the box has to reach as far in either direction.
    reach: Math.max(Math.abs(box.minX), Math.abs(box.maxX)),
  };
}

/* ============================================================
   Report
   ============================================================ */

const rows = [];
let failures = 0;

/** Deterministic animation phase, so the numbers are reproducible. */
const realRandom = Math.random;
let seed = 12345;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/** @type {Array<{name: string, entity: any, draw: (ctx: any) => void}>} */
const subjects = [];

for (const def of Object.values(ENEMIES)) {
  subjects.push({
    name: def.id,
    entity: new Enemy({ typeId: def.id, x: 0, y: 0 }),
    draw: (ctx) => {
      const enemy = new Enemy({ typeId: def.id, x: 0, y: 0 });
      drawEnemy(ctx, enemy, 1.0, { isVisible: () => true });
    },
  });
}

for (const def of Object.values(BOSSES)) {
  subjects.push({
    name: `boss:${def.id}`,
    entity: new Boss({ bossId: def.id, x: 0, y: 0 }),
    draw: (ctx) => {
      const boss = new Boss({ bossId: def.id, x: 0, y: 0 });
      drawBoss(ctx, boss, 1.0, { isVisible: () => true });
    },
  });
}

console.log('');
console.log('  drawn body vs hit volume (coordinates relative to the ground point)');
console.log('  entity            phys  hit w/u/d        body w x h      top   body  props');

for (const subject of subjects) {
  const { body, additive, outline } = measure(subject.draw);
  if (!Number.isFinite(body.minX) || outline.length === 0) {
    console.log(`  ${subject.name.padEnd(18)} drew nothing solid`);
    failures++;
    continue;
  }

  // Only the body silhouette has to be hittable; detached, rotating props
  // (a bow, an orbiting focus, spinning blades) cannot fit a static box.
  const split = splitSilhouette(outline);
  const bodyBox = boxOf(split.body);

  const volume = volumeOf(subject.entity);
  const shape = describe(subject.entity, bodyBox);
  const cov = coverage(split.body, volume);
  const percent = (cov.covered / cov.total) * 100;
  const propCover = coverage(split.props, volume);
  const propPercent = propCover.total > 0 ? (propCover.covered / propCover.total) * 100 : 100;

  // The body must sit inside the hit volume; a hair of tolerance absorbs
  // stroke width, which extends half a pixel past the path it strokes.
  const ok = percent >= 99;
  if (!ok) failures++;

  const shapeText = typeof volume.width === 'number'
    ? `${volume.width}/${volume.up}/${volume.down}`
    : `r${volume.radius}`;

  console.log(
    `  ${subject.name.padEnd(18)}`
    + `${String(subject.entity.radius).padStart(4)}`
    + `  ${shapeText.padEnd(11)}`
    + `   ${shape.width.toFixed(0).padStart(4)} x${shape.height.toFixed(0).padStart(4)}`
    + `${shape.top.toFixed(0).padStart(8)}`
    + `  ${percent.toFixed(1).padStart(5)}%`
    + `  ${propPercent.toFixed(0).padStart(4)}%`
    + `${ok ? '' : '  GAP'}`,
  );

  if (VERBOSE) {
    if (!ok && cov.worst) {
      console.log(`      body point outside: (${cov.worst.x.toFixed(0)}, ${cov.worst.y.toFixed(0)})`);
    }
    console.log(`      body points ${split.body.length}, detached props ${split.props.length}`);
    console.log(`      additive effects reach y=${Number.isFinite(additive.minY) ? additive.minY.toFixed(0) : '-'}`);
  }

  rows.push({ name: subject.name, percent, propPercent, shape, volume, worst: cov.worst });
}

Math.random = realRandom;

/* Suggested volumes: the exact box the body silhouette needs, plus a margin. */
const MARGIN = 2;
if (failures > 0) {
  console.log('');
  console.log(`  required boxes (body silhouette + ${MARGIN}px margin):`);
  for (const row of rows) {
    if (row.percent >= 100) continue;
    console.log(
      `    ${row.name.padEnd(18)}`
      + ` hitWidth: ${String(Math.ceil(row.shape.reach * 2) + MARGIN).padStart(3)}`
      + `  hitUp: ${String(Math.ceil(-row.shape.top) + MARGIN).padStart(3)}`
      + `  hitDown: ${String(Math.max(1, Math.ceil(row.shape.bottom) + MARGIN)).padStart(3)}`
      + `   (measured ${row.shape.width.toFixed(1)} wide, reach ${row.shape.reach.toFixed(1)},`
      + ` top ${row.shape.top.toFixed(1)}, bottom ${row.shape.bottom.toFixed(1)})`,
    );
  }
}

console.log('');
if (failures === 0) {
  console.log(`Hitbox audit: all ${subjects.length} silhouettes are covered by their hit volume`);
} else {
  console.log(`Hitbox audit: ${failures}/${subjects.length} silhouettes are NOT covered`);
}
console.log('');
void CONFIG;
process.exit(failures > 0 ? 1 : 0);
