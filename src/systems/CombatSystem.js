/**
 * @fileoverview Damage application and status effects.
 *
 * SRP: given an attacker, a target and a hit description, decide how much
 * damage lands and what secondary effects follow. It does not spawn
 * entities, move them, or draw anything — it only mutates health/status and
 * announces the result on the EventBus.
 *
 * This is the single place where "damage" means anything, so armour, crits,
 * shields, status application and death all stay consistent.
 */

import { CONFIG } from '../core/Config.js';
import { EVENTS } from '../core/EventBus.js';
import { distanceToHitVolume } from '../core/Collision.js';
import { FloatingTextSystem } from '../rendering/textEffects.js';

/**
 * Stamina removed from a shieldbearer per blocked hit, before the weight of
 * the blow is taken into account.
 */
const SHIELD_COST_PER_BLOCK = 12;
/**
 * A blocked hit costs a full base charge at this much damage, half of it at
 * zero, and grows linearly beyond.
 *
 * The cost was flat, which made the Sniper Rifle mathematically unable to
 * break a shield: one round removed 12 stamina and the bearer regenerated
 * 9/sec, while the rifle's 1.35s cooldown returned 12.15 - more than the
 * round had taken. No matter how long the player kept aiming, the shield
 * healed back every single time. A heavy round should pound a shield down
 * instead, and that is what this curve does: a Sniper round (78 dmg) costs
 * ~45 stamina and the guard drops after three hits, while light bullets
 * barely strain it.
 */
const SHIELD_WEIGHT_DAMAGE = 24;
/** Stamina regenerated per second while the shield is up. */
const SHIELD_REGEN = 9;
/** How long a shield stays broken once it is exhausted, in seconds. */
const SHIELD_BREAK_DURATION = 3.2;
/** Colour for damage-over-time labels, matching the burn tick colour. */
const DOT_COLOR = '#ff8a3d';

/**
 * @typedef {object} HitSpec
 * @property {number} damage
 * @property {number} [knockback]
 * @property {number} [critChance]
 * @property {number} [critMultiplier]
 * @property {boolean} [canCrit]
 * @property {number} [burnChance]
 * @property {number} [burnDuration]
 * @property {number} [burnDamage]
 * @property {number} [slowChance]
 * @property {number} [slowFactor]
 * @property {number} [slowDuration]
 * @property {number} [stunChance]
 * @property {number} [stunDuration]
 * @property {boolean} [ignoreShield]
 * @property {string} [source]   free-form tag for VFX selection
 * @property {any} [attacker]
 */

/**
 * @typedef {object} HitResult
 * @property {number} applied      damage actually dealt
 * @property {boolean} crit
 * @property {boolean} blocked
 * @property {boolean} killed
 * @property {boolean} dodged
 */

export class CombatSystem {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   * @param {import('../rendering/particleSystem.js').ParticleSystem} deps.particles
   * @param {FloatingTextSystem} deps.floatingText
   * @param {import('../rendering/decals.js').DecalLayer} [deps.decals]
   * @param {() => number} deps.random
   */
  constructor({ bus, registry, particles, floatingText, decals, random }) {
    this.bus = bus;
    this.registry = registry;
    this.particles = particles;
    this.floatingText = floatingText;
    // Optional so a bare CombatSystem in a unit test still works.
    this.decals = decals ?? null;
    this.random = random;
  }

