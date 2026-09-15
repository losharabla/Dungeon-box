/**
 * @fileoverview Playable class definitions — pure data (design doc §6, §30).
 */

/**
 * @typedef {object} ClassDef
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {number} hp
 * @property {number} damage          multiplier baseline from the doc
 * @property {number} speed           Movement Speed units (see CONFIG.world.speedUnit)
 * @property {boolean} [passiveUltCharge] enables the warrior's timed charge
 * @property {'short'|'long'} attackRange
 * @property {string} startingWeapon
 * @property {number} bodyRadius
 * @property {string} desc
 * @property {string} color           base body colour for procedural rendering
 * @property {string} accent          trim / glow colour
 */

/** @type {Record<string, ClassDef>} */
export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    role: 'melee bruiser',
    passiveUltCharge: true,
    hp: 150,
    damage: 15,
    // 3 (138 px/s) was slower than every chaser that matters — the goblin
    // runs at 3.4 (156) and the assassin at 3.2 (147) — so once a warrior
    // committed to a pack he could not walk back out and re-engage, while
    // the ranged classes simply outran everything. Matching the goblin keeps
    // the melee class the slowest on the field, but no longer the slowest
    // thing in the fight.
    speed: 3.4,
    attackRange: 'short',
    startingWeapon: 'sword',
    bodyRadius: 16,
    color: '#8792a8',
    accent: '#c0392b',
    desc: 'High HP, heavy blows, strong knockback. Melee.',
  },

  mage: {
    id: 'mage',
    name: 'Mage',
    role: 'ranged AoE / control',
    hp: 80,
    damage: 20,
    speed: 4,
    attackRange: 'long',
    startingWeapon: 'fire_staff',
    bodyRadius: 14,
    color: '#6f7fd6',
    accent: '#7fd8ff',
    desc: 'Low HP, high damage, area control and AoE.',
  },

  gunner: {
    id: 'gunner',
    name: 'Gunner',
    role: 'ranged DPS / mobility',
    hp: 100,
    damage: 12,
    speed: 5,
    attackRange: 'long',
    startingWeapon: 'pistol',
    bodyRadius: 15,
    color: '#b08a5a',
    accent: '#ffbe4d',
    desc: 'Fast and quick-firing, and heavily dependent on its weapon.',
  },
};

/** Class ids in display order. */
export const CLASS_IDS = ['warrior', 'mage', 'gunner'];

/**
 * @param {string} id
 * @returns {ClassDef}
 */
export function getClass(id) {
  const def = CLASSES[id];
  if (!def) throw new Error(`Unknown class "${id}"`);
  return def;
}
