/**
 * @fileoverview Projectile simulation.
 *
 * SRP: own flying projectiles — spawn, integrate, collide, expire. It knows
 * how to ask CombatSystem for damage, but it never decides what a weapon is.
 *
 * Supports the weapon features the design document requires: piercing
 * (§10 Void Staff / §9.10 Sniper), wall ricochet (§8 Ricochet), explosions
 * (§10), and enemy projectiles on the same pipeline.
 */

import { EVENTS } from '../core/EventBus.js';
import { segmentVsCircle } from '../core/Collision.js';
import { segmentVsHitVolume } from '../core/Collision.js';
import { reflect } from '../core/Collision.js';

/**
 * @typedef {object} Projectile
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} radius
 * @property {number} life
 * @property {number} maxLife
 * @property {number} damage
 * @property {any} owner
 * @property {string} faction
 * @property {string} visual
 * @property {number} pierce
 * @property {number} bounces
 * @property {number} explosionRadius
 * @property {number} explosionChance
 * @property {number} knockback
 * @property {boolean} alive
 * @property {number} seed
 * @property {Set<number>} hitIds
 * @property {object} [trail]
 * @property {string} [color]
 * @property {number} [burnChance]
 * @property {number} [burnDuration]
 * @property {number} [burnDamage]
 * @property {number} [slowChance]
 * @property {number} [slowFactor]
 * @property {number} [slowDuration]
 * @property {number} [stunChance]
 * @property {number} [critChance]
 * @property {boolean} [parryable]  false makes a melee swing unable to destroy it
 */

