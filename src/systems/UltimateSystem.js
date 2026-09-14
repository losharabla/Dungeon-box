/**
 * @fileoverview Ultimate ability execution (design doc §21).
 *
 * SRP: given an ultimate id, run its effect for its duration. It owns the
 * per-ultimate timers and the visual payload, while damage still flows
 * through CombatSystem and projectiles through ProjectileSystem.
 *
 * Each `kind` is a separate handler, so adding a tenth ultimate means
 * adding one entry to `data/ultimates.js` and one handler here.
 */

import { EVENTS } from '../core/EventBus.js';
import { getUltimate } from '../data/ultimates.js';

export class UltimateSystem {
  /**
   * @param {object} deps
   * @param {import('./CombatSystem.js').CombatSystem} deps.combat
   * @param {import('./ProjectileSystem.js').ProjectileSystem} deps.projectiles
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../rendering/effectsRenderer.js').ScreenFlashSystem} deps.screenFlash
   */
  constructor({ combat, projectiles, bus, screenFlash }) {
    this.combat = combat;
    this.projectiles = projectiles;
    this.bus = bus;
    this.screenFlash = screenFlash;

    /**
     * Active continuous ultimates.
     * @type {Array<{def: import('../data/ultimates.js').UltimateDef, timeLeft: number, tickTimer: number, player: any, data: any}>}
     */
    this.active = [];

    /**
     * Transient visuals that outlive their logic (chain lightning arcs,
     * meteor trails).
     * @type {Array<{kind: string, points?: Array<{x:number,y:number}>, x?: number, y?: number, radius?: number, life: number, maxLife: number, color: string}>}
     */
    this.visuals = [];
  }

  /**
   * Activate an ultimate. This is the entry point the CombatCoordinator
   * calls; it never throws for an unknown id (content can change safely).
   * @param {string} ultimateId
   * @param {import('../entities/Player.js').Player} player
   * @param {{x: number, y: number}} aim
   */
  activate(ultimateId, player, aim) {
    let def;
    try {
      def = getUltimate(ultimateId);
    } catch {
      console.warn(`[UltimateSystem] unknown ultimate "${ultimateId}"`);
      return;
    }

    // Refresh the player's stat buffs from scratch, then re-apply.
    this._clearBuffs(player);

    switch (def.kind) {
      case 'whirlwind': this._startWhirlwind(def, player); break;
      case 'invulnerability': this._startInvulnerability(def, player); break;
      case 'berserker_strike': this._berserkerStrike(def, player); break;
      case 'meteor': this._meteor(def, player, aim); break;
      case 'chain_lightning': this._chainLightning(def, player); break;
      case 'time_stop': this._timeStop(def, player); break;
      case 'bullet_storm': this._startBulletStorm(def, player); break;
      case 'ricochet': this._startRicochet(def, player); break;
      case 'combat_stim': this._combatStim(def, player); break;
      default: break;
    }

    this.bus.emit(EVENTS.ULTIMATE_ACTIVATED, { player, ultimateId });
  }

  /* ============================================================
     Warrior (§6)
     ============================================================ */

  /**
   * Whirlwind: a spinning damage aura the player can walk with — and, since
   * play feedback, walk *faster* with. `moveScale` is data-driven so the
   * spin can be tuned as a mobility buff rather than a self-slow.
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _startWhirlwind(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;
    player.spinVisual = true;
    player.movementScale = def.moveScale ?? 1;

    this.active.push({
      def, timeLeft: def.duration, tickTimer: 0, player, data: { tick: 0 },
    });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 5);
  }

  /**
   * Invulnerability: a straight immunity window with a visible shield.
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _startInvulnerability(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;
    player.status.apply('invulnerable', def.duration, 1);
    player.shieldVisual = true;
    this.screenFlash.flash(0.3, '#ffe9a8');
  }

  /**
   * Berserker Strike: one huge frontal blow with heavy knockback.
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _berserkerStrike(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;
    player.attack.swingTime = def.duration;
    player.attack.swingTotal = def.duration;
    player.swingAngle = player.facing;

    const cx = player.x + Math.cos(player.facing) * def.radius * 0.45;
    const cy = player.y + Math.sin(player.facing) * def.radius * 0.45;

    const damage = player.weapon.baseDamage * player.modifiers.damageMul * def.damageMul;
    this.combat.applyAreaHit(cx, cy, def.radius, {
      damage,
      knockback: 900,
      critChance: player.modifiers.critChance,
      source: 'berserker_strike',
    }, player, { faction: 'enemy', falloff: 0.7 });

    // Big, loud, and covered in debris (§6).
    this.combat.particles.burst('explosion', cx, cy, 26, { speed: 380 });
    this.combat.particles.burst('spark', cx, cy, 22, { speed: 460 });
    this.combat.particles.burst('dust', cx, cy, 16, { speed: 180 });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 22);
    this.screenFlash.flash(0.35, '#ff8a5c');

    this.visuals.push({
      kind: 'slash', x: cx, y: cy, radius: def.radius,
      life: 0.4, maxLife: 0.4, color: def.color,
    });
  }

  /* ============================================================
     Mage (§7)
     ============================================================ */

