/**
 * @fileoverview Particle system (design doc §26).
 *
 * SRP: spawn, update, render and destroy particles. It has no idea why a
 * particle exists — combat, movement and bosses all just ask for one.
 *
 * A single flat array with in-place compaction is used instead of objects
 * with allocation churn, because particles are the highest-frequency
 * object in the game.
 */

import { CONFIG } from '../core/Config.js';
import { glow, hexAlpha, tint } from './drawUtils.js';

/**
 * @typedef {object} Particle
 * @property {number} x
 * @property {number} y
 * @property {number} velocityX
 * @property {number} velocityY
 * @property {number} life
 * @property {number} maxLife
 * @property {number} size
 * @property {string} type
 * @property {string} color
 * @property {number} drag
 * @property {number} gravity
 * @property {number} rotation
 * @property {number} spin
 * @property {number} alpha
 * @property {string} [highlight] bright-core colour, resolved once at spawn
 */

/**
 * Named particle presets. Adding a new effect means adding a preset here;
 * no system code changes (OCP).
 * @type {Record<string, Partial<Particle>>}
 */
const PRESETS = {
  spark: { size: 2.6, drag: 3.2, color: '#ffd98a', life: 0.34 },
  blood: { size: 3.4, drag: 2.4, gravity: 260, color: '#c0392b', life: 0.55 },
  dust: { size: 4.4, drag: 4.2, color: '#8a8296', life: 0.7, alpha: 0.5 },
  fire: { size: 5.2, drag: 1.6, gravity: -60, color: '#ff7a1a', life: 0.62 },
  ice: { size: 3.8, drag: 2.8, color: '#a8e8ff', life: 0.5 },
  magic: { size: 4.2, drag: 2.2, color: '#c05cff', life: 0.48 },
  lightning: { size: 3, drag: 6, color: '#fff9c4', life: 0.2 },
  smoke: { size: 7, drag: 1.1, gravity: -22, color: '#4a4652', life: 1.0, alpha: 0.42 },
  gold: { size: 3, drag: 2.2, gravity: 190, color: '#e8b955', life: 0.7 },
  heal: { size: 3.6, drag: 2, gravity: -90, color: '#6ffbb0', life: 0.9 },
  explosion: { size: 8, drag: 3.4, color: '#ffb347', life: 0.55 },
  stone: { size: 4.6, drag: 2.6, gravity: 420, color: '#6b6357', life: 0.8 },
  void: { size: 5, drag: 2.4, color: '#c05cff', life: 0.75 },
};

export class ParticleSystem {
  /**
   * @param {number} [maxParticles] hard ceiling so a chaotic frame cannot
   *   allocate unbounded memory or destroy the frame budget.
   * @param {number} [stepBudget] how many particles may be created during one
   *   fixed simulation step. Bounds the *cost per frame*, which `maxParticles`
   *   does not: a large legal population can still be reached by hundreds of
   *   allocations inside a single step.
   */
  constructor(maxParticles = 1400, stepBudget = CONFIG.render.particleStepBudget) {
    /** @type {Particle[]} */
    this.particles = [];
    this.maxParticles = maxParticles;
    /** Set by QualitySettings; scales every emission count. */
    this.density = 1;
    this.stepBudget = stepBudget;
    /** Emissions accepted so far in the current simulation step. */
    this._emittedThisStep = 0;
    /**
     * Whether a step is open. Only an opened step is throttled, so a caller
     * that spawns directly (tests, tooling) is never silently capped.
     */
    this._stepOpened = false;
    /** Particles dropped by the step budget in the current step. */
    this.dropped = 0;
    /** Peak `dropped` seen in one step; read by the perf tests. */
    this.peakDropped = 0;
  }

