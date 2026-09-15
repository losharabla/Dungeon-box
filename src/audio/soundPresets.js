/**
 * @fileoverview Procedural sound presets — pure data.
 *
 * No behaviour lives here, exactly as with `data/weapons.js`: a sound is
 * *described* and `AudioSystem` renders the description into Web Audio nodes.
 * Adding a sound means adding an object to this file, never editing the
 * engine.
 *
 * ## The preset format
 *
 * ```js
 * id: {
 *   gain: 0.6,          // preset level, before mixer and distance scaling
 *   priority: 1,        // 0 incidental .. 4 critical; decides who is stolen
 *   cooldown: 0.05,     // optional override of CONFIG.audio.retriggerGuard
 *   minimumGap: 0.15,   // optional: drop the play entirely if it came sooner
 *   pitchVariance: 0.08,// random playbackRate spread, so repeats are not clones
 *   layers: [ ... ]     // played together, each with its own envelope
 * }
 * ```
 *
 * A layer is either a `tone` (an oscillator) or `noise` (the shared noise
 * buffer through a filter). `freq`/`cutoff` accept a number for a fixed value
 * or `[from, to]` for an exponential sweep — the sweep is what makes a
 * procedural sound read as a *gesture* (a swing, an impact, a fall) instead of
 * a beep.
 *
 * `priority` matters more than it looks: when the voice ceiling is reached the
 * mixer stops the quietest, least important voice to make room, so a critical
 * cue always survives a busy frame while a coin flip is the first to go.
 *
 * @typedef {object} SoundLayer
 * @property {'tone'|'noise'} source
 * @property {OscillatorType} [wave]      tone only
 * @property {number|number[]} [freq]     tone: oscillator frequency, Hz
 * @property {'lowpass'|'highpass'|'bandpass'} [filter] noise only
 * @property {number|number[]} [cutoff]   noise: filter frequency, Hz
 * @property {number} [q]                 noise: filter resonance
 * @property {number} dur                 seconds
 * @property {number} [attack]            seconds of attack ramp (default 0.004)
 * @property {number} [level]             layer level, default 1
 * @property {number} [detune]            tone: cents
 *
 * @typedef {object} SoundPreset
 * @property {number} gain
 * @property {number} priority
 * @property {number} [cooldown]
 * @property {number} [pitchVariance]
 * @property {SoundLayer[]} layers
 */

/** Priorities, so a preset never states a bare number it has to explain. */
export const PRIORITY = {
  /** Flavour: coins, footsteps, UI ticks. First to be dropped. */
  incidental: 0,
  /** Routine combat feedback: hits, swings, light shots. */
  combat: 1,
  /** The player's own actions: dash, weapon fire, block. */
  player: 2,
  /** Things the player must notice: taking a hit, ult ready. */
  important: 3,
  /** Run-defining cues: death, boss phase, victory. Never stolen. */
  critical: 4,
};

