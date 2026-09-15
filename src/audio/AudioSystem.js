/**
 * @fileoverview Procedural audio engine.
 *
 * SRP: own the Web Audio graph and turn a *preset* into sound. It does not
 * know what a sword or a boss is, and no gameplay system imports it — the
 * binding from game events to presets lives in `audioBindings.js`, and the
 * mixer UI talks to it through a tiny adapter.
 *
 * ## Why this is cheap
 *
 * A naive "play a sound" implementation allocates an oscillator, a gain and a
 * filter per hit and never bounds them, so a Hellstorm at 24 rounds/second
 * leaves hundreds of live nodes on the graph. This engine bounds the work in
 * five separate ways, and each one is measurable in the debug overlay:
 *
 * 1. **Lazy context.** The `AudioContext` is not created until the first user
 *    gesture. Before that there is nothing to keep alive, and the browser's
 *    autoplay policy is satisfied rather than fought.
 * 2. **Voice ceiling.** At most `CONFIG.audio.maxVoices` one-shot voices exist
 *    at once. Further plays either steal the least important voice or are
 *    dropped, so the node count has a hard upper bound.
 * 3. **Retrigger guard.** The same preset cannot restart faster than its
 *    cooldown, which turns a burst of identical hits into one denser sound
 *    instead of N overlapping clones.
 * 4. **Node pools.** Gains, filters and panners are recycled through pools
 *    after release, so steady-state combat allocates only the one node type
 *    that cannot be reused (the source) and no filter/gain churn.
 * 5. **Shared noise.** One white-noise buffer (three variants) is generated
 *    once and replayed by every noise layer through `playbackRate`, instead of
 *    building a buffer per impact.
 *
 * Culling is the sixth: a sound beyond `CONFIG.audio.audibleRadius` is never
 * created at all — the cheapest voice is the one that does not exist.
 */

import { CONFIG } from '../core/Config.js';
import { SOUND_PRESETS } from './soundPresets.js';
import { MusicPlayer } from './MusicPlayer.js';
import {
  defaultAudioSettings,
  loadAudioSettings,
  saveAudioSettings,
  sanitizeAudioSettings,
  safeLocalStorage,
} from './audioSettings.js';

/**
 * @typedef {object} PlayOptions
 * @property {number} [x]        world position of the source, for panning
 * @property {number} [y]
 * @property {number} [gain]     0..1 extra multiplier (impact weight)
 * @property {number} [pitch]    playback rate multiplier
 * @property {number} [pan]      explicit stereo pan, overrides position
 */

/**
 * @typedef {object} Voice
 * @property {GainNode} gain
 * @property {StereoPannerNode|null} panner
 * @property {AudioScheduledSourceNode[]} sources
 * @property {GainNode[]} layerGains
 * @property {BiquadFilterNode[]} filters
 * @property {number} endsAt
 * @property {number} priority
 * @property {string} id
 * @property {boolean} released
 */

