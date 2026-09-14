/**
 * @fileoverview Deterministic pseudo-random number generator.
 *
 * SRP: this module's only job is producing random numbers. Nothing about
 * gameplay, spawning or balance lives here.
 *
 * A seeded generator (mulberry32) is used so a run can be reproduced from
 * its seed, which makes gameplay bugs debuggable.
 */

/** @typedef {() => number} RandomFn */

export class Random {
  /** @param {number} [seed] */
  constructor(seed = Date.now()) {
    /** @type {number} */
    this.seed = (seed >>> 0) || 1;
    /** @type {number} */
    this._state = this.seed;
  }

  /** Reset the stream back to the original seed. */
  reset() {
    this._state = this.seed;
  }

  /**
   * Uniform float in [0, 1).
   * @returns {number}
   */
  next() {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Uniform float in [min, max).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * Uniform integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * True with the given probability.
   * @param {number} chance 0..1
   * @returns {boolean}
   */
  chance(chance) {
    return this.next() < chance;
  }

  /**
   * Pick one element uniformly. Returns undefined for an empty array.
   * @template T
   * @param {ReadonlyArray<T>} arr
   * @returns {T|undefined}
   */
  pick(arr) {
    if (arr.length === 0) return undefined;
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * Pick one element, guaranteeing a value for a non-empty array.
   * @template T
   * @param {ReadonlyArray<T>} arr
   * @returns {T}
   */
  pickOne(arr) {
    if (arr.length === 0) throw new Error('Random.pickOne: empty array');
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * Fisher-Yates shuffle into a new array (input is not mutated).
   * @template T
   * @param {ReadonlyArray<T>} arr
   * @returns {T[]}
   */
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /**
   * Pick `count` distinct elements (or all of them if count exceeds length).
   * @template T
   * @param {ReadonlyArray<T>} arr
   * @param {number} count
   * @returns {T[]}
   */
  sample(arr, count) {
    return this.shuffle(arr).slice(0, Math.max(0, count));
  }

  /**
   * Pick an element using an explicit weight function.
   * @template T
   * @param {ReadonlyArray<T>} arr
   * @param {(item: T) => number} weightOf
   * @returns {T|undefined}
   */
  weighted(arr, weightOf) {
    let total = 0;
    for (const item of arr) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(arr);
    let roll = this.next() * total;
    for (const item of arr) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return arr[arr.length - 1];
  }
}

/**
 * The gameplay-wide random stream. Exported as a singleton so all systems
 * draw from one reproducible sequence.
 * @type {Random}
 */
export const rng = new Random();
