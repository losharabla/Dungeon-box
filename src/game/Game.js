/**
 * @fileoverview The game orchestrator.
 *
 * SRP: own the *composition* of a run and the fixed-step update order. It
 * wires systems together, sequences their updates, and routes UI intents to
 * the right system. It contains no game rules of its own — every decision
 * lives in a system.
 *
 * This is the only module that knows the order in which things happen:
 * input -> AI -> combat -> projectiles -> movement -> room rules -> effects.
 */

import { CONFIG } from '../core/Config.js';
import { EVENTS } from '../core/EventBus.js';
import { Player } from '../entities/Player.js';
import { EntityRegistry } from '../entities/EntityRegistry.js';
import { CollisionWorld } from '../entities/Room.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { CombatCoordinator, registerBossBehaviour } from '../systems/CombatCoordinator.js';
import { BeamSystem } from '../systems/BeamSystem.js';
import { ProjectileSystem } from '../systems/ProjectileSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { AISystem } from '../systems/AISystem.js';
import { Spawner } from '../systems/Spawner.js';
import { LootSystem } from '../systems/LootSystem.js';
import { RoomController } from '../systems/RoomController.js';
import { BossController } from '../systems/BossController.js';
import { RunState } from '../systems/RunState.js';
import { UltimateSystem } from '../systems/UltimateSystem.js';
import { ParticleSystem } from '../rendering/particleSystem.js';
import { DecalLayer } from '../rendering/decals.js';
import { FloatingTextSystem, ScreenFlashSystem } from '../rendering/textEffects.js';
import { Camera } from '../rendering/RenderSystem.js';
import { getClass } from '../data/classes.js';

/**
 * @typedef {object} GameCallbacks
 * @property {(name: string) => void} onStateChange
 * @property {(runtime: any) => void} onRoomCleared
 * @property {(boss: any) => void} onBossSpawned
 * @property {() => void} onPlayerDeath
 * @property {(text: string) => void} onNotice
 */

export class Game {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   * @param {import('../core/StateMachine.js').StateMachine} deps.state
   * @param {GameCallbacks} deps.callbacks
   * @param {Camera} [deps.camera] shared camera owned by the composition root
   */
  constructor({ bus, state, callbacks, camera }) {
    this.bus = bus;
    this.state = state;
    this.callbacks = callbacks;

    // --- World ----------------------------------------------------------
    this.registry = new EntityRegistry();
    this.collisionWorld = new CollisionWorld();
    // Injected, not constructed here. The renderer reads the camera to place
    // the world, so the simulation and the renderer must hold the *same*
    // object; if Game makes its own, the renderer silently draws from a
    // camera nobody ever moves. Headless harnesses may omit it and get a
    // private one, since nothing else reads theirs.
    this.camera = camera ?? new Camera();

    // --- Presentation-only systems ---------------------------------------
    this.particles = new ParticleSystem(1600);
    this.floatingText = new FloatingTextSystem(160);
    this.screenFlash = new ScreenFlashSystem();
    this.decals = new DecalLayer(CONFIG.render.decalCapacity);

    // --- Simulation systems ----------------------------------------------
    this.combat = new CombatSystem({
      bus,
      registry: this.registry,
      particles: this.particles,
      floatingText: this.floatingText,
      decals: this.decals,
      random: () => Math.random(),
    });

    this.projectiles = new ProjectileSystem({
      registry: this.registry,
      collisionWorld: this.collisionWorld,
      combat: this.combat,
      particles: this.particles,
      bus,
    });

    this.movement = new MovementSystem({
      collisionWorld: this.collisionWorld,
      registry: this.registry,
    });

    this.spawner = new Spawner({
      registry: this.registry,
      getRoom: () => this.rooms.runtime?.room ?? this._emptyRoom,
    });

    this.bossController = new BossController({
      registry: this.registry,
      combat: this.combat,
      projectiles: this.projectiles,
      collisionWorld: this.collisionWorld,
      bus,
      spawnEnemy: (typeId, x, y) => this.spawner.spawnEnemy(typeId, x, y),
    });

    this.rooms = new RoomController({
      bus,
      registry: this.registry,
      spawner: this.spawner,
      collisionWorld: this.collisionWorld,
      projectiles: this.projectiles,
      particles: this.particles,
      bossController: this.bossController,
      loot: new LootSystem(),
    });

    this.run = new RunState({ bus, rooms: this.rooms });

    this.ultimates = new UltimateSystem({
      combat: this.combat,
      projectiles: this.projectiles,
      bus,
      screenFlash: this.screenFlash,
    });

    this.ai = new AISystem({
      player: null,
      registry: this.registry,
      movement: this.movement,
      combat: this.combat,
      projectiles: this.projectiles,
      collisionWorld: this.collisionWorld,
      spawnEnemy: (typeId, x, y) => this.spawner.spawnEnemy(typeId, x, y),
    });

    this.coordinator = new CombatCoordinator({
      combat: this.combat,
      projectiles: this.projectiles,
      bus,
      triggerUltimate: (id, player, aim) => this.ultimates.activate(id, player, aim),
    });

    // The other half of a magic weapon: the held beam on the right button.
    this.beam = new BeamSystem({
      combat: this.combat,
      collisionWorld: this.collisionWorld,
      registry: this.registry,
      bus,
    });

    // Bosses share the ordinary AI loop through a registered behaviour.
    registerBossBehaviour();

    /** @type {Player|null} */
    this.player = null;
    /** Fallback room so the spawner never dereferences null. */
    this._emptyRoom = /** @type {any} */ ({ spawnPoints: [{ x: 0, y: 0 }] });

    /** Screen-shake requests accumulate here and are drained each frame. */
    this._pendingShake = 0;
    /** Hit-stop freezes the simulation briefly for impact weight. */
    this._hitStop = 0;

    this._wireEvents();
  }