export class AudioSystem {
  /**
   * @param {object} [options]
   * @param {Storage|null} [options.storage] persistence target; defaults to localStorage
   * @param {import('./audioSettings.js').AudioSettings} [options.settings] starting mixer
   * @param {(settings: import('./audioSettings.js').AudioSettings) => void} [options.onChange]
   */
  constructor({ storage, settings, onChange } = {}) {
    /** Whether this environment can make sound at all (headless = false). */
    this.supported = typeof AudioContextCtor() === 'function';

    this.storage = storage === undefined ? safeLocalStorage() : storage;
    /** @type {import('./audioSettings.js').AudioSettings} */
    this.settings = sanitizeAudioSettings(
      settings ?? loadAudioSettings(this.storage),
      defaultAudioSettings(),
    );
    /** @type {((s: import('./audioSettings.js').AudioSettings) => void)|null} */
    this.onChange = onChange ?? null;

    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.masterGain = null;
    /** @type {GainNode|null} */
    this.effectsGain = null;
    /**
     * Streaming music. Created with the context, because it needs the master
     * bus to mix into.
     * @type {MusicPlayer|null}
     */
    this.music = null;
    /** @type {DynamicsCompressorNode|null} */
    this.compressor = null;

    /** True once the context is running after a user gesture. */
    this.unlocked = false;
    /** Quality scaler set by the adaptive frame-rate watchdog, 0..1. */
    this.quality = 1;

    /** Voices currently ringing. This is what the ceiling counts. */
    /** @type {Voice[]} */
    this._voices = [];
    /**
     * Voices that were stolen or trimmed and are fading out.
     *
     * They are kept out of `_voices` on purpose: a stolen voice must no longer
     * occupy the ceiling (or the next play would steal again), but its nodes
     * have to stay connected for the length of the release ramp so the cut is
     * inaudible. They are recycled by the same `update()` pass.
     * @type {Voice[]}
     */
    this._releasing = [];
    /** @type {GainNode[]} */
    this._gainPool = [];
    /** @type {BiquadFilterNode[]} */
    this._filterPool = [];
    /** @type {StereoPannerNode[]} */
    this._pannerPool = [];
    /** @type {AudioBuffer[]} */
    this._noiseBuffers = [];

    /**
     * Pool ceilings. A cache smaller than the working set is worse than no
     * cache at all: it recycles a few nodes and reallocates the rest, so the
     * bound is derived from the voice ceiling instead of guessed.
     *
     * Peak live voices are `maxVoices` ringing plus `maxVoices` fading, and a
     * voice owns one gain, one layer gain per layer (three at most) and one
     * panner.
     */
    this._poolCaps = {
      gain: CONFIG.audio.maxVoices * 8,
      filter: CONFIG.audio.maxVoices * 2,
      panner: CONFIG.audio.maxVoices * 2,
    };

    /** Per-preset last play time, for the retrigger guard. */
    /** @type {Map<string, number>} */
    this._lastPlayed = new Map();

    /** Listener position in world space, for panning and culling. */
    this.listenerX = 0;
    this.listenerY = 0;

    /** Diagnostics surfaced in the debug overlay. */
    this.stats = { voices: 0, releasing: 0, played: 0, dropped: 0, stolen: 0, peakVoices: 0 };

    /** @type {Array<() => void>} */
    this._teardown = [];
    this._attachEnvironment();
  }

  /* ============================================================
     Lifecycle
     ============================================================ */

