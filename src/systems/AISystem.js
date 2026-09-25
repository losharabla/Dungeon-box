/**
 * @fileoverview Enemy AI.
 *
 * SRP: decide what each enemy wants to do this step — a desired velocity
 * and an intent to attack. It never applies damage (it asks CombatSystem),
 * never moves anything (it asks MovementSystem) and never draws.
 *
 * Each archetype from `data/enemies.js` maps to one behaviour function.
 * Adding an archetype means adding a function to BEHAVIOURS; the update
 * loop does not change (OCP).
 */

import { CONFIG } from '../core/Config.js';
/**
 * @typedef {object} AIContext
 * @property {import('../entities/Player.js').Player|null} player
 * @property {import('../entities/EntityRegistry.js').EntityRegistry} registry
 * @property {import('../systems/MovementSystem.js').MovementSystem} movement
 * @property {import('../systems/CombatSystem.js').CombatSystem} combat
 * @property {import('../systems/ProjectileSystem.js').ProjectileSystem} projectiles
 * @property {import('../entities/Room.js').CollisionWorld} collisionWorld
 * @property {(typeId: string, x: number, y: number) => any} spawnEnemy
 */

/**
 * @typedef {object} AIIntent
 * @property {number} vx
 * @property {number} vy
 * @property {boolean} attack
 */

export class AISystem {
  /**
   * @param {AIContext} context
   */
  constructor(context) {
    this.ctx = context;
  }

