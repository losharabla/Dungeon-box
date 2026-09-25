/**
 * @fileoverview Destructible explosive barrel entity.
 *
 * A physical obstacle that can be damaged by player attacks, enemy shots,
 * or explosions. When destroyed, it detonates: dealing AoE damage to both
 * player and enemies, spawning fire particles, screen shake, scorch decal,
 * and leaving a burning oil puddle hazard.
 */

import { Entity } from './Entity.js';

export class Barrel extends Entity {
  /**
   * @param {object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.maxHp]
   */
  constructor({ x, y, maxHp = 18 }) {
    super({ x, y, radius: 15, maxHp, speed: 0 });
    this.kind = 'barrel';
    this.faction = 'neutral';
    this.hitWidth = 26;
    this.hitUp = 26;
    this.hitDown = 4;
  }

  /**
   * Barrels do not animate movement, but hurt flash decays with time.
   * @param {number} dt
   */
  update(dt) {
    this.tickCommon(dt);
  }
}
