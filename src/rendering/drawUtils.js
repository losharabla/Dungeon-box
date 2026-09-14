/**
 * @fileoverview Procedural drawing helpers.
 *
 * SRP: a toolbox of Canvas primitives. Every function here draws something
 * and returns nothing; none of them read game state.
 *
 * Design doc §2/§35: no image assets exist anywhere in this project. Every
 * visual is built from paths, gradients, arcs and alpha.
 *
 * Performance note: a busy combat frame used to allocate a gradient per
 * particle per frame and rebuild thousands of identical colour strings. The
 * helpers below are therefore built around two module-level caches:
 *
 *   - colour strings (`tint`, `hexAlpha`), memoised per colour+level;
 *   - unit gradients (`glow`, `shadow`), created once per colour/strength
 *     at (0,0,0..1) and stretched to the requested position and radius with
 *     the context transform instead of being rebuilt per call.
 *
 * Both caches are bounded and both helpers keep their exported signatures and
 * output identical to the un-cached implementations.
 */

/**
 * @typedef {CanvasRenderingContext2D} Ctx
 */

/**
 * Shortest distance between two angles, always in (-PI, PI].
 * Duplicated locally so the renderer never has to import gameplay code.
 * @param {number} a
 * @returns {number}
 */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Trace (but do not fill/stroke) a regular polygon path.
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} sides
 * @param {number} [rotation]
 */
export function polygonPath(ctx, cx, cy, radius, sides, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Fill an ellipse.
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} [rotation]
 */
export function ellipse(ctx, cx, cy, rx, ry, rotation = 0) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rotation, 0, Math.PI * 2);
  ctx.fill();
}

/* ============================================================
   Colour-string memoisation
   ============================================================ */

/**
 * Quantisation step for the brightness/alpha levels. 1/250 of a unit is a
 * quarter of an 8-bit level, so the rounding can never shift a channel by
 * more than one step, and it collapses the continuous values the renderers
 * produce (noise shades, pulse envelopes) into a small, repeatable set.
 */
const LEVEL_SCALE = 250;

/** @returns {number} the quantised level, or 1 for non-finite input */
function quantizeLevel(level) {
  return Math.round((Number.isFinite(level) ? level : 1) * LEVEL_SCALE) / LEVEL_SCALE;
}

/**
 * Bounded two-level cache: source colour -> quantised level -> result. The
 * level is a number key so a cache hit allocates nothing at all.
 * @param {Map<string, Map<number, string>>} cache
 * @param {string} hex
 * @param {number} level
 * @param {(hex: string, level: number) => string} build
 * @returns {string}
 */
function memoiseColour(cache, hex, level, build) {
  let byLevel = cache.get(hex);
  if (byLevel === undefined) {
    // Both levels of the cache are capped; a colour set that outgrows the
    // budget is rebuilt on demand rather than leaking memory per frame.
    if (cache.size >= COLOUR_CACHE_MAX_HEXES) cache.clear();
    byLevel = new Map();
    cache.set(hex, byLevel);
  }
  const hit = byLevel.get(level);
  if (hit !== undefined) return hit;
  if (byLevel.size >= COLOUR_CACHE_MAX_LEVELS) byLevel.clear();
  const value = build(hex, level);
  byLevel.set(level, value);
  return value;
}

const COLOUR_CACHE_MAX_HEXES = 64;
const COLOUR_CACHE_MAX_LEVELS = 96;

/** @type {Map<string, Map<number, string>>} */
const tintCache = new Map();
/** @type {Map<string, Map<number, string>>} */
const hexAlphaCache = new Map();

/**
 * Multiply a hex colour's brightness.
 *
 * The factor is quantised to 0.004 steps before lookup, which is a quarter of
 * an 8-bit channel: the returned colour can differ from the exact product by
 * at most one level, and static geometry (wall bricks) then reuses the same
 * string every frame instead of rebuilding it.
 * @param {string} hex
 * @param {number} factor
 * @returns {string}
 */
export function tint(hex, factor) {
  return memoiseColour(tintCache, hex, quantizeLevel(factor), computeTint);
}

