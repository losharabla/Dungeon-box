/**
 * @fileoverview Movement and collision resolution for every entity.
 *
 * SRP: given the current world, move things. It reads input intents and AI
 * velocity, then applies wall collision and entity separation. It contains
 * no damage logic and no drawing.
 *
 * Keeping movement in one place means the player and enemies share the same
 * wall-sliding and separation behaviour for free.
 */

import { CONFIG } from '../core/Config.js';
import { clamp } from '../core/MathUtils.js';

export class MovementSystem {
  /**
   * @param {object} deps
   * @param {import('../entities/Room.js').CollisionWorld} deps.collisionWorld
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   */
  constructor({ collisionWorld, registry }) {
    this.collisionWorld = collisionWorld;
    this.registry = registry;
  }

  /**
   * Convert the player's input into velocity, then integrate with collision.
   * @param {import('../entities/Player.js').Player} player
   * @param {{x: number, y: number}} moveVector normalized input direction
   * @param {number} dt
   */
  movePlayer(player, moveVector, dt) {
    if (!player.alive) {
      // Corpses still slide from residual knockback, then stop.
      this._integrate(player, 0, 0, dt);
      return;
    }

    const speed = player.getEffectiveSpeed();
    // Movement is disabled mid-ultimate for ultimates that root the player,
    // and while stunned by status effects.
    const canMove = player.status.canAct() && !player.movementLocked;
    player.vx = canMove ? moveVector.x * speed : 0;
    player.vy = canMove ? moveVector.y * speed : 0;

    // A dash is a committed burst: it ignores the input direction for its
    // short duration, so releasing the key mid-dash cannot cut it short.
    if (player.isDashing) {
      const dashSpeed = speed * CONFIG.dash.speedMul;
      player.vx = player.dashDirX * dashSpeed;
      player.vy = player.dashDirY * dashSpeed;
    }

    this._integrate(player, player.vx, player.vy, dt);
  }

  /**
   * Apply an AI-provided desired velocity to an enemy.
   * @param {import('../entities/Entity.js').Entity} enemy
   * @param {number} desiredVx
   * @param {number} desiredVy
   * @param {number} dt
   */
  moveEntity(enemy, desiredVx, desiredVy, dt) {
    if (!enemy.alive) {
      this._integrate(enemy, 0, 0, dt);
      return;
    }
    enemy.vx = desiredVx;
    enemy.vy = desiredVy;
    this._integrate(enemy, desiredVx, desiredVy, dt);
  }

  /**
   * Integrate position with wall collision and knockback.
   * @param {import('../entities/Entity.js').Entity} e
   * @param {number} vx
   * @param {number} vy
   * @param {number} dt
   */
  _integrate(e, vx, vy, dt) {
    const totalX = vx + e.knockbackX;
    const totalY = vy + e.knockbackY;

    const dx = totalX * dt;
    const dy = totalY * dt;
    if (dx === 0 && dy === 0) return;

    const resolved = this.collisionWorld.moveCircle(e.x, e.y, dx, dy, e.radius);

    // If wall sliding left us still embedded (spawned inside geometry),
    // push straight out so nothing can get permanently stuck.
    if (this.collisionWorld.overlapsAny({ x: resolved.x, y: resolved.y, radius: e.radius })) {
      const pushed = this.collisionWorld.resolve({ x: resolved.x, y: resolved.y, radius: e.radius });
      e.x = pushed.x;
      e.y = pushed.y;
    } else {
      e.x = resolved.x;
      e.y = resolved.y;
    }
  }

