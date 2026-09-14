/**
 * @fileoverview Boss attack execution.
 *
 * SRP: turn a boss's resolved attack definition into world effects —
 * damage, hazards, summons and projectiles. It owns the boss's decision
 * cadence; damage still flows through CombatSystem.
 *
 * Every attack here follows the same shape the design document demands:
 * a telegraph (handled by Boss + the renderer), then a resolution burst.
 */

import { EVENTS } from '../core/EventBus.js';
import { CONFIG } from '../core/Config.js';
import { getEnemy } from '../data/enemies.js';

export class BossController {
  /**
   * @param {object} deps
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   * @param {import('./CombatSystem.js').CombatSystem} deps.combat
   * @param {import('./ProjectileSystem.js').ProjectileSystem} deps.projectiles
   * @param {import('../entities/Room.js').CollisionWorld} deps.collisionWorld
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {(typeId: string, x: number, y: number) => any} deps.spawnEnemy
   */
  constructor({ registry, combat, projectiles, collisionWorld, bus, spawnEnemy }) {
    this.registry = registry;
    this.combat = combat;
    this.projectiles = projectiles;
    this.collisionWorld = collisionWorld;
    this.bus = bus;
    this.spawnEnemy = spawnEnemy;
    /** @type {import('../entities/Boss.js').Boss|null} */
    this.boss = null;
    /**
     * Ground hazards created by boss attacks (fire zones, shockwaves).
     * @type {Hazard[]}
     */
    this.hazards = [];
  }

  /**
   * @param {import('../entities/Boss.js').Boss} boss
   */
  attach(boss) {
    this.boss = boss;
    boss.onPhaseChange = () => {
      this.bus.emit(EVENTS.BOSS_PHASE, { boss, phase: 2 });
      this.bus.emit(EVENTS.SHAKE_REQUESTED, 16);
      this.combat.particles.burst('explosion', boss.x, boss.y, 26, { speed: 280 });
      this.combat.particles.burst('smoke', boss.x, boss.y, 14, { speed: 120 });
    };
  }

  /** @param {number} dt */
  update(dt) {
    const boss = this.boss;
    if (!boss || !boss.alive) {
      this._updateHazards(dt);
      return;
    }

    const player = this.registry.player;

    if (boss.staggerTimer > 0) {
      this._updateHazards(dt);
      return;
    }

    if (boss.pending) {
      // Telegraph countdown. The boss is rooted and visibly winding up.
      boss.pending.timer -= dt;
      if (boss.pending.timer <= 0) {
        const resolved = boss.resolveAttack();
        if (resolved && player) this.execute(resolved);
      }
    } else if (player) {
      const d = Math.hypot(player.x - boss.x, player.y - boss.y);
      const attack = boss.chooseAttack(d);
      if (attack) {
        boss.beginAttack(attack, { x: player.x, y: player.y });
      }
    }

    this._updateHazards(dt);
  }

  /**
   * Execute one resolved attack.
   * @param {import('../entities/Boss.js').PendingAttack} pending
   */
  execute(pending) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    const a = pending.def;
    // The attack's own damage value is the source of truth; the boss's
    // global damage stat only scales via the phase-2 multiplier.
    const dmg = a.damage * (boss.phase === 2 ? 1.15 : 1);

    switch (a.kind) {
      case 'slam': this._slam(pending, dmg, a.radius); break;
      case 'shockwave': this._shockwave(pending, dmg, a.radius); break;
      case 'rockVolley': this._rockVolley(pending, dmg, a.count ?? 5); break;
      case 'summon': this._summon(pending, a.count ?? 3); break;
      case 'fireball': this._fireball(pending, dmg, a.count ?? 3); break;
      case 'fireRain': this._fireRain(dmg, a.count ?? 7, a.radius); break;
      case 'fireWall': this._fireWall(pending, dmg, a.count ?? 2, a.radius); break;
      case 'dash': this._dash(pending, dmg, a.radius); break;
      case 'combo': this._combo(pending, dmg, a.radius, a.count ?? 3); break;
      case 'spin': this._spin(pending, dmg, a.radius); break;
      case 'teleport': this._teleport(pending); break;
      case 'cloneVolley': this._cloneVolley(pending, dmg, a.count ?? 6); break;
      default: break;
    }

