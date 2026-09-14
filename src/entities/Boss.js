/**
 * @fileoverview Boss entities and their attack scheduling.
 *
 * SRP: a boss is a large entity with phases and a scheduled attack list.
 * It owns its own state machine and telegraph timing; damage resolution
 * still goes through CombatSystem and movement through MovementSystem.
 *
 * A Boss extends Entity directly rather than Enemy: an enemy is a row of
 * data-driven stats with an AI archetype, whereas a boss is defined by its
 * attack script. Modelling them as siblings keeps both honest and avoids
 * fabricating a fake enemy-data row for every boss.
 *
 * Design doc §12-14 require that dangerous attacks are visibly announced
 * before they land, so every attack has a telegraph window during which a
 * ground marker is drawn and the boss is locked in place.
 */

import { Entity } from './Entity.js';
import { getBoss } from '../data/bosses.js';
import { CONFIG } from '../core/Config.js';

/**
 * @typedef {object} PendingAttack
 * @property {import('../data/bosses.js').BossAttack} def
 * @property {number} timer     seconds until it resolves
 * @property {number} total
 * @property {{x: number, y: number}} aimPoint
 * @property {number} aimAngle
 */

export class Boss extends Entity {
  /**
   * @param {object} opts
   * @param {string} opts.bossId
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.hpScale]
   * @param {number} [opts.damageScale]
   */
  constructor({ bossId, x, y, hpScale = 1, damageScale = 1 }) {
    const def = getBoss(bossId);

    super({
      x,
      y,
      radius: def.radius,
      maxHp: Math.round(def.maxHp * hpScale),
      speed: def.speed * CONFIG.world.speedUnit,
    });

    this.kind = 'boss';
    this.faction = 'enemy';
    this.bossId = bossId;
    this.bossDef = def;
    // Same split as Enemy: the sprite is drawn far larger than the physical
    // footprint, so the combat volume is measured from the art, not the body.
    this.hitRadius = def.hitRadius ?? def.radius;
    this.hitWidth = def.hitWidth ?? 0;
    this.hitUp = def.hitUp ?? 0;
    this.hitDown = def.hitDown ?? 0;
    this.damage = def.damage * damageScale;
    this.goldRange = { min: def.goldMin, max: def.goldMax };

    /**
     * A definition object shaped like an enemy row, so shared systems
     * (AI dispatch, damage scaling) can read `def.ai` and `def.attackRange`
     * uniformly without a special case.
     */
    this.def = {
      id: bossId,
      name: def.name,
      ai: 'boss',
      maxHp: this.maxHp,
      speed: def.speed,
      damage: this.damage,
      radius: def.radius,
      goldMin: def.goldMin,
      goldMax: def.goldMax,
      attackCooldown: 1.6,
      attackRange: def.radius + 90,
      attackType: /** @type {'melee'} */ ('melee'),
      elite: true,
    };

    /** Shared AI timing shape, so AISystem's dispatch works unchanged. */
    this.ai = {
      attackTimer: 0,
      dashTimer: 0,
      dashing: 0,
      summonTimer: 0,
      stealthTimer: 0,
      aggro: true,
      wobble: 0,
      strafeDir: 1,
      strafeTimer: 0,
      rooted: 0,
    };

    /** Randomises idle animation between identical bosses. */
    this.phase = 1;
    /** @type {Map<string, number>} per-attack cooldown remaining */
    this.attackCooldowns = new Map(def.attacks.map((a) => [a.id, a.cooldown * 0.4]));
    /** @type {PendingAttack|null} */
    this.pending = null;
    /** Minimum gap between attacks. */
    this.globalCooldown = 1.2;
    /** >0 while rooted by an attack animation. */
    this.attackLock = 0;
    /** Freeze frames after a big impact, for weight. */
    this.staggerTimer = 0;

    /** Enemy-compatible fields read by shared code. */
    this.enraged = false;
    this.stealthAlpha = 1;
    this.animationPhase = Math.random() * Math.PI * 2;
  }

  /**
   * @returns {number} cooldown multiplier for the current phase
   */
  get phaseCooldownMul() {
    return this.phase === 2 ? (this.bossDef.phase2CooldownMul ?? 1) : 1;
  }