  /**
   * Stop entities from overlapping each other.
   *
   * A spatial grid keeps this near-linear instead of comparing every pair,
   * which matters once a late wave has 30+ enemies on screen.
   * @param {import('../entities/Entity.js').Entity[]} enemies
   * @param {import('../entities/Entity.js').Entity|null} player
   * @param {number} dt
   */
  separate(enemies, player, dt) {
    const cellSize = 48;
    /** @type {Map<string, import('../entities/Entity.js').Entity[]>} */
    const grid = new Map();

    const keyOf = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

    for (const e of enemies) {
      if (!e.alive) continue;
      const k = keyOf(e.x, e.y);
      const bucket = grid.get(k);
      if (bucket) bucket.push(e);
      else grid.set(k, [e]);
    }

    // Push apart enemies that share or neighbour a cell.
    for (const e of enemies) {
      if (!e.alive) continue;
      const cx = Math.floor(e.x / cellSize);
      const cy = Math.floor(e.y / cellSize);

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(`${cx + ox},${cy + oy}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === e || !other.alive) continue;
            // Only resolve each pair once.
            if (other.id < e.id) continue;
            this._separatePair(e, other, dt);
          }
        }
      }
    }

    // The player pushes enemies away and is pushed back, but with a
    // stronger weight on the enemy so the player never feels "stuck".
    if (player && player.alive) {
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const minDist = e.radius + player.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > minDist * minDist || d2 < 0.0001) continue;

        const d = Math.sqrt(d2);
        const overlap = minDist - d;
        const nx = dx / d;
        const ny = dy / d;
        // Move the enemy 75% of the way, the player 25%.
        e.x += nx * overlap * 0.75;
        e.y += ny * overlap * 0.75;
        const resolved = this.collisionWorld.resolve({ x: player.x - nx * overlap * 0.25, y: player.y - ny * overlap * 0.25, radius: player.radius });
        player.x = resolved.x;
        player.y = resolved.y;
      }
    }
  }

  /**
   * @param {import('../entities/Entity.js').Entity} a
   * @param {import('../entities/Entity.js').Entity} b
   * @param {number} dt
   */
  _separatePair(a, b, dt) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minDist = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minDist * minDist || d2 < 0.0001) return;

    const d = Math.sqrt(d2);
    const overlap = minDist - d;
    const nx = dx / d;
    const ny = dy / d;

    // Heavier (larger) entities yield less.
    const massA = a.radius * a.radius;
    const massB = b.radius * b.radius;
    const total = massA + massB;
    const shareA = massB / total;
    const shareB = massA / total;

    const push = Math.min(overlap, 60) * 0.5 * clamp(dt * 60, 0, 1);
    a.x -= nx * push * shareA;
    a.y -= ny * push * shareA;
    b.x += nx * push * shareB;
    b.y += ny * push * shareB;
  }

  /**
   * Keep an entity inside the room bounds as a safety net. Wall collision
   * normally handles this; this catches anything spawned out of bounds.
   * @param {import('../entities/Entity.js').Entity} e
   * @param {{x: number, y: number, w: number, h: number}} bounds
   */
  clampToBounds(e, bounds) {
    e.x = clamp(e.x, bounds.x + e.radius, bounds.x + bounds.w - e.radius);
    e.y = clamp(e.y, bounds.y + e.radius, bounds.y + bounds.h - e.radius);
  }

  /**
   * Distance-limited movement toward a point; shared by every chasing AI.
   * @param {number} fromX
   * @param {number} fromY
   * @param {number} toX
   * @param {number} toY
   * @param {number} speed
   * @param {object} [opts]
   * @param {number} [opts.stopDistance] stop this far from the target
   * @returns {{x: number, y: number}} desired velocity
   */
  seek(fromX, fromY, toX, toY, speed, opts = {}) {
    const { stopDistance = 0 } = opts;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const d = Math.hypot(dx, dy);
    if (d < 0.0001 || d <= stopDistance) return { x: 0, y: 0 };
    return { x: (dx / d) * speed, y: (dy / d) * speed };
  }
}

/** Shared tuning for entity separation, exposed for tests and balance. */
export const MOVEMENT_TUNING = {
  separationPush: 0.5,
  maxSeparationPerStep: 60,
  playerPushShare: 0.25,
  enemyPushShare: 0.75,
};

void MOVEMENT_TUNING;
void CONFIG;
