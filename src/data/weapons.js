/**
 * @fileoverview Weapon definitions — pure data (design doc §9, §10, §30).
 *
 * No behaviour lives here. A weapon is described; CombatSystem interprets
 * the description. Adding a weapon means adding an object to this file.
 */

/**
 * @typedef {'melee'|'magic'|'gun'} WeaponKind
 */

/**
 * @typedef {object} WeaponDef
 * @property {string} id
 * @property {string} name
 * @property {WeaponKind} kind
 * @property {'warrior'|'mage'|'gunner'|'any'} ownerClass  who may roll this
 * @property {number} baseDamage      damage per hit / per projectile
 * @property {number} cooldown        seconds between attacks
 * @property {number} range           reach in pixels (melee) or projectile life driver
 * @property {boolean} [legendary]
 * @property {string} desc
 * @property {object} [projectile]    present for ranged weapons
 * @property {number} [projectile.speed]      pixels/sec
 * @property {number} [projectile.life]       seconds before expiry
 * @property {number} [projectile.radius]
 * @property {number} [projectile.count]      pellets per shot
 * @property {number} [projectile.spread]     radians of total spread
 * @property {string} [projectile.visual]     archetype passed to the projectile renderer
 * @property {number} [projectile.pierce]     how many enemies a shot passes through
 * @property {number} [projectile.bounces]    wall ricochets allowed
 * @property {number} [projectile.explosionRadius]
 * @property {number} [projectile.explosionChance] 0..1 chance to explode on hit
 * @property {number} [explosionRadius]       melee/magic secondary blast
 * @property {number} [knockback]             impulse applied on hit
 * @property {number} [stunChance]            0..1
 * @property {number} [slowChance]            0..1
 * @property {number} [slowFactor]            speed multiplier while slowed
 * @property {number} [slowDuration]
 * @property {number} [burnChance]            0..1
 * @property {number} [burnDuration]
 * @property {number} [burnDamage]            damage per second
 * @property {number} [chainChance]           0..1 extra chain lightning on hit
 * @property {number} [critBonus]             additive crit chance
 * @property {number} [healOnKill]            flat HP restored when wielder kills
 * @property {number} [heatRamp]              Hellstorm: fire-rate gain per second of sustained fire
 * @property {number} [heatMax]               Hellstorm: ceiling on the ramp multiplier
 * @property {number} [arc]                   melee swing arc in radians
 * @property {number} [swingTime]             melee animation duration (seconds)
 * @property {number} [staminaCost]           reserved for future use
 * @property {WeaponBeamDef} [beam]           magic weapons only: the held right-button mode
 */

/**
 * The held beam of a magic weapon (right mouse button).
 *
 * Status fields (`burnChance`, `slowChance`, …) are inherited from the weapon
 * itself: the beam spec is merged over the weapon before it is applied, so a
 * staff only states what its beam does *differently*. `damage` is a rate, not
 * a per-tick figure — `CONFIG.beam.tickRate` decides how it is sliced, and the
 * slice is what actually lands.
 *
 * @typedef {object} WeaponBeamDef
 * @property {number} damage          damage per second while the beam is held
 * @property {number} range           reach in pixels, before the first wall
 * @property {string} color           the beam's own colour, used by the renderer
 * @property {boolean} [pierce]       true: shines through every body in the path
 * @property {number} [rampTime]      seconds of sustained fire to reach `damageMax`
 * @property {number} [damageMax]     damage per second at the end of the ramp
 * @property {number} [halfWidth]     drawn half-width override
 * @property {'ray'|'arc'} [shape]    drawn shape: a straight ray or a crackling arc
 * @property {number} [burnChance]    per-tick chance, overriding the weapon's
 * @property {number} [slowChance]    per-tick chance, overriding the weapon's
 * @property {number} [slowFactor]
 * @property {number} [slowDuration]
 * @property {number} [burnDuration]
 * @property {number} [burnDamage]
 */

/** Cooldown floor so an extreme attack-speed roll can never divide by ~0. */
export const MIN_COOLDOWN = 0.045;

