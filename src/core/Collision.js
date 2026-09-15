/**
 * @fileoverview Collision detection primitives.
 *
 * SRP: answer geometric overlap questions. This module never applies
 * damage, never moves anything and never reads gameplay state.
 *
 * Scope is intentionally the minimal set from design document §27:
 * circle-circle, circle-rectangle, plus the vector resolution helpers
 * those two need.
 */

/**
 * @typedef {{x: number, y: number}} Vec2
 */

/**
 * @typedef {object} Circle
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 */

/**
 * @typedef {object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * Circle vs circle overlap.
 * @param {Circle} a
 * @param {Circle} b
 * @returns {boolean}
 */
export function circleVsCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Closest point on a rectangle to a given point.
 * @param {number} px
 * @param {number} py
 * @param {Rect} r
 * @returns {Vec2}
 */
export function closestPointOnRect(px, py, r) {
  return {
    x: px < r.x ? r.x : (px > r.x + r.w ? r.x + r.w : px),
    y: py < r.y ? r.y : (py > r.y + r.h ? r.y + r.h : py),
  };
}

/**
 * Circle vs axis-aligned rectangle overlap.
 * @param {Circle} c
 * @param {Rect} r
 * @returns {boolean}
 */
export function circleVsRect(c, r) {
  const p = closestPointOnRect(c.x, c.y, r);
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  return dx * dx + dy * dy <= c.radius * c.radius;
}

/**
 * Whether a point lies inside a rectangle.
 * @param {number} px
 * @param {number} py
 * @param {Rect} r
 * @returns {boolean}
 */
export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/**
 * Minimum translation vector to push `c` out of `r`.
 *
 * Returns the smallest displacement that removes the overlap, or null when
 * the shapes do not overlap. Used to resolve player/enemy wall collisions
 * without any physics engine.
 * @param {Circle} c
 * @param {Rect} r
 * @returns {Vec2|null}
 */
export function resolveCircleRect(c, r) {
  if (!circleVsRect(c, r)) return null;

  const p = closestPointOnRect(c.x, c.y, r);
  let dx = c.x - p.x;
  let dy = c.y - p.y;
  let dist = Math.hypot(dx, dy);

  if (dist > 0.00001) {
    // Centre is outside the rectangle: push out along the closest-point normal.
    const overlap = c.radius - dist;
    return { x: (dx / dist) * overlap, y: (dy / dist) * overlap };
  }

  // Centre is inside the rectangle: escape through the nearest face.
  const left = c.x - r.x;
  const right = r.x + r.w - c.x;
  const top = c.y - r.y;
  const bottom = r.y + r.h - c.y;
  const min = Math.min(left, right, top, bottom);

  if (min === left) return { x: -(left + c.radius), y: 0 };
  if (min === right) return { x: right + c.radius, y: 0 };
  if (min === top) return { x: 0, y: -(top + c.radius) };
  return { x: 0, y: bottom + c.radius };
}

/**
 * Minimum translation vector to separate two overlapping circles.
 * @param {Circle} a
 * @param {Circle} b
 * @returns {Vec2|null} displacement to apply to `a`
 */
export function resolveCircleCircle(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq > r * r) return null;

  const dist = Math.sqrt(distSq);
  if (dist < 0.00001) {
    // Perfectly stacked: choose an arbitrary but stable direction.
    return { x: r, y: 0 };
  }
  const overlap = r - dist;
  return { x: (dx / dist) * overlap, y: (dy / dist) * overlap };
}

/**
 * Swept test of a moving point segment against a circle, used for
 * projectiles that may tunnel through a fast-moving target.
 *
 * @param {number} x0 segment start
 * @param {number} y0
 * @param {number} x1 segment end
 * @param {number} y1
 * @param {Circle} circle
 * @returns {number|null} t in [0,1] of the earliest hit, or null
 */
export function segmentVsCircle(x0, y0, x1, y1, circle) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - circle.x;
  const fy = y0 - circle.y;

  const a = dx * dx + dy * dy;
  if (a < 1e-9) {
    const d2 = fx * fx + fy * fy;
    return d2 <= circle.radius * circle.radius ? 0 : null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - circle.radius * circle.radius;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);

  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

/* ============================================================
   Hit volumes
   ============================================================ */

/**
 * @typedef {object} HitVolume
 * @property {number} x          position of the entity
 * @property {number} y
 * @property {number} [radius]   circle shape: half-width, centred on (x, y)
 * @property {number} [width]    box shape: full width, centred on x
 * @property {number} [up]       box shape: how far it rises above y
 * @property {number} [down]     box shape: how far it reaches below y
 */

/**
 * Whether a volume describes a box rather than a circle.
 * @param {HitVolume} volume
 * @returns {boolean}
 */
function isBox(volume) {
  return typeof volume.width === 'number' && volume.width > 0;
}

/**
 * The volume's rectangle in world space (box shape only).
 * @param {HitVolume} volume
 * @returns {Rect}
 */
function volumeRect(volume) {
  return {
    x: volume.x - volume.width / 2,
    y: volume.y - (volume.up ?? 0),
    w: volume.width,
    h: (volume.up ?? 0) + (volume.down ?? 0),
  };
}

