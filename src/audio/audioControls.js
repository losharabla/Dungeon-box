/**
 * @fileoverview Mixer controls adapter.
 *
 * SRP: present the smallest possible surface of `AudioSystem` to the UI.
 *
 * Interface Segregation: `UIManager` needs four things — read the settings,
 * change one level, flip mute, play a click — and nothing else. It therefore
 * receives this adapter rather than the whole engine, which is also what lets
 * the DOM tests construct the UI with no audio at all.
 */

import { AUDIO_SETTING_KEYS, defaultAudioSettings } from './audioSettings.js';

/** Cue played when a menu control is used. */
export const UI_CLICK = 'ui_click';
/** Cue played when a control moves *backwards* (leaving the run, to the menu). */
export const UI_BACK = 'ui_back';

/**
 * Presets the interface owns, as opposed to `BOUND_SOUND_IDS` in
 * `audioBindings.js`, which are the ones a game event can raise. The two lists
 * together must cover the preset table exactly: `audio-test.mjs` proves it, so
 * neither a missing sound nor dead weight can accumulate here.
 * @type {readonly string[]}
 */
export const UI_SOUND_IDS = /** @type {const} */ ([UI_CLICK, UI_BACK]);

/**
 * @typedef {object} AudioControls
 * @property {import('./audioSettings.js').AudioSettings} settings
 * @property {(key: 'master'|'music'|'effects', value: number) => void} set
 * @property {(muted: boolean) => void} setMuted
 * @property {(id: string, opts?: object) => void} play
 */

/**
 * Wrap a mixer for the UI.
 * @param {import('./AudioSystem.js').AudioSystem} audio
 * @returns {AudioControls}
 */
export function createAudioControls(audio) {
  return {
    get settings() {
      return audio.settings;
    },
    set(key, value) {
      if (AUDIO_SETTING_KEYS.includes(key)) audio.setSetting(key, value);
    },
    setMuted(muted) {
      audio.setMuted(muted);
    },
    /**
     * Play a UI cue. Silent before the first gesture and in a headless
     * runtime, which is exactly the behaviour the menu wants.
     * @param {string} id
     * @param {object} [opts]
     */
    play(id, opts) {
      audio.play(id, opts ?? { gain: 0.9 });
    },
  };
}

/**
 * A mixer that makes no sound, so the UI is usable (and testable) with no
 * audio engine present. Frozen: it is shared, and a UI that mutated it would
 * corrupt every other instance.
 * @type {AudioControls}
 */
export const NULL_AUDIO_CONTROLS = Object.freeze({
  settings: Object.freeze(defaultAudioSettings()),
  set() {},
  setMuted() {},
  play() {},
});
