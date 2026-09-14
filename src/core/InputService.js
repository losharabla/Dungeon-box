/**
 * @fileoverview Keyboard and mouse input capture.
 *
 * SRP: translate raw browser events into a queryable input snapshot. This
 * class does not move entities or decide what an attack is.
 *
 * DIP: gameplay reads intents ("is attack held?", "where is the cursor in
 * world space?") through this interface, so input hardware can change
 * without touching a single system.
 */

import { CONFIG } from './Config.js';

export class InputService {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;

    /** @type {Set<string>} currently held key codes */
    this._held = new Set();
    /** @type {Set<string>} keys that went down this frame */
    this._pressed = new Set();
    /** @type {Set<string>} keys that went up this frame */
    this._released = new Set();

    /** @type {{x: number, y: number}} cursor in logical view coordinates */
    this.cursor = { x: CONFIG.view.width / 2, y: CONFIG.view.height / 2 };
    /** @type {{x: number, y: number}} cursor in raw canvas client coordinates */
    this.clientCursor = { x: 0, y: 0 };

    this.mouseDown = false;
    this.mousePressed = false;
    this.mouseReleased = false;
    /** @type {number} wheel delta accumulated this frame */
    this.wheel = 0;

    /** @type {Array<() => void>} */
    this._teardown = [];
    /** @type {boolean} */
    this._attached = false;
  }

  /**
   * Begin listening. Safe to call once.
   */
  attach() {
    if (this._attached) return;
    this._attached = true;

    const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
      // Stop the page from scrolling / triggering browser shortcuts.
      if (this._shouldSwallow(e.code)) e.preventDefault();
      if (!this._held.has(e.code)) this._pressed.add(e.code);
      this._held.add(e.code);
    };

    const onKeyUp = (/** @type {KeyboardEvent} */ e) => {
      this._held.delete(e.code);
      this._released.add(e.code);
    };

    const onMouseMove = (/** @type {MouseEvent} */ e) => {
      this.updateCursor(e.clientX, e.clientY);
    };

    const onMouseDown = (/** @type {MouseEvent} */ e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (!this.mouseDown) this.mousePressed = true;
      this.mouseDown = true;
    };

    const onMouseUp = (/** @type {MouseEvent} */ e) => {
      if (e.button !== 0) return;
      this.mouseDown = false;
      this.mouseReleased = true;
    };

    const onWheel = (/** @type {WheelEvent} */ e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    };

    // Losing focus must not leave keys "stuck down".
    const onBlur = () => this._held.clear();
    const onContextMenu = (/** @type {MouseEvent} */ e) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.canvas.addEventListener('mousemove', onMouseMove);
    this.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', onContextMenu);

    this._teardown.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.canvas.removeEventListener('mousemove', onMouseMove),
      () => this.canvas.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.canvas.removeEventListener('wheel', onWheel),
      () => this.canvas.removeEventListener('contextmenu', onContextMenu),
    );
  }

  /**
   * Convert viewport client coordinates to logical view coordinates.
   * Coordinates are intentionally allowed outside the view for pointer aiming
   * while the cursor is in a letterbox bar.
   * @param {number} clientX
   * @param {number} clientY
   */
  updateCursor(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const scale = Math.min(width / CONFIG.view.width, height / CONFIG.view.height);
    const viewWidth = CONFIG.view.width * scale;
    const viewHeight = CONFIG.view.height * scale;
    const offsetX = (width - viewWidth) / 2;
    const offsetY = (height - viewHeight) / 2;
    this.clientCursor.x = clientX - rect.left;
    this.clientCursor.y = clientY - rect.top;
    this.cursor.x = (this.clientCursor.x - offsetX) / scale;
    this.cursor.y = (this.clientCursor.y - offsetY) / scale;
  }

  /**
   * Detach every browser listener.
   */
  destroy() {
    for (const fn of this._teardown) fn();
    this._teardown.length = 0;
    this._attached = false;
  }

  /**
   * Keys we preventDefault on, to stop page scroll and browser UI.
   * @param {string} code
   * @returns {boolean}
   */
  _shouldSwallow(code) {
    return code === 'Space' || code.startsWith('Arrow') || code === 'Tab';
  }

  /**
   * @param {string} code
   * @returns {boolean} key currently held
   */
  isDown(code) {
    return this._held.has(code);
  }

  /**
   * @param {string} code
   * @returns {boolean} key went down during this frame
   */
  wasPressed(code) {
    return this._pressed.has(code);
  }

  /**
   * @param {string} code
   * @returns {boolean} key went up during this frame
   */
  wasReleased(code) {
    return this._released.has(code);
  }

  /**
   * @param {string[]} codes
   * @returns {boolean}
   */
  anyDown(codes) {
    return codes.some((c) => this._held.has(c));
  }

  /**
   * Normalized movement vector from WASD / arrow keys.
   * @returns {{x: number, y: number}} length 0 or 1
   */
  getMoveVector() {
    let x = 0;
    let y = 0;
    if (this.anyDown(['KeyA', 'ArrowLeft'])) x -= 1;
    if (this.anyDown(['KeyD', 'ArrowRight'])) x += 1;
    if (this.anyDown(['KeyW', 'ArrowUp'])) y -= 1;
    if (this.anyDown(['KeyS', 'ArrowDown'])) y += 1;
    const len = Math.hypot(x, y);
    if (len > 0) { x /= len; y /= len; }
    return { x, y };
  }

  /**
   * Clear per-frame edge flags. Called at the very end of each frame,
   * after all systems have read the snapshot.
   */
  endFrame() {
    this._pressed.clear();
    this._released.clear();
    this.mousePressed = false;
    this.mouseReleased = false;
    this.wheel = 0;
  }
}