  /**
   * Meteor: a delayed, telegraphed strike at the aimed point.
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   * @param {{x: number, y: number}} aim
   */
  _meteor(def, player, aim) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;

    this.active.push({
      def, timeLeft: def.delay ?? 1, tickTimer: 0, player,
      data: { targetX: aim.x, targetY: aim.y, landed: false },
    });
  }

  /**
   * Chain Lightning: hits an initial target then jumps to nearby enemies
   * with falling damage (§7).
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _chainLightning(def, player) {
    const maxTargets = def.maxTargets ?? 5;
    const first = this.combat.registry.closestEnemy(player.x, player.y, 700);
    if (!first) {
      // Nothing to hit: refund half the charge so the ult is not wasted.
      player.addUltCharge(50);
      this.bus.emit(EVENTS.NOTICE, { text: 'Нет цели для Chain Lightning' });
      return;
    }

    const damage = player.weapon.baseDamage * player.modifiers.damageMul * def.damageMul;
    /** @type {Array<{x: number, y: number}>} */
    const points = [{ x: player.x, y: player.y }];
    /** @type {Set<number>} */
    const hit = new Set();

    let current = first;
    let chainDamage = damage;
    let jumpRange = 260;

    for (let i = 0; i < maxTargets && current; i++) {
      points.push({ x: current.x, y: current.y });
      hit.add(current.id);

      this.combat.applyHit(current, {
        damage: chainDamage,
        knockback: 90,
        critChance: player.modifiers.critChance,
        source: 'chain_lightning',
      }, player);

      // Damage falls off with each jump, as the document requires.
      chainDamage *= 0.72;
      jumpRange *= 0.92;

      const next = this.combat.registry
        .enemiesNear(current.x, current.y, jumpRange)
        .find((e) => e.alive && !hit.has(e.id));
      current = next ?? null;
    }

    this.visuals.push({
      kind: 'chain', points, life: 0.42, maxLife: 0.42, color: def.color,
    });
    this.screenFlash.flash(0.28, '#8fe3ff');
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 8);
  }

  /**
   * Time Stop: freezes every enemy while the player keeps acting (§7).
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _timeStop(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;

    for (const enemy of this.combat.registry.enemies) {
      if (enemy.alive) enemy.status.apply('timestop', def.duration, 1);
    }
    this.screenFlash.flash(0.35, '#9fd8ff');
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 6);
  }

  /* ============================================================
     Gunner (§8)
     ============================================================ */

  /**
   * Bullet Storm: an automatic fan of fire that ignores the trigger.
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _startBulletStorm(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;
    player.status.apply('bulletstorm', def.duration, 1);

    this.active.push({
      def, timeLeft: def.duration, tickTimer: 0, player,
      data: { angle: player.facing, fan: 0 },
    });
  }

  /**
   * Ricochet: bullets bounce off walls for the duration (§8).
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _startRicochet(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;
    player.status.apply('ricochet', def.duration, 1);
    player.ricochetVisual = true;
    this.screenFlash.flash(0.2, '#9fd8ff');
  }

  /**
   * Combat Stim: instant heal plus a temporary speed buff (§8).
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   */
  _combatStim(def, player) {
    player.ultActiveTimer = def.duration;
    player.ultActiveDuration = def.duration;

    const healed = player.heal(def.heal ?? 40);
    if (healed > 0) {
      this.combat.floatingText.add(player.x, player.y - player.radius - 16, `+${Math.round(healed)}`, {
        color: '#6ffbb0', size: 20,
      });
      this.combat.particles.burst('heal', player.x, player.y, 16, { speed: 130 });
    }
    player.status.apply('hasted', def.duration, 1 + (def.speedBonus ?? 0.4));
    player.modifiers.ultSpeedBonus = def.speedBonus ?? 0;
    this.screenFlash.flash(0.22, '#6ffbb0');
  }

  /* ============================================================
     Update loop
     ============================================================ */

  /**
   * @param {number} dt
   */
  update(dt) {
    // --- Continuous ultimates -------------------------------------------
    let write = 0;
    for (let i = 0; i < this.active.length; i++) {
      const entry = this.active[i];
      entry.timeLeft -= dt;
      const player = entry.player;

      if (player && player.alive) {
        this._tickActive(entry, dt);
      }

      if (entry.timeLeft > 0 && player && player.alive) {
        this.active[write++] = entry;
      } else {
        this._endActive(entry);
      }
    }
    this.active.length = write;

    // --- Transient visuals ----------------------------------------------
    let vwrite = 0;
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i];
      v.life -= dt;
      if (v.life > 0) this.visuals[vwrite++] = v;
    }
    this.visuals.length = vwrite;
  }

  /**
   * @param {{def: any, timeLeft: number, tickTimer: number, player: any, data: any}} entry
   * @param {number} dt
   */
  _tickActive(entry, dt) {
    const { def, player, data } = entry;

    if (def.kind === 'whirlwind') {
      // Damage ticks four times a second over the full radius.
      entry.tickTimer -= dt;
      if (entry.tickTimer <= 0) {
        entry.tickTimer = 0.25;
        data.tick++;
        const damage = player.weapon.baseDamage * player.modifiers.damageMul * def.damageMul;
        this.combat.applyAreaHit(player.x, player.y, def.radius, {
          damage,
          knockback: 200,
          critChance: player.modifiers.critChance,
          source: 'whirlwind',
        }, player, { faction: 'enemy', falloff: 0.6 });

        // Trail of spinning sparks.
        const a = data.tick * 1.3;
        this.combat.particles.burst('spark',
          player.x + Math.cos(a) * def.radius * 0.7,
          player.y + Math.sin(a) * def.radius * 0.7,
          4, { speed: 160 });
      }
      return;
    }

    if (def.kind === 'meteor') {
      if (!data.landed && entry.timeLeft <= 0) {
        data.landed = true;
        this._landMeteor(def, player, data.targetX, data.targetY);
      }
      return;
    }

    if (def.kind === 'bullet_storm') {
      entry.tickTimer -= dt;
      if (entry.tickTimer <= 0) {
        entry.tickTimer = 0.09;
        data.fan += 0.42;
        const damage = player.weapon.baseDamage * player.modifiers.damageMul * 0.85;
        // Fire several bullets in a rotating fan around the player.
        for (let i = 0; i < 3; i++) {
          const a = data.fan + (i / 3) * Math.PI * 2;
          this.projectiles.spawn({
            x: player.x + Math.cos(a) * 22,
            y: player.y + Math.sin(a) * 22,
            vx: Math.cos(a) * 780,
            vy: Math.sin(a) * 780,
            radius: 5,
            life: 0.9,
            damage,
            owner: player,
            faction: 'player',
            visual: 'hellfire',
            bounces: 1,
            knockback: 60,
            critChance: player.modifiers.critChance,
          });
        }
        player.attack.muzzleFlash = 0.05;
        this.bus.emit(EVENTS.SHAKE_REQUESTED, 1.2);
      }
    }
  }

  /**
   * Land a Meteor strike at a point.
   * @param {import('../data/ultimates.js').UltimateDef} def
   * @param {any} player
   * @param {number} x
   * @param {number} y
   */
  _landMeteor(def, player, x, y) {
    const damage = player.weapon.baseDamage * player.modifiers.damageMul * def.damageMul;
    this.combat.applyAreaHit(x, y, def.radius, {
      damage,
      knockback: 620,
      burnChance: 0.6,
      burnDuration: 3,
      burnDamage: 8,
      critChance: player.modifiers.critChance,
      source: 'meteor_ult',
    }, player, { faction: 'enemy', falloff: 0.55 });

    this.combat.particles.burst('explosion', x, y, 34, { speed: 420, speedVariance: 0.8 });
    this.combat.particles.burst('fire', x, y, 26, { speed: 260 });
    this.combat.particles.burst('smoke', x, y, 18, { speed: 140 });
    this.bus.emit(EVENTS.SHAKE_REQUESTED, 26);
    this.screenFlash.flash(0.55, '#ffb347');

    this.visuals.push({
      kind: 'shockwave', x, y, radius: def.radius * 1.1,
      life: 0.55, maxLife: 0.55, color: def.color,
    });
  }

  /**
   * @param {{def: any, player: any, data: any}} entry
   */
  _endActive(entry) {
    const player = entry.player;
    if (!player) return;

    if (entry.def.kind === 'whirlwind') {
      player.spinVisual = false;
      player.movementScale = 1;
    }
    if (entry.def.kind === 'bullet_storm') {
      player.status.remove('bulletstorm');
    }
    if (entry.def.kind === 'ricochet') {
      player.ricochetVisual = false;
    }
  }

  /**
   * Undo persistent buffs so a new activation cannot stack them.
   * @param {any} player
   */
  _clearBuffs(player) {
    player.shieldVisual = false;
    player.spinVisual = false;
    player.ricochetVisual = false;
    player.movementScale = 1;
    player.modifiers.ultSpeedBonus = 0;
    player.status.remove('ricochet');
    player.status.remove('bulletstorm');
    player.status.remove('hasted');
    player.status.remove('invulnerable');
  }

  /**
   * Active ultimate name for the HUD, if any.
   * @param {any} player
   * @returns {string}
   */
  activeName(player) {
    if (player.ultActiveTimer <= 0) return '';
    const def = getUltimate(player.ultimateId);
    return def.name;
  }

  /** Stop everything (room change, run end). */
  clear(player) {
    for (const entry of this.active) {
      this._endActive(entry);
    }
    this.active.length = 0;
    this.visuals.length = 0;
    if (player) this._clearBuffs(player);
  }
}
