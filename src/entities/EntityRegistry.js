/**
 * @fileoverview Runtime entity registry.
 *
 * SRP: hold the live entity collections and answer "what is near here".
 * Nothing in this class applies damage or moves anything; it is the shared
 * source of truth that every system reads instead of passing arrays around.
 *
 * OCP: new entity categories can be added without touching the query
 * methods, because queries filter on the base `Entity` contract.
 */

import { Entity } from './Entity.js';
import { Player } from './Player.js';

export class EntityRegistry {
  constructor() {
    /** @type {Entity[]} everything except the player and projectiles */
    this.enemies = [];
    /** @type {Entity[]} enemy-owned projectiles live in ProjectileSystem */
    this.player = /** @type {Player|null} */ (null);
    /** @type {Entity[]} delayed area hazards (fire walls, meteor marks) */
    this.hazards = [];
    /** @type {any[]} drops on the floor (gold, weapons, upgrades) */
    this.pickups = [];
  }

  /**
   * @param {Player} player
   */
  setPlayer(player) {
    this.player = player;
  }

  /**
   * @param {Entity} enemy
   */
  addEnemy(enemy) {
    this.enemies.push(enemy);
  }

  /**
   * @param {Entity} hazard
   */
  addHazard(hazard) {
    this.hazards.push(hazard);
  }

  /**
   * @param {any} pickup
   */
  addPickup(pickup) {
    this.pickups.push(pickup);
  }

  /**
   * Remove dead/reaped entities. Death animation timing is owned by the
   * caller (RoomController), which sets `reapable`.
   */
  reap() {
    this.enemies = this.enemies.filter((e) => !e.reapable);
    this.hazards = this.hazards.filter((h) => !h.reapable);
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  /** Wipe everything — used when loading a new room. */
  clear() {
    this.enemies.length = 0;
    this.hazards.length = 0;
    this.pickups.length = 0;
  }

  /**
   * Living enemies only.
   * @returns {Entity[]}
   */
  livingEnemies() {
    return this.enemies.filter((e) => e.alive);
  }

  /**
   * @returns {boolean} true while at least one enemy is alive
   */
  hasLivingEnemies() {
    return this.enemies.some((e) => e.alive);
  }

  /**
   * Living enemies sorted by distance from a point.
   * @param {number} x
   * @param {number} y
   * @param {number} [maxRange] ignore enemies further than this
   * @returns {Entity[]}
   */
  enemiesNear(x, y, maxRange = Infinity) {
    const maxSq = maxRange === Infinity ? Infinity : maxRange * maxRange;
    return this.enemies
      .filter((e) => e.alive && (e.x - x) ** 2 + (e.y - y) ** 2 <= maxSq)
      .sort((a, b) => ((a.x - x) ** 2 + (a.y - y) ** 2) - ((b.x - x) ** 2 + (b.y - y) ** 2));
  }

  /**
   * The closest living enemy to a point.
   * @param {number} x
   * @param {number} y
   * @param {number} [maxRange]
   * @returns {Entity|null}
   */
  closestEnemy(x, y, maxRange = Infinity) {
    return this.enemiesNear(x, y, maxRange)[0] ?? null;
  }

  /**
   * Activate nearby hazards / collect nearby pickups. Kept here because
   * "which objects are within reach" is a registry question.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {any[]}
   */
  pickupsNear(x, y, radius) {
    const r2 = radius * radius;
    return this.pickups.filter((p) => !p.taken && (p.x - x) ** 2 + (p.y - y) ** 2 <= r2);
  }
}