    this.bus.emit(EVENTS.SHAKE_REQUESTED, 6);
  }

  /* ============================================================
     Boss 1 — Stone Golem (§12)
     ============================================================ */

  /**
   * A direct melee slam in front of the boss.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} radius
   */
  _slam(p, dmg, radius) {
    const boss = this.boss;
    if (!boss) return;
    const impact = {
      x: boss.x + Math.cos(p.aimAngle) * (boss.radius + 26),
      y: boss.y + Math.sin(p.aimAngle) * (boss.radius + 26),
    };
    this.combat.applyAreaHit(impact.x, impact.y, radius, {
      damage: dmg, knockback: 420, source: 'boss_slam',
    }, boss, { faction: 'player' });

    this._impact(impact.x, impact.y, '#a89880', 22);
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 14);
  }

  /**
   * An expanding ground ring that only damages the outer band.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} radius
   */
  _shockwave(p, dmg, radius) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    const d = Math.hypot(player.x - boss.x, player.y - boss.y);
    // Inside the ring the ground is safe; the wave itself hurts.
    if (d <= radius && d > boss.radius * 0.8) {
      this.combat.applyHit(player, {
        damage: dmg, knockback: 520, source: 'boss_shockwave',
      }, boss);
    }

    this.hazards.push(makeHazard({
      kind: 'shockwave',
      x: boss.x, y: boss.y,
      radius,
      life: 0.55,
      maxLife: 0.55,
      color: '#c8a878',
      damage: 0,
    }));

    this.combat.particles.burst('stone', boss.x, boss.y, 26, { speed: 300, speedVariance: 0.8 });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 18);
  }

  /**
   * A volley of arcing rock projectiles.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} count
   */
  _rockVolley(p, dmg, count) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    const base = Math.atan2(player.y - boss.y, player.x - boss.x);
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 0.17;
      const a = base + spread;
      this.projectiles.spawn({
        x: boss.x + Math.cos(a) * (boss.radius + 8),
        y: boss.y + Math.sin(a) * (boss.radius + 8),
        vx: Math.cos(a) * 330,
        vy: Math.sin(a) * 330,
        radius: 13,
        life: 3.2,
        damage: dmg,
        owner: boss,
        faction: 'enemy',
        visual: 'rock',
      });
    }
    this.combat.particles.burst('stone', boss.x, boss.y, 12, { speed: 140 });
  }

  /**
   * Raise smaller golems (§12).
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} count
   */
  /**
   * Raise smaller minions (§12).
   *
   * Summoning is capped: without a limit the boss re-summons on every
   * cooldown and the arena fills with hundreds of minions, which is both
   * unwinnable and a frame-rate hazard. The boss counts *all* of its
   * summoned minions, not just one type.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} count
   */
  _summon(p, count) {
    const boss = this.boss;
    if (!boss) return;

    const living = this.registry.enemies.filter((e) => e.alive && e.kind !== 'boss').length;
    const allowed = Math.max(0, CONFIG.combat.maxMinions - living);
    if (allowed === 0) {
      // Already at the cap: show the wind-up without producing more bodies.
      this.combat.particles.burst('stone', boss.x, boss.y, 10, { speed: 120 });
      return;
    }

    const n = Math.min(count, allowed);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const dist = boss.radius + 60;
      this.spawnEnemy(
        'orc',
        boss.x + Math.cos(a) * dist,
        boss.y + Math.sin(a) * dist,
      );
    }
    this.combat.particles.burst('stone', boss.x, boss.y, 22, { speed: 160 });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 8);
  }

  /* ============================================================
     Boss 2 — Fire Lord (§13)
     ============================================================ */

  /**
   * A spread of fireballs.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} count
   */
  _fireball(p, dmg, count) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    const base = Math.atan2(player.y - boss.y, player.x - boss.x);
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) / 2) * 0.22;
      this.projectiles.spawn({
        x: boss.x + Math.cos(a) * (boss.radius + 6),
        y: boss.y + Math.sin(a) * (boss.radius + 6),
        vx: Math.cos(a) * 380,
        vy: Math.sin(a) * 380,
        radius: 12,
        life: 3,
        damage: dmg,
        owner: boss,
        faction: 'enemy',
        visual: 'fire',
        explosionRadius: 54,
      });
    }
  }

  /**
   * Fiery meteors that mark the ground before landing (§13).
   * @param {number} dmg
   * @param {number} count
   * @param {number} radius
   */
  _fireRain(dmg, count, radius) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    for (let i = 0; i < count; i++) {
      // Half the meteors aim at the player, half scatter: standing still is
      // punished, but the whole arena is never covered (§13).
      const aimed = i < Math.ceil(count / 2);
      const spread = aimed ? 90 : 320;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * spread;
      const x = player.x + Math.cos(a) * d;
      const y = player.y + Math.sin(a) * d;

      this.hazards.push(makeHazard({
        kind: 'meteor',
        x, y,
        radius,
        life: 1.35,
        maxLife: 1.35,
        // Damage lands when the telegraph finishes, not during it.
        damage: dmg,
        color: '#ff6a1a',
        telegraphOnly: true,
        owner: boss,
      }));
    }
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 6);
  }

  /**
   * Walls of flame that sweep across the arena (§13).
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} count
   * @param {number} radius
   */
  _fireWall(p, dmg, count, radius) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    // Build the wall on the far side of the player from the boss, so it
    // cuts off the obvious escape route instead of spawn-killing.
    const baseAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
    const perp = baseAngle + Math.PI / 2;
    const length = 300;

    for (let w = 0; w < count; w++) {
      const offset = (w - (count - 1) / 2) * 140;
      for (let i = -length / 2; i <= length / 2; i += 44) {
        const x = player.x + Math.cos(perp) * i + Math.cos(baseAngle) * (offset + 130);
        const y = player.y + Math.sin(perp) * i + Math.sin(baseAngle) * (offset + 130);
        this.hazards.push(makeHazard({
          kind: 'fire',
          x, y,
          radius,
          life: 3.4,
          maxLife: 3.4,
          damage: dmg * 0.35,   // per second while standing in it
          damagePerSecond: true,
          color: '#ff4d1a',
          telegraphOnly: true,
          owner: boss,
        }));
      }
    }
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 8);
  }

  /* ============================================================
     Boss 3 — Executioner (§14)
     ============================================================ */

  /**
   * A charge toward the player.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} radius
   */
  _dash(p, dmg, radius) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    // Land the dash next to the player rather than on top of them.
    const a = Math.atan2(player.y - boss.y, player.x - boss.x);
    const distance = Math.max(0, Math.hypot(player.x - boss.x, player.y - boss.y) - boss.radius);
    const travel = Math.min(distance, 420);

    // Trail VFX along the path.
    for (let t = 0; t < 1; t += 0.12) {
      this.combat.particles.burst('smoke', boss.x + Math.cos(a) * travel * t, boss.y + Math.sin(a) * travel * t, 3, { speed: 60 });
    }

    boss.x += Math.cos(a) * travel;
    boss.y += Math.sin(a) * travel;
    boss.lookAt(player.x, player.y);

    this.combat.applyAreaHit(boss.x, boss.y, radius, {
      damage: dmg, knockback: 380, source: 'boss_dash',
    }, boss, { faction: 'player' });

    this.combat.particles.burst('spark', boss.x, boss.y, 18, { speed: 300 });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 15);
  }

  /**
   * A three-hit melee sequence (§14). Each step is scheduled separately so
   * the player can read and dodge each swing.
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} radius
   * @param {number} count
   */
  _combo(p, dmg, radius, count) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    for (let i = 1; i <= count; i++) {
      const angle = p.aimAngle + (i - 1) * 0.7;
      const delay = i * 0.22;
      this.hazards.push(makeHazard({
        kind: 'delay',
        x: boss.x, y: boss.y,
        radius: 0,
        life: delay,
        // The actual swing is executed by the delayed hazard callback.
        onExpire: () => {
          if (!boss.alive) return;
          const bx = boss.x + Math.cos(angle) * (boss.radius + 20);
          const by = boss.y + Math.sin(angle) * (boss.radius + 20);
          this.combat.applyAreaHit(bx, by, radius, {
            damage: dmg, knockback: 240, source: 'boss_combo',
          }, boss, { faction: 'player' });
          this.combat.particles.cone('spark', bx, by, angle, 10, 260);
          this.bus.emit(EVENTS.SHAKE_REQUESTED, 7);
        },
      }));
    }
  }

  /**
   * A 360-degree spin attack that forces the player to back off (§14).
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} radius
   */
  _spin(p, dmg, radius) {
    const boss = this.boss;
    if (!boss) return;
    this.combat.applyAreaHit(boss.x, boss.y, radius, {
      damage: dmg, knockback: 460, source: 'boss_spin',
    }, boss, { faction: 'player' });

    this.hazards.push(makeHazard({
      kind: 'shockwave', x: boss.x, y: boss.y, radius,
      life: 0.5, maxLife: 0.5, color: '#b070ff', damage: 0,
    }));
    this.combat.particles.burst('magic', boss.x, boss.y, 24, { speed: 340 });

    // Blink out to a random nearby point afterwards.
    void p;
  }

  /**
   * Teleport next to the player (§14).
   * @param {import('../entities/Boss.js').PendingAttack} p
   */
  _teleport(p) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    this.combat.particles.burst('smoke', boss.x, boss.y, 16, { speed: 120 });

    // Pick a point around the player, keeping clear of walls.
    const baseAngle = Math.atan2(boss.y - player.y, boss.x - player.x) + Math.PI * (0.6 + Math.random() * 0.8);
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const a = baseAngle + attempt * 0.7;
      const dist = 110 + Math.random() * 80;
      const nx = player.x + Math.cos(a) * dist;
      const ny = player.y + Math.sin(a) * dist;
      if (!this.collisionWorld.overlapsAny({ x: nx, y: ny, radius: boss.radius })) {
        boss.x = nx;
        boss.y = ny;
        placed = true;
      }
    }
    boss.lookAt(player.x, player.y);

    this.combat.particles.burst('magic', boss.x, boss.y, 16, { speed: 140 });
    void p;
  }

  /**
   * A volley of spectral spears radiated outward (§14).
   * @param {import('../entities/Boss.js').PendingAttack} p
   * @param {number} dmg
   * @param {number} count
   */
  _cloneVolley(p, dmg, count) {
    const boss = this.boss;
    if (!boss) return;
    const player = this.registry.player;
    if (!player) return;

    const base = Math.atan2(player.y - boss.y, player.x - boss.x);
    const ring = boss.phase === 2;
    for (let i = 0; i < count; i++) {
      // Phase 2 fires a full ring instead of an aimed fan.
      const a = ring ? base + (i / count) * Math.PI * 2 : base + (i - (count - 1) / 2) * 0.16;
      this.projectiles.spawn({
        x: boss.x + Math.cos(a) * (boss.radius + 6),
        y: boss.y + Math.sin(a) * (boss.radius + 6),
        vx: Math.cos(a) * 520,
        vy: Math.sin(a) * 520,
        radius: 9,
        life: 2.6,
        damage: dmg,
        owner: boss,
        faction: 'enemy',
        visual: 'enemy_orbs',
        color: '#b070ff',
      });
    }
    this.combat.particles.burst('magic', boss.x, boss.y, 16, { speed: 200 });
  }

  /* ============================================================
     Hazards
     ============================================================ */

  /**
   * @param {number} dt
   */
  _updateHazards(dt) {
    const player = this.registry.player;
    let write = 0;

    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i];
      h.life -= dt;

      if (h.onExpire && h.life <= 0 && !h.expired) {
        h.expired = true;
        h.onExpire();
      }

      // Telegraph hazards start damaging only after their warning finishes.
      const active = h.telegraphOnly
        ? (h.life < h.maxLife * 0.35)
        : true;

      if (active && h.damage > 0 && player && player.alive) {
        const d2 = (player.x - h.x) ** 2 + (player.y - h.y) ** 2;
        if (d2 <= h.radius * h.radius) {
          if (h.damagePerSecond) {
            // Continuous damage: apply a per-frame slice.
            this.combat.applyHit(player, {
              damage: h.damage * dt, knockback: 0, source: 'hazard',
            }, h.owner ?? null);
          } else if (!h.damageApplied) {
            h.damageApplied = true;
            this.combat.applyHit(player, {
              damage: h.damage, knockback: 300, source: 'hazard',
            }, h.owner ?? null);
            this.combat.particles.burst('fire', h.x, h.y, 14, { speed: 200 });
            this.bus.emit(EVENTS.SHAKE_REQUESTED, 9);
          }
        }
      }

      // A meteor that has finished its telegraph erupts regardless of hits.
      if (h.kind === 'meteor' && h.life <= 0 && !h.damageApplied && !h.expired) {
        h.expired = true;
        if (player) {
          this.combat.applyAreaHit(h.x, h.y, h.radius, {
            damage: h.damage, knockback: 320, source: 'meteor',
          }, h.owner ?? null, { faction: 'player' });
        }
        this.combat.particles.burst('explosion', h.x, h.y, 20, { speed: 280 });
        this.combat.particles.burst('fire', h.x, h.y, 14, { speed: 180 });
        this.bus.emit(EVENTS.SHAKE_REQUESTED, 12);
      }

      if (h.life > 0) this.hazards[write++] = h;
    }

    this.hazards.length = write;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} color
   * @param {number} count
   */
  _impact(x, y, color, count) {
    this.combat.particles.burst('stone', x, y, count, { speed: 320, speedVariance: 0.8 });
    this.combat.particles.burst('dust', x, y, count * 0.6, { speed: 130 });
    void color;
  }

  /**
   * Remove all hazards (room change).
   */
  clear() {
    this.hazards.length = 0;
    this.boss = null;
  }
}

/**
 * @typedef {object} Hazard
 * @property {string} kind
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} life
 * @property {number} maxLife
 * @property {number} damage
 * @property {string} color
 * @property {boolean} [telegraphOnly]
 * @property {boolean} [damagePerSecond]
 * @property {boolean} [damageApplied]
 * @property {boolean} [expired]
 * @property {(() => void)|null} [onExpire]
 * @property {any} [owner]
 */

/**
 * @param {Partial<Hazard> & {x: number, y: number}} spec
 * @returns {Hazard}
 */
function makeHazard(spec) {
  return {
    kind: spec.kind ?? 'marker',
    x: spec.x,
    y: spec.y,
    radius: spec.radius ?? 40,
    life: spec.life ?? 1,
    maxLife: spec.life ?? 1,
    damage: spec.damage ?? 0,
    color: spec.color ?? '#ff6a1a',
    telegraphOnly: spec.telegraphOnly ?? false,
    damagePerSecond: spec.damagePerSecond ?? false,
    damageApplied: false,
    expired: false,
    onExpire: spec.onExpire ?? null,
    owner: spec.owner,
  };
}

void getEnemy;
