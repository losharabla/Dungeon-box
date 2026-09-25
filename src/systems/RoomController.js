/**
 * @fileoverview Room lifecycle: entrance, waves, clearing, doors, rewards.
 *
 * SRP: run the *rules* of one room — when doors seal, which wave is next,
 * when the room is cleared, and what happens on exit. It queries geometry
 * (Room), spawns via Spawner, and reports through the EventBus; it does not
 * draw and does not own the run's route.
 *
 * This is the only place that understands design-document §15-§18.
 */

import { EVENTS } from '../core/EventBus.js';
import { CONFIG } from '../core/Config.js';
import { rng } from '../core/Random.js';
import { Room } from '../entities/Room.js';
import { Barrel } from '../entities/Barrel.js';
import { getWeapon } from '../data/weapons.js';
import { getUpgrade, REWARD_UPGRADE_IDS } from '../data/upgrades.js';

/** Room dimensions per type, in world pixels. */
const ROOM_SIZES = {
  start: { w: 900, h: 620 },
  arena: { w: 1120, h: 760 },
  shop: { w: 820, h: 600 },
  healing: { w: 820, h: 600 },
  boss: { w: 1320, h: 900 },
};

/**
 * @typedef {object} RoomRuntime
 * @property {string} nodeId
 * @property {string} type
 * @property {Room} room
 * @property {number} floor       0-based floor this room belongs to
 * @property {number} waveIndex
 * @property {boolean} cleared
 * @property {number} spawnTimer
 * @property {boolean} wavePending   true while a wave countdown is running
 * @property {any[]} waveDefs
 * @property {boolean} bossSpawned
 * @property {any[]} reward
 * @property {any[]} shopStock
 * @property {boolean} visited
 */

export class RoomController {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   * @param {import('./Spawner.js').Spawner} deps.spawner
   * @param {import('../entities/Room.js').CollisionWorld} deps.collisionWorld
   * @param {import('./ProjectileSystem.js').ProjectileSystem} deps.projectiles
   * @param {import('../rendering/particleSystem.js').ParticleSystem} deps.particles
   * @param {import('./BossController.js').BossController} deps.bossController
   * @param {import('./LootSystem.js').LootSystem} deps.loot
   */
  constructor({
    bus, registry, spawner, collisionWorld, projectiles, particles, bossController, loot,
  }) {
    this.bus = bus;
    this.registry = registry;
    this.spawner = spawner;
    this.collisionWorld = collisionWorld;
    this.projectiles = projectiles;
    this.particles = particles;
    this.bossController = bossController;
    this.loot = loot;

    /** @type {RoomRuntime|null} */
    this.current = null;
  }

  /**
   * Enter a room, building its geometry and starting its content.
   *
   * The room's doors are the *offers* the floor dealt for the next step: each
   * one leads to the room that will exist only if the player takes it. A room
   * is entered exactly once, so there is nothing to replay.
   * @param {import('./DungeonGenerator.js').DungeonNode} node
   * @param {import('../entities/Player.js').Player} player
   * @param {number} floorIndex
   * @param {string} [bossId] which boss guards a 'boss' room
   * @param {object} [opts]
   * @param {import('./DungeonGenerator.js').FloorPlan|null} [opts.plan]
   *   the floor, so each door can be labelled with the room it leads to
   */
  enter(node, player, floorIndex, bossId = 'stone_golem', opts = {}) {
    const size = ROOM_SIZES[node.type] ?? ROOM_SIZES.arena;
    const room = new Room({
      id: `room_${node.id}`,
      type: node.type,
      roomWidth: size.w,
      roomHeight: size.h,
    });

    // Doors connect the room to the offers of the next step. The direction is
    // cosmetic (each room is its own arena) but it makes the layout read. Each
    // door carries the *type* of its destination, which is what the renderer
    // turns into the colour the player navigates by.
    const sides = /** @type {const} */ (['north', 'east', 'south', 'west']);
    const plan = opts.plan ?? null;

    const doorTargets = node.next.slice(0, sides.length);
    doorTargets.forEach((targetId, i) => {
      const offer = plan?.offers.get(targetId) ?? null;
      room.addDoor(sides[i], 0.5, String(targetId), {
        targetType: offer?.type ?? null,
        elite: offer?.elite === true,
      });
    });
    // Only the boss arena is allowed to have no doors: it is entered once, it
    // seals behind the player, and the floor ends when it is cleared. Any
    // other doorless room would trap the player, so it gets a way out.
    if (doorTargets.length === 0 && node.type !== 'boss') {
      room.addDoor('south', 0.5);
    }

    /** @type {RoomRuntime} */
    const runtime = {
      nodeId: String(node.id),
      type: node.type,
      room,
      floor: floorIndex,
      waveIndex: 0,
      cleared: false,
      spawnTimer: 0,
      wavePending: false,
      waveDefs: [],
      bossSpawned: false,
      reward: [],
      shopStock: [],
      visited: false,
    };
    this.current = runtime;

    // Reset the world for the new room.
    this.registry.clear();
    this.projectiles.clear();
    this.particles.clear();
    this.bossController.clear();
    this.collisionWorld.setRects(room.getCollisionRects(), room.bounds);

    // Place the player at the room's entry point.
    player.x = room.entry.x;
    player.y = room.entry.y;
    player.vx = 0;
    player.vy = 0;

    this._setupRoomContent(runtime, node, player, floorIndex, bossId);

    this.bus.emit(EVENTS.ROOM_ENTERED, { runtime, node, player });
  }

