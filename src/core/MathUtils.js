/**
 * @fileoverview Small shared math helpers used by every system.
 * Pure functions only — no state, no dependencies.
 */

/**
 * Clamp a number into a range.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t 0..1
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Move `current` toward `target` by at most `maxDelta`.
 * @param {number} current
 * @param {number} target
 * @param {number} maxDelta
 * @returns {number}
 */
export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/**
 * Squared distance between two points (avoids a sqrt).
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 * @returns {number}
 */
export function distSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/**
 * Distance between two points.
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 * @returns {number}
 */
export function dist(ax, ay, bx, by) {
  return Math.sqrt(distSq(ax, ay, bx, by));
}

/**
 * Normalize an angle into (-PI, PI].
 * @param {number} a
 * @returns {number}
 */
export function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Shortest signed angular difference from `from` to `to`.
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
export function angleDelta(from, to) {
  return normalizeAngle(to - from);
}

/**
 * Rotate `from` toward `to` by at most `maxStep` radians.
 * @param {number} from
 * @param {number} to
 * @param {number} maxStep
 * @returns {number}
 */
export function rotateToward(from, to, maxStep) {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return normalizeAngle(from + Math.sign(d) * maxStep);
}

/**
 * Build a unit vector from an angle.
 * @param {number} angle
 * @returns {{x: number, y: number}}
 */
export function angleToVector(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * Whether two axis-aligned rectangles overlap.
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {boolean}
 */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Points of a rectangle's corners.
 * @param {{x:number,y:number,w:number,h:number}} r
 * @returns {Array<{x:number,y:number}>}
 */
export function rectCorners(r) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/**
 * Axis-aligned bounding box of a rotated rectangle.
 * @param {number} cx center x
 * @param {number} cy center y
 * @param {number} w  full width
 * @param {number} h  full height
 * @param {number} angle rotation in radians
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function rotatedAABB(cx, cy, w, h, angle) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const ew = w * c + h * s;
  const eh = w * s + h * c;
  return { x: cx - ew / 2, y: cy - eh / 2, w: ew, h: eh };
}

/**
 * Format a number as an integer string, guarding against NaN.
 * @param {number} v
 * @returns {string}
 */
export function fmtInt(v) {
  return Number.isFinite(v) ? String(Math.round(v)) : '0';
}

/**
 * Returns a percentage 0..100.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
export function percent(value, max) {
  if (max <= 0) return 0;
  return clamp((value / max) * 100, 0, 100);
}