  /**
   * Subscribe to the events this orchestrator must react to.
   */
  _wireEvents() {
    this.bus.on(EVENTS.SHAKE_REQUESTED, (amount) => {
      this._pendingShake += Number(amount) || 0;
    });

    // A brief simulation freeze on huge impacts (crit kill, boss phase). The
    // request arrives as an event so combat code never has to reach back into
    // the orchestrator; `seconds` is clamped here so no single hit can stall
    // the game for more than a few frames.
    this.bus.on(EVENTS.HIT_STOP, (seconds) => {
      const s = Number(seconds) || 0;
      if (s > 0) this._hitStop = Math.max(this._hitStop, Math.min(0.09, s));
    });

    this.bus.on(EVENTS.ENTITY_DIED, ({ entity }) => {
      if (entity && entity.faction === 'player') {
        this.callbacks.onPlayerDeath();
      }
    });

    this.bus.on(EVENTS.ROOM_CLEARED, ({ runtime }) => {
      this.run.markCleared();
      this.callbacks.onRoomCleared(runtime);
    });

    this.bus.on(EVENTS.BOSS_SPAWNED, ({ boss }) => {
      this.camera.addShake(12);
      this.callbacks.onBossSpawned(boss);
    });

    this.bus.on(EVENTS.BOSS_PHASE, () => {
      this.screenFlash.flash(0.4, '#ff5a3c');
    });

    this.bus.on(EVENTS.NOTICE, ({ text }) => {
      this.callbacks.onNotice(text);
    });
  }

  /* ============================================================
     Run lifecycle
     ============================================================ */

  /**
   * Begin a new run with a freshly built player.
   * @param {string} classId
   * @param {string} ultimateId
   * @param {number} [seed]
   */
  startRun(classId, ultimateId, seed) {
    this._resetWorld();

    this.player = new Player({
      classId,
      x: 0,
      y: 0,
      ultimateId,
    });
    this.registry.setPlayer(this.player);
    this.ai.ctx.player = this.player;

    this.run.start(this.player, seed);
    this.camera.follow(this.player.x, this.player.y, true);
    this._snapCameraToPlayer();
  }

  /**
   * Advance to the next floor from the victory screen.
   */
  nextFloor() {
    if (!this.player) return;
    this._resetWorld();
    this.player.hp = this.player.maxHp;
    this.player.ultCharge = 0;
    this.player.status.clear();
    this.registry.setPlayer(this.player);
    this.ai.ctx.player = this.player;
    this.run.nextFloor(this.player);
    this.camera.follow(this.player.x, this.player.y, true);
    this._snapCameraToPlayer();
  }

  /**
   * Clear every transient system so a new run cannot inherit stale state.
   */
  _resetWorld() {
    this.registry.clear();
    this.projectiles.clear();
    this.particles.clear();
    this.floatingText.clear();
    this.screenFlash.clear();
    this.decals.clear();
    this.bossController.clear();
    this.ultimates.clear(this.player);
    this.collisionWorld.clear();
    this._pendingShake = 0;
    this._hitStop = 0;
  }

  /**
   * Point the camera at the player immediately, skipping the easing.
   *
   * Used on run start and on entering a room, so the view does not slide
   * across the world from wherever it happened to be.
   */
  _snapCameraToPlayer() {
    if (!this.player) return;
    this.camera.follow(this.player.x, this.player.y, true);
  }

  /* ============================================================
     Fixed-step update
     ============================================================ */