  /**
   * @returns {number} pixels per second, zero while attacking or staggered
   */
  getSpeed() {
    let s = this.speed;
    if (this.phase === 2) s *= this.bossDef.phase2SpeedMul ?? 1;
    if (this.attackLock > 0 || this.pending) s = 0;
    s *= this.status.speedMultiplier();
    return s;
  }

  /**
   * @returns {number}
   */
  getDamage() {
    return this.damage * (this.phase === 2 ? 1.15 : 1);
  }

  /**
   * Bosses cannot attack with the ordinary enemy melee; the controller
   * schedules their scripted attacks instead.
   * @returns {boolean}
   */
  canAttack() {
    return false;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    this.tickCommon(dt);

    if (this.globalCooldown > 0) this.globalCooldown -= dt;
    if (this.attackLock > 0) this.attackLock -= dt;
    if (this.staggerTimer > 0) this.staggerTimer -= dt;

    for (const [id, cd] of this.attackCooldowns) {
      if (cd > 0) this.attackCooldowns.set(id, cd - dt);
    }

    // Phase transition at the documented HP threshold (§12-14).
    if (this.phase === 1 && this.healthFraction <= (this.bossDef.phase2At ?? 0.5)) {
      this.phase = 2;
      this.staggerTimer = 0.7;
      this.attackLock = 0.7;
      // Shorten remaining cooldowns so phase 2 presses immediately.
      for (const [id, cd] of this.attackCooldowns) {
        this.attackCooldowns.set(id, cd * 0.4);
      }
      this.pending = null;
      if (this.onPhaseChange) this.onPhaseChange();
    }
  }

  /**
   * Pick the next attack that is off cooldown and sensible at this range.
   * @param {number} distToPlayer
   * @returns {import('../data/bosses.js').BossAttack|null}
   */
  chooseAttack(distToPlayer) {
    if (this.pending || this.attackLock > 0) return null;
    if (this.globalCooldown > 0) return null;

    const ready = this.bossDef.attacks.filter((a) => (this.attackCooldowns.get(a.id) ?? 0) <= 0);
    if (ready.length === 0) return null;

    // Score each attack for the current distance: melee patterns are
    // favoured up close, ranged patterns at range.
    const scored = ready.map((a) => {
      const isMelee = a.kind === 'slam' || a.kind === 'combo'
        || a.kind === 'spin' || a.kind === 'dash';
      let score = isMelee
        ? (distToPlayer < this.radius + 150 ? 3 : 0.3)
        : (distToPlayer > this.radius + 90 ? 2.4 : 0.6);
      if (a.kind === 'summon') score = 1.6;
      // Phase 2 leans on the heaviest patterns.
      if (this.phase === 2 && (a.kind === 'fireRain' || a.kind === 'spin' || a.kind === 'cloneVolley')) {
        score *= 1.6;
      }
      // Jitter prevents a perfectly predictable rotation.
      return { a, score: score * (0.7 + Math.random() * 0.6) };
    }).sort((x, y) => y.score - x.score);

    const chosen = scored[0];
    return chosen && chosen.score > 0.25 ? chosen.a : null;
  }

  /**
   * Begin the telegraph wind-up for an attack.
   * @param {import('../data/bosses.js').BossAttack} attack
   * @param {{x: number, y: number}} aimPoint
   */
  beginAttack(attack, aimPoint) {
    this.pending = {
      def: attack,
      timer: attack.telegraph,
      total: attack.telegraph,
      aimPoint: { x: aimPoint.x, y: aimPoint.y },
      aimAngle: Math.atan2(aimPoint.y - this.y, aimPoint.x - this.x),
    };
    this.attackCooldowns.set(attack.id, attack.cooldown * this.phaseCooldownMul);
    this.lookAt(aimPoint.x, aimPoint.y);
  }

  /**
   * Called once the telegraph completes.
   * @returns {PendingAttack|null} the resolved attack
   */
  resolveAttack() {
    const p = this.pending;
    this.pending = null;
    if (p) {
      this.globalCooldown = 0.55 * this.phaseCooldownMul;
      this.attackLock = 0.3;
    }
    return p;
  }

  /**
   * Assigned by the BossController.
   * @type {(() => void)|null}
   */
  onPhaseChange = null;
}
