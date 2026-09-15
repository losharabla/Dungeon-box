/**
 * @fileoverview Publish/subscribe message hub.
 *
 * SRP: the EventBus transports messages. It knows nothing about combat,
 * rendering or game rules.
 *
 * OCP/DIP: systems depend on this abstraction instead of on each other.
 * Adding a new reaction to "enemy died" means subscribing a new listener,
 * never editing CombatSystem.
 */

/**
 * @callback EventHandler
 * @param {any} payload
 * @returns {void}
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<EventHandler>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {EventHandler} handler
   * @returns {() => void} unsubscribe function
   */
  on(event, handler) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe for exactly one delivery.
   *
   * The wrapper removes itself before calling through, so a handler that
   * throws cannot leave the subscription behind (which would otherwise grow
   * the listener set without bound).
   * @param {string} event
   * @param {EventHandler} handler
   * @returns {() => void} unsubscribe function
   */
  once(event, handler) {
    const wrapper = (/** @type {any} */ payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove a subscription.
   * @param {string} event
   * @param {EventHandler} handler
   */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(event);
  }

  /**
   * Publish an event synchronously.
   *
   * Two guarantees matter for correctness:
   *  1. A throwing listener must not abort the rest of the delivery, so
   *     each handler is isolated and failures go to the console.
   *  2. A listener that unsubscribes another listener during dispatch must
   *     actually prevent that listener from being called, so membership is
   *     re-checked against the live set before each invocation.
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    // Snapshot first: handlers are allowed to mutate the set during dispatch.
    for (const handler of Array.from(set)) {
      // Re-check membership so a handler removed by an earlier handler in
      // this same dispatch is skipped.
      if (!set.has(handler)) continue;
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${event}" threw:`, err);
      }
    }
  }

  /**
   * Remove every subscription, or every subscription of one event.
   * @param {string} [event]
   */
  clear(event) {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
  }

  /**
   * Number of listeners registered for an event (used by tests/diagnostics).
   * @param {string} event
   * @returns {number}
   */
  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }
}

/**
 * Canonical event names. Using constants instead of raw strings keeps a
 * typo from silently creating a dead channel.
 * @enum {string}
 */
export const EVENTS = {
  // --- lifecycle ---
  RUN_STARTED: 'run:started',
  RUN_ENDED: 'run:ended',
  FLOOR_STARTED: 'floor:started',
  STATE_CHANGED: 'state:changed',

  // --- combat ---
  DAMAGE_DEALT: 'combat:damageDealt',
  ENTITY_DIED: 'combat:entityDied',
  PLAYER_DAMAGED: 'combat:playerDamaged',
  PLAYER_HEALED: 'combat:playerHealed',
  ATTACK_PERFORMED: 'combat:attackPerformed',
  STATUS_APPLIED: 'combat:statusApplied',
  /** A dash burst started. Presentation-only: audio, trails, diagnostics. */
  DASHED: 'combat:dashed',
  /** A beam started firing (rising edge only, not once per tick). */
  BEAM_STARTED: 'combat:beamStarted',
  /** A beam stopped firing. */
  BEAM_STOPPED: 'combat:beamStopped',
  /** The heat gauge filled and the staff locked itself out. */
  BEAM_OVERHEATED: 'combat:beamOverheated',

  // --- economy / progression ---
  GOLD_CHANGED: 'economy:goldChanged',
  WEAPON_PICKED: 'progression:weaponPicked',
  UPGRADE_TAKEN: 'progression:upgradeTaken',
  ULTIMATE_CHANGED: 'progression:ultimateChanged',
  ULTIMATE_ACTIVATED: 'progression:ultimateActivated',

  // --- rooms ---
  ROOM_ENTERED: 'room:entered',
  ROOM_CLEARED: 'room:cleared',
  WAVE_STARTED: 'room:waveStarted',
  BOSS_SPAWNED: 'room:bossSpawned',
  BOSS_PHASE: 'room:bossPhase',
  PORTAL_OPENED: 'room:portalOpened',

  // --- presentation ---
  SHAKE_REQUESTED: 'fx:shake',
  FLOATING_TEXT: 'fx:floatingText',
  HIT_STOP: 'fx:hitStop',
  NOTICE: 'ui:notice',

  // --- shop ---
  SHOP_OPENED: 'shop:opened',
  SHOP_PURCHASE: 'shop:purchase',
  HEALING_TAKEN: 'room:healingTaken',
};