  /**
   * Resolve one hit against one target.
   *
   * @param {import('../entities/Entity.js').Entity} target
   * @param {HitSpec} spec
   * @param {any} [source] entity credited with the hit (attacker)
   * @returns {HitResult}
   */
  applyHit(target, spec, source) {
    /** @type {HitResult} */
    const result = { applied: 0, crit: false, blocked: false, killed: false, dodged: false };

    if (!target || !target.alive) return result;
    if (target.status.isInvulnerable()) {
      this._showText(target, 'MISS', FloatingTextSystem.COLORS.info, 13);
      return result;
    }

    let damage = spec.damage;

    // Shieldbearer (design doc §11.7): a frontal block. The block test is
    // directional, so attacking from behind still lands full damage, and
    // area damage (explosions, ground hazards) bypasses the shield since
    // it cannot be covered.
    const blockResult = spec.ignoreShield ? null : this._checkShieldBlock(target, source);
    if (blockResult) {
      result.blocked = true;
      // Blocking costs the bearer stamina; a sustained assault breaks the
      // shield and opens it up from every direction for a moment. The
      // strain scales with the weight of the blow, so heavy weapons can
      // batter a guard down faster than a stream of light shots.
      this._drainShield(target, damage / SHIELD_WEIGHT_DAMAGE);
      this.particles.cone('spark', target.x, target.y, blockResult.angle, 8, 220);
      this.floatingText.add(target.x, target.y - target.radius - 8, 'BLOCK', {
        color: '#9fd8ff', size: 15,
      });
      this.bus.emit(EVENTS.STATUS_APPLIED, { entity: target, status: 'block' });
      return result;
    }

    // Critical hit.
    const canCrit = spec.canCrit !== false;
    const critChance = spec.critChance ?? 0;
    if (canCrit && critChance > 0 && this.random() < critChance) {
      result.crit = true;
      damage *= spec.critMultiplier ?? CONFIG.combat.critMultiplier;
    }

    // Flat armour reduction for the player.
    if (target.faction === 'player' && typeof target.modifiers?.armor === 'number') {
      damage = Math.max(1, damage - target.modifiers.armor);
    }

    const applied = target.takeDamage(damage);
    result.applied = applied;
    result.killed = !target.alive;

    // The player's post-hit mercy window. Pack enemies each attack on their
    // own timer, so several blows can land on one frame; without this gate a
    // melee class that has to stand inside the pack takes all of them at once
    // and dies in about two seconds. Only a hit that actually hurt opens the
    // window, and status damage (burn) bypasses it.
    if (applied > 0 && target.faction === 'player' && CONFIG.combat.playerHurtIframe > 0) {
      target.status.apply('hurtIframe', CONFIG.combat.playerHurtIframe, 1);
    }

    this._applyStatus(target, spec);
    this._knockback(target, source, spec);

    // Presentation.
    const isPlayerTarget = target.faction === 'player';
    // Only override the particle colour for critical hits; passing an
    // explicit `undefined` would clobber the preset's own colour.
    const hitParticleOverrides = result.crit ? { color: '#ff7a5a' } : {};
    // Area damage arrives as one hit per body caught in the blast. Firing a
    // full impact burst for each of them overshoots the particle step budget,
    // which then drops two thirds of them: the effect looks thinner *and* every
    // dropped particle was still work. Scaling by the caller's factor keeps a
    // blast inside the budget instead of gambling on which sparks survive.
    const vfx = spec.vfxScale ?? 1;
    if (vfx > 0) {
      this.particles.burst(
        isPlayerTarget ? 'blood' : 'spark',
        target.x, target.y - target.radius * 0.5,
        (result.crit ? 12 : 7) * vfx,
        { speed: 170, overrides: hitParticleOverrides },
      );
    }
    // Damage labels aggregate: a pierce-and-explode weapon lands dozens of hits
    // a second on the same body, and one glyph run per hit was the single
    // largest per-frame drawing cost in the game.
    this.floatingText.addDamage(
      target.x, target.y - target.radius - 10,
      applied,
      {
        color: result.crit ? FloatingTextSystem.COLORS.crit : FloatingTextSystem.COLORS.damage,
        size: result.crit ? 22 : 16,
      },
    );
    if (result.crit) {
      this.bus.emit(EVENTS.SHAKE_REQUESTED, 3.4);
    }

    // Bookkeeping & progression.
    this._reportDamage(target, applied, source, spec, result);

    if (result.killed) {
      this._handleDeath(target, source);
    }

    return result;
  }