/** @type {Record<string, SoundPreset>} */
export const SOUND_PRESETS = {
  /* ---------------- Interface ---------------- */

  ui_click: {
    gain: 0.30,
    priority: PRIORITY.player,
    pitchVariance: 0.05,
    layers: [
      { source: 'tone', wave: 'square', freq: [880, 620], dur: 0.055, attack: 0.001 },
      { source: 'noise', filter: 'highpass', cutoff: 3200, dur: 0.03, level: 0.35 },
    ],
  },

  ui_back: {
    gain: 0.26,
    priority: PRIORITY.player,
    layers: [
      { source: 'tone', wave: 'square', freq: [520, 340], dur: 0.07, attack: 0.001 },
    ],
  },

  /* ---------------- Melee ---------------- */

  swing_light: {
    gain: 0.34,
    priority: PRIORITY.player,
    cooldown: 0.08,
    pitchVariance: 0.10,
    layers: [
      { source: 'noise', filter: 'bandpass', cutoff: [2600, 700], q: 1.1, dur: 0.17, attack: 0.012 },
    ],
  },

  swing_heavy: {
    gain: 0.46,
    priority: PRIORITY.player,
    cooldown: 0.12,
    pitchVariance: 0.08,
    layers: [
      { source: 'noise', filter: 'bandpass', cutoff: [1500, 380], q: 1.4, dur: 0.30, attack: 0.03 },
      { source: 'tone', wave: 'triangle', freq: [180, 90], dur: 0.22, attack: 0.02, level: 0.5 },
    ],
  },

  /* ---------------- Ranged ---------------- */

  shoot_light: {
    gain: 0.32,
    priority: PRIORITY.player,
    cooldown: 0.045,
    pitchVariance: 0.12,
    layers: [
      { source: 'noise', filter: 'bandpass', cutoff: [2200, 900], q: 0.8, dur: 0.07, attack: 0.001 },
      { source: 'tone', wave: 'square', freq: [420, 150], dur: 0.05, attack: 0.001, level: 0.6 },
    ],
  },

  shoot_heavy: {
    gain: 0.5,
    priority: PRIORITY.player,
    cooldown: 0.09,
    pitchVariance: 0.07,
    layers: [
      { source: 'noise', filter: 'lowpass', cutoff: [1800, 400], dur: 0.20, attack: 0.002 },
      { source: 'tone', wave: 'sawtooth', freq: [220, 62], dur: 0.16, attack: 0.001, level: 0.7 },
    ],
  },

  shoot_magic: {
    gain: 0.30,
    priority: PRIORITY.player,
    cooldown: 0.06,
    pitchVariance: 0.10,
    layers: [
      { source: 'tone', wave: 'sine', freq: [720, 1180], dur: 0.14, attack: 0.01 },
      { source: 'tone', wave: 'triangle', freq: [360, 590], dur: 0.16, attack: 0.01, level: 0.5, detune: 12 },
      { source: 'noise', filter: 'highpass', cutoff: 2400, dur: 0.10, level: 0.25 },
    ],
  },

  /* ---------------- Impacts ---------------- */

  hit_flesh: {
    gain: 0.34,
    priority: PRIORITY.combat,
    cooldown: 0.03,
    pitchVariance: 0.16,
    layers: [
      { source: 'noise', filter: 'bandpass', cutoff: [900, 260], q: 0.9, dur: 0.09, attack: 0.001 },
      { source: 'tone', wave: 'triangle', freq: [150, 78], dur: 0.08, attack: 0.001, level: 0.7 },
    ],
  },

  hit_crit: {
    gain: 0.48,
    priority: PRIORITY.important,
    cooldown: 0.05,
    pitchVariance: 0.08,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [520, 130], dur: 0.16, attack: 0.001 },
      { source: 'noise', filter: 'highpass', cutoff: [1800, 900], dur: 0.12, level: 0.6 },
    ],
  },

  hit_block: {
    gain: 0.42,
    priority: PRIORITY.combat,
    cooldown: 0.06,
    pitchVariance: 0.10,
    layers: [
      { source: 'tone', wave: 'square', freq: [1300, 900], dur: 0.09, attack: 0.001 },
      { source: 'noise', filter: 'highpass', cutoff: 4000, dur: 0.06, level: 0.5 },
    ],
  },

  shield_break: {
    gain: 0.5,
    priority: PRIORITY.important,
    layers: [
      { source: 'noise', filter: 'bandpass', cutoff: [4200, 900], q: 1.6, dur: 0.32, attack: 0.002 },
      { source: 'tone', wave: 'sawtooth', freq: [300, 70], dur: 0.26, attack: 0.001, level: 0.6 },
    ],
  },

  /* ---------------- Death ---------------- */

  enemy_death: {
    gain: 0.36,
    priority: PRIORITY.combat,
    cooldown: 0.05,
    pitchVariance: 0.18,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [340, 68], dur: 0.34, attack: 0.002 },
      { source: 'noise', filter: 'lowpass', cutoff: [1400, 300], dur: 0.30, attack: 0.01, level: 0.6 },
    ],
  },

  boss_death: {
    gain: 0.72,
    priority: PRIORITY.critical,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [180, 34], dur: 1.30, attack: 0.01 },
      { source: 'noise', filter: 'lowpass', cutoff: [1600, 180], dur: 1.20, attack: 0.02, level: 0.8 },
      { source: 'tone', wave: 'square', freq: [90, 26], dur: 1.35, attack: 0.02, level: 0.5 },
    ],
  },

  player_hurt: {
    gain: 0.5,
    priority: PRIORITY.important,
    cooldown: 0.12,
    pitchVariance: 0.06,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [300, 96], dur: 0.20, attack: 0.001 },
      { source: 'noise', filter: 'lowpass', cutoff: [900, 220], dur: 0.18, attack: 0.001, level: 0.7 },
    ],
  },

  /* ---------------- Player abilities ---------------- */

  dash: {
    gain: 0.34,
    priority: PRIORITY.player,
    cooldown: 0.12,
    pitchVariance: 0.08,
    layers: [
      { source: 'noise', filter: 'bandpass', cutoff: [500, 2600], q: 0.7, dur: 0.20, attack: 0.02 },
    ],
  },

  ult_ready: {
    gain: 0.42,
    priority: PRIORITY.important,
    cooldown: 0.5,
    layers: [
      { source: 'tone', wave: 'sine', freq: [520, 1040], dur: 0.34, attack: 0.03 },
      { source: 'tone', wave: 'sine', freq: [780, 1560], dur: 0.30, attack: 0.05, level: 0.5 },
    ],
  },

  ult_cast: {
    gain: 0.62,
    priority: PRIORITY.critical,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [110, 440], dur: 0.55, attack: 0.02 },
      { source: 'noise', filter: 'bandpass', cutoff: [400, 3600], q: 0.9, dur: 0.60, attack: 0.04, level: 0.8 },
      { source: 'tone', wave: 'sine', freq: [660, 1320], dur: 0.45, attack: 0.06, level: 0.4 },
    ],
  },

  heal: {
    gain: 0.34,
    priority: PRIORITY.player,
    cooldown: 0.2,
    layers: [
      { source: 'tone', wave: 'sine', freq: [620, 930], dur: 0.34, attack: 0.04 },
      { source: 'tone', wave: 'sine', freq: [930, 1240], dur: 0.30, attack: 0.07, level: 0.55 },
    ],
  },

  /* ---------------- Economy ---------------- */

  coin: {
    gain: 0.20,
    priority: PRIORITY.incidental,
    cooldown: 0.06,
    pitchVariance: 0.16,
    layers: [
      { source: 'tone', wave: 'square', freq: [1240, 1860], dur: 0.10, attack: 0.001 },
    ],
  },

  purchase: {
    gain: 0.38,
    priority: PRIORITY.player,
    layers: [
      { source: 'tone', wave: 'triangle', freq: [520, 780], dur: 0.16, attack: 0.005 },
      { source: 'tone', wave: 'triangle', freq: [780, 1170], dur: 0.22, attack: 0.02, level: 0.6 },
    ],
  },

  /* ---------------- Room / floor ---------------- */

  wave_start: {
    gain: 0.42,
    priority: PRIORITY.important,
    cooldown: 1.0,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [120, 180], dur: 0.60, attack: 0.08, level: 0.7 },
      { source: 'noise', filter: 'lowpass', cutoff: [700, 1200], dur: 0.50, attack: 0.10, level: 0.4 },
    ],
  },

  room_clear: {
    gain: 0.40,
    priority: PRIORITY.important,
    cooldown: 0.4,
    layers: [
      { source: 'tone', wave: 'triangle', freq: [392, 587], dur: 0.40, attack: 0.02 },
      { source: 'tone', wave: 'sine', freq: [587, 784], dur: 0.46, attack: 0.06, level: 0.6 },
    ],
  },

  door_open: {
    gain: 0.26,
    priority: PRIORITY.incidental,
    cooldown: 0.3,
    pitchVariance: 0.10,
    layers: [
      { source: 'noise', filter: 'lowpass', cutoff: [600, 1400], dur: 0.34, attack: 0.05 },
      { source: 'tone', wave: 'triangle', freq: [140, 220], dur: 0.30, attack: 0.05, level: 0.5 },
    ],
  },

  /* ---------------- Boss ---------------- */

  boss_spawn: {
    gain: 0.70,
    priority: PRIORITY.critical,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [70, 46], dur: 1.10, attack: 0.05 },
      { source: 'tone', wave: 'square', freq: [140, 92], dur: 0.95, attack: 0.08, level: 0.5 },
      { source: 'noise', filter: 'lowpass', cutoff: [500, 260], dur: 1.20, attack: 0.12, level: 0.6 },
    ],
  },

  boss_phase: {
    gain: 0.68,
    priority: PRIORITY.critical,
    cooldown: 1.0,
    layers: [
      { source: 'tone', wave: 'sawtooth', freq: [190, 60], dur: 0.85, attack: 0.01 },
      { source: 'noise', filter: 'bandpass', cutoff: [1800, 300], q: 1.2, dur: 0.80, attack: 0.02, level: 0.8 },
    ],
  },

  /* ---------------- Run outcome ---------------- */

  victory: {
    gain: 0.62,
    priority: PRIORITY.critical,
    layers: [
      { source: 'tone', wave: 'triangle', freq: [392, 392], dur: 0.36, attack: 0.02 },
      { source: 'tone', wave: 'triangle', freq: [523, 523], dur: 0.36, attack: 0.02, level: 0.8 },
      { source: 'tone', wave: 'sine', freq: [784, 784], dur: 0.85, attack: 0.05, level: 0.7 },
    ],
  },

  defeat: {
    gain: 0.60,
    priority: PRIORITY.critical,
    layers: [
      { source: 'tone', wave: 'triangle', freq: [330, 220], dur: 0.70, attack: 0.03 },
      { source: 'tone', wave: 'sine', freq: [220, 110], dur: 1.10, attack: 0.06, level: 0.7 },
    ],
  },
};