/** @type {Record<string, WeaponDef>} */
export const WEAPONS = {
  /* ---------------- Warrior — normal (§9.1-9.3) ---------------- */

  sword: {
    id: 'sword',
    name: 'Sword',
    kind: 'melee',
    ownerClass: 'warrior',
    // Melee pays for its reach in HP, so it must win the exchange when it
    // finally arrives: 22/0.40 is 55 DPS against 41 before, which puts the
    // warrior's starting weapon ahead of the mage's staff instead of dead
    // last among the normal weapons.
    baseDamage: 22,
    cooldown: 0.40,
    range: 74,
    arc: 1.45,
    swingTime: 0.18,
    knockback: 130,
    desc: 'A balanced blade. Medium damage, medium speed.',
  },

  battle_axe: {
    id: 'battle_axe',
    name: 'Battle Axe',
    kind: 'melee',
    ownerClass: 'warrior',
    baseDamage: 37,
    cooldown: 0.82,
    range: 84,
    arc: 1.9,
    swingTime: 0.28,
    knockback: 220,
    explosionRadius: 42,
    desc: 'A heavy axe with a wide swing and a small AoE.',
  },

  war_hammer: {
    id: 'war_hammer',
    name: 'War Hammer',
    kind: 'melee',
    ownerClass: 'warrior',
    baseDamage: 62,
    cooldown: 1.15,
    range: 88,
    arc: 2.2,
    swingTime: 0.34,
    knockback: 430,
    stunChance: 0.35,
    desc: 'Very high damage, heavy knockback and a chance to stun.',
  },

  /* ---------------- Mage — normal (§9.4-9.6) ---------------- */

  fire_staff: {
    id: 'fire_staff',
    name: 'Fire Staff',
    kind: 'magic',
    ownerClass: 'mage',
    baseDamage: 22,
    cooldown: 0.5,
    range: 620,
    knockback: 70,
    burnChance: 0.75,
    burnDuration: 2.6,
    burnDamage: 6,
    desc: 'Fire bolts that set the target alight. Hold the right button for a burning beam.',
    projectile: {
      speed: 520, life: 1.25, radius: 8, visual: 'fire',
      explosionRadius: 34, explosionChance: 0.15,
    },
    // The beam is the reliable mode: less damage than the bolts, but it
    // cannot miss and it keeps the target alight while it is held.
    beam: {
      damage: 30, range: 400, color: '#ff8a3d',
      // Fires a little more often per tick than the bolts do per shot, so a
      // beamed target is essentially always burning.
      burnChance: 0.3, burnDuration: 2.2, burnDamage: 6,
    },
  },

  ice_staff: {
    id: 'ice_staff',
    name: 'Ice Staff',
    kind: 'magic',
    ownerClass: 'mage',
    baseDamage: 15,
    cooldown: 0.4,
    range: 620,
    knockback: 55,
    slowChance: 0.95,
    slowFactor: 0.45,
    slowDuration: 2.4,
    desc: 'Ice bolts that slow enemies down. Hold the right button for a freezing ray.',
    projectile: { speed: 560, life: 1.2, radius: 7, visual: 'ice' },
    // The slow is refreshed every tick, so what the beam really sells is the
    // *hold*: it pins a body in place for as long as the mage keeps aiming.
    beam: {
      damage: 20, range: 380, color: '#7fd8ff',
      slowChance: 1, slowFactor: 0.35, slowDuration: 0.6,
    },
  },

  lightning_staff: {
    id: 'lightning_staff',
    name: 'Lightning Staff',
    kind: 'magic',
    ownerClass: 'mage',
    baseDamage: 17,
    cooldown: 0.28,
    range: 680,
    knockback: 60,
    chainChance: 0.3,
    desc: 'Fast bolts that can chain lightning. Hold the right button for a beam that builds up.',
    projectile: { speed: 760, life: 1.0, radius: 5, visual: 'lightning' },
    // The only beam that gets stronger the longer it is held, which is what
    // makes the heat gauge a decision: hold through the ramp and risk the
    // lock-out, or feather it and never reach the top.
    beam: {
      damage: 22, range: 460, color: '#ffe14d', shape: 'arc',
      rampTime: 2.2, damageMax: 78,
    },
  },

  /* ---------------- Gunner — normal (§9.7-9.10) ---------------- */

  pistol: {
    id: 'pistol',
    name: 'Pistol',
    kind: 'gun',
    ownerClass: 'gunner',
    baseDamage: 13,
    cooldown: 0.2,
    range: 780,
    critBonus: 0.08,
    knockback: 60,
    desc: 'High accuracy and attack speed, low damage.',
    projectile: { speed: 1050, life: 0.85, radius: 4, visual: 'bullet', count: 1 },
  },

  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    kind: 'gun',
    ownerClass: 'gunner',
    baseDamage: 12,
    cooldown: 0.72,
    range: 330,
    knockback: 130,
    desc: 'Seven pellets. Devastating up close, weaker at range.',
    projectile: {
      speed: 880, life: 0.34, radius: 4, visual: 'pellet',
      count: 7, spread: 0.44, pierce: 0,
    },
  },

  assault_rifle: {
    id: 'assault_rifle',
    name: 'Assault Rifle',
    kind: 'gun',
    ownerClass: 'gunner',
    baseDamage: 9,
    cooldown: 0.1,
    range: 820,
    knockback: 45,
    desc: 'Very high rate of fire, weak single bullet.',
    projectile: { speed: 1250, life: 0.72, radius: 4, visual: 'bullet' },
  },

  sniper_rifle: {
    id: 'sniper_rifle',
    name: 'Sniper Rifle',
    kind: 'gun',
    ownerClass: 'gunner',
    baseDamage: 78,
    cooldown: 1.35,
    range: 1500,
    critBonus: 0.2,
    knockback: 240,
    desc: 'Huge damage, low rate of fire, and it pierces straight through enemies.',
    projectile: { speed: 2600, life: 1.3, radius: 5, visual: 'sniper', pierce: 6 },
  },

  /* ---------------- Legendary (§10) ---------------- */

  bloodthirster: {
    id: 'bloodthirster',
    name: 'Bloodthirster',
    kind: 'melee',
    ownerClass: 'warrior',
    legendary: true,
    baseDamage: 46,
    cooldown: 0.36,
    range: 96,
    arc: 2.0,
    swingTime: 0.2,
    knockback: 300,
    healOnKill: 14,
    desc: 'Kills restore HP. The more aggressive you play, the more you heal.',
  },

  staff_of_the_void: {
    id: 'staff_of_the_void',
    name: 'Staff of the Void',
    kind: 'magic',
    ownerClass: 'mage',
    legendary: true,
    baseDamage: 30,
    cooldown: 0.42,
    range: 900,
    knockback: 90,
    desc: 'Bolts that pass through enemies and explode. Hold the right button for a beam that pierces everything.',
    projectile: {
      speed: 700, life: 1.6, radius: 11, visual: 'void',
      pierce: 99, explosionRadius: 74, explosionChance: 0.5,
    },
    // The only beam that does not stop at the first body: it is the reward for
    // lining a pack up, and the reason it deals less per second than the
    // lightning ramp reaches.
    beam: {
      damage: 34, range: 420, color: '#c05cff', pierce: true,
    },
  },

  hellstorm: {
    id: 'hellstorm',
    name: 'Hellstorm',
    kind: 'gun',
    ownerClass: 'gunner',
    legendary: true,
    baseDamage: 11,
    cooldown: 0.11,
    range: 860,
    knockback: 50,
    heatRamp: 0.55,
    heatMax: 2.6,
    desc: 'The longer you keep firing, the faster it shoots.',
    projectile: { speed: 1180, life: 0.78, radius: 5, visual: 'hellfire', spread: 0.1 },
  },
};

/**
 * Every non-legendary weapon id.
 * @returns {string[]}
 */
export function normalWeaponIds() {
  return Object.values(WEAPONS).filter((w) => !w.legendary).map((w) => w.id);
}

/**
 * Look up a weapon definition.
 * @param {string} id
 * @returns {WeaponDef}
 */
export function getWeapon(id) {
  const def = WEAPONS[id];
  if (!def) throw new Error(`Unknown weapon "${id}"`);
  return def;
}
