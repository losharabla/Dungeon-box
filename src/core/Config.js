/**
 * @fileoverview Global tuning constants.
 *
 * SRP: a single home for magic numbers shared across systems. Systems must
 * not invent their own physics scales, otherwise "speed 3" from the design
 * document would mean something different in each module.
 */

export const CONFIG = {
  /** Logical rendering resolution. The canvas is letterboxed to fit. */
  view: {
    width: 1280,
    height: 720,
  },

  /** Simulation runs on a fixed step, independent of display refresh. */
  loop: {
    fixedStep: 1 / 60,
    maxStepsPerFrame: 5,
    maxFrameDelta: 0.25,
  },

  run: {
    /**
     * Floors in one campaign (§18: boss → next floor → ... → victory).
     * The final floor is the one whose boss ends the run outright; its
     * index is floors - 1, which is also what makes the boss rotation
     * (§12-14) terminate on the Executioner.
     */
    floors: 3,
  },

  world: {
    /** Design-document "Movement Speed" units -> pixels per second. */
    speedUnit: 46,
    /** Radius used for entity body collision. */
    playerRadius: 15,
    /** Knockback impulse decay per second. */
    knockbackDecay: 7.5,
    /** Walls are drawn this thick. */
    wallThickness: 18,
  },

  camera: {
    /**
     * How quickly the camera catches up to the player (per second).
     *
     * Kept high so the player stays visually locked to the centre of the
     * screen. A lower value leaves a visible lag that reads as the camera
     * "not following", which is worse than the slight loss of smoothness.
     * The easing still softens single-frame teleports (dashes, blinks).
     */
    followLerp: 22,
    /** Screen shake decays by this fraction per second. */
    shakeDecay: 5.2,
    /** Maximum shake offset in pixels. */
    maxShake: 26,
  },

  render: {
    /** Entity distance beyond which enemies are not drawn. */
    cullMargin: 160,
    /**
     * How many particles may be created during one fixed simulation step.
     *
     * `maxParticles` bounds the *population*, which does not bound the *work*
     * of a single frame: several simultaneous explosions can each be legal and
     * still allocate hundreds of objects between them, and a burst of
     * allocation plus draw calls is exactly what turns a 60fps frame into a
     * dropped one. This caps the emission rate instead, so the cost of effects
     * is bounded per step regardless of how many systems asked at once.
     *
     * 140 per step is ~8400/s, far above what a normal fight emits (the
     * busiest measured arena sits near 60 live particles), so it only ever
     * bites when effects stack — and then it trims the tail of the pile rather
     * than stalling the whole frame.
     */
    particleStepBudget: 140,
    /**
     * Maximum simultaneous floor marks (blood, scorch, chips). A ring buffer:
     * the oldest is evicted when the cap is reached, so per-frame decal cost is
     * constant no matter how long a fight runs.
     */
    decalCapacity: 96,
  },

  combat: {
    /**
     * Invulnerability window after the player takes a hit.
     *
     * Enemies attack on independent timers, so without this a pack standing
     * on the player lands every blow on the same frame: four mid-run chasers
     * deal ~52 HP/s to a 150 HP warrior and end him in under three seconds,
     * while a ranged class never enters that zone at all. The window caps the
     * incoming rate at roughly one blow per 0.4s no matter how many enemies
     * surround the player, which is what makes melee range survivable.
     *
     * Damage over time deliberately ignores it (see `updateStatusDamage`), so
     * burning still ticks through the window.
     */
    playerHurtIframe: 0.4,
    /** Enemy flash duration when damaged. */
    hurtFlash: 0.14,
    /** Baseline critical hit multiplier. */
    critMultiplier: 2,
    /** Ultimate charge gained from dealing 1 damage. */
    ultChargePerDamage: 0.045,
    /** Ultimate charge gained from a kill. */
    ultChargePerKill: 7,
    /** Ultimate charge gained from taking 1 damage. */
    ultChargePerDamageTaken: 0.05,
    /**
     * Ultimate charge gained per second of play, independent of combat.
     *
     * Enabled only by classDef.passiveUltCharge (warrior). Other classes
     * retain the original combat charge sources.
     * At this rate a full charge from time alone takes ~33s.
     */
    ultChargePerSecond: 3,

    /**
     * Total living non-boss enemies a room may contain. Summoners (the
     * necromancer and the boss summon attacks) stop adding bodies at this
     * ceiling, so a long fight cannot degenerate into an unwinnable swarm
     * or exhaust the frame budget.
     *
     * Kept deliberately low: minions physically block a melee player from
     * reaching the boss, so a large swarm silently makes the fight
     * impossible rather than merely hard.
     */
    maxMinions: 6,
  },

  /**
   * Dash (Space). A short committed burst of speed in the direction the
   * player is moving. The design document's control list (§22) has no dash,
   * but the in-game help screen has always advertised one on Space, so the
   * ability is implemented rather than the promise retracted: it also gives
   * a melee class a way to close the last stretch to a ranged enemy.
   */
  dash: {
    /** Length of the burst, seconds. */
    duration: 0.18,
    /** Seconds before another dash is available. */
    cooldown: 1.5,
    /** Multiplier applied to the player's effective movement speed. */
    speedMul: 3.6,
  },

  loot: {
    /**
     * Chance that the weapon a boss drops is a legendary instead of a
     * normal one (§15/§18 reward pools).
     *
     * The prototype guaranteed a legendary from every boss, which meant a
     * completed campaign always ended fully kitted out: the rarest items
     * stopped being rare. Three bosses at this rate hand out a legendary in
     * about one run out of two — the payoff is still the best source in the
     * game (arena rolls offer one at ~4-10%), but it is a reward again.
     */
    bossLegendaryChance: 0.35,
    /**
     * Extra legendary chance when the *harder* boss variant was chosen.
     *
     * The last door of a floor offers a normal boss and one entered with an
     * elite guard; without a payoff the louder door would just be a trap. At
     * 0.35 + 0.30 the elite boss is better than a coin flip for a legendary,
     * which is the strongest single reward in the game and is meant to be.
     */
    bossEliteLegendaryBonus: 0.3,
  },
};
