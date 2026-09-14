/**
 * @fileoverview Service container.
 *
 * SRP: hold service instances and hand them out by name.
 *
 * DIP: this is the seam that lets every system depend on abstractions it
 * receives rather than on concrete modules it imports. A system asks for
 * "combat" and receives whatever implements that role — which is what
 * makes the systems independently testable and replaceable (OCP).
 */

/** @typedef {string} ServiceName */

export class ServiceContainer {
  constructor() {
    /** @type {Map<ServiceName, any>} */
    this._services = new Map();
  }

  /**
   * Register a service under a name. Re-registering replaces it, which is
   * what makes runs restartable without rebuilding the container.
   * @template T
   * @param {ServiceName} name
   * @param {T} instance
   * @returns {T}
   */
  register(name, instance) {
    this._services.set(name, instance);
    return instance;
  }

  /**
   * Fetch a service.
   * @template T
   * @param {ServiceName} name
   * @returns {T}
   */
  get(name) {
    const svc = this._services.get(name);
    if (svc === undefined) {
      throw new Error(`[Services] "${name}" is not registered`);
    }
    return svc;
  }

  /**
   * Fetch a service that may legitimately be absent.
   * @template T
   * @param {ServiceName} name
   * @returns {T|undefined}
   */
  tryGet(name) {
    return this._services.get(name);
  }

  /**
   * @param {ServiceName} name
   * @returns {boolean}
   */
  has(name) {
    return this._services.has(name);
  }

  /**
   * Remove a service and return it.
   * @param {ServiceName} name
   * @returns {any}
   */
  remove(name) {
    const svc = this._services.get(name);
    this._services.delete(name);
    return svc;
  }

  /** @returns {ServiceName[]} */
  names() {
    return Array.from(this._services.keys());
  }

  /** Drop every registration. */
  clear() {
    this._services.clear();
  }
}

/**
 * Canonical service names, so the wiring is discoverable in one place.
 * @enum {string}
 */
export const SERVICES = {
  CONFIG: 'config',
  BUS: 'bus',
  STATE: 'state',
  INPUT: 'input',
  RANDOM: 'random',
  COMBAT: 'combat',
  COLLISION_WORLD: 'collisionWorld',
  PARTICLES: 'particles',
  EFFECTS: 'effects',
  PROJECTILES: 'projectiles',
  RENDER: 'render',
  CAMERA: 'camera',
  UI: 'ui',
  /**
   * Live mutable set of entities belonging to the current room. Registered
   * as a service so combat, AI, projectiles and rendering all share one
   * authoritative list instead of passing arrays around.
   */
  ENTITIES: 'entities',
  PROGRESSION: 'progression',
  RUN: 'run',
  SHOP: 'shop',
  DUNGEON: 'dungeon',
  ROOMS: 'rooms',
  SPAWNER: 'spawner',
  WEAPONS: 'weapons',
};

/** Shared container for the running application. */
export const services = new ServiceContainer();
