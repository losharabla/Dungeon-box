/**
 * @fileoverview Floor layout: a straight run of rooms from the entrance to
 * the boss, where every room is a *choice*.
 *
 * SRP: decide what a floor offers at each step. It does not build geometry,
 * spawn enemies, or track the player.
 *
 * Design (design doc §19, adapted after play-testing):
 *
 *   start -> [ 2-3 choices ] -> [ 2-3 choices ] -> ... -> boss
 *
 * The route to the boss is a fixed number of rooms — the player never skips
 * a step, because a door leads to the *next* room on a straight path. What
 * the player chooses is *which* room that step is: a normal arena, a harder
 * arena, a shop or a healing altar. Entering one door consumes the others
 * forever; the rooms behind them are never built and are dropped from the
 * floor.
 *
 * Nothing is generated ahead of the current step. A room exists as a single
 * offer, and only becomes a real room when a door is taken, so no interface
 * can leak rooms the player has not chosen yet.
 */

import { rng } from '../core/Random.js';

/** @typedef {'start'|'arena'|'shop'|'healing'|'boss'} RoomType */

/**
 * @typedef {object} RoomOffer
 * @property {number} id
 * @property {RoomType} type
 * @property {number} depth      1 = first room after the entrance
 * @property {number} arenaTier  1 = early waves, 2 = late waves
 * @property {boolean} elite     the harder variant of its type
 */

/**
 * @typedef {object} DungeonNode
 * @property {number} id
 * @property {RoomType} type
 * @property {number} depth
 * @property {number} arenaTier
 * @property {boolean} elite
 * @property {number[]} next      ids of the rooms this one offers
 */

/**
 * @typedef {object} FloorPlan
 * @property {number} floorIndex
 * @property {number} seed
 * @property {number} layers     rooms on the straight path, boss included
 * @property {string[]} kinds    per-depth recipe: start|arena1|arena2|support|boss
 * @property {number} startId
 * @property {number} bossId
 * @property {number} bossDepth
 * @property {DungeonNode[]} nodes  rooms actually entered, in order
 * @property {Map<number, RoomOffer>} offers  every room that currently exists
 */

/** Fewest doors a room must offer. */
export const MIN_CHOICES = 2;
/** Most doors a room may offer. */
export const MAX_CHOICES = 3;

/**
 * Room ids encode their position: `depth * 10 + slot`. Ids never collide, and
 * the boss id is known from the first frame without building anything.
 * @param {number} depth
 * @param {number} slot
 * @returns {number}
 */
function idFor(depth, slot) {
  return depth * 10 + slot;
}

/**
 * Create a floor. This rolls the *shape* of the route (how many steps, and
 * what kind of step each one is) — not its rooms.
 * @param {number} [floorIndex] 0-based; later floors are longer and harder
 * @param {number} [seed]
 * @returns {FloorPlan}
 */
export function createFloor(floorIndex = 0, seed = Math.floor(Math.random() * 1e9)) {
  rng.seed = seed >>> 0;
  rng.reset();

  const earlyCount = rng.int(2, 4);
  const lateCount = rng.int(2, 4);
  // A second support step on later floors, because a longer, harder floor
  // needs more than one chance to restock.
  const extraSupport = floorIndex > 0 && rng.chance(0.6);

  /** @type {string[]} */
  const kinds = ['start'];
  for (let i = 0; i < earlyCount; i++) kinds.push('arena1');
  kinds.push('support');
  for (let i = 0; i < lateCount; i++) kinds.push('arena2');
  if (extraSupport) kinds.push('support');
  kinds.push('boss');

  const layers = kinds.length;
  const bossDepth = layers - 1;

  /** @type {FloorPlan} */
  const plan = {
    floorIndex,
    seed,
    layers,
    kinds,
    startId: idFor(0, 0),
    bossId: idFor(bossDepth, 0),
    bossDepth,
    nodes: [],
    offers: new Map(),
  };

  // The entrance and the boss are fixed points of the route, so they exist
  // from the start; everything between them is offered one step at a time.
  plan.offers.set(plan.startId, { id: plan.startId, type: 'start', depth: 0, arenaTier: 1, elite: false });
  plan.offers.set(plan.bossId, { id: plan.bossId, type: 'boss', depth: bossDepth, arenaTier: 1, elite: false });

  return plan;
}

