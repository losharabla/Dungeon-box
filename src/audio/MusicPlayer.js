/**
 * @fileoverview Streaming music playback.
 *
 * SRP: play one long recording, looped, at a level the mixer controls. It owns
 * its media element and its own gain node; it does not know what a run is, and
 * `AudioSystem` only asks it to start, stop and follow the music level.
 *
 * ## Why a media element and not `decodeAudioData`
 *
 * The obvious Web Audio way to loop a file is to decode it into an
 * `AudioBuffer` and drive an `AudioBufferSourceNode`. For a three-minute
 * stereo track that buffer is 172 s × 48 000 Hz × 2 ch × 4 bytes ≈ **66 MB of
 * float PCM held for the whole session** — an order of magnitude more memory
 * than the entire rest of the game.
 *
 * An `HTMLAudioElement` routed through a `MediaElementAudioSourceNode` streams
 * and decodes incrementally instead, so the resident cost is a small buffer
 * rather than the whole waveform. The trade-offs are deliberate:
 *
 * * the element is same-origin, so no CORS tainting;
 * * `loop` is the element's own, which the browser implements gaplessly for a
 *   fully buffered resource;
 * * level control still happens in the Web Audio graph, so the music honours
 *   master volume, the music slider and mute exactly like the effects bus.
 *
 * If `createMediaElementSource` is unavailable the player degrades to the
 * element's own `volume`, which keeps music working (minus graph routing)
 * rather than silently dropping it.
 */

import { CONFIG } from '../core/Config.js';

/**
 * @typedef {object} MusicStats
 * @property {number} plays      successful starts
 * @property {number} errors     load/decode failures
 * @property {number} blocked    play() refusals (no user gesture yet)
 * @property {boolean} routed    whether the element runs through the graph
 * @property {string|null} track
 */

export class MusicPlayer {
  /**
   * @param {object} deps
   * @param {AudioContext} deps.ctx        the mixer's context
   * @param {AudioNode} deps.destination   bus the music is mixed into
   * @param {(err: unknown) => void} [deps.onError]
   */
  constructor({ ctx, destination, onError }) {
    this.ctx = ctx;
    this.destination = destination;
    /** @type {((err: unknown) => void)|null} */
    this.onError = onError ?? null;

    /** @type {HTMLAudioElement|null} */
    this.element = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this.source = null;
    /** @type {GainNode|null} */
    this.gain = null;
    /** True when the element is routed through the mixer graph. */
    this.routed = typeof ctx.createMediaElementSource === 'function';

    /** @type {string|null} */
    this.trackUrl = null;
    /** Level the mixer wants (0..1), before mute. */
    this.level = 0;
    /** True while the player *should* be sounding, even during a fade. */
    this.wanted = false;

    /** Audio-clock time at which a fade-out finished and the element pauses. */
    /** @type {number|null} */
    this._pauseAt = null;
    /** Audio-clock time at which the fade-in started. */
    /** @type {number|null} */
    this._fadeFrom = null;

    /** @type {MusicStats} */
    this.stats = { plays: 0, errors: 0, blocked: 0, routed: this.routed, track: null };

    if (this.routed) {
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.0001;
      this.gain.connect(destination);
    }
  }

  /** @returns {boolean} whether a track is loaded and playing */
  get playing() {
    const el = this.element;
    return Boolean(el && !el.paused && !el.ended);
  }

  /**
   * Load a track if it is not already the current one.
   * @param {string} url
   */
  setTrack(url) {
    if (this.trackUrl === url && this.element) return;
    this.stop(0);
    this._disposeElement();
    this.trackUrl = url;
    this.stats.track = url;
    this._createElement(url);
  }

