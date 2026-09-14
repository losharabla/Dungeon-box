/**
 * @fileoverview The player entity.
 *
 * SRP: hold the player's stats, inventory of modifiers and the timing state
 * of its attacks/ultimate. It does not decide how damage is resolved (that
 * is CombatSystem) nor how it is drawn (that is PlayerRenderer).
 *
 * The design document deliberately has no character levels (§20) — power
 * comes from the weapon plus temporary run-scoped upgrades, which is what
 * `modifiers` models.
 */

import { Entity } from './Entity.js';
import { CONFIG } from '../core/Config.js';
import { clamp, lerp } from '../core/MathUtils.js';
import { getClass } from '../data/classes.js';
import { getWeapon, MIN_COOLDOWN } from '../data/weapons.js';

/**
 * @typedef {object} PlayerModifiers
 * @property {number} damageMul       multiplicative damage bonus
 * @property {number} speedMul        multiplicative movement bonus
 * @property {number} attackSpeedMul  multiplicative attack-rate bonus
 * @property {number} critChance      0..1 additive critical chance
 * @property {number} maxHpBonus      flat bonus applied at pickup time
 * @property {number} lifeSteal       fraction of damage returned as HP
 * @property {number} armor           flat damage reduction
 */

/**
 * @typedef {object} AttackState
 * @property {number} cooldown         seconds until the next shot
 * @property {number} swingTime        melee animation remaining
 * @property {number} swingTotal       duration of the current swing
 * @property {number} recoil           gun recoil amount, 0..1
 * @property {number} muzzleFlash      seconds of muzzle flash remaining
 * @property {number} heat             Hellstorm sustained-fire ramp in seconds
 * @property {boolean} firing          whether the trigger is held this step
 */

export class Player extends Entity {
  /**
   * @param {object} opts
   * @param {string} opts.classId
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {string} opts.ultimateId
   */
  constructor({ classId, x, y, ultimateId }) {
    const def = getClass(classId);
    super({
      x,
      y,
      radius: def.bodyRadius,
      maxHp: def.hp,
      speed: def.speed * CONFIG.world.speedUnit,
    });

    this.kind = 'player';
    this.faction = 'player';
    this.classId = classId;
    this.classDef = def;
    this.ultimateId = ultimateId;

    /** Gold is a run-scoped resource (design doc §17). */
    this.gold = 0;

    /** @type {PlayerModifiers} */
    this.modifiers = {
      damageMul: 1,
      speedMul: 1,
      attackSpeedMul: 1,
      critChance: 0.05,
      maxHpBonus: 0,
      lifeSteal: 0,
      armor: 0,
    };

    /** @type {import('../data/weapons.js').WeaponDef} */
    this.weapon = getWeapon(def.startingWeapon);
    this.weaponId = this.weapon.id;

    /** Ultimate charge in percent, 0..100 (design doc §21). */
    this.ultCharge = 0;
    /** >0 while the ultimate is executing. */
    this.ultActiveTimer = 0;
    /** Total duration of the running ultimate, for the HUD and rendering. */
    this.ultActiveDuration = 0;
    /** Pending aimed-ultimate target (Meteor), consumed by the ultimate system. */
    /** @type {{x: number, y: number, timer: number}|null} */
    this.pendingStrike = null;

    /** @type {AttackState} */
    this.attack = {
      cooldown: 0,
      swingTime: 0,
      swingTotal: 0,
      recoil: 0,
      muzzleFlash: 0,
      heat: 0,
      firing: false,
    };

    /** Facing of the swinging weapon, captured at swing start. */
    this.swingAngle = 0;
    /** Direction of the most recent melee/dash lunge. */
    this.lungeX = 0;
    this.lungeY = 0;

    /** Dash (Space): burst timer, recharge timer and the committed heading. */
    this.dashTime = 0;
    this.dashCooldown = 0;
    this.dashDirX = 0;
    this.dashDirY = 0;

    /** Run statistics (design doc §"Game Over" statistics screen). */
    this.stats = {
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      goldEarned: 0,
      roomsCleared: 0,
      shotsFired: 0,
    };

    /** Visual-only: smooths the drawn facing so the aim does not snap. */
    this.visualFacing = 0;
    this.visualRecoil = 0;
  }

  /**
   * Effective movement speed including modifiers and status effects.
   * @returns {number} pixels per second
   */
  getEffectiveSpeed() {
    return this.speed * this.modifiers.speedMul * this.status.speedMultiplier();
  }

  /**
   * Effective attack cooldown, accounting for attack-speed modifiers and
   * the Hellstorm heat ramp.
   * @returns {number} seconds
   */
  getEffectiveCooldown() {
    const base = this.weapon.cooldown;
    let cd = base / Math.max(0.1, this.modifiers.attackSpeedMul);

    // Legendary §10: sustained fire raises the rate, and it decays back.
    const ramp = this.weapon.heatRamp;
    if (ramp) {
      const maxRamp = this.weapon.heatMax ?? 2;
      const heatFactor = clamp(1 + this.attack.heat * ramp, 1, maxRamp);
      cd /= heatFactor;
    }
    return Math.max(MIN_COOLDOWN, cd);
  }

