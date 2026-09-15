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

  /** Timings shared by room lifecycle and death animations. */
  room: {
    enemyDeathDuration: 1.2,
    playerDeathDuration: 1.4,
    healingFraction: 0.30,
    bossGuardCount: 5,
  },

  ui: {
    noticeDuration: 2.6,
    startTransitionDuration: 1.3,
    floorTransitionDuration: 1.4,
    bossTransitionDuration: 2.0,
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
    /**
     * Damage-number aggregation.
     *
     * A piercing explosive weapon lands many hits per second: the Staff of the
     * Void measured 78 hits/s inside a pack, and one label per hit put ~120
     * live labels on screen. Each label costs a font switch plus a stroked and
     * a filled glyph run, so labels became the single largest per-frame drawing
     * cost in the game — 45% of that scene's render time, and the text layer
     * was still saturating its own ceiling of 140.
     *
     * Consecutive hits on the same body therefore fold into one number that
     * keeps counting. The player sees the same information (the damage they are
     * doing) with a tenth of the glyph work, and it reads better: a pack taking
     * a blast shows one rising total instead of a cloud of colliding digits.
     */
    damageNumber: {
      /** Only fold into a label younger than this, in seconds. */
      mergeWindow: 0.26,
      /**
       * ...and only into one within this many pixels of the new hit. Wide
       * enough that a blast catching several bodies reads as one number for
       * the impact zone, which is both cheaper and easier to read than five
       * labels fighting for the same patch of screen.
       */
      mergeRadius: 52,
      /**
       * How far back to look for a merge target. Recent labels live at the end
       * of the list, so a short scan finds every candidate — and keeps the
       * merge itself O(1) instead of a scan over the whole population.
       */
      lookback: 16,
    },
    /**
     * Impact-effect scale for damage that arrives from an area blast rather
     * than a direct hit.
     *
     * An explosion that catches nine bodies used to fire nine full impact
     * bursts on one frame. The step budget then dropped most of them, so the
     * player saw a *worse* effect and still paid for every attempt. Emitting a
     * fraction per body keeps the blast inside the budget, so the visual is
     * consistent instead of randomly pruned.
     */
    areaVfxScale: 0.35,
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
     * How often damage-over-time reports itself.
     *
     * A hazard the player is standing in deals damage every fixed step, but
     * neither the player nor the mixer wants sixty reports a second: the damage
     * is applied continuously — which is what makes the configured dps the dps
     * actually taken — while the label, the sound and the shake fire at this
     * interval, so a burn reads as a burn instead of a strobe.
     */
    dotFeedbackInterval: 0.35,

    /**
     * Seconds between burning ticks, and therefore the unit `burnDamage` is
     * multiplied by.
     *
     * `burnDamage` is documented as damage per *second*, so the amount applied
     * on each tick is `burnDamage * burnTickInterval`. Applying the rate flat
     * once per tick — which is what the code did — quietly dealt 1/0.4 = 2.5
     * times the number in the weapon data: a 6 dps burn was 15 dps, and the
     * Fire Staff's burn outdamaged its own projectile.
     */
    burnTickInterval: 0.4,

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

  /**
   * Beam mode (right mouse button) for the magic weapons.
   *
   * Every staff fires two ways: bolts on the left button, a held beam on the
   * right. The *model* of the beam is shared — a raycast to the first wall, a
   * tick rate, and a heat gauge that locks the staff out — while the numbers
   * and the effect belong to the weapon (`weapons.js` `beam` block): what it
   * costs per second, how far it reaches, what it inflicts, and whether it
   * stops at the first body or shines through it.
   *
   * The heat gauge is what keeps the beam from being the only button worth
   * pressing: it is stronger than the bolts while it lasts and unavailable
   * while it cools, so the staff is played as a rhythm rather than held down.
   */
  beam: {
    /**
     * Damage applications per second.
     *
     * Each tick applies `dps / tickRate`, so the configured dps is the dps
     * actually dealt whatever this is set to. It is deliberately low: every
     * tick is a status roll and a hit-volume test, and the damage *labels* are
     * batched by `combat.dotFeedbackInterval` anyway.
     */
    tickRate: 12,
    /** Seconds of continuous fire before the staff locks out. */
    heatUpTime: 3.2,
    /** Gauge fraction per second shed while cooling. */
    coolRate: 0.5,
    /** Seconds after letting go before cooling starts. */
    coolDelay: 0.3,
    /**
     * The gauge must fall back to this before the beam fires again.
     *
     * A lock-out that cleared at 1.0 would let the player tap the button the
     * instant it unlocked and stutter the beam at full heat; releasing at 0.35
     * makes an overheat cost roughly a second and a half.
     */
    releaseAt: 0.35,
    /** Half-width of the drawn beam, in world pixels. */
    halfWidth: 3,
    /**
     * The beam is drawn as a handful of segments, not a particle stream.
     *
     * Per-frame cost is bounded by construction: one raycast, at most
     * `maxTargets` hit volumes, one beam quad and one impact glow.
     */
    maxTargets: 12,
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

  /**
   * Procedural audio (Web Audio API). Every value here bounds *cost*, not
   * artistic choice: the voice ceiling and the retrigger guard are what keep a
   * busy arena from stacking hundreds of live nodes on one frame.
   */
  audio: {
    /** Mixer defaults, also the shape persisted to localStorage. */
    defaults: {
      master: 0.8,
      /**
       * Music sits under the effects instead of beside them. The shipped track
       * is a hot master (mean −15.8 dB, peak −0.6 dB), so at 0.45 × master it
       * lands around −25 dBFS — just under the bus compressor's knee, which is
       * where a bed belongs: audible, never fighting a sword hit.
       */
      music: 0.45,
      effects: 0.85,
      muted: false,
    },
    /**
     * Simultaneous one-shot voices. Each voice is a source + gain (+ panner),
     * so this is a hard ceiling on the node count the mixer can create,
     * regardless of how many hits land on the same frame.
     */
    maxVoices: 14,
    /**
     * Voices the mixer accepts when the frame rate is degraded (see
     * `AudioSystem.setQuality`). Halving it is invisible during a fight but
     * removes roughly half the graph work on a struggling machine.
     */
    maxVoicesReduced: 7,
    /**
     * Minimum seconds between two plays of the *same* preset. A Hellstorm
     * firing 24 rounds a second must not become 24 copies of one gunshot
     * sample: identical sounds fuse into a single denser voice instead.
     */
    retriggerGuard: 0.035,
    /**
     * Distance at which a world sound is fully attenuated. Everything beyond
     * it is not played at all — the cheapest voice is the one never created.
     */
    audibleRadius: 1150,
    /** Floor on distance attenuation, so a far-off hit is still a hint. */
    minAudibleGain: 0.16,
    /** How much a sound is panned across the stereo field at full offset. */
    maxPan: 0.72,
    /**
     * Master bus ceiling. A single compressor replaces per-sound limiting:
     * twenty simultaneous impacts duck instead of clipping.
     */
    busThreshold: -14,
    busKnee: 22,
    busRatio: 8,
    /** Fade applied when a voice is stolen or stopped, so nothing clicks. */
    releaseFade: 0.028,
    /**
     * Music fades. The track itself already fades in and out at its own ends,
     * so these only smooth a start mid-run and a stop at the run's end; they
     * are deliberately short enough not to be heard as a fade.
     */
    musicFadeIn: 1.2,
    musicFadeOut: 2.0,
  },
};