  /**
   * Apply an area-of-effect hit to everything within a radius.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {HitSpec} spec
   * @param {any} [source]
   * @param {object} [opts]
   * @param {string} [opts.faction] restrict to a faction ('enemy' hits enemies)
   * @param {number} [opts.falloff] damage multiplier applied at the edge
   * @returns {number} number of entities hit
   */
  applyAreaHit(x, y, radius, spec, source, opts = {}) {
    const { faction, falloff = 1 } = opts;
    let hits = 0;

    /** @type {import('../entities/Entity.js').Entity[]} */
    const candidates = [];
    if (!faction || faction === 'enemy') candidates.push(...this.registry.enemies);
    if (!faction || faction === 'player') {
      if (this.registry.player) candidates.push(this.registry.player);
    }

    for (const e of candidates) {
      if (!e.alive) continue;
      // Blasts are tested against the target's drawn body, which stands above
      // its ground point: a fireball landing on a humanoid's chest used to
      // miss because the circle sat at the feet.
      const volume = typeof e.getHitVolume === 'function'
        ? e.getHitVolume()
        : { x: e.x, y: e.y, radius: e.hitRadius ?? e.radius ?? 0 };
      const surface = distanceToHitVolume(x, y, volume);
      if (surface > radius) continue;

      // Falloff is measured at the target's near edge rather than its centre,
      // so a large body takes full damage where it actually overlaps.
      const scale = falloff >= 1 ? 1 : 1 - (surface / radius) * (1 - falloff);
      // Blast damage ignores directional shields, and emits a fraction of a
      // direct hit's particles because one blast hits many bodies at once.
      this.applyHit(e, {
        ...spec,
        damage: spec.damage * scale,
        ignoreShield: true,
        vfxScale: (spec.vfxScale ?? 1) * CONFIG.render.areaVfxScale,
      }, source);
      hits++;
    }
    return hits;
  }

  /* ============================================================
     Internals
     ============================================================ */

