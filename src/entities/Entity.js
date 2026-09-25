/**
 * @fileoverview Base entity shared by player, enemies and bosses.
 *
 * SRP: own the common physical/mortal state of a thing in the world —
 * position, velocity, health, facing, animation clock. It contains no AI,
 * no attack logic and no drawing.
 */

import { clamp } from '../core/MathUtils.js';
import { StatusEffects } from './StatusEffects.js';

/** Monotonic id source, so every entity is uniquely identifiable in events. */
let nextEntityId = 1;

export class Entity {
  /**
   * @param {object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} opts.radius
   * @param {number} opts.maxHp
   * @param {number} [opts.speed] pixels per second
   */
  constructor({ x, y, radius, maxHp, speed = 0 }) {
    this.id = nextEntityId++;
    this.x = x;
    this.y = y;
    /**
     * Physical footprint used by walls and entity separation.
     * Decorative appendages (bat wings, robes, weapon heads) must not make an
     * entity wedge itself into walls, so combat targeting has a separate
     * `hitRadius` below.
     */
    this.radius = radius;
    /** Radius accepted by attacks/projectiles; subclasses may widen it. */
    this.hitRadius = radius;
    /**
     * Drawn-body hit box, in pixels, anchored on the ground point.
     *
     * Sprites are drawn standing *above* their position, so a circle centred
     * on the feet only ever covers the legs. An enemy whose art is bigger than
     * its footprint declares `hitWidth` / `hitUp` / `hitDown` (measured with
     * `tools/hitbox-audit.mjs`) and combat tests against that box instead;
     * leaving `hitWidth` at 0 keeps the plain circle.
     */
    this.hitWidth = 0;
    this.hitUp = 0;
    this.hitDown = 0;
    this.speed = speed;

    this.maxHp = maxHp;
    this.hp = maxHp;
    this.alive = true;
    /** Set once the death animation has finished; the room then reaps it. */
    this.reapable = false;

    /** Facing angle in radians — drives both rendering and melee arcs. */
    this.facing = 0;
    /** Unit vector derived from `facing`, refreshed each step. */
    this.dirX = 1;
    this.dirY = 0;

    this.vx = 0;
    this.vy = 0;
    /** External impulse from knockback, decays independently of input. */
    this.knockbackX = 0;
    this.knockbackY = 0;

    this.status = new StatusEffects();

    /** Seconds since spawn, used to drive idle animation phase. */
    this.age = 0;
    /** >0 while the entity is in its hurt flash. */
    this.hurtFlash = 0;
    /** Seconds since death, drives the death animation. */
    this.deathTimer = 0;
    /** Faction key: 'player' or 'enemy'. CombatSystem refuses friendly fire. */
    this.faction = 'neutral';
    /** Free-form tag used by renderers to pick a silhouette. */
    this.kind = 'entity';
  }

  /** @returns {boolean} */
  get isDead() {
    return !this.alive;
  }

  /** @returns {number} 0..1 */
  get healthFraction() {
    return this.maxHp > 0 ? clamp(this.hp / this.maxHp, 0, 1) : 0;
  }

  /**
   * Aim the entity at a world point.
   * @param {number} tx
   * @param {number} ty
   */
  lookAt(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.0001) {
      this.dirX = dx / len;
      this.dirY = dy / len;
      this.facing = Math.atan2(dy, dx);
    }
  }

  /**
   * Push the entity away from a source point with a given impulse.
   * @param {number} fromX
   * @param {number} fromY
   * @param {number} strength
   */
  applyKnockback(fromX, fromY, strength) {
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    this.knockbackX += (dx / len) * strength;
    this.knockbackY += (dy / len) * strength;
  }

  /**
   * Deal damage. Returns the amount actually applied (0 when blocked),
   * so the combat system can report accurate numbers.
   * @param {number} amount
   * @returns {number}
   */
  takeDamage(amount) {
    if (!this.alive || amount <= 0) return 0;
    const applied = Math.min(this.hp, amount);
    this.hp -= applied;
    this.hurtFlash = 0.14;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deathTimer = 0;
    }
    return applied;
  }

  /**
   * Restore health, capped at maxHp. Returns the amount actually healed.
   * @param {number} amount
   * @returns {number}
   */
  heal(amount) {
    if (!this.alive || amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /**
   * Increase max HP, keeping the current HP ratio sensible (used by the
   * "+10% max HP" upgrades and healing-room bonus).
   * @param {number} amount
   * @param {boolean} [healToo] also grant the new HP immediately
   */
  increaseMaxHp(amount, healToo = true) {
    this.maxHp += amount;
    if (healToo) this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * Advance timers common to every entity. Movement is applied by the
   * caller because the collision response differs per entity type.
   * @param {number} dt
   */
  tickCommon(dt) {
    this.age += dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (!this.alive) this.deathTimer += dt;
    this.status.update(dt);

    // Knockback decays exponentially — frame-rate independent.
    const decay = Math.exp(-7.5 * dt);
    this.knockbackX *= decay;
    this.knockbackY *= decay;
    if (Math.abs(this.knockbackX) < 1) this.knockbackX = 0;
    if (Math.abs(this.knockbackY) < 1) this.knockbackY = 0;
  }

  /**
   * Total velocity for this step, including knockback.
   * @returns {{x: number, y: number}}
   */
  totalVelocity() {
    return { x: this.vx + this.knockbackX, y: this.vy + this.knockbackY };
  }

  /**
   * Circle used for collision tests.
   * @returns {{x: number, y: number, radius: number}}
   */
  getCircle() {
    return { x: this.x, y: this.y, radius: this.radius };
  }

  /**
   * Shape that attacks are tested against.
   *
   * This is the *drawn* body, not the physical footprint: walls and entity
   * separation keep using `getCircle()`, so a wide sprite never wedges itself
   * into geometry. Entities whose art fits their circle return the circle.
   * @returns {{x: number, y: number, radius?: number, width?: number, up?: number, down?: number}}
   */
  getHitVolume() {
    if (this.hitWidth > 0) {
      return {
        x: this.x,
        y: this.y,
        width: this.hitWidth,
        up: this.hitUp,
        down: this.hitDown,
      };
    }
    return { x: this.x, y: this.y, radius: this.hitRadius };
  }

  /** Instantly kill and mark as reapable. */
  kill() {
    this.hp = 0;
    this.alive = false;
    this.reapable = true;
  }

  /** Detach from the world. Subclasses may override for extra cleanup. */
  destroy() {
    this.alive = false;
  }
}
