/**
 * @fileoverview Mixer settings: defaults, sanitising and persistence.
 *
 * SRP: turn untrusted numbers (localStorage, a DOM input, a query string) into
 * a valid mixer settings record, and store it again. It knows nothing about
 * Web Audio, the DOM or the game — which is what makes it testable headlessly
 * and reusable by both the audio engine and the UI controls.
 */

import { CONFIG } from '../core/Config.js';

/**
 * @typedef {object} AudioSettings
 * @property {number} master   0..1 overall level
 * @property {number} music    0..1 background music level
 * @property {number} effects  0..1 one-shot sound level
 * @property {boolean} muted   hard mute, independent of the levels
 */

/** Keys the mixer exposes, in UI order. */
export const AUDIO_SETTING_KEYS = /** @type {const} */ (['master', 'music', 'effects']);

/** LocalStorage key. Versioned so a future shape change cannot crash on old data. */
export const AUDIO_STORAGE_KEY = 'rogalik.audio.v3';

/** @returns {AudioSettings} a fresh copy of the shipped defaults. */
export function defaultAudioSettings() {
  const d = CONFIG.audio.defaults;
  return {
    master: d.master,
    music: d.music,
    effects: d.effects,
    muted: d.muted === true,
  };
}

/**
 * Clamp one level into 0..1, treating anything non-finite as "leave it alone".
 *
 * `null`, `undefined` and `''` are treated as *missing* rather than as zero:
 * a corrupt entry next to a valid one must not silently mute a channel, which
 * is exactly what `Number(null) === 0` would have done.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function level(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Coerce an arbitrary partial record into a complete, valid settings object.
 *
 * Every field is repaired independently, so one corrupt entry in storage can
 * never discard the rest of the player's mixer.
 * @param {any} raw
 * @param {AudioSettings} [base]
 * @returns {AudioSettings}
 */
export function sanitizeAudioSettings(raw, base = defaultAudioSettings()) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    master: level(src.master, base.master),
    music: level(src.music, base.music),
    effects: level(src.effects, base.effects),
    muted: typeof src.muted === 'boolean' ? src.muted : base.muted,
  };
}

/**
 * Read persisted settings. Any failure (no storage, private mode, corrupt
 * JSON) falls back to the defaults rather than breaking the boot.
 * @param {Storage|null|undefined} storage
 * @returns {AudioSettings}
 */
export function loadAudioSettings(storage) {
  const defaults = defaultAudioSettings();
  if (!storage || typeof storage.getItem !== 'function') return defaults;
  try {
    const text = storage.getItem(AUDIO_STORAGE_KEY);
    if (!text) return defaults;
    return sanitizeAudioSettings(JSON.parse(text), defaults);
  } catch {
    return defaults;
  }
}

/**
 * Persist settings. Storage is treated as best-effort: a browser that refuses
 * to write (quota, private mode) must not surface an error into the game.
 * @param {Storage|null|undefined} storage
 * @param {AudioSettings} settings
 * @returns {boolean} whether the write succeeded
 */
export function saveAudioSettings(storage, settings) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(sanitizeAudioSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser's storage, if it is reachable. Accessing `localStorage` can
 * itself throw in a sandboxed iframe, so it is probed rather than assumed.
 * @returns {Storage|null}
 */
export function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    // Touch it: some browsers expose the object but throw on use.
    ls.getItem(AUDIO_STORAGE_KEY);
    return /** @type {Storage} */ (ls);
  } catch {
    return null;
  }
}