  /**
   * Start (or resume) the current track, fading in.
   * @param {number} [fade] seconds
   */
  start(fade = 1.2) {
    const el = this.element;
    if (!el) return;
    this.wanted = true;
    this._pauseAt = null;
    this._rampTo(this.level, fade);

    if (!el.paused) return;
    const attempt = el.play();
    // Both outcomes matter: a refusal is the normal "no gesture yet" case and
    // must not be reported as a load failure.
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(
        () => {
          this.stats.plays++;
        },
        (err) => {
          if (isAutoplayRefusal(err)) this.stats.blocked++;
          else this._fail(err);
        },
      );
    }
  }

  /**
   * Fade out and pause. The element is kept (and its buffer with it), so
   * starting again is instant and does not re-download the track.
   * @param {number} [fade] seconds; 0 stops immediately
   */
  stop(fade = CONFIG.audio.musicFadeOut) {
    this.wanted = false;
    const el = this.element;
    if (!el) return;
    if (fade <= 0 || !this.ctx) {
      this._pauseNow();
      return;
    }
    this._rampTo(0, fade);
    // The pause happens in `update()` against the audio clock, so this class
    // owns no timers — the same rule the effect voices follow.
    this._pauseAt = this.ctx.currentTime + fade;
  }

  /**
   * Follow the mixer. Mute arrives through the master bus, so the value here
   * is the music slider alone and is never applied twice.
   * @param {number} level 0..1
   */
  setLevel(level) {
    const next = Math.min(1, Math.max(0, Number(level) || 0));
    if (Math.abs(next - this.level) < 0.0005) return;
    this.level = next;
    if (!this.routed) {
      if (this.element) this.element.volume = next;
      return;
    }
    this._rampTo(next, 0.06);
  }

  /**
   * Advance the fade bookkeeping. One call per rendered frame, like the voice
   * cleanup — no per-fade timers.
   */
  update() {
    if (this._pauseAt === null || !this.ctx) return;
    if (this.ctx.currentTime >= this._pauseAt) this._pauseNow();
  }

  /** Release everything. */
  destroy() {
    this.stop(0);
    this._disposeElement();
    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch {
        // Nothing to disconnect.
      }
    }
    this.gain = null;
    this.trackUrl = null;
  }

  /* ============================================================
     Internals
     ============================================================ */

  /**
   * Drop the current element and its graph source.
   *
   * Clearing `src` and calling `load()` is the documented way to make a media
   * element release its buffered network resource; without it, switching
   * tracks would keep the old stream alive for the life of the page.
   */
  _disposeElement() {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // Nothing to disconnect.
      }
      this.source = null;
    }
    const el = this.element;
    this.element = null;
    if (!el) return;
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      // A detached element has nothing left to release.
    }
  }

  /**
   * @param {string} url
   */
  _createElement(url) {
    const Ctor = globalThis.Audio;
    if (typeof Ctor !== 'function') {
      // No media element in this runtime (headless): music is simply absent.
      this.stats.errors++;
      return;
    }

    const el = new Ctor();
    // Looping is the point: one track scores a whole run.
    el.loop = true;
    el.preload = 'auto';
    el.volume = this.routed ? 1 : this.level;
    el.addEventListener('error', () => {
      this._fail(el.error ?? new Error(`music failed to load: ${url}`));
    });
    el.src = url;
    this.element = el;

    if (!this.routed) return;
    try {
      this.source = this.ctx.createMediaElementSource(el);
      this.source.connect(/** @type {GainNode} */ (this.gain));
    } catch (err) {
      // Some browsers refuse a second source for the same element, or refuse
      // outright in a restricted context. Falling back to element volume keeps
      // the music audible rather than dropping it.
      this.routed = false;
      this.stats.routed = false;
      this.source = null;
      el.volume = this.level;
      this.onError?.(err);
    }
  }

  /** @param {number} value @param {number} fade */
  _rampTo(value, fade) {
    if (!this.routed || !this.gain || !this.ctx) {
      if (this.element) this.element.volume = value;
      return;
    }
    const now = this.ctx.currentTime;
    const param = this.gain.gain;
    try {
      param.cancelScheduledValues(now);
      const current = typeof param.value === 'number' ? param.value : 0;
      param.setValueAtTime(current, now);
      // Zero is not reachable exponentially, so the ramp is linear and the
      // floor is a hair above silence.
      param.linearRampToValueAtTime(Math.max(0.0001, value), now + Math.max(0.01, fade));
    } catch {
      param.value = Math.max(0.0001, value);
    }
    if (fade > 0) this._fadeFrom = now;
  }

  _pauseNow() {
    this._pauseAt = null;
    const el = this.element;
    if (!el) return;
    try {
      el.pause();
    } catch {
      // Already paused or detached.
    }
  }

  /** @param {unknown} err */
  _fail(err) {
    this.stats.errors++;
    this.wanted = false;
    this.onError?.(err);
  }
}

/**
 * Whether a rejected `play()` promise is the browser's autoplay policy rather
 * than a real failure. Those are expected before the first gesture and must
 * not be counted as errors.
 * @param {unknown} err
 * @returns {boolean}
 */
function isAutoplayRefusal(err) {
  const name = /** @type {any} */ (err)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}
