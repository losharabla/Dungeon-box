/**
 * @fileoverview The simulation clock.
 *
 * SRP: own time. It decides how many fixed steps of simulated time have
 * elapsed and how far the renderer is between them. It knows nothing about
 * entities, rendering or input.
 *
 * A fixed timestep with an interpolation alpha keeps gameplay deterministic
 * and frame-rate independent: physics never depends on the monitor's Hz.
 */

import { CONFIG } from './Config.js';

export class GameLoop {
  /**
   * @param {object} opts
   * @param {(dt: number) => void} opts.onFixedUpdate  fixed-step simulation
   * @param {(alpha: number, frameDelta: number) => void} opts.onRender
   */
  constructor({ onFixedUpdate, onRender }) {
    /** @type {(dt: number) => void} */
    this.onFixedUpdate = onFixedUpdate;
    /** @type {(alpha: number, frameDelta: number) => void} */
    this.onRender = onRender;

    this.running = false;
    /** Simulated seconds since the loop started. */
    this.elapsed = 0;
    /** Real seconds of the previous frame. */
    this.frameDelta = 0;
    /** Smoothed frames-per-second, for diagnostics. */
    this.fps = 60;
    /** Simulated seconds discarded after hitting the per-frame step ceiling. */
    this.droppedSimulationTime = 0;
    /**
     * When paused the accumulator stops advancing, so a pause never
     * produces a burst of catch-up steps on resume.
     */
    this.timeScale = 1;

    this._accumulator = 0;
    this._lastTime = 0;
    /** @type {number|null} */
    this._rafId = null;
    /** @type {(now: number) => void} */
    this._tick = this._tick.bind(this);
  }

  /** Begin the loop. */
  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = performance.now();
    this._accumulator = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  /** Stop the loop and cancel the pending frame. */
  stop() {
    this.running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Drop accumulated time, e.g. after a long tab-away. */
  resetAccumulator() {
    this._accumulator = 0;
  }

  /**
   * @param {number} now high-resolution timestamp from requestAnimationFrame
   */
  _tick(now) {
    if (!this.running) return;
    this._rafId = requestAnimationFrame(this._tick);

    let delta = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // A backgrounded tab can hand us a multi-second delta. Clamping keeps
    // the catch-up loop bounded instead of freezing the page.
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    if (delta > CONFIG.loop.maxFrameDelta) delta = CONFIG.loop.maxFrameDelta;

    this.frameDelta = delta;
    if (delta > 0) {
      this.fps += ((1 / delta) - this.fps) * 0.1;
    }

    this._accumulator += delta * this.timeScale;

    const step = CONFIG.loop.fixedStep;
    let steps = 0;
    while (this._accumulator >= step && steps < CONFIG.loop.maxStepsPerFrame) {
      this.onFixedUpdate(step);
      this._accumulator -= step;
      this.elapsed += step;
      steps++;
    }
    // If we hit the step ceiling, discard the backlog rather than spiralling,
    // but keep track of the lost simulation time for diagnostics.
    if (steps === CONFIG.loop.maxStepsPerFrame && this._accumulator > 0) {
      this.droppedSimulationTime += this._accumulator;
      this._accumulator = 0;
    }

    const alpha = step > 0 ? this._accumulator / step : 0;
    this.onRender(alpha, delta);
  }
}