  /**
   * One simulation step.
   * @param {number} dt
   * @param {object} input
   * @param {boolean} input.attackHeld
   * @param {boolean} input.attackPressed
   * @param {boolean} input.beamHeld  magic weapons: the right-button beam
   * @param {boolean} input.ultPressed
   * @param {boolean} input.dashPressed
   * @param {{x: number, y: number}} input.move
   * @param {{x: number, y: number}} input.aim  screen-space cursor
   */
  update(dt, input) {
    const player = this.player;
    if (!player) return;

    // Refill the per-step particle allowance before any system can emit, so
    // the cap bounds the cost of one step rather than the whole population.
    this.particles.beginStep();

    // Drain screen shake into the camera (design doc §25).
    if (this._pendingShake > 0) {
      this.camera.addShake(this._pendingShake);
      this._pendingShake = 0;
    }

    // Boss encounters may request a brief freeze after a heavy impact.
    if (this._hitStop > 0) {
      this._hitStop -= dt;
      this.camera.update(dt);
      return;
    }

    const aimWorld = this.camera.screenToWorld(input.aim.x, input.aim.y);
    // Standing dash must use this step's cursor, not last step's facing.
    player.lookAt(aimWorld.x, aimWorld.y);

    // --- 1. Player intent and attacks -----------------------------------
    const moveVector = player.alive && player.status.canAct()
      ? { x: input.move.x * (player.movementScale ?? 1), y: input.move.y * (player.movementScale ?? 1) }
      : { x: 0, y: 0 };

    // Dash on Space. Resolved before the systems so the burst moves the
    // player in this same step, and it does not consume the attack input.
    // The direction comes from the raw stick, not the scaled vector.
    if (input.dashPressed && player.tryDash(input.move.x, input.move.y)) {
      this.particles.burst('dust', player.x, player.y, 10, { speed: 150 });
      this.bus.emit(EVENTS.SHAKE_REQUESTED, 2);
      // Announced, not played: Game knows nothing about speakers, exactly as
      // it knows nothing about the DOM.
      this.bus.emit(EVENTS.DASHED, { player });
    }

    this.coordinator.update(dt, player, {
      attackHeld: input.attackHeld,
      attackPressed: input.attackPressed,
      ultPressed: input.ultPressed,
    }, aimWorld);

    // The beam is fed the raw button rather than going through the
    // coordinator: it has no cooldown, it keeps its own heat, and a magic
    // weapon is the only thing that can fire it.
    this.beam.update(dt, player, Boolean(input.beamHeld));

    // --- 2. Enemy AI -----------------------------------------------------
    this.ai.update(dt, this.registry.enemies);

    // --- 3. Boss scheduling ----------------------------------------------
    this.bossController.update(dt);

    // --- 4. Projectiles ---------------------------------------------------
    this.projectiles.update(dt);

    // --- 5. Movement and collision ---------------------------------------
    this.movement.movePlayer(player, moveVector, dt);
    for (const enemy of this.registry.enemies) {
      if (enemy.alive) enemy.update(dt);
      else {
        // Dead entities still animate their death timer.
        enemy.tickCommon(dt);
        if (enemy.deathTimer > CONFIG.room.enemyDeathDuration) enemy.reapable = true;
      }
    }
    this.registry.reap();
    this.movement.separate(this.registry.enemies, player, dt);

    // Clamp everything inside the arena as a safety net.
    const room = this.rooms.runtime?.room;
    if (room) {
      this.movement.clampToBounds(player, room.bounds);
      for (const enemy of this.registry.enemies) {
        // Bosses dash past the clamp; keep them in bounds too.
        this.movement.clampToBounds(enemy, room.bounds);
      }
    }

    // --- 6. Status damage -------------------------------------------------
    this.combat.updateStatusDamage(dt, [player, ...this.registry.enemies]);
    this.combat.updateShields(dt);

    // --- 7. Ultimates -----------------------------------------------------
    this.ultimates.update(dt);

    // --- 8. Room rules ----------------------------------------------------
    player.update(dt);
    this.rooms.update(dt, player);
    this.run.update(dt);

    // --- 9. Presentation --------------------------------------------------
    this.particles.update(dt);
    this.floatingText.update(dt);
    this.screenFlash.update(dt);
    this.decals.update(dt);

    // The camera tracks the player directly. Rooms are all smaller than the
    // logical view, so clamping the camera to the room would leave it with
    // only a few pixels of travel — effectively frozen while the player
    // walks off-centre. Following unconditionally keeps the player centred,
    // and the renderer fills the space beyond the walls so the area outside
    // the room reads as solid rock rather than as void.
    this.camera.follow(player.x, player.y);
    this.camera.update(dt);

    // Death check: the player's own death must end the run exactly once.
    if (!player.alive && player.deathTimer > CONFIG.room.playerDeathDuration) {
      this.run.end('death', player);
    }
  }