  /**
   * @param {RoomRuntime} runtime
   * @param {import('./DungeonGenerator.js').DungeonNode} node
   * @param {import('../entities/Player.js').Player} player
   * @param {number} floorIndex
   * @param {string} bossId
   */
  _setupRoomContent(runtime, node, player, floorIndex, bossId) {
    const room = runtime.room;
    this.spawner.setFloor(floorIndex);

    switch (node.type) {
      case 'arena': {
        runtime.waveDefs = this.spawner.buildWaves(node.arenaTier ?? 1);
        // Design doc §15: doors close when the player enters the arena.
        room.seal();
        runtime.spawnTimer = runtime.waveDefs[0].delay;
        runtime.wavePending = true;
        this._spawnBarrels(room);
        break;
      }

      case 'boss': {
        room.seal();
        const boss = this.spawner.spawnBoss(
          bossId,
          room.center.x,
          room.center.y - 120,
          floorIndex,
        );
        runtime.bossSpawned = true;
        // The harder variant is entered with an elite guard. It is the reason
        // the louder door exists: the fight is worse and the reward is better
        // (see `_bossReward`), so the choice is a real trade rather than a
        // strictly-worse option nobody would take.
        if (node.elite === true) {
          runtime.eliteBoss = true;
          this.spawner.spawnWave(
            { label: 'Boss Guard', count: CONFIG.room.bossGuardCount, elite: true, delay: 0 },
            player.x,
            player.y,
          );
        }
        this.bossController.attach(boss);
        this.bus.emit(EVENTS.BOSS_SPAWNED, { boss });
        break;
      }

      case 'healing': {
        // Design doc §16: heal 30% of max HP on entry, plus a small bonus.
        const healAmount = Math.round(player.maxHp * CONFIG.room.healingFraction);
        const healed = player.heal(healAmount);
        player.stats.healingReceived = (player.stats.healingReceived ?? 0) + healed;

        // The pool comes from the upgrade data (`source: 'reward'`), not from a
        // list repeated here: a new altar blessing used to need an edit in this
        // file as well, which is exactly the drift the data file exists to
        // prevent.
        const bonusId = rng.pickOne(REWARD_UPGRADE_IDS);
        runtime.reward = [{
          kind: 'upgrade', id: bonusId, name: '', desc: '', price: 0,
        }];
        runtime.healingAmount = healed;
        runtime.healingBonusId = bonusId;
        this.bus.emit(EVENTS.HEALING_TAKEN, { player, healed, bonusId });
        break;
      }

      case 'shop': {
        runtime.shopStock = this.loot.buildShopStock(player.classId, floorIndex, player.weaponId);
        break;
      }

      case 'start':
      default:
        // A quiet entry room: nothing to fight, doors stay open.
        break;
    }

    runtime.visited = true;
  }

