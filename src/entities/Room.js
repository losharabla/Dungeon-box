/**
 * @fileoverview Room geometry and the world's collision registry.
 *
 * SRP: two closely-related but single-purpose pieces.
 *  - `Room` is a data structure describing an arena: its bounds, its wall
 *    rectangles, its doors and its spawn points.
 *  - `CollisionWorld` answers hit queries against those rectangles.
 *
 * Neither knows what an enemy is; they are pure geometry that movement,
 * projectiles and the renderer all query.
 */

import { circleVsRect, resolveCircleRect, segmentVsRect } from '../core/Collision.js';
import { rng } from '../core/Random.js';

/**
 * @typedef {import('../core/Collision.js').Rect} Rect
 */

/**
 * @typedef {object} Door
 * @property {string} id
 * @property {'north'|'south'|'east'|'west'} side
 * @property {Rect} rect
 * @property {boolean} open
 * @property {string} [targetRoomId]
 * @property {string|null} [targetType] room type beyond the door, for colour
 * @property {boolean} [elite] the harder variant of that room type
 * @property {number} lockTimer   >0 while the arena seals the doors
 */

/**
 * @typedef {object} RoomLayout
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

export class Room {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.type  arena | healing | shop | boss | start
   * @param {number} opts.roomWidth
   * @param {number} opts.roomHeight
   * @param {number} [opts.wallThickness]
   */
  constructor({ id, type, roomWidth, roomHeight, wallThickness = 18 }) {
    this.id = id;
    this.type = type;
    /** Interior playable area, in world coordinates. */
    this.bounds = { x: 0, y: 0, w: roomWidth, h: roomHeight };
    this.wallThickness = wallThickness;

    /** Solid wall rectangles used for collision and rendering. */
    /** @type {Rect[]} */
    this.walls = [];
    /** @type {Door[]} */
    this.doors = [];
    /** Rooms are sealed while a fight is in progress (design doc §15, §18). */
    this.sealed = false;

    /** @type {{x: number, y: number}} where the player starts in this room. */
    this.entry = { x: roomWidth / 2, y: roomHeight / 2 };
    /** @type {{x: number, y: number}[]} candidate enemy spawn points. */
    this.spawnPoints = [];
    /** @type {{x:number,y:number}|null} decorative props placed at generation. */
    this.props = [];

    this._buildWalls();
    this._buildSpawnPoints();
    this._buildProps();
  }

  /**
   * Four perimeter walls, with the door gaps cut out afterwards.
   */
  _buildWalls() {
    const t = this.wallThickness;
    const b = this.bounds;
    // Walls extend OUTWARD from the interior so the play area is exactly `bounds`.
    this.walls.push({ x: b.x - t, y: b.y - t, w: b.w + t * 2, h: t });      // north
    this.walls.push({ x: b.x - t, y: b.y + b.h, w: b.w + t * 2, h: t });    // south
    this.walls.push({ x: b.x - t, y: b.y - t, w: t, h: b.h + t * 2 });      // west
    this.walls.push({ x: b.x + b.w, y: b.y - t, w: t, h: b.h + t * 2 });    // east
  }

  /**
   * Evenly spaced interior spawn candidates, kept away from the walls so
   * nothing spawns inside geometry.
   */
  _buildSpawnPoints() {
    const b = this.bounds;
    const margin = 70;
    const cols = 4;
    const rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = b.x + margin + (c / (cols - 1 || 1)) * (b.w - margin * 2);
        const y = b.y + margin + (r / (rows - 1 || 1)) * (b.h - margin * 2);
        this.spawnPoints.push({ x, y });
      }
    }
  }

  /**
   * A handful of decorative floor details. Purely visual, but generated
   * once per room so the look is stable across frames.
   */
  _buildProps() {
    const b = this.bounds;
    const count = rng.int(5, 9);
    for (let i = 0; i < count; i++) {
      this.props.push({
        x: rng.range(b.x + 50, b.x + b.w - 50),
        y: rng.range(b.y + 50, b.y + b.h - 50),
        radius: rng.range(14, 42),
        kind: rng.pick(['crack', 'rubble', 'stain']),
        rotation: rng.range(0, Math.PI * 2),
        alpha: rng.range(0.12, 0.34),
      });
    }
  }

  /**
   * Place a door on one side and remove the wall it covers.
   * @param {'north'|'south'|'east'|'west'} side
   * @param {number} [offsetFraction] 0..1 position along the side
   * @param {string} [targetRoomId]
   * @param {{targetType?: string|null, elite?: boolean}} [meta] what lies
   *   beyond the door, so the renderer can colour it. Geometry does not act
   *   on it.
   * @returns {Door}
   */
  addDoor(side, offsetFraction = 0.5, targetRoomId, meta = {}) {
    const b = this.bounds;
    const t = this.wallThickness;
    const gap = 96;
    const half = gap / 2;

    /** @type {Rect} */
    let rect;
    /** @type {Rect} */
    let wallSlice;

    if (side === 'north' || side === 'south') {
      const cx = b.x + b.w * offsetFraction;
      const y = side === 'north' ? b.y - t : b.y + b.h;
      rect = { x: cx - half, y, w: gap, h: t };
      wallSlice = { x: cx - half, y, w: gap, h: t };
    } else {
      const cy = b.y + b.h * offsetFraction;
      const x = side === 'west' ? b.x - t : b.x + b.w;
      rect = { x, y: cy - half, w: t, h: gap };
      wallSlice = { x, y: cy - half, w: t, h: gap };
    }

    // Cut the opening: drop the wall whose centre falls inside the gap,
    // then split any wall the gap partially overlaps.
    this._carveOpening(wallSlice);

    /** @type {Door} */
    const door = {
      id: `${this.id}:${side}:${Math.round(offsetFraction * 100)}`,
      side,
      rect,
      open: true,
      targetRoomId,
      targetType: meta.targetType ?? null,
      elite: meta.elite === true,
      lockTimer: 0,
    };
    this.doors.push(door);
    return door;
  }

  /**
   * Remove wall material covered by `opening`, splitting walls as needed.
   * @param {Rect} opening
   */
  _carveOpening(opening) {
    /** @type {Rect[]} */
    const result = [];
    for (const wall of this.walls) {
      const overlapX = Math.max(wall.x, opening.x);
      const overlapY = Math.max(wall.y, opening.y);
      const overlapRight = Math.min(wall.x + wall.w, opening.x + opening.w);
      const overlapBottom = Math.min(wall.y + wall.h, opening.y + opening.h);

      if (overlapRight <= overlapX || overlapBottom <= overlapY) {
        result.push(wall);
        continue;
      }

      // Horizontal wall: trim along x.
      if (wall.w >= wall.h) {
        const leftW = overlapX - wall.x;
        const rightX = overlapRight;
        const rightW = wall.x + wall.w - rightX;
        if (leftW > 0.5) result.push({ x: wall.x, y: wall.y, w: leftW, h: wall.h });
        if (rightW > 0.5) result.push({ x: rightX, y: wall.y, w: rightW, h: wall.h });
      } else {
        // Vertical wall: trim along y.
        const topH = overlapY - wall.y;
        const bottomY = overlapBottom;
        const bottomH = wall.y + wall.h - bottomY;
        if (topH > 0.5) result.push({ x: wall.x, y: wall.y, w: wall.w, h: topH });
        if (bottomH > 0.5) result.push({ x: wall.x, y: bottomY, w: wall.w, h: bottomH });
      }
    }
    this.walls = result;
  }

  /**
   * Solid rectangles for collision: every wall, plus every closed door.
   * @returns {Rect[]}
   */
  getCollisionRects() {
    /** @type {Rect[]} */
    const rects = this.walls.slice();
    for (const door of this.doors) {
      if (!door.open) rects.push(door.rect);
    }
    return rects;
  }

  /**
   * Close every door and start the seal timer (design doc §15: doors close
   * when the player enters an arena).
   * @param {number} [duration] seconds the seal lasts, Infinity while fighting
   */
  /**
   * Close every door while the fight is running (design doc §15, §18).
   *
   * `duration` is how long the doors stay shut. `Infinity` means "until the
   * room is cleared", which is the normal case for an arena — the room's
   * controller calls `unseal()` when the last enemy dies.
   *
   * @param {number} [duration] seconds the seal lasts
   */
  seal(duration = Infinity) {
    this.sealed = true;
    for (const door of this.doors) {
      door.open = false;
      door.lockTimer = duration;
    }
  }

  /** Re-open every door once the room is cleared. */
  unseal() {
    this.sealed = false;
    for (const door of this.doors) {
      door.open = true;
      door.lockTimer = 0;
    }
  }

  /**
   * Advance timed door locks.
   *
   * Only doors with a finite timer are affected: an `Infinity` lock means
   * "sealed until the room is cleared" and must never be released by the
   * clock, otherwise a timed door could open a permanently-sealed room.
   * The `sealed` flag is derived from the doors, so it can never disagree
   * with their actual state.
   * @param {number} dt
   */
  update(dt) {
    if (!this.sealed) return;

    let anyShut = false;
    for (const door of this.doors) {
      if (Number.isFinite(door.lockTimer) && door.lockTimer > 0) {
        door.lockTimer -= dt;
        if (door.lockTimer <= 0) {
          door.lockTimer = 0;
          door.open = true;
        }
      }
      if (!door.open) anyShut = true;
    }
    if (!anyShut) this.sealed = false;
  }

  /**
   * Spawn points sorted so that the furthest from a position come first —
   * used to keep enemies from materialising on top of the player.
   * @param {number} fromX
   * @param {number} fromY
   * @returns {{x: number, y: number}[]}
   */
  spawnPointsAwayFrom(fromX, fromY) {
    return this.spawnPoints
      .slice()
      .sort((a, b) => {
        const da = (a.x - fromX) ** 2 + (a.y - fromY) ** 2;
        const db = (b.x - fromX) ** 2 + (b.y - fromY) ** 2;
        return db - da;
      });
  }

  /**
   * Centre of the interior.
   * @returns {{x: number, y: number}}
   */
  get center() {
    return { x: this.bounds.x + this.bounds.w / 2, y: this.bounds.y + this.bounds.h / 2 };
  }
}

