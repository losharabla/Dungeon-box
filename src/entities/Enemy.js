/**
 * @fileoverview Enemy semantics: the runtime companion to `data/enemies.js`.
 *
 * SRP: hold per-instance enemy state (AI timers, aggro, boss phase) and
 * expose the data definition. It contains no AI decisions — those are in
 * the AI behaviour modules — and no drawing.
 */

import { Entity } from '../entities/Entity.js';
import { CONFIG } from '../core/Config.js';
import { getEnemy } from '../data/enemies.js';

export class Enemy extends Entity {
  /**
   * @param {object} opts
   * @param {string} opts.typeId
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.hpScale]  difficulty scaling for later floors
   * @param {number} [opts.damageScale]
   */
  constructor({ typeId, x, y, hpScale = 1, damageScale = 1 }) {
    const def = getEnemy(typeId);
    super({
      x,
      y,
      radius: def.radius,
      maxHp: Math.round(def.maxHp * hpScale),
      speed: def.speed * CONFIG.world.speedUnit,
    });

    this.kind = typeId;
    this.faction = 'enemy';
    // Targeting and physical collision are intentionally separate. A bat's
    // wings and a slime's squash/stretch should be hittable, but they should
    // not make those enemies snag on walls or shove the player from afar.
    // The hit *box* describes the drawn body, which stands above the ground
    // point; both are measured by `tools/hitbox-audit.mjs`.
    this.hitRadius = def.hitRadius ?? def.radius;
    this.hitWidth = def.hitWidth ?? 0;
    this.hitUp = def.hitUp ?? 0;
    this.hitDown = def.hitDown ?? 0;
    this.def = def;
    this.typeId = typeId;
    this.damage = def.damage * damageScale;

    /** Gold payout range, read by CombatSystem on death. */
    this.goldRange = { min: def.goldMin, max: def.goldMax };

    /** AI timing state. */
    this.ai = {
      attackTimer: def.attackCooldown * Math.random(),
      dashTimer: def.dashCooldown ? def.dashCooldown * Math.random() : 0,
      dashing: 0,
      summonTimer: def.summon ? def.summon.cooldown * 0.5 : 0,
      stealthTimer: 0,
      aggro: false,
      /** Random wander offset, so groups do not stack into one line. */
      wobble: Math.random() * Math.PI * 2,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1 + Math.random() * 2,
      rooted: 0,
    };

    /** Enrage state (Berserker §11.9). */
    this.enraged = false;
    /** Assassin stealth alpha, read by the renderer (§11.8). */
    this.stealthAlpha = 1;

    /** Rolling animation phase so identical enemies do not move in sync. */
    this.phase = Math.random() * Math.PI * 2;

    /**
     * Shield stamina (shieldbearers only). Blocking drains it; an exhausted
     * shield drops for a recovery window, which prevents a pair of bearers
     * from covering each other's flanks permanently.
     */
    this.shieldMaxStamina = def.ai === 'shield' ? 100 : 0;
    this.shieldStamina = this.shieldMaxStamina;
    /** >0 while the shield is broken and provides no protection. */
    this.shieldBreakTimer = 0;
  }

  /**
   * Damage output including the enrage multiplier.
   * @returns {number}
   */
  getDamage() {
    const mul = this.enraged ? (this.def.enrageDamageMul ?? 1) : 1;
    return this.damage * mul;
  }

  /**
   * Speed including enrage, status effects and the dash burst.
   * @returns {number} pixels per second
   */
  getSpeed() {
    let s = this.speed;
    if (this.enraged) s *= this.def.enrageSpeedMul ?? 1;
    s *= this.status.speedMultiplier();
    if (this.ai.dashing > 0) s *= (this.def.dashSpeed ?? 1);
    return s;
  }

  /**
   * @returns {boolean} whether this enemy can attack right now
   */
  canAttack() {
    return this.alive && this.status.canAct() && this.ai.attackTimer <= 0 && this.ai.rooted <= 0;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    this.tickCommon(dt);

    if (this.ai.attackTimer > 0) this.ai.attackTimer -= dt;
    if (this.ai.dashTimer > 0) this.ai.dashTimer -= dt;
    if (this.ai.dashing > 0) this.ai.dashing -= dt;
    if (this.ai.summonTimer > 0) this.ai.summonTimer -= dt;
    if (this.ai.stealthTimer > 0) this.ai.stealthTimer -= dt;
    if (this.ai.rooted > 0) this.ai.rooted -= dt;

    // Berserker enrage (§11.9): triggers once, at the configured threshold.
    const threshold = this.def.healthThreshold;
    if (threshold && !this.enraged && this.healthFraction <= threshold) {
      this.enraged = true;
      // The speed/damage multipliers are applied in getSpeed()/getDamage(),
      // so the base stats stay immutable and the buff stays removable.
      this.ai.rooted = 0.2;
    }
  }

  /** Called by the room when the death animation finishes. */
  markReapable() {
    this.reapable = true;
  }
}