export class ProjectileSystem {
  /**
   * @param {object} deps
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   * @param {import('../entities/Room.js').CollisionWorld} deps.collisionWorld
   * @param {import('./CombatSystem.js').CombatSystem} deps.combat
   * @param {import('../rendering/particleSystem.js').ParticleSystem} deps.particles
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ registry, collisionWorld, combat, particles, bus }) {
    this.registry = registry;
    this.collisionWorld = collisionWorld;
    this.combat = combat;
    this.particles = particles;
    this.bus = bus;
    /** @type {Projectile[]} */
    this.projectiles = [];
  }

  /**
   * Spawn a projectile.
   * @param {Partial<Projectile> & {x: number, y: number, vx: number, vy: number}} spec
   * @returns {Projectile}
   */
  spawn(spec) {
    /** @type {Projectile} */
    const p = {
      x: spec.x,
      y: spec.y,
      vx: spec.vx,
      vy: spec.vy,
      radius: spec.radius ?? 5,
      life: spec.life ?? 1,
      maxLife: spec.life ?? 1,
      damage: spec.damage ?? 10,
      owner: spec.owner ?? null,
      faction: spec.faction ?? 'enemy',
      visual: spec.visual ?? 'bullet',
      pierce: spec.pierce ?? 0,
      bounces: spec.bounces ?? 0,
      explosionRadius: spec.explosionRadius ?? 0,
      explosionChance: spec.explosionChance ?? 0,
      knockback: spec.knockback ?? 0,
      alive: true,
      seed: Math.random() * 1000,
      hitIds: new Set(),
      color: spec.color,
      burnChance: spec.burnChance,
      burnDuration: spec.burnDuration,
      burnDamage: spec.burnDamage,
      slowChance: spec.slowChance,
      slowFactor: spec.slowFactor,
      slowDuration: spec.slowDuration,
      stunChance: spec.stunChance,
      critChance: spec.critChance,
      parryable: spec.parryable ?? true,
      leavesHazard: spec.leavesHazard ?? false,
    };
    this.projectiles.push(p);
    return p;
  }

  /**
   * Fire a weapon's projectile pattern (design doc §9): handles pellet
   * counts, spread and the aim direction.
   * @param {object} opts
   * @param {import('../entities/Player.js').Player} opts.player
   * @param {number} opts.angle        aim angle in radians
   * @param {number} [opts.damageOverride]
   * @param {number} [opts.angleOffset]
   * @param {boolean} [opts.ricochet]  grant wall bounces (Ricochet ultimate)
   */
  fireWeapon({ player, angle, damageOverride, angleOffset = 0, ricochet = false }) {
    const w = player.weapon;
    const proj = w.projectile;
    if (!proj) return;

    const count = proj.count ?? 1;
    const spread = proj.spread ?? 0;
    const baseAngle = angle + angleOffset;
    const damage = (damageOverride ?? w.baseDamage) * player.modifiers.damageMul;

    for (let i = 0; i < count; i++) {
      // Fan the pellets symmetrically around the aim direction.
      const t = count === 1 ? 0 : (i / (count - 1)) - 0.5;
      const a = baseAngle + t * spread;

      const muzzle = 26;
      this.spawn({
        x: player.x + Math.cos(a) * muzzle,
        y: player.y - 12 + Math.sin(a) * muzzle,
        vx: Math.cos(a) * (proj.speed ?? 700),
        vy: Math.sin(a) * (proj.speed ?? 700),
        radius: proj.radius ?? 5,
        life: proj.life ?? 1,
        damage,
        owner: player,
        faction: 'player',
        visual: proj.visual ?? 'bullet',
        pierce: proj.pierce ?? 0,
        bounces: ricochet ? 2 : (proj.bounces ?? 0),
        explosionRadius: proj.explosionRadius ?? 0,
        explosionChance: proj.explosionChance ?? 0,
        knockback: w.knockback ?? 0,
        burnChance: w.burnChance,
        burnDuration: w.burnDuration,
        burnDamage: w.burnDamage,
        slowChance: w.slowChance,
        slowFactor: w.slowFactor,
        slowDuration: w.slowDuration,
        stunChance: w.stunChance,
        critChance: (player.modifiers.critChance ?? 0) + (w.critBonus ?? 0),
      });
    }
    player.stats.shotsFired++;

    // Muzzle feedback (§25).
    player.attack.muzzleFlash = 0.07;
    player.attack.recoil = Math.min(1, 0.12 + damage / 260);
    this.particles.cone('spark', player.x + Math.cos(angle) * 26, player.y - 12 + Math.sin(angle) * 26,
      angle, count > 2 ? 10 : 5, 300);
    // Shake is proportional to the *weight* of the shot, not its rarity.
    // Tying it to the legendary flag made Hellstorm (24 shots/sec at full
    // heat) accumulate 10+ pixels of constant camera jitter, while a single
    // Sniper round - the heaviest hit in the game - only asked for 3.
    // recoil is already normalized by damage, and the camera decays shake
    // continuously, so per-request size determines the sustained level.
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 0.8 + player.attack.recoil * 2.2);
  }

  /**
   * Fire a single projectile from an enemy toward a point.
   * @param {any} enemy
   * @param {number} targetX
   * @param {number} targetY
   * @param {object} opts
   * @param {number} opts.damage
   * @param {number} opts.speed
   * @param {string} [opts.visual]
   * @param {string} [opts.color]
   * @param {number} [opts.radius]
   * @param {number} [opts.life]
   * @param {number} [opts.explosionRadius]
   * @param {number} [opts.spread]
   */
  fireEnemyProjectile(enemy, targetX, targetY, opts) {
    const a = Math.atan2(targetY - enemy.y, targetX - enemy.x) + (Math.random() - 0.5) * (opts.spread ?? 0);
    this.spawn({
      x: enemy.x + Math.cos(a) * (enemy.radius + 6),
      y: enemy.y + Math.sin(a) * (enemy.radius + 6),
      vx: Math.cos(a) * opts.speed,
      vy: Math.sin(a) * opts.speed,
      radius: opts.radius ?? 7,
      life: opts.life ?? 2.4,
      damage: opts.damage,
      owner: enemy,
      faction: 'enemy',
      visual: opts.visual ?? 'enemy_orbs',
      color: opts.color ?? '#c05cff',
      explosionRadius: opts.explosionRadius ?? 0,
      leavesHazard: opts.leavesHazard ?? false,
    });
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const live = this.projectiles;
    let write = 0;

    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (!p.alive) continue;

      p.life -= dt;
      if (p.life <= 0) {
        this._onExpire(p);
        continue;
      }

      const x0 = p.x;
      const y0 = p.y;
      const nx = x0 + p.vx * dt;
      const ny = y0 + p.vy * dt;

      // --- Wall interaction -------------------------------------------------
      let hitX = nx;
      let hitY = ny;
      const wallHit = this.collisionWorld.raycast(x0, y0, nx, ny);

      // Intercept along the path before resolving either walls or body damage.
      const player = this.registry.player;
      const parryT = this._parryTime(p, player, x0, y0, nx, ny);
      const bodyT = player && p.faction !== 'player'
        ? segmentVsCircle(x0, y0, nx, ny, { x: player.x, y: player.y, radius: player.radius + p.radius })
        : null;
      const travel = Math.hypot(nx - x0, ny - y0);
      const wallT = wallHit && travel > 0
        ? Math.hypot(wallHit.x - x0, wallHit.y - y0) / travel : Infinity;
      if (parryT !== null && parryT < wallT && (bodyT === null || parryT <= bodyT)) {
        this._breakParried(p, x0 + (nx - x0) * parryT, y0 + (ny - y0) * parryT);
        continue;
      }

      if (wallHit) {
        if (p.bounces > 0) {
          // Ricochet (§8): reflect off the surface normal and keep flying.
          p.bounces--;
          const r = reflect(p.vx, p.vy, wallHit.normal);
          p.vx = r.x;
          p.vy = r.y;
          // Nudge off the surface so the next step does not re-hit it.
          hitX = wallHit.x + wallHit.normal.x * (p.radius + 1);
          hitY = wallHit.y + wallHit.normal.y * (p.radius + 1);
          this.particles.cone('spark', wallHit.x, wallHit.y, Math.atan2(r.y, r.x), 5, 220);
        } else {
          this._onWallImpact(p, wallHit.x, wallHit.y);
          continue;
        }
      }

      p.x = hitX;
      p.y = hitY;

      // --- Entity interaction ----------------------------------------------
      const barrels = this.registry.barrels ?? [];
      const targets = p.faction === 'player'
        ? [...this.registry.enemies, ...barrels]
        : (this.registry.player ? [this.registry.player, ...barrels] : barrels);

      let consumed = false;
      for (const t of targets) {
        if (!t.alive || p.hitIds.has(t.id)) continue;

        // Swept test prevents fast bullets tunnelling through small enemies.
        //
        // Enemy sprites stand above their ground point, so a shot aimed at a
        // torso or head used to fly straight through it: player shots are
        // therefore tested against the drawn body. Hostile shots keep the
        // player's plain body circle, because enemies aim at the player's
        // position rather than at painted art.
        if (p.faction === 'player' || t.kind === 'barrel') {
          const volume = typeof t.getHitVolume === 'function'
            ? t.getHitVolume()
            : { x: t.x, y: t.y, radius: t.hitRadius ?? t.radius };
          if (!segmentVsHitVolume(x0, y0, p.x, p.y, volume, p.radius)) continue;
        } else {
          const t0 = segmentVsCircle(x0, y0, p.x, p.y, {
            x: t.x, y: t.y, radius: t.radius + p.radius,
          });
          if (t0 === null) continue;
        }

        p.hitIds.add(t.id);
        this._onEntityHit(p, t);
        if (!p.alive) { consumed = true; break; }
      }
      if (consumed) continue;

      live[write++] = p;
    }

    live.length = write;
  }

  /**
   * Swat hostile projectiles out of the air with an active melee swing.
   *
   * Ranged enemies (§11.3 skeletons, §11.6 mages, boss volleys) otherwise
   * have no answer at all for a melee class: the player can neither outrun
   * the shots nor trade with them. Letting the weapon destroy what it sweeps
   * through gives the swing a defensive use and rewards facing the threat.
   *
   * The window is the whole swing animation rather than the single frame the
   * damage lands on, so a shot arriving a few frames later is still caught.
   * Passives such as `parryable: false` opt a projectile out.
   *
   * @param {import('../entities/Player.js').Player} player
   * @returns {number} how many projectiles were destroyed
   */
  parrySwing(player) {
    let destroyed = 0;
    for (const p of this.projectiles) {
      if (this._parryTime(p, player, p.x, p.y, p.x, p.y) === null) continue;
      this._breakParried(p, p.x, p.y);
      destroyed++;
    }
    return destroyed;
  }

  /** Earliest segment entry into the active weapon sector, or null. */
  _parryTime(p, player, x0, y0, x1, y1) {
    if (!player?.alive || !player.isSwinging || !player.status.canAct()
      || player.weapon.kind !== 'melee' || !p.alive
      || p.faction === 'player' || p.parryable === false) return null;
    const x = x0 - player.x, y = y0 - player.y;
    const dx = x1 - x0, dy = y1 - y0;
    const radius = player.weapon.range + p.radius;
    const half = (player.weapon.arc ?? 1.4) / 2;
    const candidates = [0];
    const a = dx * dx + dy * dy;
    if (a > 0) {
      const b = 2 * (x * dx + y * dy);
      const c = x * x + y * y - radius * radius;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        candidates.push((-b - Math.sqrt(disc)) / (2 * a));
        candidates.push((-b + Math.sqrt(disc)) / (2 * a));
      }
      // Entry can also cross either straight edge of the sector.
      for (const angle of [player.swingAngle - half, player.swingAngle + half]) {
        const ex = Math.cos(angle) * radius, ey = Math.sin(angle) * radius;
        const cross = dx * ey - dy * ex;
        if (Math.abs(cross) < 1e-9) continue;
        const t = (-x * ey + y * ex) / cross;
        const u = (-x * dy + y * dx) / cross;
        if (u >= 0 && u <= 1) candidates.push(t);
      }
    }
    candidates.sort((a, b) => a - b);
    for (const t of candidates) {
      if (t < 0 || t > 1) continue;
      const px = x + dx * t, py = y + dy * t;
      const angle = Math.atan2(py, px) - player.swingAngle;
      const diff = Math.atan2(Math.sin(angle), Math.cos(angle));
      if (Math.hypot(px, py) > radius + 1e-7 || Math.abs(diff) > half + 1e-7) continue;
      if (!this.collisionWorld.hasLineOfSight(player.x, player.y, player.x + px, player.y + py)) continue;
      return t;
    }
    return null;
  }

  _breakParried(p, x, y) {
    p.alive = false;
    p.x = x; p.y = y;
    // No impact/expiry handlers: a parried explosive must not detonate.
    this.particles.cone('spark', x, y, Math.atan2(-p.vy, -p.vx), 6, 210);
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 2.5);
  }

  /**
   * @param {Projectile} p
   * @param {import('../entities/Entity.js').Entity} target
   */
  _onEntityHit(p, target) {
    // Screen-shake feedback belongs to the design doc's hit effect (§25).
    this.combat.applyHit(target, {
      damage: p.damage,
      knockback: p.knockback,
      critChance: p.critChance ?? 0,
      burnChance: p.burnChance,
      burnDuration: p.burnDuration,
      burnDamage: p.burnDamage,
      slowChance: p.slowChance,
      slowFactor: p.slowFactor,
      slowDuration: p.slowDuration,
      stunChance: p.stunChance,
      source: p.visual,
    }, p.owner);

    this._impactBurst(p, target.x, target.y);

    // Explosion on hit (Void Staff §10, Fire Staff chance).
    const shouldExplode = p.explosionRadius > 0
      && (p.explosionChance <= 0 || Math.random() < p.explosionChance);
    if (shouldExplode) {
      this.explode(p.x, p.y, p.explosionRadius, p.damage * 0.7, p);
    }
    this._spawnPuddle(p.x, p.y, p);

    // Pierce allows the shot to continue; otherwise it is consumed.
    if (p.pierce > 0) {
      p.pierce--;
      // Damage decays slightly per pierced target so piercing stays fair.
      p.damage *= 0.86;
    } else {
      p.alive = false;
    }
  }

  /**
   * @param {Projectile} p
   * @param {number} x
   * @param {number} y
   */
  _onWallImpact(p, x, y) {
    p.alive = false;
    this._impactBurst(p, x, y);
    if (p.explosionRadius > 0) {
      this.explode(x, y, p.explosionRadius, p.damage * 0.6, p);
    }
    this._spawnPuddle(x, y, p);
  }

  /**
   * @param {Projectile} p
   */
  _onExpire(p) {
    p.alive = false;
    if (p.visual === 'molotov' || p.leavesHazard) {
      this._impactBurst(p, p.x, p.y);
      if (p.explosionRadius > 0) {
        this.explode(p.x, p.y, p.explosionRadius, p.damage * 0.6, p);
      }
      this._spawnPuddle(p.x, p.y, p);
    } else if (p.visual === 'fire' || p.visual === 'void' || p.visual === 'enemy_orbs') {
      this.particles.burst('magic', p.x, p.y, 5, { speed: 80 });
    }
  }

  /**
   * Spawn a persistent fire puddle hazard when an incendiary shot lands.
   * @param {number} x
   * @param {number} y
   * @param {Projectile} p
   */
  _spawnPuddle(x, y, p) {
    if (!p.leavesHazard && p.visual !== 'molotov') return;
    this.bus.emit(EVENTS.HAZARD_SPAWNED, {
      kind: 'fire_puddle',
      x,
      y,
      radius: 36,
      damage: 7,
      damagePerSecond: true,
      life: 3.0,
      maxLife: 3.0,
      color: '#ff5a1a',
      targetsEnemies: true,
      owner: p.owner ?? null,
    });
    if (this.combat.decals) {
      this.combat.decals.add(x, y, 'scorch', { size: 30 });
    }
  }

  /**
   * @param {Projectile} p
   * @param {number} x
   * @param {number} y
   */
  _impactBurst(p, x, y) {
    const a = Math.atan2(p.vy, p.vx);
    switch (p.visual) {
      case 'molotov':
        this.particles.burst('spark', x, y, 10, { speed: 200 });
        this.particles.burst('fire', x, y, 12, { speed: 170 });
        break;
      case 'fire':
        this.particles.burst('fire', x, y, 9, { speed: 150 });
        break;
      case 'ice':
        this.particles.burst('ice', x, y, 8, { speed: 140 });
        break;
      case 'lightning':
        this.particles.burst('lightning', x, y, 7, { speed: 220 });
        break;
      case 'void':
        // A piercing shot fires this once per body it passes through, so it
        // carries less than a single-target bolt: the detonation is the payoff.
        this.particles.burst('void', x, y, 6, { speed: 170 });
        break;
      case 'enemy_orbs':
        this.particles.burst('magic', x, y, 7, { speed: 130 });
        break;
      default:
        this.particles.cone('spark', x, y, a + Math.PI, 7, 260);
        break;
    }
  }

  /**
   * An explosive detonation: AoE damage, particles, flash and shake.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} damage
   * @param {Projectile} [source]
   */
  explode(x, y, radius, damage, source) {
    const faction = source?.faction === 'player' ? 'enemy' : 'player';
    this.combat.applyAreaHit(x, y, radius, {
      damage,
      knockback: 160,
      source: 'explosion',
      critChance: source?.critChance ?? 0,
    }, source?.owner ?? null, { faction, falloff: 0.55 });

    this.particles.burst('explosion', x, y, 18, { speed: 260, speedVariance: 0.7 });
    this.particles.burst('smoke', x, y, 8, { speed: 90 });
    this.particles.burst('spark', x, y, 14, { speed: 340 });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 8);
  }

  /**
   * Remove every projectile (room transition, run restart).
   */
  clear() {
    this.projectiles.length = 0;
  }

  /** @returns {number} */
  get count() {
    return this.projectiles.length;
  }
}
