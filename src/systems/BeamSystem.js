/**
 * @fileoverview Beam mode: the held right-button fire of a magic weapon.
 *
 * SRP: own the *beam*. Bolts go through `ProjectileSystem` and `CombatSystem`
 * like every other ranged weapon; the beam is the one attack in the game that
 * exists continuously rather than as an event, so it needs a place to live
 * that is not a projectile.
 *
 * ## One model, four staffs
 *
 * The mechanism is shared — a raycast to the first wall, a status roll at
 * `CONFIG.beam.tickRate`, a heat gauge that locks the staff out — and the
 * numbers belong to the weapon (`weapons.js` `beam` block). That is the same
 * split as everything else in this codebase: the system interprets, the data
 * decides. A new staff is a data row.
 *
 * ## Damage is continuous, feedback is not
 *
 * Damage is applied every frame as `dps * dt` through
 * `CombatSystem.applyDamageOverTime`, so the configured dps is the dps the
 * target actually takes and a partial tick is not rounded away. That method
 * also batches the damage *labels*, which is what keeps a 12 Hz beam from
 * being a 12 Hz strobe of numbers — and it emits no sound per tick, so a beam
 * is silent in the mixer except for its own start, stop and overheat cues.
 *
 * Status rolls do run on the tick (a 30% burn chance rolled sixty times a
 * second would mean a target is always alight regardless of the chance), and
 * so does the impact spark.
 *
 * ## Cost is bounded by construction
 *
 * Per frame: one raycast, one pass over the nearby enemies, one damage call
 * per body touched, and a single segment record for the renderer to draw. No
 * particles are emitted per frame and nothing accumulates.
 */

import { CONFIG } from '../core/Config.js';
import { EVENTS } from '../core/EventBus.js';
import { segmentVsHitVolumeHit } from '../core/Collision.js';
import { hitVolumeOf } from './CombatCoordinator.js';

export class BeamSystem {
  /**
   * @param {object} deps
   * @param {import('./CombatSystem.js').CombatSystem} deps.combat
   * @param {import('../entities/Room.js').CollisionWorld} deps.collisionWorld
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} deps.registry
   * @param {import('../core/EventBus.js').EventBus} deps.bus
   */
  constructor({ combat, collisionWorld, registry, bus }) {
    this.combat = combat;
    this.collisionWorld = collisionWorld;
    this.registry = registry;
    this.bus = bus;

    /**
     * The beam as it was drawn this step, for the renderer: null when nothing
     * is firing. Kept here rather than on the player because it is a fact
     * about the last *frame*, not about the character.
     * @type {{x0: number, y0: number, x1: number, y1: number, color: string,
     *   halfWidth: number, shape: string|undefined, hitBody: boolean,
     *   ramp: number, targets: number}|null}
     */
    this.last = null;
  }

