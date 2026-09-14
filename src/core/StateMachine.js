/**
 * @fileoverview Finite state machine for the game's high-level screens.
 *
 * SRP: owns the current state and its legal transitions. It does not know
 * how a menu is drawn or what a boss is — it only answers "where are we"
 * and "is this transition allowed".
 *
 * State list is taken verbatim from the design document §28.
 */

/**
 * @typedef {string} GameStateName
 */

/** @type {Record<string, string[]>} */
const TRANSITIONS = {
  menu: ['character_select', 'playing'],
  character_select: ['menu', 'playing'],
  playing: ['pause', 'shop', 'healing', 'boss', 'game_over', 'victory', 'menu'],
  pause: ['playing', 'menu', 'game_over'],
  shop: ['playing', 'game_over'],
  healing: ['playing', 'game_over'],
  boss: ['playing', 'game_over', 'victory', 'pause'],
  game_over: ['menu', 'character_select', 'playing'],
  victory: ['menu', 'character_select', 'playing'],
};

export class StateMachine {
  /**
   * @param {import('./EventBus.js').EventBus} bus
   * @param {GameStateName} [initial]
   */
  constructor(bus, initial = 'menu') {
    /** @type {import('./EventBus.js').EventBus} */
    this.bus = bus;
    /** @type {GameStateName} */
    this.current = initial;
    /** @type {GameStateName|null} */
    this.previous = null;
    /** @type {Map<GameStateName, Set<(from: GameStateName) => void>>} */
    this._enterHooks = new Map();
    /** @type {Map<GameStateName, Set<(to: GameStateName) => void>>} */
    this._exitHooks = new Map();
  }

  /**
   * Register a callback fired when a state is entered.
   * @param {GameStateName} state
   * @param {(from: GameStateName) => void} fn
   * @returns {() => void} unsubscribe
   */
  onEnter(state, fn) {
    let set = this._enterHooks.get(state);
    if (!set) { set = new Set(); this._enterHooks.set(state, set); }
    set.add(fn);
    return () => { set.delete(fn); };
  }

  /**
   * Register a callback fired when a state is left.
   * @param {GameStateName} state
   * @param {(to: GameStateName) => void} fn
   * @returns {() => void} unsubscribe
   */
  onExit(state, fn) {
    let set = this._exitHooks.get(state);
    if (!set) { set = new Set(); this._exitHooks.set(state, set); }
    set.add(fn);
    return () => { set.delete(fn); };
  }

  /**
   * Whether a transition is declared legal.
   * @param {GameStateName} next
   * @returns {boolean}
   */
  canTransition(next) {
    return (TRANSITIONS[this.current] ?? []).includes(next);
  }

  /**
   * Perform a transition. Illegal transitions are rejected with a warning
   * rather than throwing, so a UI mishap can never hard-lock a run.
   * @param {GameStateName} next
   * @returns {boolean} true when the transition happened
   */
  transition(next) {
    if (next === this.current) return false;
    if (!this.canTransition(next)) {
      console.warn(`[StateMachine] illegal transition ${this.current} -> ${next}`);
      return false;
    }
    const from = this.current;
    for (const fn of this._exitHooks.get(from) ?? []) fn(next);
    this.previous = from;
    this.current = next;
    for (const fn of this._enterHooks.get(next) ?? []) fn(from);
    return true;
  }

  /**
   * Force a state without validation. Used on hard reset (new run) where
   * the previous state must not constrain us.
   * @param {GameStateName} next
   */
  force(next) {
    const from = this.current;
    for (const fn of this._exitHooks.get(from) ?? []) fn(next);
    this.previous = from;
    this.current = next;
    for (const fn of this._enterHooks.get(next) ?? []) fn(from);
  }

  /**
   * @param {GameStateName} state
   * @returns {boolean}
   */
  is(state) {
    return this.current === state;
  }

  /**
   * Any of the given states is active.
   * @param {GameStateName[]} states
   * @returns {boolean}
   */
  isAny(states) {
    return states.includes(this.current);
  }
}
