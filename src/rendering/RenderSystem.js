/**
 * @fileoverview Canvas ownership and the world->screen transform.
 *
 * SRP: own the canvas element, keep its backing store sized to the display,
 * and expose a camera transform. It does not draw entities — that is the
 * RenderSystem's job — and it knows nothing about gameplay.
 */

import { CONFIG } from '../core/Config.js';
import { clamp, lerp } from '../core/MathUtils.js';

export class Camera {
  constructor() {
    /** Centre of the view in world coordinates. */
    this.x = 0;
    this.y = 0;
    /** Interpolated previous position, for smooth following. */
    this.targetX = 0;
    this.targetY = 0;
    /** Current shake offset, applied on top of the position. */
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    /** When set, the camera is confined to this rectangle (room bounds). */
    /** @type {{x: number, y: number, w: number, h: number}|null} */
    this.bounds = null;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} [snap] jump immediately instead of easing
   */
  follow(x, y, snap = false) {
    this.targetX = x;
    this.targetY = y;
    if (snap) {
      this.x = x;
      this.y = y;
    }
  }

  /**
   * @param {{x: number, y: number, w: number, h: number}|null} bounds
   */
  setBounds(bounds) {
    this.bounds = bounds;
  }

  /**
   * Add screen shake. Additive, so several simultaneous hits stack up to
   * the configured ceiling (design doc §25).
   * @param {number} amount
   */
  addShake(amount) {
    this.shake = clamp(this.shake + amount, 0, CONFIG.camera.maxShake);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const t = 1 - Math.exp(-CONFIG.camera.followLerp * dt);
    this.x = lerp(this.x, this.targetX, t);
    this.y = lerp(this.y, this.targetY, t);

    if (this.shake > 0.01) {
      // Random per-frame offset reads as impact rather than a smooth wobble.
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
      this.shake = Math.max(0, this.shake - this.shake * CONFIG.camera.shakeDecay * dt - dt * 4);
    } else {
      this.shake = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /**
   * Convert a logical-view point (e.g. the cursor) into world space.
   * @param {number} viewX
   * @param {number} viewY
   * @returns {{x: number, y: number}}
   */
  screenToWorld(viewX, viewY) {
    return {
      x: viewX - CONFIG.view.width / 2 + this.x + this.shakeX,
      y: viewY - CONFIG.view.height / 2 + this.y + this.shakeY,
    };
  }

  /** @returns {{x: number, y: number}} applied shake offset */
  get shakeOffset() {
    return { x: this.shakeX, y: this.shakeY };
  }
}

export class RenderSystem {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Camera} camera
   */
  constructor(canvas, camera) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = (() => {
      const c = canvas.getContext('2d', { alpha: false });
      if (!c) throw new Error('Canvas 2D context unavailable');
      return c;
    })();
    this.camera = camera;

    this.width = CONFIG.view.width;
    this.height = CONFIG.view.height;
    this.scale = 1;

    /** Letterbox band in CSS pixels, refreshed by resize(). */
    this.viewWidth = this.width;
    this.viewHeight = this.height;
    this.viewLeft = 0;
    this.viewTop = 0;
    this._dpr = 1;

    /** Smoothed FPS, mirrored from the loop for the debug overlay. */
    this.fps = 60;
    this.showDebug = false;
  }

  /**
   * Size the backing store to the device pixel ratio and the CSS box, then
   * compute the letterbox scale so the logical view maps onto it.
   *
   * The letterbox band is also published to CSS as `--view-*` custom
   * properties on the canvas. The HUD is DOM and sits above the canvas, so
   * without this it would span the whole window while the world occupies
   * only a centred band — at any aspect ratio other than 16:9 the HUD's
   * centre and corners would drift away from the things they label.
   */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    this.scale = Math.min(cssW / this.width, cssH / this.height);
    this._dpr = dpr;

    // The rendered (letterboxed) view rectangle, in CSS pixels relative to
    // the canvas box. Negative/oversized values are impossible because the
    // scale is the minimum of the two axis ratios.
    this.viewWidth = this.width * this.scale;
    this.viewHeight = this.height * this.scale;
    this.viewLeft = (cssW - this.viewWidth) / 2;
    this.viewTop = (cssH - this.viewHeight) / 2;

    this._publishViewBand();
  }

  /**
   * Expose the letterbox band to CSS so DOM overlays can align with the
   * rendered world. Silently does nothing when there is no parent element
   * (for example in a headless test harness).
   */
  _publishViewBand() {
    const parent = this.canvas.parentElement;
    if (!parent || !parent.style) return;

    parent.style.setProperty('--view-left', `${this.viewLeft}px`);
    parent.style.setProperty('--view-top', `${this.viewTop}px`);
    parent.style.setProperty('--view-width', `${this.viewWidth}px`);
    parent.style.setProperty('--view-height', `${this.viewHeight}px`);
  }

  /**
   * Clear the canvas and apply the logical-view transform.
   * After this call the context is in logical (1280x720) coordinates with
   * the camera already applied.
   *
   * The offsets come from the values captured by `resize()`, so the drawn
   * world and the CSS band published to the HUD can never disagree.
   */
  beginFrame() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const s = this.scale * this._dpr;
    const offsetX = this.viewLeft * this._dpr;
    const offsetY = this.viewTop * this._dpr;

    ctx.setTransform(s, 0, 0, s, offsetX, offsetY);
    // Clip so nothing bleeds into the letterbox bars.
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.clip();
  }

  /**
   * Apply the world transform: origin moves to the camera centre.
   * Everything drawn after this is in world coordinates.
   */
  applyCamera() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(
      this.width / 2 - this.camera.x - this.camera.shakeX,
      this.height / 2 - this.camera.y - this.camera.shakeY,
    );
  }

  /** Restore the view transform after world drawing. */
  releaseCamera() {
    this.ctx.restore();
  }

  /**
   * Whether a world-space circle is at least partly inside the view.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {boolean}
   */
  isVisible(x, y, radius) {
    const m = CONFIG.render.cullMargin + radius;
    const halfW = this.width / 2 + m;
    const halfH = this.height / 2 + m;
    return Math.abs(x - this.camera.x) <= halfW && Math.abs(y - this.camera.y) <= halfH;
  }

  /**
   * Whether a world rectangle intersects the view.
   * @param {{x: number, y: number, w: number, h: number}} r
   * @returns {boolean}
   */
  isRectVisible(r) {
    const m = CONFIG.render.cullMargin;
    const left = this.camera.x - this.width / 2 - m;
    const top = this.camera.y - this.height / 2 - m;
    const right = this.camera.x + this.width / 2 + m;
    const bottom = this.camera.y + this.height / 2 + m;
    return r.x < right && r.x + r.w > left && r.y < bottom && r.y + r.h > top;
  }

  /**
   * Visible world rectangle, used for cheap culling in renderers.
   * @returns {{x: number, y: number, w: number, h: number}}
   */
  getViewRect() {
    return {
      x: this.camera.x - this.width / 2 - CONFIG.render.cullMargin,
      y: this.camera.y - this.height / 2 - CONFIG.render.cullMargin,
      w: this.width + CONFIG.render.cullMargin * 2,
      h: this.height + CONFIG.render.cullMargin * 2,
    };
  }
}
