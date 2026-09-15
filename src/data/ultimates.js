/**
 * @fileoverview Ultimate definitions — pure data (design doc §6-8, §21).
 *
 * 3 classes × 3 ultimates = the 9 abilities the MVP requires.
 */

/**
 * @typedef {object} UltimateDef
 * @property {string} id
 * @property {string} classId
 * @property {string} name
 * @property {number} duration   seconds the effect lasts (0 = instant)
 * @property {string} desc
 * @property {string} kind       behavioural tag interpreted by UltimateSystem
 * @property {number} [radius]
 * @property {number} [damageMul] damage relative to the weapon's base damage
 * @property {number} [delay]    telegraph delay for aimed strikes
 * @property {number} [maxTargets]
 * @property {number} [heal]
 * @property {number} [speedBonus]
 * @property {number} [damageBonus]
 * @property {number} [moveScale] movement multiplier while the effect runs
 *   (1 = unchanged). Values above 1 are a mobility buff.
 * @property {string} color
 */

/** @type {Record<string, UltimateDef>} */
export const ULTIMATES = {
  /* ---------------- Warrior (§6) ---------------- */

  whirlwind: {
    id: 'whirlwind', classId: 'warrior', name: 'Whirlwind',
    kind: 'whirlwind', duration: 2.0, radius: 120, damageMul: 0.42,
    // The document only requires that the warrior "can keep moving a little"
    // (§6). Play feedback was that a slowed spin feels like a self-stun on
    // the class that already has the hardest time staying in range, so the
    // spin now accelerates him into the enemies it is hitting.
    moveScale: 1.35,
    color: '#ffb347',
    desc: 'A spinning attack that damages every enemy around you. Speeds the warrior up.',
  },

  invulnerability: {
    id: 'invulnerability', classId: 'warrior', name: 'Invulnerability',
    kind: 'invulnerability', duration: 3.0, color: '#ffe9a8',
    desc: 'Total invulnerability for 3 seconds.',
  },

  berserker_strike: {
    id: 'berserker_strike', classId: 'warrior', name: 'Berserker Strike',
    kind: 'berserker_strike', duration: 0.45, radius: 150, damageMul: 3.4,
    color: '#ff4b2b',
    desc: 'A crushing blow to the area in front of you with huge knockback.',
  },

  /* ---------------- Mage (§7) ---------------- */

  meteor: {
    id: 'meteor', classId: 'mage', name: 'Meteor',
    kind: 'meteor', duration: 0, radius: 165, damageMul: 4.2, delay: 1.1,
    color: '#ff6a1a',
    desc: 'After a short delay, a meteor falls on the targeted area.',
  },

  chain_lightning: {
    id: 'chain_lightning', classId: 'mage', name: 'Chain Lightning',
    kind: 'chain_lightning', duration: 0.5, maxTargets: 5, damageMul: 1.8,
    color: '#8fe3ff',
    desc: 'Lightning strikes up to 5 targets, with damage falling off at every jump.',
  },

  time_stop: {
    id: 'time_stop', classId: 'mage', name: 'Time Stop',
    kind: 'time_stop', duration: 3.5, color: '#7fd8ff',
    desc: 'Every enemy freezes. The player keeps moving and shooting.',
  },

  /* ---------------- Gunner (§8) ---------------- */

  bullet_storm: {
    id: 'bullet_storm', classId: 'gunner', name: 'Bullet Storm',
    kind: 'bullet_storm', duration: 2.4, color: '#ffbe4d',
    desc: 'A continuous storm of bullets fanned out around the player.',
  },

  ricochet: {
    id: 'ricochet', classId: 'gunner', name: 'Ricochet',
    kind: 'ricochet', duration: 6.0, color: '#9fd8ff',
    desc: 'Bullets ricochet off walls for 6 seconds.',
  },

  combat_stim: {
    id: 'combat_stim', classId: 'gunner', name: 'Combat Stim',
    kind: 'combat_stim', duration: 7.0, heal: 40, speedBonus: 0.45,
    color: '#6ffbb0',
    desc: 'Restores HP and temporarily speeds up movement.',
  },
};

/** Ultimate ids grouped by class, in selection order. */
/** @type {Record<string, string[]>} */
export const ULTIMATES_BY_CLASS = {
  warrior: ['whirlwind', 'invulnerability', 'berserker_strike'],
  mage: ['meteor', 'chain_lightning', 'time_stop'],
  gunner: ['bullet_storm', 'ricochet', 'combat_stim'],
};

/**
 * @param {string} id
 * @returns {UltimateDef}
 */
export function getUltimate(id) {
  const def = ULTIMATES[id];
  if (!def) throw new Error(`Unknown ultimate "${id}"`);
  return def;
}

/**
 * @param {string} classId
 * @returns {UltimateDef[]}
 */
export function ultimatesForClass(classId) {
  return (ULTIMATES_BY_CLASS[classId] ?? []).map(getUltimate);
}
