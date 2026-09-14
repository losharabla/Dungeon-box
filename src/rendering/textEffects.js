/**
 * @fileoverview Floating damage numbers and the full-screen flash.
 *
 * SRP: own short-lived, screen-space presentation feedback. Combat reports
 * a hit; this decides how the number rises, fades and is painted. Neither
 * class knows anything about what caused the feedback.
 */

import { hexAlpha } from './drawUtils.js';

/**
 * @typedef {object} FloatingText
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} life
 * @property {number} maxLife
 * @property {string} text
 * @property {string} color
 * @property {number} size
 * @property {boolean} outline
 */

export class FloatingTextSystem {
  /** @param {number} [maxTexts] */
  constructor(maxTexts = 140) {
    /** @type {FloatingText[]} */
    this.texts = [];
    this.maxTexts = maxTexts;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.color]
   * @param {number} [opts.size]
   * @param {number} [opts.life]
   * @param {number} [opts.vy]
   * @param {number} [opts.vx]
   * @param {number} [opts.jitter]
   */
  add(x, y, text, opts = {}) {
    // A degenerate size means "invisible spacer": skip it entirely so the
    // combat code can call this unconditionally without drawing artefacts.
    if (!text || (opts.size ?? 16) <= 0.5) return;

    if (this.texts.length >= this.maxTexts) this.texts.shift();
    const {
      color = '#ffffff', size = 16, life = 0.85, vy = -46, vx = 0, jitter = 10,
    } = opts;
    this.texts.push({
      x: x + (Math.random() - 0.5) * jitter,
      y,
      vx,
      vy,
      life,
      maxLife: life,
      text,
      color,
      size,
      outline: true,
    });
  }

  /** @param {number} dt */
  update(dt) {
    let write = 0;
    for (const t of this.texts) {
      t.life -= dt;
      if (t.life <= 0) continue;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      // Gravity on the rise makes the number arc instead of sliding.
      t.vy += 74 * dt;
      this.texts[write++] = t;
    }
    this.texts.length = write;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    if (this.texts.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const t of this.texts) {
      const k = t.life / t.maxLife;
      // Snap large at spawn, then settle — reads as impact.
      const scale = k > 0.82 ? 1 + (1 - (1 - k) / 0.18) * 0.35 : 0.85 + k * 0.35;
      ctx.globalAlpha = Math.min(1, k * 2.2);
      ctx.font = `700 ${Math.round(t.size * scale)}px "Trebuchet MS", sans-serif`;

      if (t.outline) {
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(t.text, t.x, t.y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Remove every label. */
  clear() {
    this.texts.length = 0;
  }

  /**
   * Canonical colours for common messages, so every system reports hits in
   * the same visual language.
   * @type {Record<string, string>}
   */
  static COLORS = {
    damage: '#ffe9a8',
    crit: '#ff5a5a',
    playerHurt: '#ff6b6b',
    heal: '#6ffbb0',
    gold: '#e8b955',
    info: '#cfd6e6',
    legendary: '#ffb347',
    blocked: '#9fd8ff',
  };
}

/**
 * A brief flash over the whole view, used for meteors, explosions and
 * ultimate activations (design doc §25).
 */
export class ScreenFlashSystem {
  constructor() {
    this.strength = 0;
    /** @type {string} */
    this.color = '#ffffff';
  }

  /**
   * @param {number} strength 0..1
   * @param {string} [color]
   */
  flash(strength, color = '#ffffff') {
    this.strength = Math.min(1, Math.max(this.strength, strength));
    this.color = color;
  }

  /** @param {number} dt */
  update(dt) {
    if (this.strength > 0) this.strength = Math.max(0, this.strength - dt * 3.4);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  draw(ctx, width, height) {
    if (this.strength <= 0.001) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hexAlpha(this.color, this.strength * 0.42);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** Reset without fading. */
  clear() {
    this.strength = 0;
  }
}