  /* ============================================================
     Interaction
     ============================================================ */

  /**
   * What the player can interact with right now, or null.
   * @returns {{kind: string, distance: number, door?: any}|null}
   */
  getInteraction() {
    const rt = this.rooms.runtime;
    const player = this.player;
    if (!rt || !player || !player.alive) return null;

    const c = rt.room.center;
    const d = Math.hypot(player.x - c.x, player.y - c.y);

    if ((rt.type === 'healing' || rt.type === 'shop') && !rt.cleared) {
      return d < 120 ? { kind: rt.type, distance: d } : null;
    }

    // A door the player is standing in. Every room has several, so the one
    // they are inside is reported rather than "the first neighbour": the
    // interaction has to be able to say *which* room it leads to.
    if (rt.cleared || rt.type === 'start') {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const door of rt.room.doors) {
        if (!door.open) continue;
        const dx = player.x - (door.rect.x + door.rect.w / 2);
        const dy = player.y - (door.rect.y + door.rect.h / 2);
        const distance = Math.hypot(dx, dy);
        if (distance < 70 && distance < nearestDistance) {
          nearest = door;
          nearestDistance = distance;
        }
      }
      if (nearest) return { kind: 'door', distance: nearestDistance, door: nearest };
    }
    return null;
  }

  /**
   * Resolve the interaction the player just requested.
   * @returns {{kind: string, payload?: any}|null}
   */
  interact() {
    const interaction = this.getInteraction();
    if (!interaction) return null;

    const rt = this.rooms.runtime;
    if (!rt) return null;

    if (interaction.kind === 'healing') {
      // The altar grants its one-time upgrade when the player interacts with
      // it. Applying the reward here (rather than only displaying its name in
      // the overlay) keeps the healing room's gameplay effect authoritative in
      // RoomController and makes the operation safe to repeat.
      const bonus = rt.reward[0];
      if (bonus) this.rooms.takeReward(this.player, bonus);

      // Route through the controller so the doors are opened as part of
      // marking the room consumed; setting the flag directly would leave a
      // sealed room sealed and trap the player.
      this.rooms.markConsumed(rt);
      return { kind: 'healing', payload: { healed: rt.healingAmount ?? 0, bonusId: rt.healingBonusId ?? 'damage_10' } };
    }

    if (interaction.kind === 'shop') {
      this.rooms.markConsumed(rt);
      return { kind: 'shop', payload: { stock: rt.shopStock } };
    }

    if (interaction.kind === 'door') {
      // Travel through the door the player is standing in. With several exits
      // per room, picking "the first neighbour" would silently ignore which
      // doorway the player actually walked into.
      const node = this.run.currentNode();
      const door = interaction.door;
      const targetId = Number(door?.targetRoomId);
      if (!node || !Number.isFinite(targetId) || !node.next.includes(targetId)) return null;
      this.run.travelTo(targetId, this.player);
      this.camera.follow(this.player.x, this.player.y, true);
      this._snapCameraToPlayer();
      return { kind: 'travel', payload: { targetType: door?.targetType ?? null } };
    }

    return null;
  }

  /**
   * Apply a chosen reward.
   * @param {any} choice
   */
  takeReward(choice) {
    if (!this.player) return false;
    return this.rooms.takeReward(this.player, choice);
  }

  /**
   * Buy a shop item.
   * @param {any} item
   * @returns {boolean}
   */
  buy(item) {
    if (!this.player) return false;
    return this.rooms.purchase(this.player, item);
  }

  /**
   * Descend to the next arena node once the current room is cleared.
   * @param {number} nodeId
   */
  travelTo(nodeId) {
    if (!this.player) return;
    this.run.travelTo(nodeId, this.player);
    this.camera.follow(this.player.x, this.player.y, true);
    this._snapCameraToPlayer();
  }

  /**
   * Request a brief simulation freeze, for emphasis on huge impacts.
   * @param {number} seconds
   */
  requestHitStop(seconds) {
    this._hitStop = Math.max(this._hitStop, seconds);
  }

  /** @returns {Player|null} */
  getPlayer() {
    return this.player;
  }

  /**
   * Player statistics for the end screens.
   * @returns {any}
   */
  getStats() {
    return this.player?.stats ?? {
      kills: 0, damageDealt: 0, damageTaken: 0, goldEarned: 0, roomsCleared: 0,
    };
  }

  /**
   * Description of the class currently being played.
   * @returns {string}
   */
  getClassName() {
    return this.player ? getClass(this.player.classId).name : '';
  }
}