  /**
   * Directional shield block check (§11.7).
   *
   * Only an arc in front of the shieldbearer is protected, and the bearer
   * turns slowly (see its `turnRate`), so the player can circle behind it.
   *
   * A shield also cannot track a target forever: blocking drains it, and
   * once it is exhausted the bearer is open from any direction for a short
   * window. Without this, two bearers standing together would cover each
   * other's flanks permanently and become mutually invulnerable, since each
   * always faces the player — an accidental immunity that no amount of
   * player skill could defeat.
   *
   * @param {import('../entities/Entity.js').Entity} target
   * @param {any} source
   * @returns {{angle: number}|null}
   */
  _checkShieldBlock(target, source) {
    if (target.kind !== 'shieldbearer') return null;
    if (!source || typeof source.x !== 'number') return null;
    // A shield cannot stop an explosion or a hazard that engulfs it.
    if (source.faction !== 'player') return null;
    // An exhausted shield is down.
    if (target.shieldBreakTimer > 0) return null;

    const arc = target.def?.blockArc ?? 0.85;
    const toSource = Math.atan2(source.y - target.y, source.x - target.x);
    let diff = toSource - target.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < arc) {
      return { angle: toSource + Math.PI };
    }
    return null;
  }

  /**
   * Update shield stamina for every bearer. A block consumes stamina; when
   * it runs out the shield drops for a recovery window, which is what keeps
   * a pair of bearers from being permanently immune.
   * @param {number} dt
   */
  updateShields(dt) {
    for (const e of this.registry.enemies) {
      if (e.kind !== 'shieldbearer' || !e.alive) continue;

      if (e.shieldBreakTimer > 0) {
        e.shieldBreakTimer -= dt;
        // Recover fully once the shield comes back up.
        if (e.shieldBreakTimer <= 0) e.shieldStamina = e.shieldMaxStamina;
        continue;
      }

      // Regenerate slowly while not under pressure.
      if (e.shieldStamina < e.shieldMaxStamina) {
        e.shieldStamina = Math.min(e.shieldMaxStamina, e.shieldStamina + dt * SHIELD_REGEN);
      }
    }
  }

  /**
   * Charge the stamina cost of a successful block and break the shield when
   * it is exhausted.
   * @param {import('../entities/Entity.js').Entity} target
   * @param {number} [weight] strain multiplier from the blocked blow (1 = a
   *   base-cost hit; heavy weapons block above 1, light pellets below)
   */
  _drainShield(target, weight = 1) {
    if (typeof target.shieldStamina !== 'number') return;
    const strain = 0.5 + 0.5 * Math.min(4, Math.max(0, weight));
    target.shieldStamina -= SHIELD_COST_PER_BLOCK * strain;
    if (target.shieldStamina <= 0) {
      target.shieldStamina = 0;
      target.shieldBreakTimer = SHIELD_BREAK_DURATION;
      this.particles.cone('spark', target.x, target.y, 0, 14, 300);
      this.floatingText.add(target.x, target.y - target.radius - 12, 'SHIELD BROKEN', {
        color: '#ffd166', size: 15, life: 1.1,
      });
      this.bus.emit(EVENTS.SHAKE_REQUESTED, 5);
      this.bus.emit(EVENTS.STATUS_APPLIED, { entity: target, status: 'shieldBreak' });
    }
  }

  /**
   * @param {import('../entities/Entity.js').Entity} target
   * @param {HitSpec} spec
   */
  _applyStatus(target, spec) {
    const r = this.random;
    if (spec.burnChance && r() < spec.burnChance) {
      target.status.apply('burn', spec.burnDuration ?? 2.5, 1);
      target.burnDamage = spec.burnDamage ?? 5;
      this.particles.burst('fire', target.x, target.y, 6, { speed: 90 });
    }
    if (spec.slowChance && r() < spec.slowChance) {
      target.status.apply('slow', spec.slowDuration ?? 2, spec.slowFactor ?? 0.5);
      this.particles.burst('ice', target.x, target.y, 6, { speed: 90 });
    }
    if (spec.stunChance && r() < spec.stunChance) {
      target.status.apply('stun', spec.stunDuration ?? 0.9, 1);
      this.particles.burst('lightning', target.x, target.y - target.radius, 8, { speed: 140 });
      this.floatingText.add(target.x, target.y - target.radius - 26, 'STUNNED', {
        color: '#ffe14d', size: 13,
      });
    }
  }

  /**
   * @param {import('../entities/Entity.js').Entity} target
   * @param {any} source
   * @param {HitSpec} spec
   */
  _knockback(target, source, spec) {
    if (!spec.knockback || !source || typeof source.x !== 'number') return;
    // Bosses are too heavy to shove around.
    const resistance = target.kind === 'boss' ? 0.12 : 1;
    target.applyKnockback(source.x, source.y, spec.knockback * resistance);
  }

  /**
   * Update run statistics and ultimate charge.
   * @param {import('../entities/Entity.js').Entity} target
   * @param {number} applied
   * @param {any} source
   * @param {HitSpec} spec
   * @param {HitResult} result
   */
  _reportDamage(target, applied, source, spec, result) {
    this.bus.emit(EVENTS.DAMAGE_DEALT, {
      target, source, amount: applied, crit: result.crit, spec,
    });

    // Heavy hits get a tiny hit-stop and a directional floor mark. Both are
    // presentation events/data; combat still owns only the damage decision.
    if (result.crit || result.killed) {
      this.bus.emit(EVENTS.HIT_STOP, result.killed ? 0.075 : 0.045);
    }
    if (this.decals && applied > 0 && target.faction !== 'player') {
      const angle = source && typeof source.x === 'number'
        ? Math.atan2(target.y - source.y, target.x - source.x)
        : 0;
      this.decals.add(target.x, target.y, result.killed ? 'blood' : 'chip', {
        rotation: angle,
        size: result.crit ? 21 : 13,
      });
    }

    const player = this.registry.player;

    if (source && source.faction === 'player' && applied > 0) {
      source.stats.damageDealt += applied;
      // Ultimate charges from damage dealt (design doc §21).
      if (source.addUltCharge(applied * CONFIG.combat.ultChargePerDamage)) {
        this.bus.emit(EVENTS.ULTIMATE_CHANGED, { player: source, ready: true });
      }
      // Lifesteal upgrades (§20 temporary upgrades).
      const lifeSteal = source.modifiers?.lifeSteal ?? 0;
      if (lifeSteal > 0) {
        const healed = source.heal(applied * lifeSteal);
        if (healed > 0) {
          this.floatingText.add(source.x, source.y - source.radius - 14, `+${Math.round(healed)}`, {
            color: FloatingTextSystem.COLORS.heal, size: 14,
          });
        }
      }
      // Bloodthirster heals on kill, handled in _handleDeath.
    }

    if (target.faction === 'player' && applied > 0) {
      target.stats.damageTaken += applied;
      this.bus.emit(EVENTS.PLAYER_DAMAGED, { amount: applied });
      this.bus.emit(EVENTS.SHAKE_REQUESTED, Math.min(9, 3 + applied * 0.25));
      // Optional charge from taking damage (§21 marks it optional).
      if (player && player.addUltCharge(applied * CONFIG.combat.ultChargePerDamageTaken)) {
        this.bus.emit(EVENTS.ULTIMATE_CHANGED, { player, ready: true });
      }
    }

    if (player && applied > 0 && target.faction !== 'player') {
      // (No spacer label here: `add` skips a zero-size text anyway, so the
      // call was pure overhead on the hottest path in the game.)
    }
    void player;
  }

  /**
   * Death handling: rewards, VFX, statistics and the death event.
   * @param {import('../entities/Entity.js').Entity} target
   * @param {any} source
   */
  _handleDeath(target, source) {
    this.particles.burst('blood', target.x, target.y, 14, { speed: 200 });
    this.particles.burst('smoke', target.x, target.y, 8, { speed: 70 });
    this.bus.emit(EVENTS.ENTITY_DIED, { entity: target, source });

    const player = this.registry.player;
    if (!player) return;

    if (target.faction === 'enemy') {
      const goldRange = target.goldRange ?? { min: 0, max: 0 };
      const gold = Math.round(goldRange.min + this.random() * (goldRange.max - goldRange.min));
      if (gold > 0) {
        player.addGold(gold);
        this.bus.emit(EVENTS.GOLD_CHANGED, { gold: player.gold, delta: gold });
        this.floatingText.add(target.x, target.y - 26, `+${gold}`, {
          color: FloatingTextSystem.COLORS.gold, size: 14, life: 0.7,
        });
        this.particles.burst('gold', target.x, target.y, 6, { speed: 120 });
      }

      player.stats.kills++;
      if (source && source.faction === 'player') {
        if (source.addUltCharge(CONFIG.combat.ultChargePerKill)) {
          this.bus.emit(EVENTS.ULTIMATE_CHANGED, { player: source, ready: true });
        }
        // Legendary §10: Bloodthirster restores HP on kill.
        const healOnKill = source.weapon?.healOnKill ?? 0;
        if (healOnKill > 0) {
          const healed = source.heal(healOnKill);
          if (healed > 0) {
            this.floatingText.add(source.x, source.y - source.radius - 16, `+${Math.round(healed)}`, {
              color: '#ff6b8a', size: 16, life: 0.9,
            });
            this.particles.burst('heal', source.x, source.y - 10, 8, { speed: 90 });
          }
        }
      }
    }
  }

  /* ============================================================
     Damage over time
     ============================================================ */

  /**
   * Apply continuous damage — a hazard the player is standing in.
   *
   * This deliberately does *not* go through `applyHit`, because `applyHit`
   * models a discrete **blow**, and two of its rules are wrong for a burn:
   *
   *  * **The post-hit mercy window.** Every accepted tick opened a fresh
   *    `playerHurtIframe`, so 0.4 s of the fire's damage came back as "MISS",
   *    and — far worse — the player was *continuously invulnerable* while
   *    standing in it. Measured: a 40-damage boss slam did 0 damage to a
   *    player standing in a fire wall. The fire was a god-mode button.
   *  * **The flat armour floor.** `applyHit` clamps player damage to a minimum
   *    of 1 (`Math.max(1, damage - armor)`) so armour can never make the player
   *    immune to a real hit. A per-frame slice is a fraction of a point, so
   *    that floor turned a 10.5 dps burn into exactly 1 damage per accepted
   *    tick.
   *
   * Armour is described in-game as weakening each incoming *blow*, so it does
   * not apply here either. The fraction is applied as-is, which is what makes
   * the configured dps the dps the player actually takes.
   *
   * @param {import('../entities/Entity.js').Entity} target
   * @param {number} dps damage per second
   * @param {number} dt fixed step, seconds
   * @param {any} [source]
   * @returns {number} damage actually applied this step
   */
  applyDamageOverTime(target, dps, dt, source) {
    if (!target || !target.alive) return 0;
    if (!(dps > 0) || !(dt > 0)) return 0;
    // The Invulnerability ultimate really is a ward, so it does stop fire.
    if (target.status.has('invulnerable')) return 0;

    const applied = target.takeDamage(dps * dt);
    if (applied <= 0) return 0;

    // Statistics count every step, so they match the health bar exactly.
    if (target.faction === 'player') target.stats.damageTaken += applied;
    else if (source && source.faction === 'player') source.stats.damageDealt += applied;

    // Feedback is batched: the damage above is continuous, but the label,
    // sound and shake arrive a few times a second instead of every frame.
    target.dotDamage = (target.dotDamage ?? 0) + applied;
    target.dotFeedbackTimer = (target.dotFeedbackTimer ?? 0) - dt;
    if (target.dotFeedbackTimer <= 0) {
      target.dotFeedbackTimer = CONFIG.combat.dotFeedbackInterval;
      const chunk = target.dotDamage;
      target.dotDamage = 0;
      if (target.faction === 'player') {
        this.bus.emit(EVENTS.PLAYER_DAMAGED, { amount: chunk });
        this.bus.emit(EVENTS.SHAKE_REQUESTED, Math.min(4, 1 + chunk * 0.2));
        this.floatingText.addDamage(target.x, target.y - target.radius - 12, chunk, {
          color: DOT_COLOR, size: 14,
        });
      } else {
        this.floatingText.addDamage(target.x, target.y - target.radius - 10, chunk, {
          color: FloatingTextSystem.COLORS.damage, size: 14,
        });
      }
    }
    return applied;
  }

  /**
   * @param {import('../entities/Entity.js').Entity} target
   * @param {string} text
   * @param {string} color
   * @param {number} size
   */
  _showText(target, text, color, size) {
    // Repeated words refresh the label that is already on screen instead of
    // stacking a copy per event: a blocked tick can arrive many times per
    // frame, and "MISS" sixty times a second is noise, not information.
    this.floatingText.addNotice(target.x, target.y - target.radius - 12, text, { color, size });
  }

  /**
   * Tick damage-over-time effects on every entity. Burning (§9.4) is the
   * only DoT in the prototype.
   * @param {number} dt
   * @param {import('../entities/Entity.js').Entity[]} entities
   */
  updateStatusDamage(dt, entities) {
    for (const e of entities) {
      if (!e.alive) continue;
      if (e.status.has('burn')) {
        const ticks = e.status.consumeTicks('burn', dt, 0.4);
        for (let i = 0; i < ticks; i++) {
          const burnDamage = e.burnDamage ?? 5;
          const applied = e.takeDamage(burnDamage);
          if (applied > 0) {
            this.floatingText.add(e.x, e.y - e.radius, String(Math.round(applied)), {
              color: '#ff8a3d', size: 12, life: 0.5,
            });
            this.particles.burst('fire', e.x, e.y - e.radius * 0.5, 2, { speed: 60 });
          }
          if (!e.alive) {
            this._handleDeath(e, this.registry.player);
            break;
          }
        }
      }
    }
  }
}