  /**
   * Open a new simulation step, refilling the emission budget.
   *
   * Called once by `Game.update` before any system runs. Until the first call
   * the cap is inactive — direct `spawn` from tests and tooling is not
   * throttled, which keeps the budget a pure runtime safety valve.
   */
  beginStep() {
    if (this.dropped > this.peakDropped) this.peakDropped = this.dropped;
    this.dropped = 0;
    this._emittedThisStep = 0;
    this._stepOpened = true;
  }

  /**
   * Emit a single particle.
   * @param {string} type preset name
   * @param {number} x
   * @param {number} y
   * @param {number} [vx]
   * @param {number} [vy]
   * @param {Partial<Particle>} [overrides]
   * @returns {Particle|null}
   */
  spawn(type, x, y, vx = 0, vy = 0, overrides = {}) {
    if (this.particles.length >= this.maxParticles) return null;
    if (this._stepOpened && this._emittedThisStep >= this.stepBudget) {
      this.dropped++;
      return null;
    }
    this._emittedThisStep++;

    const preset = PRESETS[type] ?? PRESETS.spark;
    /** @type {Particle} */
    const p = {
      x, y,
      velocityX: vx,
      velocityY: vy,
      life: preset.life ?? 0.5,
      maxLife: preset.life ?? 0.5,
      size: preset.size ?? 3,
      type,
      color: preset.color ?? '#ffffff',
      drag: preset.drag ?? 2.5,
      gravity: preset.gravity ?? 0,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 8,
      alpha: preset.alpha ?? 1,
      ...overrides,
    };

    // An override that is explicitly `undefined` (a caller building the
    // object from a conditional) must not clobber a valid value, otherwise
    // the colour reaches the renderer as undefined and throws.
    for (const key of Object.keys(p)) {
      if (p[key] === undefined) {
        const fallback = preset[key];
        p[key] = fallback !== undefined ? fallback : DEFAULT_PARTICLE[key];
      }
    }

    p.maxLife = p.life;
    // The bright core of a generic mote is a fixed tint of its colour, so it
    // is resolved once here instead of once per particle per frame. `color`
    // is never mutated after spawn, which makes the cached string safe.
    p.highlight = moteHighlight(p.color);
    this.particles.push(p);
    return p;
  }

  /**
   * Emit a burst of particles in a radial spread.
   * @param {string} type
   * @param {number} x
   * @param {number} y
   * @param {number} count
   * @param {object} [opts]
   * @param {number} [opts.speed]
   * @param {number} [opts.speedVariance]
   * @param {number} [opts.angle]    centre angle of the spread
   * @param {number} [opts.spread]   angular width, default 2*PI (radial)
   * @param {Partial<Particle>} [opts.overrides]
   */
  burst(type, x, y, count, opts = {}) {
    const {
      speed = 120, speedVariance = 0.55, angle = 0,
      spread = Math.PI * 2, overrides = {},
    } = opts;
    const n = Math.max(0, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const a = spread >= Math.PI * 2
        ? Math.random() * Math.PI * 2
        : angle + (Math.random() - 0.5) * spread;
      const s = speed * (1 + (Math.random() - 0.5) * 2 * speedVariance);
      this.spawn(type, x, y, Math.cos(a) * s, Math.sin(a) * s, overrides);
    }
  }