  /**
   * Spawn a random number (2 to 4) of explosive barrels at random tactical positions in an arena.
   * Placed safely away from doors and the player's entry position.
   * Uses Math.random() so the global Spawner rng stream stays intact and deterministic.
   * @param {Room} room
   */
  _spawnBarrels(room) {
    const b = room.bounds;
    // Random count of barrels between 2 and 4 inclusive
    const count = 2 + Math.floor(Math.random() * 3);

    const marginX = 80;
    const marginY = 70;
    const minSeparation = 110;
    const minEntryDist = 130;

    const entryX = room.entry?.x ?? (b.x + b.w / 2);
    const entryY = room.entry?.y ?? (b.y + b.h - 30);

    const placed = [];
    const maxAttempts = 60;

    for (let i = 0; i < count; i++) {
      let bestPos = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = b.x + marginX + Math.random() * (b.w - marginX * 2);
        const y = b.y + marginY + Math.random() * (b.h - marginY * 2);

        // Keep distance from room entrance
        if (Math.hypot(x - entryX, y - entryY) < minEntryDist) continue;

        // Keep distance from any door
        let tooCloseToDoor = false;
        for (const door of room.doors) {
          const dx = (door.rect.x + door.rect.w / 2) - x;
          const dy = (door.rect.y + door.rect.h / 2) - y;
          if (Math.hypot(dx, dy) < 90) {
            tooCloseToDoor = true;
            break;
          }
        }
        if (tooCloseToDoor) continue;

        // Keep distance from already placed barrels
        let tooCloseToOther = false;
        for (const p of placed) {
          if (Math.hypot(x - p.x, y - p.y) < minSeparation) {
            tooCloseToOther = true;
            break;
          }
        }
        if (tooCloseToOther) continue;

        bestPos = { x, y };
        break;
      }

      if (bestPos) {
        placed.push(bestPos);
        this.registry.addBarrel(new Barrel(bestPos));
      }
    }
  }

  /**
   * Advance the room's rules by one step.
   * @param {number} dt
   * @param {import('../entities/Player.js').Player} player
   */
  update(dt, player) {
    const rt = this.current;
    if (!rt) return;

    rt.room.update(dt);

    if (rt.type === 'arena' && !rt.cleared) {
      this._updateArena(rt, dt, player);
    } else if (rt.type === 'boss' && !rt.cleared) {
      this._updateBossRoom(rt, player);
    }
  }

  /**
   * Advance one arena wave cycle (design doc §15: Wave 1 -> Wave 2 ->
   * Elite Wave -> Victory).
   *
   * The cycle is an explicit two-phase state machine driven by
   * `rt.wavePending`:
   *   pending  - a countdown runs, then the wave spawns and pending clears
   *   !pending - wait until the arena is empty, then arm the next countdown
   *
   * Overloading a single timer for both phases is what made the second wave
   * unreachable, so the phases are kept distinct.
   * @param {RoomRuntime} rt
   * @param {number} dt
   * @param {import('../entities/Player.js').Player} player
   */
  _updateArena(rt, dt, player) {
    // All waves have been spawned: the room is cleared once the arena is
    // empty of living enemies.
    if (rt.waveIndex >= rt.waveDefs.length) {
      if (!this.registry.hasLivingEnemies()) this._clearRoom(rt, player);
      return;
    }

    if (rt.wavePending) {
      rt.spawnTimer -= dt;
      if (rt.spawnTimer > 0) return;

      const wave = rt.waveDefs[rt.waveIndex];
      this.spawner.spawnWave(wave, player.x, player.y);
      rt.waveIndex++;
      rt.wavePending = false;
      rt.spawnTimer = 0;
      this.bus.emit(EVENTS.WAVE_STARTED, {
        label: wave.label,
        index: rt.waveIndex - 1,
        total: rt.waveDefs.length,
      });
      return;
    }

    // Between waves: once the arena is empty, arm the next one.
    if (!this.registry.hasLivingEnemies()) {
      rt.spawnTimer = rt.waveDefs[rt.waveIndex].delay;
      rt.wavePending = true;
    }
  }

  /**
   * @param {RoomRuntime} rt
   * @param {import('../entities/Player.js').Player} player
   */
  _updateBossRoom(rt, player) {
    const boss = this.registry.enemies.find((e) => e.kind === 'boss');
    if (!boss) {
      // The boss is gone: the arena opens (design doc §18).
      this._clearRoom(rt, player);
      return;
    }
    if (!boss.alive && boss.deathTimer > 1.1) {
      this._clearRoom(rt, player);
    }
  }

  /**
   * Mark the room cleared, open the doors and roll the reward.
   * @param {RoomRuntime} rt
   * @param {import('../entities/Player.js').Player} player
   */
  /**
   * Mark a room's content as finished without running the full clear path.
   *
   * Used by non-combat rooms (shop, healing) once their interaction has been
   * consumed. Doors are always opened here: a room whose content is done but
   * whose doors stay shut would trap the player forever.
   * @param {RoomRuntime} rt
   */
  markConsumed(rt) {
    rt.cleared = true;
    rt.room.unseal();
    this.bus.emit(EVENTS.PORTAL_OPENED, { runtime: rt });
  }

  /**
   * Mark the room cleared, open the doors and roll the reward.
   * @param {RoomRuntime} rt
   * @param {import('../entities/Player.js').Player} player
   */
  _clearRoom(rt, player) {
    if (rt.cleared) return;
    rt.cleared = true;
    rt.room.unseal();
    player.stats.roomsCleared++;
    if (rt.type === 'arena') {
      rt.reward = this.loot.rollArenaReward(player.classId, rt.floor ?? 0, false, player.weaponId);
    } else if (rt.type === 'boss') {
      rt.reward = this._bossReward(player, rt.eliteBoss === true);
    }

    this.bus.emit(EVENTS.ROOM_CLEARED, { runtime: rt, player });
    this.bus.emit(EVENTS.PORTAL_OPENED, { runtime: rt });
  }

  /**
   * Boss rooms pay out gold plus a weapon offer (design doc §18).
   *
   * The roll lives in LootSystem: this class runs room rules, and what
   * drops from what is content generation.
   * @param {import('../entities/Player.js').Player} player
   * @param {boolean} [elite] the boss was fought with its elite guard
   * @returns {any[]}
   */
  _bossReward(player, elite = false) {
    return this.loot.rollBossReward(player.classId, elite, player.weaponId);
  }

  /**
   * Take a reward choice and apply it.
   * @param {import('../entities/Player.js').Player} player
   * @param {any} choice
   */
  takeReward(player, choice) {
    // Rewards are single-use. Validate that this choice belongs to the active
    // room before applying it, so double clicks or stale overlay callbacks
    // cannot duplicate weapons, upgrades, or gold.
    if (!choice || !this.current || !Array.isArray(this.current.reward)) return false;
    if (!this.current.reward.includes(choice)) return false;

    this._applyLoot(player, choice);
    this.current.reward = [];
    return true;
  }

  /**
   * Apply any loot entry to the player. Shared by rewards, the shop and
   * floor pickups.
   * @param {import('../entities/Player.js').Player} player
   * @param {any} entry
   */
  _applyLoot(player, entry) {
    switch (entry.kind) {
      case 'weapon': {
        const w = getWeapon(entry.id);
        player.equip(w);
        this.bus.emit(EVENTS.WEAPON_PICKED, { player, weapon: w });
        break;
      }
      case 'upgrade': {
        const up = getUpgrade(entry.id);
        up.apply(player);
        this.bus.emit(EVENTS.UPGRADE_TAKEN, { player, upgrade: up });
        break;
      }
      case 'potion': {
        const fraction = entry.id === 'greater_potion' ? 1 : 0.4;
        const healed = player.heal(player.maxHp * fraction);
        this.bus.emit(EVENTS.PLAYER_HEALED, { player, amount: healed });
        this.particles.burst('heal', player.x, player.y, 12, { speed: 110 });
        break;
      }
      case 'gold': {
        const amount = 40 + Math.floor(Math.random() * 60);
        player.addGold(amount);
        this.bus.emit(EVENTS.GOLD_CHANGED, { gold: player.gold, delta: amount });
        break;
      }
      default:
        break;
    }
  }

  /**
   * Buy an item from the current shop stock.
   * @param {import('../entities/Player.js').Player} player
   * @param {any} item
   * @returns {boolean} whether the purchase succeeded
   */
  purchase(player, item) {
    if (!item || item.sold) return false;
    if (!player.canAfford(item.price)) return false;
    if (!player.spend(item.price)) return false;

    item.sold = true;
    this._applyLoot(player, item);
    this.bus.emit(EVENTS.SHOP_PURCHASE, { player, item });
    this.bus.emit(EVENTS.GOLD_CHANGED, { gold: player.gold, delta: -item.price });
    return true;
  }

  /** @returns {RoomRuntime|null} */
  get runtime() {
    return this.current;
  }
}
