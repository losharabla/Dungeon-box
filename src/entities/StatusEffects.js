/**
 * @fileoverview Timed status effects (burn, slow, stun, invulnerability).
 *
 * SRP: track which modifiers are active on one entity and how long they
 * last. It never applies damage itself — it only exposes multipliers that
 * movement and combat read.
 *
 * OCP: a new effect is a new entry in EFFECT_DEFS; no system needs editing.
 */

import { clamp } from '../core/MathUtils.js';

/**
 * @typedef {object} StatusDef
 * @property {string} id
 * @property {string} label
 * @property {boolean} [stacking]      refresh instead of stacking duration
 * @property {boolean} [harmful]
 */

/** @type {Record<string, StatusDef>} */
export const EFFECT_DEFS = {
  burn: { id: 'burn', label: 'Горение', harmful: true },
  slow: { id: 'slow', label: 'Замедление', harmful: true },
  stun: { id: 'stun', label: 'Оглушение', harmful: true },
  invulnerable: { id: 'invulnerable', label: 'Неуязвимость' },
  /**
   * The short mercy window after the player is hit (CONFIG.combat
   * .playerHurtIframe). Kept apart from `invulnerable` so the ability's ward
   * bubble stays its own visual instead of flickering on every hit, while
   * both still count as "incoming damage is ignored".
   */
  hurtIframe: { id: 'hurtIframe', label: 'Передышка' },
  hasted: { id: 'hasted', label: 'Ускорение' },
  timestop: { id: 'timestop', label: 'Стоп времени', harmful: true },
  ricochet: { id: 'ricochet', label: 'Рикошет' },
  bulletstorm: { id: 'bulletstorm', label: 'Шквал пуль' },
  damagebuff: { id: 'damagebuff', label: 'Ярость' },
};

/**
 * @typedef {object} StatusInstance
 * @property {string} id
 * @property {number} timeLeft
 * @property {number} duration
 * @property {number} magnitude
 * @property {number} tickTimer   used by damage-over-time effects
 */

export class StatusEffects {
  constructor() {
    /** @type {Map<string, StatusInstance>} */
    this._active = new Map();
  }

  /**
   * Apply or refresh an effect.
   * @param {string} id
   * @param {number} duration seconds
   * @param {number} [magnitude] effect strength (e.g. slow factor < 1)
   */
  apply(id, duration, magnitude = 1) {
    const existing = this._active.get(id);
    if (existing) {
      // Refresh: keep the stronger magnitude, extend the timer.
      existing.duration = Math.max(existing.duration, duration);
      existing.timeLeft = Math.max(existing.timeLeft, duration);
      existing.magnitude = Math.max(existing.magnitude, magnitude);
      return;
    }
    this._active.set(id, {
      id,
      timeLeft: duration,
      duration,
      magnitude,
      tickTimer: 0,
    });
  }

  /**
   * Remove an effect immediately.
   * @param {string} id
   */
  remove(id) {
    this._active.delete(id);
  }

  /** Remove every effect. */
  clear() {
    this._active.clear();
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._active.has(id);
  }

  /**
   * @param {string} id
   * @returns {number} remaining seconds, 0 when absent
   */
  timeLeft(id) {
    return this._active.get(id)?.timeLeft ?? 0;
  }

  /**
   * @param {string} id
   * @returns {number} magnitude, 1 when absent
   */
  magnitude(id) {
    return this._active.get(id)?.magnitude ?? 1;
  }

  /**
   * Advance all timers and collect the effects that expired this step.
   * @param {number} dt
   * @returns {StatusInstance[]} expired effects
   */
  update(dt) {
    /** @type {StatusInstance[]} */
    const expired = [];
    for (const effect of this._active.values()) {
      effect.timeLeft -= dt;
      if (effect.timeLeft <= 0) expired.push(effect);
    }
    for (const effect of expired) this._active.delete(effect.id);
    return expired;
  }

  /**
   * Accumulate DoT tick time.
   * @param {string} id
   * @param {number} dt
   * @param {number} interval
   * @returns {number} how many ticks fired
   */
  consumeTicks(id, dt, interval) {
    const effect = this._active.get(id);
    if (!effect || interval <= 0) return 0;
    effect.tickTimer += dt;
    let ticks = 0;
    while (effect.tickTimer >= interval) {
      effect.tickTimer -= interval;
      ticks++;
    }
    return ticks;
  }

  /**
   * Movement multiplier contributed by all active effects.
   * A stun pins the entity in place; slows scale movement.
   * @returns {number}
   */
  speedMultiplier() {
    if (this.has('stun') || this.has('timestop')) return 0;
    let m = 1;
    if (this.has('slow')) m *= clamp(this.magnitude('slow'), 0.05, 1);
    if (this.has('hasted')) m *= Math.max(1, this.magnitude('hasted'));
    return m;
  }

  /**
   * Whether the entity may act (attack, use abilities).
   * @returns {boolean}
   */
  canAct() {
    return !this.has('stun') && !this.has('timestop');
  }

  /**
   * Whether incoming damage is ignored. Covers both the Invulnerability
   * ultimate and the brief post-hit mercy window.
   * @returns {boolean}
   */
  isInvulnerable() {
    return this.has('invulnerable') || this.has('hurtIframe');
  }

  /**
   * Active effects, for HUD icons.
   * @returns {StatusInstance[]}
   */
  list() {
    return Array.from(this._active.values());
  }
}
