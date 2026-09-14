/**
 * @fileoverview Spawn scheduling for arena waves.
 *
 * SRP: decide *what* spawns and *where*, and track how many enemies remain
 * to kill. It does not create Room geometry and does not run AI.
 */

import { rng } from '../core/Random.js';
import { BASIC_ENEMY_IDS, ELITE_ENEMY_IDS } from '../data/enemies.js';
import { Enemy } from '../entities/Enemy.js';
import { Boss } from '../entities/Boss.js';

/**
 * @typedef {object} WaveDef
 * @property {string} label
 * @property {number} count
 * @property {boolean} elite
 * @property {number} delay   seconds before the wave starts
 */

export class Spawner {
  /**
   * @param {object} deps
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   * @param {() => import('../entities/Room.js').Room} deps.getRoom
   */
  constructor({ registry, getRoom }) {
    this.registry = registry;
    this.getRoom = getRoom;
    /** Difficulty multipliers, set per floor. */
    this.hpScale = 1;
    this.damageScale = 1;
    /** Id of the most recently spawned boss, for victory reporting. */
    this.lastBossId = '';
  }

  /**
   * @param {number} floorIndex
   */
  setFloor(floorIndex) {
    // Late floors hit harder without becoming a wall (design doc §20 keeps
    // power growth in weapons/upgrades, so enemy growth stays modest).
    this.hpScale = 1 + floorIndex * 0.32;
    this.damageScale = 1 + floorIndex * 0.20;
  }

  /**
   * Build the wave list for an arena room (design doc §15):
   * Wave 1 -> Wave 2 -> Elite Wave -> Victory.
   * @param {number} tier 1 = early, 2 = late
   * @returns {WaveDef[]}
   */
  buildWaves(tier) {
    const base = tier === 2 ? 4 : 3;
    return [
      { label: 'Волна 1', count: base, elite: false, delay: 0.8 },
      { label: 'Волна 2', count: base + 2, elite: false, delay: 1.3 },
      { label: 'Элитная волна', count: Math.max(2, Math.round(base * 0.75)), elite: true, delay: 1.3 },
    ];
  }

  /**
   * Spawn one wave of enemies at safe distances from the player.
   * @param {WaveDef} wave
   * @param {number} playerX
   * @param {number} playerY
   */
  spawnWave(wave, playerX, playerY) {
    const room = this.getRoom();
    const points = room.spawnPointsAwayFrom(playerX, playerY);

    const pool = wave.elite
      ? (rng.chance(0.55) ? ELITE_ENEMY_IDS : BASIC_ENEMY_IDS)
      : BASIC_ENEMY_IDS;

    for (let i = 0; i < wave.count; i++) {
      const point = points[i % points.length];
      // Jitter so stacked spawns do not look like a single enemy.
      const jitterX = (rng.next() - 0.5) * 46;
      const jitterY = (rng.next() - 0.5) * 46;
      const typeId = rng.pickOne(pool);
      this.spawnEnemy(typeId, point.x + jitterX, point.y + jitterY);
    }
  }

  /**
   * Spawn a single enemy by id.
   * @param {string} typeId
   * @param {number} x
   * @param {number} y
   * @returns {import('../entities/Enemy.js').Enemy}
   */
  spawnEnemy(typeId, x, y) {
    const enemy = new Enemy({
      typeId,
      x,
      y,
      hpScale: this.hpScale,
      damageScale: this.damageScale,
    });
    this.registry.addEnemy(enemy);
    return enemy;
  }

  /**
   * Spawn the floor boss (design doc §18).
   * @param {string} bossId
   * @param {number} x
   * @param {number} y
   * @param {number} [floorIndex]
   * @returns {Boss}
   */
  spawnBoss(bossId, x, y, floorIndex = 0) {
    const boss = new Boss({
      bossId,
      x,
      y,
      hpScale: 1 + floorIndex * 0.18,
      damageScale: 1 + floorIndex * 0.12,
    });
    this.registry.addEnemy(boss);
    this.lastBossId = bossId;
    return boss;
  }

  /**
   * Total living enemies.
   * @returns {number}
   */
  get livingCount() {
    return this.registry.enemies.filter((e) => e.alive).length;
  }
}