  /**
   * @param {number} dt
   * @param {import('../entities/Player.js').Player} player
   * @param {boolean} firing whether the beam button is held this step
   */
  update(dt, player, firing) {
    if (!player || !player.alive) {
      this._stop(player);
      return;
    }

    const w = player.weapon;
    const canBeam = Boolean(w && w.kind === 'magic' && w.beam);

    // The lock-out clears only once the button has been let go *and* the gauge
    // has fallen back. Clearing it on temperature alone would let a player who
    // never released stutter the beam at full heat.
    if (player.beam.locked && (!firing || !canBeam) && player.beam.heat <= CONFIG.beam.releaseAt) {
      player.beam.locked = false;
    }

    const active = Boolean(firing && canBeam) && !player.beam.locked;
    if (!active) {
      this._stop(player);
      // A staff held past its limit does not cool. The player has to let go,
      // which is the entire point of having a gauge: holding the button
      // forever has to be the thing that costs.
      if (!firing) this._cool(dt, player);
      return;
    }

    if (!player.beam.firing) {
      player.beam.firing = true;
      player.beam.ramp = 0;
      this.bus.emit(EVENTS.BEAM_STARTED, { player, weapon: w });
    }
    player.beam.ramp += dt;

    // --- Heat ------------------------------------------------------------
    player.beam.heat += dt / CONFIG.beam.heatUpTime;
    if (player.beam.heat >= 1) {
      player.beam.heat = 1;
      player.beam.locked = true;
      this.bus.emit(EVENTS.BEAM_OVERHEATED, { player, weapon: w });
      this._stop(player);
      return;
    }

    // --- The ray ---------------------------------------------------------
    const beam = w.beam;
    const halfWidth = beam.halfWidth ?? CONFIG.beam.halfWidth;
    const cos = Math.cos(player.facing);
    const sin = Math.sin(player.facing);
    // The muzzle matches the projectile spawn point, so both modes fire from
    // the same place and the staff only has to be drawn once.
    const x0 = player.x + cos * 24;
    const y0 = player.y - 12 + sin * 24;
    let x1 = x0 + cos * beam.range;
    let y1 = y0 + sin * beam.range;

    const wall = this.collisionWorld.raycast(x0, y0, x1, y1);
    if (wall) {
      x1 = wall.x;
      y1 = wall.y;
    }

    const dps = this._dps(beam, player);
    const targets = this._targets(x0, y0, x1, y1, halfWidth, beam);

    // --- Damage ----------------------------------------------------------
    // `dps` is a rate and `applyDamageOverTime` does the `* dt` itself: a
    // per-frame slice is exact, and rounding the damage up to a tick is what
    // turned the fire hazard into a 1-HP-per-tick joke (see that method).
    for (const t of targets) {
      this.combat.applyDamageOverTime(t.enemy, dps, dt, player, { color: beam.color });
    }

    // --- Status and impact feedback, on the tick -------------------------
    player.beam.tickTimer = (player.beam.tickTimer ?? 0) - dt;
    if (player.beam.tickTimer <= 0) {
      // Reset to the interval rather than to zero: a frame longer than the
      // interval must not queue up a burst of rolls on the next one.
      player.beam.tickTimer = 1 / CONFIG.beam.tickRate;
      const spec = { ...w, ...beam };
      for (const t of targets) {
        this.combat.applyStatus(t.enemy, spec);
      }
      const impact = targets.length > 0 ? targets[0] : null;
      if (impact) {
        this.combat.particles.burst('spark', impact.x, impact.y, 2, {
          speed: 110, overrides: { color: beam.color },
        });
      }
    }

    const impactPoint = targets.length > 0
      ? { x: targets[0].x, y: targets[0].y }
      : { x: x1, y: y1 };

    this.last = {
      x0,
      y0,
      x1: impactPoint.x,
      y1: impactPoint.y,
      color: beam.color,
      halfWidth,
      shape: beam.shape,
      hitBody: targets.length > 0,
      ramp: this._rampFraction(beam, player),
      targets: targets.length,
    };
  }

  /**
   * Damage per second right now, including the lightning staff's ramp.
   * @param {any} beam
   * @param {import('../entities/Player.js').Player} player
   */
  _dps(beam, player) {
    const base = beam.damage * player.modifiers.damageMul;
    if (!beam.damageMax || !beam.rampTime) return base;
    const top = beam.damageMax * player.modifiers.damageMul;
    return base + (top - base) * this._rampFraction(beam, player);
  }

  /** How far into the damage ramp the held beam is, 0..1. */
  _rampFraction(beam, player) {
    if (!beam.damageMax || !beam.rampTime) return 0;
    return Math.min(1, player.beam.ramp / beam.rampTime);
  }

  /**
   * Every body the beam touches, nearest first.
   * @returns {Array<{enemy: any, t: number, x: number, y: number}>}
   */
  _targets(x0, y0, x1, y1, halfWidth, beam) {
    const candidates = this.registry.enemiesNear(x0, y0, beam.range + 64);
    const hits = [];

    for (const enemy of candidates) {
      if (!enemy.alive) continue;
      const hit = segmentVsHitVolumeHit(x0, y0, x1, y1, hitVolumeOf(enemy), halfWidth);
      if (hit) hits.push({ enemy, t: hit.t, x: hit.x, y: hit.y });
    }

    hits.sort((a, b) => a.t - b.t);

    // A beam stops at the first body unless the weapon says it shines through:
    // that is the whole difference between the void staff and the rest.
    const limit = beam.pierce ? CONFIG.beam.maxTargets : 1;
    return hits.slice(0, limit);
  }

  /** Let the gauge shed heat, and report the transition out of firing. */
  _cool(dt, player) {
    if (!player) return;
    player.beam.coolTimer = (player.beam.coolTimer ?? 0) - dt;
    if (player.beam.coolTimer > 0) return;
    player.beam.heat = Math.max(0, player.beam.heat - CONFIG.beam.coolRate * dt);
  }

  /** @param {import('../entities/Player.js').Player|null} player */
  _stop(player) {
    this.last = null;
    if (!player || !player.beam.firing) return;
    player.beam.firing = false;
    player.beam.ramp = 0;
    // Restart the cooling delay on every release, so feathering the trigger
    // does not cool the staff for free.
    player.beam.coolTimer = CONFIG.beam.coolDelay;
    this.bus.emit(EVENTS.BEAM_STOPPED, { player });
  }
}