/**
 * The `MIN_CHOICES`-`MAX_CHOICES` rooms offered at `depth`.
 *
 * An arena step always offers at least one arena, so a player who wants to
 * fight always can, and may also offer a harder arena, a shop or a healing
 * altar — that is the risk/reward decision the door colour communicates.
 * A support step offers the two support rooms, and the boss step offers the
 * boss alone.
 *
 * @param {FloorPlan} plan
 * @param {number} depth
 * @returns {RoomOffer[]}
 */
export function rollOffers(plan, depth) {
  const kind = plan.kinds[depth];
  if (!kind) return [];

  if (kind === 'boss') {
    // The floor ends with a choice too: the boss, or the same boss entered
    // with an elite guard for a much better shot at a legendary. Without the
    // second door the room before the boss would be the one step with nothing
    // to decide — a straight path to a single boss has no other choice to
    // offer, and an arena full of identical doors would not be a decision.
    return [
      { id: idFor(depth, 0), type: 'boss', depth, arenaTier: 1, elite: false },
      { id: idFor(depth, 1), type: 'boss', depth, arenaTier: 2, elite: true },
    ];
  }

  if (kind === 'support') {
    // Which support the player takes is itself a choice: sustain or shopping.
    const order = rng.chance(0.5) ? ['shop', 'healing'] : ['healing', 'shop'];
    return order.map((type, slot) => ({
      id: idFor(depth, slot),
      type: /** @type {RoomType} */ (type),
      depth,
      arenaTier: 1,
      elite: false,
    }));
  }

  const tier = kind === 'arena2' ? 2 : 1;
  const count = rng.int(MIN_CHOICES, MAX_CHOICES);
  /** @type {RoomOffer[]} */
  const offers = [{ id: idFor(depth, 0), type: 'arena', depth, arenaTier: tier, elite: false }];

  /** @type {Array<{type: RoomType, arenaTier: number, elite: boolean}>} */
  const pool = [];
  // A harder arena is only "harder" while there is a higher tier to reach;
  // it is marked elite so its door reads as the dangerous option.
  if (tier < 2) pool.push({ type: 'arena', arenaTier: tier + 1, elite: true });
  pool.push({ type: 'shop', arenaTier: tier, elite: false });
  pool.push({ type: 'healing', arenaTier: tier, elite: false });

  const picks = rng.sample(pool, Math.min(count - 1, pool.length));
  picks.forEach((pick, i) => {
    offers.push({
      id: idFor(depth, i + 1),
      type: pick.type,
      depth,
      arenaTier: pick.arenaTier,
      elite: pick.elite,
    });
  });
  return offers;
}

/**
 * Every room that currently exists under this id.
 * @param {FloorPlan} plan
 * @param {number} id
 * @returns {RoomOffer|null}
 */
export function offerById(plan, id) {
  return plan.offers.get(id) ?? null;
}

/**
 * A room that has already been entered.
 * @param {FloorPlan} plan
 * @param {number} id
 * @returns {DungeonNode}
 */
export function getNode(plan, id) {
  const node = plan.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Room ${id} has not been entered on this floor`);
  return node;
}

/**
 * Rooms on the straight path from the entrance to the boss. With the choice
 * model this is simply the floor's length: the player cannot skip a step, so
 * this is both the route length and the number of rooms a clean run visits.
 * @param {FloorPlan} plan
 * @returns {number}
 */
export function pathLength(plan) {
  return plan.layers;
}

/**
 * How many arena rooms the floor's path can contain at most, for pacing.
 * @param {FloorPlan} plan
 * @returns {number}
 */
export function arenaCount(plan) {
  return plan.kinds.filter((k) => k.startsWith('arena')).length;
}