  /**
   * A short directional cone of sparks, used for bullet impacts.
   * @param {string} type
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   * @param {number} count
   * @param {number} [speed]
   */
  cone(type, x, y, angle, count, speed = 220) {
    this.burst(type, x, y, count, { angle, spread: 1.1, speed, speedVariance: 0.5 });
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const list = this.particles;
    let write = 0;
    for (let read = 0; read < list.length; read++) {
      const p = list[read];
      p.life -= dt;
      if (p.life <= 0) continue;

      p.velocityY += p.gravity * dt;
      const damp = Math.exp(-p.drag * dt);
      p.velocityX *= damp;
      p.velocityY *= damp;
      p.x += p.velocityX * dt;
      p.y += p.velocityY * dt;
      p.rotation += p.spin * dt;

      list[write++] = p;
    }
    list.length = write;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  draw(ctx, render) {
    if (this.particles.length === 0) return;

    ctx.save();
    const view = render.getViewRect();
    const additiveTypes = ADDITIVE_TYPES;

    // Two passes: normal blending first, additive on top. Switching blend
    // modes once per pass is far cheaper than once per particle.
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass === 0 ? 'source-over' : 'lighter';

      for (const p of this.particles) {
        const isAdditive = additiveTypes.has(p.type);
        if ((pass === 0) === isAdditive) continue;
        // Cheap off-screen rejection.
        if (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h) continue;

        const t = p.life / p.maxLife;
        ctx.globalAlpha = Math.max(0, Math.min(1, t * p.alpha));

        switch (p.type) {
          case 'spark':
          case 'lightning':
          case 'gold': {
            // Stretched streak along the velocity vector.
            const len = Math.min(18, Math.hypot(p.velocityX, p.velocityY) * 0.03);
            const a = Math.atan2(p.velocityY, p.velocityX);
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(a);
            ctx.fillRect(-len / 2, -p.size * 0.28, len + p.size, p.size * 0.56);
            ctx.restore();
            break;
          }
          case 'smoke':
          case 'dust':
          case 'explosion': {
            const r = p.size * (1.6 - t * 0.7);
            ctx.fillStyle = hexAlpha(p.color.startsWith('#') ? p.color : '#888888', 0.5);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case 'stone': {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
            break;
          }
          case 'void': {
            glow(ctx, p.x, p.y, p.size * (2.4 - t), p.color, 0.7 * t);
            break;
          }
          default: {
            // Generic glowing mote.
            glow(ctx, p.x, p.y, p.size * 2.2 * (0.6 + t * 0.6), p.color, 0.75 * t);
            ctx.fillStyle = p.highlight !== undefined
              ? p.highlight
              : (p.highlight = moteHighlight(p.color));
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.4, p.size * 0.42 * t), 0, Math.PI * 2);
            ctx.fill();
            break;
          }
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /**
   * Remove every particle immediately (room change, run restart).
   */
  clear() {
    this.particles.length = 0;
  }

  /** @returns {number} */
  get count() {
    return this.particles.length;
  }
}

/** Particle types drawn with additive blending. */
const ADDITIVE_TYPES = new Set([
  'spark', 'fire', 'ice', 'magic', 'lightning', 'heal', 'explosion', 'void', 'gold',
]);

/**
 * Highlight colours for the bright core of a generic mote, per distinct
 * particle colour.
 *
 * The core used to run `tint()` on every mote on every frame. The result
 * depends on nothing but the particle's own colour, so it is folded into one
 * small Map, filled at spawn and resolved again defensively at draw in case a
 * particle object was built by hand. A malformed or missing colour maps to
 * the same fallback the old expression used, so it degrades rather than
 * throwing.
 * @type {Map<string, string>}
 */
const moteHighlights = new Map();
const MOTE_HIGHLIGHT_CACHE_MAX = 64;

/** @param {string} color @returns {string} */
function moteHighlight(color) {
  let hit = moteHighlights.get(color);
  if (hit !== undefined) return hit;
  if (moteHighlights.size >= MOTE_HIGHLIGHT_CACHE_MAX) moteHighlights.clear();
  hit = tint(typeof color === 'string' && color.startsWith('#') ? color : '#ffffff', 1.4);
  moteHighlights.set(color, hit);
  return hit;
}

/**
 * Last-resort values for any particle field left undefined, so a malformed
 * override degrades visually instead of throwing inside the renderer.
 * @type {Record<string, any>}
 */
const DEFAULT_PARTICLE = {
  x: 0, y: 0, velocityX: 0, velocityY: 0,
  life: 0.5, maxLife: 0.5, size: 3,
  type: 'spark', color: '#ffffff', drag: 2.5, gravity: 0,
  rotation: 0, spin: 0, alpha: 1,
};