  /**
   * Update every living enemy.
   * @param {number} dt
   * @param {import('../entities/Entity.js').Entity[]} enemies
   */
  update(dt, enemies) {
    const player = this.ctx.player;
    if (!player) return;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      // Time Stop (§7) freezes enemies entirely.
      if (enemy.status.has('timestop')) {
        enemy.vx = 0;
        enemy.vy = 0;
        continue;
      }

      const behaviour = BEHAVIOURS[enemy.def.ai] ?? BEHAVIOURS.chaser;
      const intent = behaviour(enemy, player, dt, this.ctx);

      this.ctx.movement.moveEntity(enemy, intent.vx, intent.vy, dt);

      if (intent.attack) {
        this._performAttack(enemy, player);
      }

      // Face the movement target so melee arcs and shields point correctly.
      if (enemy.ai.dashing > 0 || intent.vx !== 0 || intent.vy !== 0 || this._isAggroed(enemy, player)) {
        const targetAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        let diff = targetAngle - enemy.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        // Turn rate is per-archetype. A shieldbearer must turn slowly,
        // otherwise it would always keep its shield toward the player and
        // "vulnerable from behind" (§11.7) could never be exploited.
        const turnRate = enemy.def.turnRate ?? 7;
        enemy.facing += diff * Math.min(1, dt * turnRate);
        enemy.dirX = Math.cos(enemy.facing);
        enemy.dirY = Math.sin(enemy.facing);
      }
    }
  }

  /**
   * @param {any} enemy
   * @param {import('../entities/Player.js').Player} player
   * @returns {boolean}
   */
  _isAggroed(enemy, player) {
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    return d < 460;
  }

  /**
   * Execute an enemy's attack intent.
   * @param {any} enemy
   * @param {import('../entities/Player.js').Player} player
   */
  _performAttack(enemy, player) {
    const def = enemy.def;
    if (!enemy.canAttack()) return;
    if (enemy.status.has('stun') || enemy.status.has('timestop')) return;

    const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    // attackRange is a centre-to-centre gameplay distance in enemy data.
    if (dist > def.attackRange) return;

    enemy.ai.attackTimer = def.attackCooldown;

    if (def.attackType === 'melee') {
      this._meleeAttack(enemy, player, def);
    } else {
      this._rangedAttack(enemy, player, def);
    }
  }

  /**
   * @param {any} enemy
   * @param {import('../entities/Player.js').Player} player
   * @param {any} def
   */
  _meleeAttack(enemy, player, def) {
    // Damage lands only if the player is still inside the swing when it
    // resolves, so backing off at the last moment is a real defence.
    const damage = enemy.getDamage();
    this.ctx.combat.applyHit(player, {
      damage,
      knockback: 130,
      source: 'enemy_melee',
    }, enemy);

    // Lunge animation: a short burst toward the player.
    enemy.vx += enemy.dirX * 120;
    enemy.vy += enemy.dirY * 120;

    void def;
  }

  /**
   * @param {any} enemy
   * @param {import('../entities/Player.js').Player} player
   * @param {any} def
   */
  _rangedAttack(enemy, player, def) {
    const damage = enemy.getDamage();
    const p = this.ctx.projectiles;

    if (enemy.typeId === 'pyromancer') {
      // Molotov cocktail that shatters and leaves a burning fire puddle.
      p.fireEnemyProjectile(enemy, player.x, player.y, {
        damage, speed: 320, visual: 'molotov', color: '#ff6a1a',
        radius: 7, life: 2.2, explosionRadius: 48, spread: 0.05,
        leavesHazard: true,
      });
    } else if (enemy.typeId === 'enemy_mage') {
      // AoE bolt that detonates on impact (§11.6).
      p.fireEnemyProjectile(enemy, player.x, player.y, {
        damage, speed: 300, visual: 'enemy_orbs', color: '#c05cff',
        radius: 9, life: 2.4, explosionRadius: 62, spread: 0.06,
      });
    } else if (enemy.typeId === 'necromancer') {
      // Necromancer attacks weakly and summons (handled by the summoner AI).
      p.fireEnemyProjectile(enemy, player.x, player.y, {
        damage, speed: 340, visual: 'enemy_orbs', color: '#6bff9e', radius: 7, life: 2.4,
      });
    } else {
      // Skeleton archer: a fast, accurate bolt.
      p.fireEnemyProjectile(enemy, player.x, player.y, {
        damage, speed: 460, visual: 'enemy_orbs', color: '#9fd8ff',
        radius: 6, life: 2.0, spread: 0.08,
      });
    }
    void def;
  }

  /**
   * Spawn one enemy through the room's spawner (used by summoners).
   * @param {any} summoner
   * @param {string} typeId
   * @param {number} count
   */
  _summon(summoner, typeId, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 40;
      this.ctx.spawnEnemy(typeId, summoner.x + Math.cos(a) * r, summoner.y + Math.sin(a) * r);
    }
  }

  /**
   * Exposed for boss code and tests.
   * @param {any} summoner
   * @param {string} typeId
   * @param {number} count
   */
  summon(summoner, typeId, count) {
    this._summon(summoner, typeId, count);
  }
}

/* ============================================================
   Behaviour archetypes — one function per design-document enemy
   ============================================================ */

/**
 * @typedef {(enemy: any, player: import('../entities/Player.js').Player, dt: number, ctx: AIContext) => AIIntent}
 */