/**
 * Closest point of a hit volume to a world point.
 *
 * A character is drawn standing *above* its ground point, so its body is not
 * a circle centred on that point: it is a standing rectangle running from the
 * feet to the crown. Treating it as a circle is what let attacks aimed at a
 * humanoid's chest pass straight through it — an orc is drawn 70px tall and
 * the circle only ever covered the bottom 3% of that silhouette.
 *
 * @param {number} px
 * @param {number} py
 * @param {HitVolume} volume
 * @returns {Vec2}
 */
export function closestPointOnHitVolume(px, py, volume) {
  if (!isBox(volume)) return { x: volume.x, y: volume.y };
  return closestPointOnRect(px, py, volumeRect(volume));
}

/**
 * Distance from a point to the *surface* of a hit volume; 0 when inside.
 * @param {number} px
 * @param {number} py
 * @param {HitVolume} volume
 * @returns {number}
 */
export function distanceToHitVolume(px, py, volume) {
  const c = closestPointOnHitVolume(px, py, volume);
  const d = Math.hypot(px - c.x, py - c.y);
  return isBox(volume) ? d : Math.max(0, d - (volume.radius ?? 0));
}

/**
 * Whether a circle (a point with its own radius) touches a hit volume.
 * @param {number} px
 * @param {number} py
 * @param {number} radius
 * @param {HitVolume} volume
 * @returns {boolean}
 */
export function pointVsHitVolume(px, py, radius, volume) {
  const c = closestPointOnHitVolume(px, py, volume);
  const r = radius + (isBox(volume) ? 0 : (volume.radius ?? 0));
  // A point exactly on the surface counts as touching: without the tolerance a
  // boundary value fails on floating-point noise alone.
  return (px - c.x) * (px - c.x) + (py - c.y) * (py - c.y) <= r * r + 1e-6;
}

/**
 * Whether a swept point — a projectile travelling from (x0,y0) to (x1,y1) —
 * touches a hit volume. `inflate` is the projectile's own radius, which grows
 * the target shape instead of thickening the path.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {HitVolume} volume
 * @param {number} [inflate]
 * @returns {boolean}
 */
export function segmentVsHitVolume(x0, y0, x1, y1, volume, inflate = 0) {
  return segmentVsHitVolumeHit(x0, y0, x1, y1, volume, inflate) !== null;
}

/**
 * Where a swept point first touches a hit volume, or null.
 *
 * The boolean above is all a projectile needs — it either hit or it did not.
 * A beam has to know *where* the first body is, so that it can stop there
 * instead of shining through it, and so the impact glow sits on the body
 * rather than at the wall behind it.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {HitVolume} volume
 * @param {number} [inflate]
 * @returns {RayHit|null}
 */
export function segmentVsHitVolumeHit(x0, y0, x1, y1, volume, inflate = 0) {
  if (!isBox(volume)) {
    const circle = { x: volume.x, y: volume.y, radius: (volume.radius ?? 0) + inflate };
    return segmentVsCircle(x0, y0, x1, y1, circle);
  }

  // Inflate the box by the beam's half-width, then sweep the bare segment.
  const rect = volumeRect(volume);
  rect.x -= inflate;
  rect.y -= inflate;
  rect.w += inflate * 2;
  rect.h += inflate * 2;
  return segmentVsRect(x0, y0, x1 - x0, y1 - y0, rect);
}

/**
 * @typedef {object} RayHit
 * @property {number} t       parameter along the ray in [0,1]
 * @property {number} x       impact point
 * @property {number} y
 * @property {Vec2} normal   surface normal at the impact
 */

/**
 * Ray/segment vs axis-aligned rectangle (slab method).
 * @param {number} x0
 * @param {number} y0
 * @param {number} dx
 * @param {number} dy
 * @param {Rect} r
 * @returns {RayHit|null}
 */
export function segmentVsRect(x0, y0, dx, dy, r) {
  let tMin = 0;
  let tMax = 1;
  /** @type {Vec2} */
  let normal = { x: 0, y: 0 };

  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (x0 < r.x || x0 > r.x + r.w) return null;
  } else {
    let t1 = (r.x - x0) / dx;
    let t2 = (r.x + r.w - x0) / dx;
    let n = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tMin) { tMin = t1; normal = { x: n, y: 0 }; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-9) {
    if (y0 < r.y || y0 > r.y + r.h) return null;
  } else {
    let t1 = (r.y - y0) / dy;
    let t2 = (r.y + r.h - y0) / dy;
    let n = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tMin) { tMin = t1; normal = { x: 0, y: n }; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  return { t: tMin, x: x0 + dx * tMin, y: y0 + dy * tMin, normal };
}

/**
 * Reflect a direction vector on a surface normal.
 * @param {number} dx
 * @param {number} dy
 * @param {Vec2} normal
 * @returns {Vec2}
 */
export function reflect(dx, dy, normal) {
  const dot = dx * normal.x + dy * normal.y;
  return { x: dx - 2 * dot * normal.x, y: dy - 2 * dot * normal.y };
}
