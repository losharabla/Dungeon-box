/**
 * @fileoverview Combat orchestration: turning input into attacks and
 * moving boss fights forward.
 *
 * SRP: own the *player's* attack cadence (cooldown, swing animation,
 * ultimate triggering) and delegate the actual damage to CombatSystem.
 * It also drives the BossController so the engine does not have to know
 * whether a room contains a boss.
 */

import { EVENTS } from '../core/EventBus.js';
import { CONFIG } from '../core/Config.js';
import { closestPointOnHitVolume, distanceToHitVolume } from '../core/Collision.js';
import { registerBehaviour } from './AISystem.js';

/**
 * The combat shape of an entity: its drawn body when it has one, otherwise
 * its plain circle. Built by the entity itself (`getHitVolume`), so no system
 * duplicates the art's proportions.
 *
 * Exported because the beam needs the same answer to the same question.
 * @param {any} entity
 */
export function hitVolumeOf(entity) {
  return typeof entity.getHitVolume === 'function'
    ? entity.getHitVolume()
    : { x: entity.x, y: entity.y, radius: entity.hitRadius ?? entity.radius };
}

export class CombatCoordinator {
  /**
   * @param {object} deps
   * @param {import('./CombatSystem.js').CombatSystem} deps.combat
   * @param {import('./ProjectileSystem.js').ProjectileSystem} deps.projectiles
   * @param {(ultId: string, player: any, aim: {x: number, y: number}) => void} deps.triggerUltimate
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ combat, projectiles, triggerUltimate, bus }) {
    this.combat = combat;
    this.projectiles = projectiles;
    this.triggerUltimate = triggerUltimate;
    this.bus = bus;
  }

  /**
   * Process the player's attack and ultimate input for this step.
   * @param {number} dt
   * @param {import('../entities/Player.js').Player} player
   * @param {object} input
   * @param {boolean} input.attackHeld
   * @param {boolean} input.attackPressed
   * @param {boolean} input.ultPressed
   * @param {{x: number, y: number}} aim world-space aim point
   */
  update(dt, player, input, aim) {
    if (!player.alive) return;

    // Aim always updates, even while swinging or dashing.
    player.lookAt(aim.x, aim.y);

    // --- Ultimate (design doc §21) --------------------------------------
    if (input.ultPressed && player.ultReady) {
      player.consumeUltCharge();
      this.triggerUltimate(player.ultimateId, player, aim);
      this.bus.emit(EVENTS.ULTIMATE_ACTIVATED, { player, ultimateId: player.ultimateId });
    }

    // --- Weapon fire -----------------------------------------------------
    player.attack.firing = input.attackHeld;

    // Ultimates that take over the weapon (Bullet Storm) suppress firing.
    if (player.weaponOverrideUntil && player.weaponOverrideUntil > player.age) return;

    const wantsAttack = player.weapon.kind === 'melee'
      ? (input.attackPressed || input.attackHeld)
      : input.attackHeld;

    if (!wantsAttack || !player.canAttack()) return;

    if (player.weapon.kind === 'melee') {
      this.performMeleeAttack(player);
    } else {
      this.projectiles.fireWeapon({
        player,
        angle: player.facing,
        ricochet: player.status.has('ricochet'),
      });
      player.startCooldown(player.getEffectiveCooldown());
    }
  }

  /**
   * Execute a melee swing and resolve everything inside the arc.
   * @param {import('../entities/Player.js').Player} player
   */
  performMeleeAttack(player) {
    const w = player.weapon;
    player.startCooldown(player.getEffectiveCooldown());
    player.startSwing(w.swingTime ?? 0.2);

    // The hit lands immediately; the animation is a visual echo of it.
    const range = w.range;
    const halfArc = (w.arc ?? 1.4) / 2;
    const damage = w.baseDamage * player.modifiers.damageMul;
    const critChance = player.modifiers.critChance ?? 0;

    // The broad phase has to allow for the tallest body, not just the swing
    // radius: a target standing "above" the player is reachable at its head.
    const enemies = this.combat.registry.enemiesNear(player.x, player.y, range + 96);
    let hits = 0;

    for (const enemy of enemies) {
      // The swing is tested against the enemy's drawn body, which stands above
      // its ground point. Measuring to the feet is what made a sword pass
      // through an orc's chest: 70px of visible body, 18px of hit circle.
      const volume = hitVolumeOf(enemy);
      const surface = distanceToHitVolume(player.x, player.y, volume);
      if (surface > range) continue;

      // Aim the arc test at the nearest point of the body; when the player is
      // already standing inside it, fall back to the body's centre so the
      // angle stays defined.
      const nearest = closestPointOnHitVolume(player.x, player.y, volume);
      let dx = nearest.x - player.x;
      let dy = nearest.y - player.y;
      if (dx * dx + dy * dy < 1e-6) {
        dx = enemy.x - player.x;
        dy = enemy.y - player.y;
      }
      const angleTo = dx * dx + dy * dy < 1e-6 ? player.facing : Math.atan2(dy, dx);

      let diff = angleTo - player.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // Widen the arc slightly for targets touching the visible swing origin,
      // so an oversized readable silhouette cannot slip behind the angle test.
      const forgiveness = surface < 12 ? 0.6 : 0;
      if (Math.abs(diff) > halfArc + forgiveness) continue;

      this.combat.applyHit(enemy, {
        damage,
        knockback: w.knockback ?? 100,
        critChance: (critChance + (w.critBonus ?? 0)),
        burnChance: w.burnChance,
        burnDuration: w.burnDuration,
        burnDamage: w.burnDamage,
        slowChance: w.slowChance,
        slowFactor: w.slowFactor,
        slowDuration: w.slowDuration,
        stunChance: w.stunChance,
        source: 'melee',
      }, player);
      hits++;

      // Battle Axe (§9.2) cleaves a small area behind the primary target.
      if (w.explosionRadius) {
        this.combat.applyAreaHit(enemy.x, enemy.y, w.explosionRadius, {
          damage: damage * 0.45,
          knockback: 120,
          source: 'cleave',
        }, player, { faction: 'enemy', falloff: 0.5 });
      }
    }

    if (hits > 0) {
      this.bus.emit(EVENTS.SHAKE_REQUESTED, Math.min(6, 2 + hits));
      this.combat.particles.cone(
        'spark',
        player.x + Math.cos(player.facing) * range * 0.6,
        player.y + Math.sin(player.facing) * range * 0.6,
        player.facing, 8, 240,
      );
    }
    this.bus.emit(EVENTS.ATTACK_PERFORMED, { player, weapon: w, hits });
  }
}

/**
 * Register the boss archetype with the AI system so bosses can share the
 * same update loop as ordinary enemies without a special case.
 */
export function registerBossBehaviour() {
  registerBehaviour('boss', (enemy, player, dt, ctx) => {
    // Bosses move toward the player but let the BossController decide when
    // to attack; this keeps the boss from also using the basic melee attack.
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const desired = enemy.radius + player.radius + 40;
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed, {
      stopDistance: desired,
    });
    // Face the player constantly so telegraphs point the right way.
    enemy.lookAt(player.x, player.y);
    void d;
    void dt;
    return { vx: v.x, vy: v.y, attack: false };
  });
}

/** Base ultimate charge rate while out of combat, if ever enabled. */
export const ULT_PASSIVE_CHARGE = 0;

void CONFIG;