/** @type {Record<string, AIBehaviourFn>} */
const BEHAVIOURS = {
  /** Slime (§11.1): a slow, straight walk at the player. */
  chaser(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const wobble = Math.sin(enemy.age * 2 + enemy.phase) * 0.5;
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed, { stopDistance: enemy.radius + 4 });
    // Slight sine wobble makes slimes look gelatinous rather than robotic.
    const a = Math.atan2(v.y, v.x) + wobble * 0.35;
    const len = Math.hypot(v.x, v.y);
    return {
      vx: Math.cos(a) * len,
      vy: Math.sin(a) * len,
      attack: Math.hypot(player.x - enemy.x, player.y - enemy.y) <= enemy.def.attackRange,
    };
  },

  /** Goblin / Orc / Berserker (§11.2, §11.4, §11.9): close in and strike. */
  melee(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const stop = enemy.radius + player.radius + 2;
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed, { stopDistance: stop });
    return {
      vx: v.x,
      vy: v.y,
      attack: d <= enemy.def.attackRange,
    };
  },

  /** Skeleton (§11.3): hold a firing lane and retreat if crowded. */
  kiter(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const prefer = enemy.def.preferRange ?? 280;
    const hasLos = ctx.collisionWorld.hasLineOfSight(enemy.x, enemy.y, player.x, player.y);

    // Advance if too far or without line of sight; back off if too close.
    let dir = 0;
    if (!hasLos || d > prefer * 1.15) dir = 1;
    else if (d < prefer * 0.72) dir = -1;

    // Backing away is deliberately slower than closing in. A kiter that
    // retreats at full speed can hold a melee class off forever, which turns
    // the fight into an unending chase the player cannot win (§3 says the
    // skeleton "tries to keep its distance", not that it cannot be reached).
    const retreatMul = dir < 0 ? (enemy.def.retreatSpeedMul ?? 0.6) : 1;
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed * dir * retreatMul);

    // Sideways strafe so groups do not form a single conga line. Eased while
    // retreating, so the kiter does not weave out of a melee arc.
    enemy.ai.strafeTimer -= dt;
    if (enemy.ai.strafeTimer <= 0) {
      enemy.ai.strafeTimer = 1.2 + Math.random() * 2;
      enemy.ai.strafeDir *= -1;
    }
    const perpX = -Math.sin(Math.atan2(player.y - enemy.y, player.x - enemy.x));
    const perpY = Math.cos(Math.atan2(player.y - enemy.y, player.x - enemy.x));
    const strafeSpeed = speed * 0.45 * enemy.ai.strafeDir * (dir < 0 ? 0.5 : 1);

    return {
      vx: v.x + perpX * strafeSpeed,
      vy: v.y + perpY * strafeSpeed,
      attack: d <= enemy.def.attackRange && hasLos,
    };
  },

  /** Enemy Mage (§11.6): AoE caster that keeps well back. */
  bomber(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const prefer = enemy.def.preferRange ?? 300;
    const hasLos = ctx.collisionWorld.hasLineOfSight(enemy.x, enemy.y, player.x, player.y);

    let dir = 0;
    if (!hasLos || d > prefer * 1.2) dir = 1;
    else if (d < prefer * 0.8) dir = -1;

    // Same rule as the kiter: retreating is slower than advancing, so the
    // bomber cannot kite a melee class out of reach indefinitely.
    const retreatMul = dir < 0 ? (enemy.def.retreatSpeedMul ?? 0.6) : 1;
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed * dir * retreatMul);
    return {
      vx: v.x * 0.9,
      vy: v.y * 0.9,
      attack: d <= enemy.def.attackRange && hasLos && d > 90,
    };
  },

  /** Bat (§11.5): approach, then burst forward periodically. */
  dasher(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);

    if (enemy.ai.dashTimer <= 0 && d < 380 && enemy.ai.dashing <= 0) {
      enemy.ai.dashing = 0.32;
      enemy.ai.dashTimer = enemy.def.dashCooldown ?? 3;
    }

    // Erratic sine weave while not dashing.
    const weave = enemy.ai.dashing > 0 ? 0 : Math.sin(enemy.age * 6 + enemy.phase) * 0.9;
    const baseAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    const a = baseAngle + weave;
    const s = enemy.ai.dashing > 0 ? speed : speed * 0.55;

    return {
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      attack: d <= enemy.def.attackRange,
    };
  },

  /** Shieldbearer (§11.7): advances behind its shield, faces the player. */
  shield(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed, {
      stopDistance: enemy.radius + player.radius,
    });
    return {
      vx: v.x,
      vy: v.y,
      attack: d <= enemy.def.attackRange,
    };
  },

  /** Assassin (§11.8): cloaks, blinks next to the player, strikes. */
  assassin(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);

    enemy.ai.stealthTimer -= dt;

    // Blink toward the player when far away and off cooldown.
    if (d > 260 && enemy.ai.stealthTimer <= 0) {
      const a = Math.random() * Math.PI * 2;
      // Only land where an enemy of this size fits *inside the room*. The
      // old check asked `overlapsAny`, which accepts any point that is not
      // touching a wall - including one beyond it, outside the arena.
      let spot = null;
      for (const dist of [70, 100, 130]) {
        const candidate = {
          x: player.x + Math.cos(a) * dist,
          y: player.y + Math.sin(a) * dist,
          radius: enemy.radius,
        };
        if (ctx.collisionWorld.isFreeSpot(candidate)) {
          spot = candidate;
          break;
        }
      }
      if (spot) {
        // Smoke out, smoke in.
        ctx.combat.particles.burst('smoke', enemy.x, enemy.y, 10, { speed: 80 });
        enemy.x = spot.x;
        enemy.y = spot.y;
        ctx.combat.particles.burst('smoke', enemy.x, enemy.y, 10, { speed: 80 });
        enemy.ai.stealthTimer = 3.2 + Math.random() * 2;
        enemy.ai.attackTimer = 0.35;
        return { vx: 0, vy: 0, attack: false };
      }
    }

    // Cloak while closing distance.
    const target = d > 120 ? (enemy.def.stealth ?? 0.2) : 1;
    enemy.stealthAlpha += (target - enemy.stealthAlpha) * Math.min(1, dt * 3);

    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed, {
      stopDistance: enemy.radius + player.radius,
    });
    return { vx: v.x, vy: v.y, attack: d <= enemy.def.attackRange };
  },

  /** Necromancer (§11.10): keeps away and raises skeletons. */
  summoner(enemy, player, dt, ctx) {
    const speed = enemy.getSpeed();
    const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const prefer = enemy.def.preferRange ?? 320;

    let dir = 0;
    if (d > prefer * 1.15) dir = 1;
    else if (d < prefer * 0.75) dir = -1;
    const v = ctx.movement.seek(enemy.x, enemy.y, player.x, player.y, speed * dir);

    // Summon on its own timer, capped so the arena cannot be flooded.
    const summonDef = enemy.def.summon;
    if (summonDef && enemy.ai.summonTimer <= 0) {
      const livingSkeletons = ctx.registry.enemies.filter(
        (e) => e.alive && e.typeId === summonDef.id,
      ).length;
      // Cap both this necromancer's own minions and the room as a whole:
      // several necromancers together must not exceed the global ceiling.
      const livingTotal = ctx.registry.enemies.filter(
        (e) => e.alive && e.kind !== 'boss',
      ).length;
      if (livingSkeletons < 4 && livingTotal < CONFIG.combat.maxMinions) {
        const a = Math.random() * Math.PI * 2;
        const allowed = Math.min(summonDef.count, CONFIG.combat.maxMinions - livingTotal);
        for (let i = 0; i < allowed; i++) {
          ctx.spawnEnemy(
            summonDef.id,
            enemy.x + Math.cos(a + (i / Math.max(1, allowed)) * Math.PI * 2) * 46,
            enemy.y + Math.sin(a + (i / Math.max(1, allowed)) * Math.PI * 2) * 46,
          );
        }
        ctx.combat.particles.burst('magic', enemy.x, enemy.y, 14, { speed: 120 });
      }
      enemy.ai.summonTimer = summonDef.cooldown;
    }

    return {
      vx: v.x * 0.85,
      vy: v.y * 0.85,
      attack: d <= enemy.def.attackRange,
    };
  },
};

/**
 * @typedef {typeof BEHAVIOURS.chaser} AIBehaviourFn
 */

/**
 * Register a custom behaviour at runtime (used by boss attacks).
 * @param {string} name
 * @param {AIBehaviourFn} fn
 */
export function registerBehaviour(name, fn) {
  BEHAVIOURS[name] = fn;
}