/**
 * Collision queries against a fixed set of rectangles.
 *
 * SRP: hold the world's solid geometry and resolve circles against it.
 */
export class CollisionWorld {
  constructor() {
    /** @type {Rect[]} */
    this.rects = [];
  }

  /**
   * Replace the geometry set (called when the player changes room).
   * @param {Rect[]} rects
   */
  setRects(rects) {
    this.rects = rects;
  }

  /** @param {Rect[]} rects */
  addRects(rects) {
    this.rects.push(...rects);
  }

  clear() {
    this.rects = [];
  }

  /**
   * @param {{x: number, y: number, radius: number}} circle
   * @returns {boolean}
   */
  overlapsAny(circle) {
    for (const r of this.rects) {
      if (circleVsRect(circle, r)) return true;
    }
    return false;
  }

  /**
   * Push a circle out of every wall it intersects.
   *
   * Two passes are used because resolving one wall can push the circle into
   * another (typical at inside corners). A third, axis-aligned fallback
   * handles the degenerate corner case where the minimum-translation vector
   * lands exactly on the tangent point and remains in contact with both
   * walls: there the only escape is to move further along one axis.
   * @param {{x: number, y: number, radius: number}} circle
   * @returns {{x: number, y: number}} the corrected centre
   */
  resolve(circle) {
    let { x, y } = circle;
    const radius = circle.radius;

    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const r of this.rects) {
        const mtv = resolveCircleRect({ x, y, radius }, r);
        if (mtv) {
          // Nudge slightly past the surface so the result is strictly
          // outside rather than exactly tangent (which still "overlaps").
          const len = Math.hypot(mtv.x, mtv.y) || 1;
          x += mtv.x + (mtv.x / len) * 0.01;
          y += mtv.y + (mtv.y / len) * 0.01;
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Corner fallback: if still embedded, escape along whichever axis is
    // cheapest, using the deepest overlapping rect.
    if (this.overlapsAny({ x, y, radius })) {
      let bestDx = 0;
      let bestDy = 0;
      let bestCost = Infinity;

      for (const r of this.rects) {
        if (!circleVsRect({ x, y, radius }, r)) continue;
        const candidates = [
          { dx: (r.x - radius - 0.5) - x, dy: 0 },
          { dx: (r.x + r.w + radius + 0.5) - x, dy: 0 },
          { dx: 0, dy: (r.y - radius - 0.5) - y },
          { dx: 0, dy: (r.y + r.h + radius + 0.5) - y },
        ];
        for (const c of candidates) {
          const cost = Math.abs(c.dx) + Math.abs(c.dy);
          if (cost < bestCost) {
            bestCost = cost;
            bestDx = c.dx;
            bestDy = c.dy;
          }
        }
      }
      x += bestDx;
      y += bestDy;
    }

    return { x, y };
  }

  /**
   * Axis-separated movement: try X, then Y, so sliding along a wall feels
   * natural instead of the entity sticking to it.
   *
   * If the start position is already inside geometry (a spawn placed badly,
   * or a corner resolved onto the tangent point), movement is first fixed
   * by pushing out, otherwise the "is the destination free" test would
   * reject every step and weld the entity in place forever.
   * @param {number} x current centre
   * @param {number} y
   * @param {number} dx desired movement
   * @param {number} dy
   * @param {number} radius
   * @returns {{x: number, y: number}} resolved centre
   */
  moveCircle(x, y, dx, dy, radius) {
    // Escape first if we are not in free space, so sliding can work.
    if (this.overlapsAny({ x, y, radius })) {
      const freed = this.resolve({ x, y, radius });
      x = freed.x;
      y = freed.y;
    }

    let nx = x;
    let ny = y;

    if (dx !== 0) {
      const tryX = nx + dx;
      if (!this.overlapsAny({ x: tryX, y: ny, radius })) {
        nx = tryX;
      } else {
        // Step as far as possible to keep contact smooth on diagonals.
        const sign = Math.sign(dx);
        let stepped = 0;
        while (Math.abs(stepped) < Math.abs(dx)
          && !this.overlapsAny({ x: nx + stepped + sign, y: ny, radius })) {
          stepped += sign;
        }
        nx += stepped;
      }
    }

    if (dy !== 0) {
      const tryY = ny + dy;
      if (!this.overlapsAny({ x: nx, y: tryY, radius })) {
        ny = tryY;
      } else {
        const sign = Math.sign(dy);
        let stepped = 0;
        while (Math.abs(stepped) < Math.abs(dy)
          && !this.overlapsAny({ x: nx, y: ny + stepped + sign, radius })) {
          stepped += sign;
        }
        ny += stepped;
      }
    }

    return { x: nx, y: ny };
  }

  /**
   * First rectangle hit by a segment, used by projectiles for wall impacts.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @returns {import('../core/Collision.js').RayHit|null}
   */
  raycast(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    /** @type {import('../core/Collision.js').RayHit|null} */
    let best = null;
    for (const r of this.rects) {
      const hit = segmentVsRect(x0, y0, dx, dy, r);
      if (hit && (best === null || hit.t < best.t)) best = hit;
    }
    return best;
  }

  /**
   * Whether a straight line between two points is unobstructed. Used by
   * enemy AI to decide if it has line of sight.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @returns {boolean}
   */
  hasLineOfSight(x0, y0, x1, y1) {
    return this.raycast(x0, y0, x1, y1) === null;
  }
}