/** @param {string} hex @param {number} factor @returns {string} */
function computeTint(hex, factor) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = Math.min(255, Math.round(parseInt(h.slice(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(h.slice(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(h.slice(4, 6), 16) * factor));
  return `rgb(${r},${g},${b})`;
}

/**
 * Convert `#rrggbb` to `rgba(...)` with the given alpha.
 *
 * Already-rgb/rgba strings are returned unchanged. A malformed or missing
 * colour falls back to opaque white rather than throwing: this function sits
 * on the hot path of every glow, particle and effect, and a single bad colour
 * must never take down a whole frame.
 *
 * Alpha is quantised to 0.004 steps for the cache; that is below one 8-bit
 * level, so no visible difference, and it lets animated pulses and noise
 * driven tints reuse the same string across frames.
 *
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
export function hexAlpha(hex, alpha) {
  const a = Math.max(0, Math.min(1, quantizeLevel(alpha)));
  return memoiseColour(hexAlphaCache, hex, a, computeHexAlpha);
}

/** @param {string} hex @param {number} a @returns {string} */
function computeHexAlpha(hex, a) {
  if (typeof hex !== 'string' || hex.length === 0) return `rgba(255,255,255,${a})`;

  // A well-formed rgb()/rgba() string is already usable as-is.
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(hex.trim())) {
    return hex;
  }

  const h = hex.trim().replace('#', '');
  const expanded = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  if (expanded.length !== 6) return `rgba(255,255,255,${a})`;

  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(255,255,255,${a})`;
  }
  return `rgba(${r},${g},${b},${a})`;
}

/* ============================================================
   Unit-gradient caching for the two soft-blob primitives
   ============================================================ */

/**
 * `glow` and `shadow` paint a radially fading blob. The fade shape is always
 * the same; only its position, size and colour change. So instead of
 * allocating a gradient per call, one unit gradient (centred at the origin,
 * radius 1) is cached per colour/strength and stretched into place with
 * translate+scale: a CanvasGradient's coordinates are resolved by the
 * transform that is active when it is painted, not when it was created.
 *
 * Multiplying the blob's strength into `globalAlpha` is exactly equivalent to
 * baking it into the stop alphas under `lighter` compositing, because that
 * blend mode is linear in the source.
 *
 * The headless rasteriser in tools/render-frame.mjs (and the recording
 * contexts of the other tools) applies translate but ignores scale(), so on
 * those contexts the blob would collapse to a point. They therefore keep the
 * per-call path, which produces byte-identical output to the previous
 * implementation. Real CanvasRenderingContext2D objects expose getTransform();
 * that is used as the capability probe.
 */

/** @type {WeakMap<object, boolean>} */
const ctmCache = new WeakMap();

/** @param {Ctx} ctx @returns {boolean} */
function ctxHonoursScale(ctx) {
  const known = ctmCache.get(ctx);
  if (known !== undefined) return known;
  const supported = typeof ctx.getTransform === 'function';
  try {
    ctmCache.set(ctx, supported);
  } catch {
    // An exotic context that cannot be WeakMap-keyed: fall back per call.
  }
  return supported;
}

/** @type {Map<string, CanvasGradient>} */
const glowGradients = new Map();
let glowGradientOwner = null;
const GLOW_GRADIENT_CACHE_MAX = 48;

/** @param {Ctx} ctx @param {string} color @returns {CanvasGradient} */
function glowUnitGradient(ctx, color) {
  if (ctx !== glowGradientOwner) {
    // Gradients are cheap to rebuild once per context; keep the cache scoped
    // to the context that will actually paint them.
    glowGradients.clear();
    glowGradientOwner = ctx;
  }
  let g = glowGradients.get(color);
  if (g === undefined) {
    if (glowGradients.size >= GLOW_GRADIENT_CACHE_MAX) glowGradients.clear();
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, hexAlpha(color, 0.95));
    g.addColorStop(0.42, hexAlpha(color, 0.42));
    g.addColorStop(1, hexAlpha(color, 0));
    glowGradients.set(color, g);
  }
  return g;
}

/** @type {Map<number, CanvasGradient>} */
const shadowGradients = new Map();
let shadowGradientOwner = null;
const SHADOW_GRADIENT_CACHE_MAX = 64;

/** @param {Ctx} ctx @param {number} strength @returns {CanvasGradient} */
function shadowUnitGradient(ctx, strength) {
  if (ctx !== shadowGradientOwner) {
    shadowGradients.clear();
    shadowGradientOwner = ctx;
  }
  const level = quantizeLevel(strength);
  let g = shadowGradients.get(level);
  if (g === undefined) {
    if (shadowGradients.size >= SHADOW_GRADIENT_CACHE_MAX) shadowGradients.clear();
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(0,0,0,${0.55 * level})`);
    g.addColorStop(0.6, `rgba(0,0,0,${0.28 * level})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    shadowGradients.set(level, g);
  }
  return g;
}

/**
 * A soft elliptical shadow beneath a character (design doc §3).
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy ground contact point
 * @param {number} radius
 * @param {number} [strength] 0..1
 */
export function shadow(ctx, cx, cy, radius, strength = 1) {
  const s = Number.isFinite(strength) ? strength : 1;
  if (!(radius > 0) || s <= 0) return;

  if (!ctxHonoursScale(ctx)) {
    drawShadowPerCall(ctx, cx, cy, radius, s);
    return;
  }

  const g = shadowUnitGradient(ctx, s);
  ctx.save();
  ctx.translate(cx, cy);
  // One transform does both jobs: the radius and the flattening that turns
  // the circle into the ground ellipse the original code built with
  // scale(1, 0.45) around a radius-sized arc.
  ctx.scale(radius, radius * 0.45);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Original per-call form, used on contexts that ignore scale().
 * @param {Ctx} ctx
 * @param {number} cx @param {number} cy @param {number} radius @param {number} strength
 */
function drawShadowPerCall(ctx, cx, cy, radius, strength) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, `rgba(0,0,0,${0.55 * strength})`);
  g.addColorStop(0.6, `rgba(0,0,0,${0.28 * strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.45);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Additive glow blob — the workhorse for magic, fire and muzzle flashes.
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {string} color
 * @param {number} [alpha]
 */
export function glow(ctx, cx, cy, radius, color, alpha = 1) {
  if (!(radius > 0)) return;
  let a = Number.isFinite(alpha) ? alpha : 1;
  if (a <= 0) return;
  if (a > 1) a = 1;

  if (!ctxHonoursScale(ctx)) {
    drawGlowPerCall(ctx, cx, cy, radius, color, a);
    return;
  }

  const g = glowUnitGradient(ctx, color);
  const ga = ctx.globalAlpha * a;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = ga > 1 ? 1 : ga;
  ctx.translate(cx, cy);
  ctx.scale(radius, radius);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Original per-call form, used on contexts that ignore scale().
 * @param {Ctx} ctx
 * @param {number} cx @param {number} cy @param {number} radius
 * @param {string} color @param {number} alpha
 */
function drawGlowPerCall(ctx, cx, cy, radius, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexAlpha(color, 0.95 * alpha));
  g.addColorStop(0.42, hexAlpha(color, 0.42 * alpha));
  g.addColorStop(1, hexAlpha(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Linear gradient helper that takes explicit stops.
 * @param {Ctx} ctx
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {Array<[number, string]>} stops
 * @returns {CanvasGradient}
 */
export function linearGradient(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  return g;
}

/**
 * Radial gradient helper.
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {Array<[number, string]>} stops
 * @returns {CanvasGradient}
 */
export function radialGradient(ctx, cx, cy, r, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.01, r));
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  return g;
}

/**
 * Stroke a tapered arc — used for melee slash trails and chain lightning.
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} startAngle
 * @param {number} endAngle
 * @param {number} width
 * @param {string} color
 * @param {number} [alpha]
 */
export function arcStroke(ctx, cx, cy, radius, startAngle, endAngle, width, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.stroke();
  ctx.restore();
}

/**
 * A jagged line between two points, for lightning and cracks.
 * @param {Ctx} ctx
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} segments
 * @param {number} jitter
 * @param {() => number} random
 * @returns {Array<{x: number, y: number}>} generated points
 */
export function jaggedLine(ctx, x0, y0, x1, y1, segments, jitter, random) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  /** @type {Array<{x: number, y: number}>} */
  const points = [{ x: x0, y: y0 }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const off = (random() - 0.5) * 2 * jitter;
    points.push({ x: x0 + dx * t + nx * off, y: y0 + dy * t + ny * off });
  }
  points.push({ x: x1, y: y1 });

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  return points;
}

/**
 * Draw a rune/ward circle — used for telegraphs and the healing altar.
 * @param {Ctx} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {string} color
 * @param {number} rotation
 * @param {number} [alpha]
 */
export function runeRing(ctx, cx, cy, radius, color, rotation, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.4;
  for (let i = 0; i < 8; i++) {
    const a = rotation + (i / 8) * Math.PI * 2;
    const x0 = cx + Math.cos(a) * (radius * 0.78);
    const y0 = cy + Math.sin(a) * (radius * 0.78);
    const x1 = cx + Math.cos(a) * (radius * 1.06);
    const y1 = cy + Math.sin(a) * (radius * 1.06);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Rounded rectangle path.
 * @param {Ctx} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Deterministic value noise, used for stone/floor texture.
 * @param {number} x
 * @param {number} y
 * @returns {number} 0..1
 */
export function valueNoise(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * @typedef {object} BrickShades
 * @property {string[]} shades row-major per-brick tint for this grid
 * @property {number} gx horizontal mortar inset
 * @property {number} gy vertical mortar inset
 */

/**
 * Per-brick tints, cached by the brick grid's geometry.
 *
 * The shade of a brick is a pure function of its column and row in the grid,
 * so a wall that never moves asks for exactly the same list every frame. The
 * grid is keyed by brick size and course/column counts — never by the wall's
 * position — so scrolling the camera does not invalidate it. Nothing here
 * touches a second canvas: the expensive part (noise + colour string) is
 * precomputed, and the rectangles are still drawn live, which keeps the
 * output verifiable by the headless rasteriser.
 * @type {Map<string, BrickShades>}
 */
const brickShadeCache = new Map();
const BRICK_CACHE_MAX = 32;

/**
 * Draw a stone-brick texture pattern into a rectangle.
 *
 * The brick grid is derived from the rectangle's own size when the caller
 * does not supply one. That matters for the room's walls: a horizontal wall
 * is long and thin while a vertical wall is tall and narrow, and a single
 * fixed brick size would overflow the thin axis — producing a jagged
 * staircase of half-bricks instead of a masonry course.
 *
 * @param {Ctx} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} baseColor
 * @param {string} mortarColor
 * @param {number} [brickW] brick length along the wall; defaults to a size
 *   proportional to the rectangle
 * @param {number} [brickH] brick thickness; defaults to the rect's thin axis
 */
export function brickPattern(ctx, x, y, w, h, baseColor, mortarColor, brickW, brickH) {
  const horizontal = w >= h;

  // The thin axis is the wall's thickness, so one brick course must span it
  // exactly rather than being chopped.
  const thickness = horizontal ? h : w;

  const resolvedH = brickH ?? thickness;
  const resolvedW = brickW ?? (horizontal
    ? Math.max(24, Math.min(48, thickness * 2.2))
    : thickness);

  const bw = horizontal ? resolvedW : thickness;
  const bh = horizontal ? thickness : resolvedH;

  const rows = Math.ceil(h / bh) + 1;
  const cols = Math.ceil(w / bw) + 2;

  const pattern = brickShades(baseColor, bw, bh, rows, cols);
  const { shades, gx, gy, stride } = pattern;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, w, h);

  const right = x + w;
  const bottom = y + h;

  for (let r = 0; r < rows; r++) {
    const by = y + r * bh;
    // Courses are laid on the grid starting at the near edge, so the first
    // course that begins past the far edge contributes nothing inside the
    // clip rect and every later one is further out.
    if (by >= bottom) break;
    // Offset every other course, but only along the long axis.
    const offset = (r % 2) * (bw / 2);
    const rowStart = r * stride;
    // Columns are generated for -1..cols-1 (the original range); with no
    // offset the leading column sits entirely left of the clip rect, so it is
    // skipped rather than drawn invisibly.
    for (let c = offset > 0 ? -1 : 0; c < cols; c++) {
      const bx = x + c * bw + offset;
      // Columns run left to right on the grid, so the first one that starts
      // on or past the far edge ends the row.
      if (bx >= right) break;
      if (bx + bw <= x) continue;
      ctx.fillStyle = shades[rowStart + c + 1];
      // Inset by the mortar joint, but never so much that the brick vanishes.
      ctx.fillRect(bx + gx, by + gy, bw - gx * 2, bh - gy * 2);
    }
  }

  // Mortar lines on top for definition. The clip rect removes any line past
  // the wall's far edge, so the stroke loop stops at that edge.
  ctx.strokeStyle = mortarColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.35;
  for (let r = 0; r <= rows; r++) {
    const by = y + r * bh;
    // A line half a width past the edge still bleeds into the wall, so the
    // break leaves a whole stroke-width of margin before giving up.
    if (by > bottom + 1) break;
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x + w, by);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Resolve (and memoise) the tint list for one brick grid.
 * @param {string} baseColor
 * @param {number} bw
 * @param {number} bh
 * @param {number} rows
 * @param {number} cols
 * @returns {BrickShades}
 */
function brickShades(baseColor, bw, bh, rows, cols) {
  const stride = cols + 1; // columns are generated from -1 to cols-1
  const key = `${baseColor}|${bw.toFixed(2)}|${bh.toFixed(2)}|${rows}x${cols}`;
  const hit = brickShadeCache.get(key);
  if (hit !== undefined) return hit;

  if (brickShadeCache.size >= BRICK_CACHE_MAX) brickShadeCache.clear();
  const shades = new Array(rows * stride);
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      // Per-brick shade variation keeps large walls from looking flat.
      const n = valueNoise(c * 3.7 + r * 1.3, r * 2.1);
      shades[r * stride + c + 1] = tint(baseColor, 0.86 + n * 0.28);
    }
  }
  const pattern = {
    shades,
    stride,
    gx: Math.min(1.5, bw * 0.12),
    gy: Math.min(1.5, bh * 0.12),
  };
  brickShadeCache.set(key, pattern);
  return pattern;
}

/**
 * Mix two hex colours.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0..1
 * @returns {string}
 */
export function mix(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function parseHex(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
