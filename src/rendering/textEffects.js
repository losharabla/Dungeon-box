/**
 * @fileoverview Floating damage numbers and the full-screen flash.
 *
 * SRP: own short-lived, screen-space presentation feedback. Combat reports
 * a hit; this decides how the number rises, fades and is painted. Neither
 * class knows anything about what caused the feedback.
 */

import { hexAlpha } from './drawUtils.js';
import { CONFIG } from '../core/Config.js';

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
 * @property {number} [amount]     running total, for damage labels
 * @property {number} [baseVy]     rise speed before gravity, for a merge reset
 * @property {boolean} [mergeable] whether a later hit may fold into this label
 */

export class FloatingTextSystem {
  /** @param {number} [maxTexts] */
  constructor(maxTexts = 140) {
    /** @type {FloatingText[]} */
    this.texts = [];
    this.maxTexts = maxTexts;
    /** Hits folded into an existing label instead of creating a new one. */
    this.merged = 0;
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
   * @returns {FloatingText|null} the label that was created, if any
   */
  add(x, y, text, opts = {}) {
    // A degenerate size means "invisible spacer": skip it entirely so the
    // combat code can call this unconditionally without drawing artefacts.
    if (!text || (opts.size ?? 16) <= 0.5) return null;

    if (this.texts.length >= this.maxTexts) this.texts.shift();
    const {
      color = '#ffffff', size = 16, life = 0.85, vy = -46, vx = 0, jitter = 10,
    } = opts;
    /** @type {FloatingText} */
    const label = {
      x: x + (Math.random() - 0.5) * jitter,
      y,
      vx,
      vy,
      baseVy: vy,
      life,
      maxLife: life,
      text,
      color,
      size,
      outline: true,
    };
    this.texts.push(label);
    return label;
  }

  /**
   * Report damage, folding it into a nearby recent label when there is one.
   *
   * This is the call combat makes; `add` remains for one-off messages (gold,
   * healing, notices) that must never merge. Aggregation is what keeps a
   * many-hit weapon from paying for a glyph run per hit — see
   * `CONFIG.render.damageNumber`.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} amount
   * @param {object} [opts]
   * @param {string} [opts.color]
   * @param {number} [opts.size]
   * @param {number} [opts.life]
   * @returns {FloatingText|null}
   */
  addDamage(x, y, amount, opts = {}) {
    const value = Math.round(amount);
    if (!Number.isFinite(value) || value <= 0) return null;

    const { mergeWindow, mergeRadius, lookback } = CONFIG.render.damageNumber;
    const color = opts.color ?? FloatingTextSystem.COLORS.damage;
    const size = opts.size ?? 16;

    // Labels are appended, so merge candidates are among the most recent few;
    // scanning only those keeps this O(1) rather than O(population).
    //
    // The scan deliberately cannot stop at the first too-old label: merging
    // *refreshes* a label's age, so the list is only approximately ordered by
    // age and an older neighbour can hide a younger one behind it.
    const stop = Math.max(0, this.texts.length - lookback);
    for (let i = this.texts.length - 1; i >= stop; i--) {
      const t = this.texts[i];
      if (!t.mergeable) continue;
      if (t.color !== color || t.size !== size) continue;
      if (t.maxLife - t.life > mergeWindow) continue;
      if (Math.abs(t.x - x) > mergeRadius || Math.abs(t.y - y) > mergeRadius) continue;

      t.amount = (t.amount ?? 0) + value;
      t.text = String(Math.round(t.amount));
      // Refresh rather than stack: the number keeps counting while the pack
      // keeps taking damage, then rises and fades once the hits stop.
      t.life = t.maxLife;
      t.vy = t.baseVy ?? t.vy;
      this.merged++;
      return t;
    }

    const label = this.add(x, y, String(value), { color, size, life: opts.life });
    if (label) {
      label.amount = value;
      label.mergeable = true;
    }
    return label;
  }

  /**
   * Show a status word ("МИМО", "БЛОК"), refreshing an identical label that is
   * already on screen instead of stacking another copy.
   *
   * A blocked event can arrive many times in one frame — every hazard the
   * player is standing in, every enemy in a pack swinging together — and one
   * label per event covers the screen with the same word while churning the
   * whole text budget.
   *
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {object} [opts]
   * @returns {FloatingText|null}
   */
  addNotice(x, y, text, opts = {}) {
    const { mergeWindow, mergeRadius, lookback } = CONFIG.render.damageNumber;
    const stop = Math.max(0, this.texts.length - lookback);
    for (let i = this.texts.length - 1; i >= stop; i--) {
      const t = this.texts[i];
      if (t.text !== text) continue;
      if (t.maxLife - t.life > mergeWindow) continue;
      if (Math.abs(t.x - x) > mergeRadius || Math.abs(t.y - y) > mergeRadius) continue;
      t.life = t.maxLife;
      t.vy = t.baseVy ?? t.vy;
      this.merged++;
      return t;
    }
    return this.add(x, y, text, opts);
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

    /**
     * Font assignment is the expensive part of drawing text: every new
     * `ctx.font` string invalidates the browser's shaping/metrics cache.
     * Sizes are therefore quantised to even pixels and the font is written
     * only when it actually changes, which turns a hundred unique fonts per
     * frame into a handful of runs.
     */
    let lastFont = '';

    for (const t of this.texts) {
      const k = t.life / t.maxLife;
      // Snap large at spawn, then settle — reads as impact.
      const scale = k > 0.82 ? 1 + (1 - (1 - k) / 0.18) * 0.35 : 0.85 + k * 0.35;
      ctx.globalAlpha = Math.min(1, k * 2.2);

      const px = Math.max(8, Math.round(t.size * scale / 2) * 2);
      const font = `700 ${px}px ${FLOATING_FONT}`;
      if (font !== lastFont) {
        ctx.font = font;
        lastFont = font;
      }

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

/**
 * The label typeface, kept in one place so the font string drawn matches the
 * one the stylesheet asks for and can be compared for equality in `draw()`.
 */
const FLOATING_FONT = '"Trebuchet MS", sans-serif';
