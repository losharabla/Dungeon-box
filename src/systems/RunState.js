/**
 * @fileoverview Run state: the current floor, the room being played, and the
 * doors out of it.
 *
 * SRP: own "where is this run and what happens next". The floor's shape comes
 * from DungeonGenerator and the room's rules from RoomController; this class
 * only decides which room the player is in and which rooms they may enter.
 *
 * The floor is a *straight run of choices*: the room being played offers
 * `MIN_CHOICES`-`MAX_CHOICES` doors, each leading to the next room on the
 * path. Taking one consumes the others — they are dropped from the floor and
 * are never built — so a step is always exactly one room and the route to the
 * boss is never shortened or skipped.
 */

import { EVENTS } from '../core/EventBus.js';
import { CONFIG } from '../core/Config.js';
import { createFloor, rollOffers, offerById } from './DungeonGenerator.js';

export class RunState {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('./RoomController.js').RoomController} deps.rooms
   */
  constructor({ bus, rooms }) {
    this.bus = bus;
    this.rooms = rooms;

    this.active = false;
    this.floorIndex = 0;
    /** @type {import('./DungeonGenerator.js').FloorPlan|null} */
    this.plan = null;
    this.currentNodeId = -1;
    /** @type {import('./DungeonGenerator.js').DungeonNode|null} */
    this._current = null;

    /** Node ids the player has been in, kept for stats and diagnostics. */
    /** @type {Set<number>} */
    this.visitedNodes = new Set();
    /** @type {Set<number>} */
    this.clearedNodes = new Set();

    this.startedAt = 0;
    this.elapsed = 0;
  }

  /**
   * Begin a fresh run on floor 0.
   * @param {import('../entities/Player.js').Player} player
   * @param {number} [seed]
   */
  start(player, seed = Math.floor(Math.random() * 1e9)) {
    this.active = true;
    this.floorIndex = 0;
    this.visitedNodes.clear();
    this.clearedNodes.clear();
    this.elapsed = 0;
    this.startedAt = performance.now() / 1000;

    // The floor is rolled as a *shape* (steps and their kinds); its rooms are
    // offered one step at a time as the player walks it.
    this.plan = createFloor(this.floorIndex, seed);
    this.bus.emit(EVENTS.FLOOR_STARTED, { floor: this.floorIndex, plan: this.plan });
    this.enterRoom(this.plan.startId, player);
    this.bus.emit(EVENTS.RUN_STARTED, { player, seed });
  }

  /**
   * Advance to the next floor once a boss is beaten (design doc §18).
   * @param {import('../entities/Player.js').Player} player
   */
  nextFloor(player) {
    this.floorIndex++;
    this.visitedNodes.clear();
    this.clearedNodes.clear();
    this.plan = createFloor(this.floorIndex, Math.floor(Math.random() * 1e9));
    this.bus.emit(EVENTS.FLOOR_STARTED, { floor: this.floorIndex, plan: this.plan });
    this.enterRoom(this.plan.startId, player);
  }

  /**
   * Open a room and deal the doors out of it.
   *
   * This is the only place a room is created. The offers of the next step are
   * rolled *now*, one step ahead — never the whole floor — and every offer
   * that is not one of this room's doors is dropped, which is what makes a
   * choice final.
   * @param {number} roomId
   * @param {import('../entities/Player.js').Player} player
   */
  enterRoom(roomId, player) {
    const plan = this.plan;
    if (!plan) return;
    const offer = offerById(plan, roomId);
    if (!offer) {
      console.warn(`[RunState] room ${roomId} does not exist on this floor`);
      return;
    }

    /** @type {import('./DungeonGenerator.js').DungeonNode} */
    const node = {
      id: offer.id,
      type: offer.type,
      depth: offer.depth,
      arenaTier: offer.arenaTier,
      elite: offer.elite === true,
      next: [],
    };
    plan.nodes.push(node);
    plan.currentId = node.id;
    this._current = node;
    this.currentNodeId = node.id;
    this.visitedNodes.add(node.id);

    // Deal the next step's doors, then destroy the road not taken.
    const offers = rollOffers(plan, node.depth + 1);
    for (const next of offers) plan.offers.set(next.id, next);
    node.next = offers.map((o) => o.id);
    this._discardOtherOffers(node.next);

    // The boss rotates with the floor (design doc §12-14).
    this.rooms.enter(node, player, this.floorIndex, bossIdForFloor(this.floorIndex), {
      plan,
    });
  }

  /**
   * Drop every room that is not one of the doors just dealt.
   *
   * The entrance and the boss are permanent points of the floor, so they are
   * kept; everything else the player passed by ceases to exist, which is what
   * "the room you did not enter is gone" means in data rather than in prose.
   * @param {number[]} keep
   */
  _discardOtherOffers(keep) {
    const plan = this.plan;
    if (!plan) return;
    const keepSet = new Set(keep);
    keepSet.add(plan.startId);
    keepSet.add(plan.bossId);
    for (const id of Array.from(plan.offers.keys())) {
      if (!keepSet.has(id)) plan.offers.delete(id);
    }
  }

  /**
   * The room the player is currently in.
   * @returns {import('./DungeonGenerator.js').DungeonNode|null}
   */
  currentNode() {
    return this._current;
  }

  /**
   * Nodes reachable from here — the doors the player may take.
   * @returns {import('./DungeonGenerator.js').RoomOffer[]}
   */
  exits() {
    const node = this.currentNode();
    const plan = this.plan;
    if (!node || !plan) return [];
    /** @type {import('./DungeonGenerator.js').RoomOffer[]} */
    const out = [];
    for (const id of node.next) {
      const offer = offerById(plan, id);
      if (offer) out.push(offer);
    }
    return out;
  }

  /**
   * Whether the boss on this floor is the last one of the campaign.
   * @returns {boolean}
   */
  isLastFloor() {
    return this.floorIndex >= CONFIG.run.floors - 1;
  }

  /**
   * Whether the current room's content is finished.
   * @returns {boolean}
   */
  currentRoomCleared() {
    return this.rooms.runtime?.cleared ?? false;
  }

  /**
   * Mark the current node cleared.
   */
  markCleared() {
    if (this.currentNodeId >= 0) this.clearedNodes.add(this.currentNodeId);
  }

  /**
   * Leave through a door toward a room the current one offers.
   *
   * The player-facing path: a door that is not one of this room's doors is
   * refused, so the choice made earlier cannot be undone.
   * @param {number} targetRoomId
   * @param {import('../entities/Player.js').Player} player
   */
  travelTo(targetRoomId, player) {
    const node = this.currentNode();
    if (!node || !node.next.includes(targetRoomId)) {
      console.warn(`[RunState] ${targetRoomId} is not one of the doors out of ${this.currentNodeId}`);
      return;
    }
    this.enterRoom(targetRoomId, player);
  }

  /**
   * Low-level entry used by tooling and tests: open a specific room even if
   * it is not currently offered (for example to measure the boss arena).
   * Player movement always goes through `travelTo`.
   * @param {number} roomId
   * @param {import('../entities/Player.js').Player} player
   */
  enterNode(roomId, player) {
    this.enterRoom(roomId, player);
  }

  /**
   * Progress 0..1 along the straight path to the boss, for the HUD.
   * @returns {number}
   */
  progress() {
    const node = this.currentNode();
    const total = Math.max(1, this.layers - 1);
    if (!node) return 0;
    return Math.min(1, node.depth / total);
  }

  /** @returns {number} rooms on the floor's straight path, boss included */
  get layers() {
    return this.plan?.layers ?? 0;
  }

  /** @returns {number} how far along that path the player is (0 = entrance) */
  get depth() {
    return this.currentNode()?.depth ?? 0;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    if (this.active) this.elapsed += dt;
  }

  /**
   * End the run.
   * @param {'death'|'victory'|'abandon'} reason
   * @param {import('../entities/Player.js').Player} player
   */
  end(reason, player) {
    this.active = false;
    this.bus.emit(EVENTS.RUN_ENDED, { reason, player, stats: player.stats, elapsed: this.elapsed });
  }
}

/**
 * Boss rotation (design doc §12-14): each floor has its own boss.
 * @param {number} floorIndex
 * @returns {string}
 */
export function bossIdForFloor(floorIndex) {
  const order = ['stone_golem', 'fire_lord', 'executioner'];
  return order[Math.min(floorIndex, order.length - 1)] ?? 'stone_golem';
}