  /**
   * Whether the weapon is ready to fire.
   * @returns {boolean}
   */
  canAttack() {
    return this.alive && this.status.canAct() && this.attack.cooldown <= 0;
  }

  /**
   * Begin the cooldown for a shot at the given effective rate.
   * @param {number} cooldown seconds
   */
  startCooldown(cooldown) {
    this.attack.cooldown = cooldown;
  }

  /**
   * Start a melee swing animation and remember its direction.
   * @param {number} duration
   */
  startSwing(duration) {
    this.attack.swingTime = duration;
    this.attack.swingTotal = duration;
    this.swingAngle = this.facing;
  }

  /** @returns {boolean} */
  get isSwinging() {
    return this.attack.swingTime > 0;
  }

  /** @returns {boolean} a dash burst is in progress */
  get isDashing() {
    return this.dashTime > 0;
  }

  /**
   * Whether a dash can start right now. Being mid-dash or still recharging
   * both block it, so the burst cannot be held down for continuous speed.
   * @returns {boolean}
   */
  get dashReady() {
    return this.alive
      && this.dashTime <= 0
      && this.dashCooldown <= 0
      && this.status.canAct()
      && !this.movementLocked;
  }

  /**
   * Begin a dash in the given direction, falling back to where the player is
   * facing when there is no movement input (a standing dash).
   * @param {number} dirX
   * @param {number} dirY
   * @returns {boolean} true when the dash started
   */
  tryDash(dirX, dirY) {
    if (!this.dashReady) return false;

    let x = dirX;
    let y = dirY;
    const len = Math.hypot(x, y);
    if (len < 0.0001) {
      x = Math.cos(this.facing);
      y = Math.sin(this.facing);
    } else {
      x /= len;
      y /= len;
    }

    this.dashTime = CONFIG.dash.duration;
    this.dashCooldown = CONFIG.dash.cooldown;
    this.dashDirX = x;
    this.dashDirY = y;
    // Reused by the renderer for the lean/afterimage, like a melee lunge.
    this.lungeX = x;
    this.lungeY = y;
    return true;
  }

  /**
   * Add ultimate charge, clamped to 100.
   * @param {number} amount
   * @returns {boolean} true when the ultimate just became ready
   */
  addUltCharge(amount) {
    if (this.ultCharge >= 100) return false;
    this.ultCharge = clamp(this.ultCharge + amount, 0, 100);
    return this.ultCharge >= 100;
  }

  /** @returns {boolean} */
  get ultReady() {
    return this.ultCharge >= 100 && this.ultActiveTimer <= 0 && this.alive;
  }

  /**
   * Spend a full charge to activate the ultimate.
   */
  consumeUltCharge() {
    this.ultCharge = 0;
  }

  /**
   * Swap the equipped weapon.
   * @param {import('../data/weapons.js').WeaponDef} weapon
   */
  equip(weapon) {
    this.weapon = weapon;
    this.weaponId = weapon.id;
    // Reset the heat ramp; it belongs to the previous gun's rhythm.
    this.attack.heat = 0;
  }

  /**
   * Add gold and record it for the end-of-run statistics.
   * @param {number} amount
   */
  addGold(amount) {
    if (amount <= 0) return;
    this.gold += amount;
    this.stats.goldEarned += amount;
  }

  /**
   * Whether the player can afford a price.
   * @param {number} price
   * @returns {boolean}
   */
  canAfford(price) {
    return this.gold >= price;
  }

  /**
   * @param {number} price
   * @returns {boolean} true when the purchase succeeded
   */
  spend(price) {
    if (!this.canAfford(price)) return false;
    this.gold -= price;
    return true;
  }

  /**
   * Per-step player update: timers, animation smoothing and heat decay.
   * Movement itself is handled by MovementSystem so collision stays in one
   * place, and firing is handled by CombatSystem.
   * @param {number} dt
   */
  update(dt) {
    this.tickCommon(dt);

    const a = this.attack;
    if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - dt);
    if (a.swingTime > 0) a.swingTime = Math.max(0, a.swingTime - dt);
    if (a.muzzleFlash > 0) a.muzzleFlash = Math.max(0, a.muzzleFlash - dt);
    if (this.ultActiveTimer > 0) this.ultActiveTimer = Math.max(0, this.ultActiveTimer - dt);

    if (this.dashTime > 0) this.dashTime = Math.max(0, this.dashTime - dt);
    if (this.dashCooldown > 0) this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    // Timed charge is a warrior buff; other classes keep combat-only charge.
    if (this.alive && this.classDef.passiveUltCharge) {
      this.addUltCharge(CONFIG.combat.ultChargePerSecond * dt);
    }

    // Hellstorm §10: heat builds while firing, bleeds away when it stops.
    if (this.weapon.heatRamp) {
      if (a.firing) a.heat += dt;
      else a.heat = Math.max(0, a.heat - dt * 1.6);
    }

    // Recoil and aim are visual, but smoothing them here keeps the renderer
    // stateless and purely a function of entity data.
    a.recoil = lerp(a.recoil, 0, Math.min(1, dt * 9));
    this.visualRecoil = a.recoil;

    const turnRate = 18;
    let diff = this.facing - this.visualFacing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.visualFacing += diff * Math.min(1, dt * turnRate);
  }
}