  /**
   * Create the context (if needed) and resume it. Must be called from inside a
   * user gesture the first time, which is what `main.js` does on the first
   * pointer/key event.
   * @returns {Promise<boolean>} whether audio is now running
   */
  async unlock() {
    if (!this.supported) return false;
    if (!this.ctx) this._createContext();
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // A refused resume simply means "still locked"; the next gesture
        // retries. Nothing here is worth breaking the boot over.
      }
    }
    this.unlocked = ctx.state === 'running';
    if (this.unlocked) {
      this._applyMix();
      // A track requested before the first gesture had its `play()` refused by
      // the autoplay policy. Now that the context is live, honour the request
      // instead of waiting for the player to start a run again.
      const music = this.music;
      if (music && music.wanted && !music.playing) {
        music.start(CONFIG.audio.musicFadeIn);
      }
    }
    return this.unlocked;
  }

  /**
   * Listen for the first gesture and unlock once, then stop listening. Safe to
   * call in a headless environment (it becomes a no-op).
   * @param {EventTarget} [target]
   */
  attachUnlockHandlers(target = globalThis.window) {
    if (!this.supported || !target || typeof target.addEventListener !== 'function') return;
    const handler = () => {
      void this.unlock();
      detach();
    };
    const detach = () => {
      target.removeEventListener?.('pointerdown', handler);
      target.removeEventListener?.('keydown', handler);
    };
    target.addEventListener('pointerdown', handler);
    target.addEventListener('keydown', handler);
    this._teardown.push(detach);
  }

  /** Release every browser listener and node. Used by tests and teardown. */
  destroy() {
    for (const fn of this._teardown) fn();
    this._teardown.length = 0;
    if (this.music) {
      this.music.destroy();
      this.music = null;
    }
    for (const voice of [...this._voices, ...this._releasing]) this._releaseVoice(voice);
    this._voices.length = 0;
    this._releasing.length = 0;
    this._gainPool.length = 0;
    this._filterPool.length = 0;
    this._pannerPool.length = 0;
    this._noiseBuffers.length = 0;
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // Already closed, or closed by the browser: nothing to salvage.
      }
    }
    this.ctx = null;
    this.masterGain = null;
    this.effectsGain = null;
    this.compressor = null;
    this.unlocked = false;
  }

  /* ============================================================
     Mixer
     ============================================================ */

  /**
   * Change one mixer level, persist it and push it to the graph.
   * @param {'master'|'effects'} key
   * @param {number} value 0..1
   */
  setSetting(key, value) {
    const next = sanitizeAudioSettings({ ...this.settings, [key]: value }, this.settings);
    if (next[key] === this.settings[key]) return;
    this.settings = next;
    this._applyMix();
    this._persist();
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    const value = muted === true;
    if (value === this.settings.muted) return;
    this.settings = { ...this.settings, muted: value };
    this._applyMix();
    this._persist();
  }

  /** Flip mute; returns the new state. */
  toggleMute() {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  /**
   * Effective master level with mute applied. Exposed so the UI can render the
   * slider state without duplicating the rule.
   * @returns {number}
   */
  effectiveMaster() {
    return this.settings.muted ? 0 : this.settings.master;
  }

  /**
   * Reduce the mixer's cost when the frame rate sags. Called by the same
   * watchdog that trims particle density, so one signal drives both.
   * @param {number} quality 0..1
   */
  setQuality(quality) {
    const q = Math.min(1, Math.max(0.35, Number(quality) || 1));
    if (Math.abs(q - this.quality) < 0.001) return;
    this.quality = q;
    this._applyMix();
    // Trim the graph immediately rather than waiting for natural expiry.
    while (this._voices.length > this._maxVoices()) {
      const victim = this._weakestVoice();
      if (!victim) break;
      this._steal(victim);
    }
    this.stats.voices = this._voices.length;
  }

  /* ============================================================
     Playback
     ============================================================ */

  /**
   * Render a preset into the graph.
   * @param {string} id preset name
   * @param {PlayOptions} [opts]
   * @returns {Voice|null} the created voice, or null when it was culled
   */
  play(id, opts = {}) {
    if (!this.unlocked || !this.ctx) return null;
    const preset = SOUND_PRESETS[id];
    if (!preset) return null;

    const effects = (this.settings.muted ? 0 : this.settings.effects * this.settings.master);
    if (effects <= 0) return null;

    const now = this.ctx.currentTime;

    // 3. Retrigger guard: an identical sound that arrives too soon is folded
    //    into the one already ringing instead of stacking on top of it.
    const guard = preset.cooldown ?? CONFIG.audio.retriggerGuard;
    const last = this._lastPlayed.get(id);
    if (last !== undefined && now - last < guard) {
      this.stats.dropped++;
      return null;
    }

    // 6. Culling: compute the spatial part first, so a far-off sound costs one
    //    distance check and nothing else.
    const spatial = this._spatial(opts);
    if (spatial.gain <= 0) {
      this.stats.dropped++;
      return null;
    }

    // 2. Voice ceiling: make room by stealing the least important voice.
    const cap = this._maxVoices();
    if (this._voices.length >= cap) {
      const victim = this._weakestVoice();
      if (!victim || victim.priority > preset.priority) {
        this.stats.dropped++;
        return null;
      }
      this._steal(victim);
    }

    this._lastPlayed.set(id, now);
    const voice = this._render(id, preset, now, spatial, opts);
    this.stats.played++;
    this.stats.voices = this._voices.length;
    if (this._voices.length > this.stats.peakVoices) {
      this.stats.peakVoices = this._voices.length;
    }
    return voice;
  }

  /**
   * Prune finished voices. Called once per rendered frame: using the audio
   * clock instead of `setTimeout`/`onended` per voice keeps cleanup to one
   * pass and cannot fire during a browser hiccup.
   */
  update() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = this._voices.length - 1; i >= 0; i--) {
      const voice = this._voices[i];
      if (voice.endsAt <= now) this._releaseVoice(voice);
    }
    // Stolen voices live here until their release ramp has played out.
    for (let i = this._releasing.length - 1; i >= 0; i--) {
      const voice = this._releasing[i];
      if (voice.endsAt <= now) this._releaseVoice(voice);
    }
    this.stats.voices = this._voices.length;
    this.stats.releasing = this._releasing.length;
    // Music fades are driven by the same pass, for the same reason.
    if (this.music) this.music.update();
  }

  /* ============================================================
     Music
     ============================================================ */

  /**
   * Start the looping background track, fading in. Safe to call repeatedly
   * with the same track: an already-playing track is left alone rather than
   * restarted, so descending a floor does not restart the score.
   *
   * @param {string} url
   * @param {number} [fade] seconds
   * @returns {boolean} whether the track is loaded
   */
  playMusic(url, fade = CONFIG.audio.musicFadeIn) {
    if (!this.supported) return false;
    // Music must not be gated on `unlocked`: this is called from inside the
    // very click that unlocks the context, before `resume()` has resolved.
    if (!this.ctx) this._createContext();
    if (!this.music) return false;
    this.music.setTrack(url);
    this.music.setLevel(this.settings.music);
    this.music.start(fade);
    return this.music.element !== null;
  }

  /**
   * Fade the music out and pause it. The buffer is kept, so starting the next
   * run costs nothing.
   * @param {number} [fade] seconds
   */
  stopMusic(fade = CONFIG.audio.musicFadeOut) {
    if (this.music) this.music.stop(fade);
  }

  /** @returns {boolean} whether music is currently sounding */
  get musicPlaying() {
    return Boolean(this.music && this.music.playing);
  }

  /**
   * Move the listener. World sounds are panned relative to it, so a hit on the
   * right of the screen is heard on the right.
   * @param {number} x
   * @param {number} y
   */
  setListener(x, y) {
    this.listenerX = x;
    this.listenerY = y;
  }

  /* ============================================================
     Internals — graph
     ============================================================ */

  /** Build the context, bus and node pools on first use. */
  _createContext() {
    const Ctor = AudioContextCtor();
    if (typeof Ctor !== 'function') return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // 4/5. One compressor replaces per-sound limiting: dozens of simultaneous
    //      impacts duck instead of clipping, which is what lets every preset
    //      stay quiet enough to layer.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = CONFIG.audio.busThreshold;
    compressor.knee.value = CONFIG.audio.busKnee;
    compressor.ratio.value = CONFIG.audio.busRatio;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    compressor.connect(ctx.destination);
    this.compressor = compressor;

    const master = ctx.createGain();
    master.connect(compressor);
    this.masterGain = master;

    const effects = ctx.createGain();
    effects.connect(master);
    this.effectsGain = effects;

    // Music mixes into the master bus through its own gain, which the player
    // owns (it is the same node that performs the fades). Mute and master
    // volume therefore reach it through the graph — the level passed in is the
    // music slider alone, so nothing is applied twice.
    this.music = new MusicPlayer({
      ctx,
      destination: master,
      onError: (err) => {
        // Music is optional: a missing or undecodable file must leave the game
        // fully playable, so the failure is recorded rather than thrown.
        console.warn('[audio] music unavailable:', err);
      },
    });

    // The noise bank is generated once per context and shared by every noise
    // layer, so no impact ever allocates a buffer.
    for (let v = 0; v < 3; v++) this._noiseBuffers.push(this._makeNoiseBuffer(v));

    this._applyMix();
  }

  /**
   * @param {number} variant 0..2, seeds three different noise textures
   * @returns {AudioBuffer}
   */
  _makeNoiseBuffer(variant) {
    const ctx = /** @type {AudioContext} */ (this.ctx);
    const length = Math.floor(ctx.sampleRate * 0.6);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // A cheap deterministic hash keeps the three variants distinct without
    // pulling the gameplay RNG into the audio thread.
    let state = (0x9e3779b9 ^ (variant * 0x85ebca6b)) >>> 0;
    for (let i = 0; i < length; i++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      data[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  /** Push mixer levels into the graph with a short ramp, so nothing clicks. */
  _applyMix() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const audible = !this.settings.muted;
    setLevel(this.masterGain, audible ? this.settings.master : 0, now);
    setLevel(this.effectsGain, audible ? this.settings.effects : 0, now);
    // Music only needs its own slider here: mute and master volume are applied
    // by the graph it is connected to.
    if (this.music) this.music.setLevel(this.settings.music);
  }

  /** @returns {number} the voice ceiling for the current quality level. */
  _maxVoices() {
    const full = CONFIG.audio.maxVoices;
    const reduced = CONFIG.audio.maxVoicesReduced;
    return Math.max(2, Math.round(reduced + (full - reduced) * this.quality));
  }

  /** The voice that should be sacrificed first: least important, then oldest. */
  _weakestVoice() {
    let best = null;
    for (const voice of this._voices) {
      if (voice.released) continue;
      if (!best
        || voice.priority < best.priority
        || (voice.priority === best.priority && voice.endsAt < best.endsAt)) {
        best = voice;
      }
    }
    return best;
  }

  /**
   * @param {PlayOptions} opts
   * @returns {{gain: number, pan: number}}
   */
  _spatial(opts) {
    if (typeof opts.pan === 'number') {
      return { gain: 1, pan: clampPan(opts.pan) };
    }
    if (typeof opts.x !== 'number' || typeof opts.y !== 'number') {
      return { gain: 1, pan: 0 };
    }
    const dx = opts.x - this.listenerX;
    const dy = opts.y - this.listenerY;
    const distance = Math.hypot(dx, dy);
    const radius = CONFIG.audio.audibleRadius;
    if (distance > radius) return { gain: 0, pan: 0 };
    const falloff = 1 - distance / radius;
    const gain = CONFIG.audio.minAudibleGain
      + (1 - CONFIG.audio.minAudibleGain) * falloff * falloff;
    return { gain, pan: clampPan(dx / radius) * CONFIG.audio.maxPan };
  }

  /**
   * Turn one preset into nodes.
   * @param {string} id
   * @param {import('./soundPresets.js').SoundPreset} preset
   * @param {number} now
   * @param {{gain: number, pan: number}} spatial
   * @param {PlayOptions} opts
   * @returns {Voice}
   */
  _render(id, preset, now, spatial, opts) {
    const ctx = /** @type {AudioContext} */ (this.ctx);
    const voiceGain = this._acquireGain();
    const panner = this._acquirePanner();
    const base = preset.gain * spatial.gain * (opts.gain ?? 1) * this.quality;
    voiceGain.gain.setValueAtTime(base, now);

    if (panner) {
      if (typeof panner.pan.linearRampToValueAtTime === 'function') {
        panner.pan.setValueAtTime(spatial.pan, now);
      } else {
        panner.pan.value = spatial.pan;
      }
      voiceGain.connect(panner);
      panner.connect(/** @type {GainNode} */ (this.effectsGain));
    } else {
      voiceGain.connect(/** @type {GainNode} */ (this.effectsGain));
    }

    const variance = preset.pitchVariance ?? 0;
    const pitch = (opts.pitch ?? 1) * (variance > 0 ? 1 + (Math.random() * 2 - 1) * variance : 1);

    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];
    /** @type {GainNode[]} */
    const layerGains = [];
    /** @type {BiquadFilterNode[]} */
    const filters = [];
    let endsAt = now;
    for (const layer of preset.layers) {
      const rendered = this._renderLayer(layer, now, pitch, voiceGain);
      if (!rendered) continue;
      sources.push(rendered.source);
      if (rendered.gain) layerGains.push(rendered.gain);
      if (rendered.filter) filters.push(rendered.filter);
      endsAt = Math.max(endsAt, rendered.endsAt);
    }

    /** @type {Voice} */
    const voice = {
      gain: voiceGain,
      panner,
      sources,
      layerGains,
      filters,
      endsAt,
      priority: preset.priority,
      id,
      released: false,
    };
    this._voices.push(voice);
    return voice;
  }

  /**
   * Render one layer into `destination` and report what it allocated, so the
   * voice can hand every reusable node back to its pool on release.
   * @param {import('./soundPresets.js').SoundLayer} layer
   * @param {number} now
   * @param {number} pitch
   * @param {GainNode} destination
   * @returns {{source: AudioScheduledSourceNode,
   *   endsAt: number, gain: GainNode|null, filter: BiquadFilterNode|null}|null}
   */
  _renderLayer(layer, now, pitch, destination) {
    const ctx = /** @type {AudioContext} */ (this.ctx);
    const attack = Math.max(0.001, layer.attack ?? 0.004);
    const dur = Math.max(0.02, layer.dur);
    const level = Math.max(0.0001, layer.level ?? 1);
    const end = now + attack + dur;

    /** @type {AudioScheduledSourceNode} */
    let source;
    /** @type {AudioNode} */
    let head;
    /** @type {BiquadFilterNode|null} */
    let filter = null;

    if (layer.source === 'noise') {
      if (this._noiseBuffers.length === 0) return null;
      const buffer = this._noiseBuffers[Math.floor(Math.random() * this._noiseBuffers.length)];
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      noise.playbackRate.value = pitch;
      source = noise;
      head = noise;

      filter = this._acquireFilter();
      if (filter) {
        filter.type = layer.filter ?? 'lowpass';
        filter.Q.setValueAtTime(layer.q ?? 0.7, now);
        const cutoff = layer.cutoff ?? 1200;
        if (Array.isArray(cutoff)) {
          filter.frequency.setValueAtTime(Math.max(20, cutoff[0]), now);
          filter.frequency.exponentialRampToValueAtTime(Math.max(20, cutoff[1]), end);
        } else {
          filter.frequency.setValueAtTime(Math.max(20, cutoff), now);
        }
        noise.connect(filter);
        head = filter;
      }
    } else {
      const osc = ctx.createOscillator();
      osc.type = layer.wave ?? 'sine';
      const freq = layer.freq ?? 440;
      if (Array.isArray(freq)) {
        osc.frequency.setValueAtTime(Math.max(1, freq[0]), now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), end);
      } else {
        osc.frequency.setValueAtTime(Math.max(1, freq), now);
      }
      if (layer.detune) osc.detune.setValueAtTime(layer.detune, now);
      source = osc;
      head = osc;
    }

    // Per-layer envelope: a fast exponential bite and a decay to a hair above
    // zero is what makes a 60 ms click read as an impact instead of a burp.
    const layerGain = this._acquireGain();
    layerGain.gain.setValueAtTime(0.0001, now);
    layerGain.gain.exponentialRampToValueAtTime(level, now + attack);
    layerGain.gain.exponentialRampToValueAtTime(0.0001, end);
    head.connect(layerGain);
    layerGain.connect(destination);

    source.start(now);
    source.stop(end + 0.01);
    return { source, endsAt: end + 0.02, gain: layerGain, filter };
  }

  /**
   * Fade a voice out and move it to the releasing list: it stops occupying the
   * ceiling at once, but keeps its nodes until the ramp has played.
   * @param {Voice} voice
   */
  _steal(voice) {
    this.stats.stolen++;
    const ctx = /** @type {AudioContext} */ (this.ctx);
    const now = ctx ? ctx.currentTime : 0;
    const fade = CONFIG.audio.releaseFade;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      const current = typeof voice.gain.gain.value === 'number' ? voice.gain.gain.value : 0;
      voice.gain.gain.setValueAtTime(current, now);
      voice.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    } catch {
      // A param that refuses the ramp still gets disconnected below.
    }
    for (const source of voice.sources) {
      try {
        source.stop(now + fade);
      } catch {
        // Already stopped: the voice is going away regardless.
      }
    }
    voice.endsAt = Math.min(voice.endsAt, now + fade + 0.01);

    const index = this._voices.indexOf(voice);
    if (index >= 0) this._voices.splice(index, 1);
    if (!voice.released && this._releasing.indexOf(voice) < 0) {
      this._releasing.push(voice);
    }

    // A pathological burst could otherwise pile fading voices up faster than
    // they expire, so the releasing list is bounded by the same ceiling: the
    // oldest is cut dry rather than allowed to grow the graph without limit.
    const ceiling = this._maxVoices();
    while (this._releasing.length > ceiling) {
      const oldest = this._releasing[0];
      if (!oldest) break;
      this._releaseVoice(oldest);
    }
  }

  /**
   * @param {Voice} voice
   */
  _releaseVoice(voice) {
    if (voice.released) return;
    voice.released = true;
    for (const list of [this._voices, this._releasing]) {
      const index = list.indexOf(voice);
      if (index >= 0) list.splice(index, 1);
    }

    // Every node the voice borrowed goes back to its pool, so steady-state
    // combat allocates only the sources, which cannot be reused.
    for (const source of voice.sources) {
      try {
        source.disconnect();
      } catch {
        // Nothing to disconnect.
      }
    }
    for (const filter of voice.filters) {
      try {
        filter.disconnect();
      } catch {
        // Nothing to disconnect.
      }
      this._releaseFilter(filter);
    }
    for (const gain of voice.layerGains) {
      try {
        gain.disconnect();
      } catch {
        // Nothing to disconnect.
      }
      this._releaseGain(gain);
    }
    try {
      voice.gain.disconnect();
    } catch {
      // Nothing to disconnect.
    }
    this._releasePanner(voice.panner);
    this._releaseGain(voice.gain);
  }

  /* ============================================================
     Internals — pools
     ============================================================ */

  /** @returns {GainNode} */
  _acquireGain() {
    const pooled = this._gainPool.pop();
    if (pooled) {
      pooled.gain.cancelScheduledValues(0);
      pooled.gain.value = 1;
      return pooled;
    }
    return /** @type {AudioContext} */ (this.ctx).createGain();
  }

  /** @param {GainNode|null} node */
  _releaseGain(node) {
    if (!node || this._gainPool.length >= this._poolCaps.gain) return;
    this._gainPool.push(node);
  }

  /** @returns {BiquadFilterNode|null} */
  _acquireFilter() {
    const pooled = this._filterPool.pop();
    if (pooled) {
      pooled.frequency.cancelScheduledValues(0);
      return pooled;
    }
    const ctx = /** @type {AudioContext} */ (this.ctx);
    return typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null;
  }

  /** @param {BiquadFilterNode|null} node */
  _releaseFilter(node) {
    if (!node || this._filterPool.length >= this._poolCaps.filter) return;
    this._filterPool.push(node);
  }

  /** @returns {StereoPannerNode|null} */
  _acquirePanner() {
    const pooled = this._pannerPool.pop();
    if (pooled) return pooled;
    const ctx = /** @type {AudioContext} */ (this.ctx);
    return typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
  }

  /** @param {StereoPannerNode|null|undefined} node */
  _releasePanner(node) {
    if (!node || this._pannerPool.length >= this._poolCaps.panner) return;
    try {
      node.disconnect();
    } catch {
      // Nothing to disconnect.
    }
    this._pannerPool.push(node);
  }

  /* ============================================================
     Internals — environment
     ============================================================ */

  /** Suspend while hidden: a backgrounded tab must not keep an audio graph hot. */
  _attachEnvironment() {
    const doc = globalThis.document;
    if (!doc || typeof doc.addEventListener !== 'function') return;
    const onVisibility = () => {
      if (!this.ctx) return;
      if (doc.hidden) {
        try {
          void this.ctx.suspend();
        } catch {
          // Suspension is an optimisation, never a requirement.
        }
      } else if (this.unlocked) {
        try {
          void this.ctx.resume();
        } catch {
          // The next gesture unlocks again.
        }
      }
    };
    doc.addEventListener('visibilitychange', onVisibility);
    this._teardown.push(() => doc.removeEventListener?.('visibilitychange', onVisibility));
  }

  /** Persist through the shared settings module (best effort). */
  _persist() {
    saveAudioSettings(this.storage, this.settings);
    if (this.onChange) this.onChange(this.settings);
  }
}

/* ============================================================
   Helpers
   ============================================================ */

/**
 * The available Web Audio constructor, or undefined in a headless runtime.
 * `webkitAudioContext` is still needed for older iOS Safari.
 * @returns {typeof AudioContext|undefined}
 */
function AudioContextCtor() {
  return /** @type {any} */ (globalThis.AudioContext
    ?? /** @type {any} */ (globalThis).webkitAudioContext);
}

/**
 * @param {GainNode|null} node
 * @param {number} value
 * @param {number} now
 */
function setLevel(node, value, now) {
  if (!node) return;
  try {
    // A 30 ms ramp instead of a hard set: a slider drag would otherwise click.
    node.gain.setTargetAtTime(value, now, 0.03);
  } catch {
    node.gain.value = value;
  }
}

/**
 * @param {number} value
 * @returns {number} pan clamped to the stereo field
 */
function clampPan(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}
