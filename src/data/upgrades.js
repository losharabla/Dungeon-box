/**
 * @fileoverview Run-scoped upgrades — pure data (design doc §16, §17, §20).
 *
 * Upgrades are temporary: they apply only to the current run. Each entry
 * declares an `apply(player)` effect, which is the single extension point
 * for new progression content.
 */

/**
 * @typedef {object} UpgradeDef
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {number} price        gold cost in the shop (0 = not sold)
 * @property {'shop'|'reward'|'both'} source
 * @property {'common'|'rare'} rarity
 * @property {(player: any) => void} apply
 */

/** @type {Record<string, UpgradeDef>} */
export const UPGRADES = {
  damage_10: {
    id: 'damage_10',
    name: '+10% Damage',
    desc: 'Весь наносимый урон увеличен на 10%.',
    price: 80,
    source: 'both',
    rarity: 'common',
    apply: (p) => { p.modifiers.damageMul += 0.10; },
  },

  max_hp_20: {
    id: 'max_hp_20',
    name: '+20 Max HP',
    desc: 'Максимальный запас здоровья увеличен на 20.',
    price: 70,
    source: 'both',
    rarity: 'common',
    apply: (p) => { p.modifiers.maxHpBonus += 20; p.increaseMaxHp(20, true); },
  },

  speed_15: {
    id: 'speed_15',
    name: '+15% Movement Speed',
    desc: 'Скорость передвижения увеличена на 15%.',
    price: 80,
    source: 'both',
    rarity: 'common',
    apply: (p) => { p.modifiers.speedMul += 0.15; },
  },

  crit_10: {
    id: 'crit_10',
    name: '+10% Critical Chance',
    desc: 'Шанс критического удара увеличен на 10%.',
    price: 90,
    source: 'both',
    rarity: 'common',
    apply: (p) => { p.modifiers.critChance += 0.10; },
  },

  attack_speed_20: {
    id: 'attack_speed_20',
    name: '+20% Attack Speed',
    desc: 'Скорость атаки увеличена на 20%.',
    price: 95,
    source: 'both',
    rarity: 'common',
    apply: (p) => { p.modifiers.attackSpeedMul += 0.20; },
  },

  /* Healing-room variants use the same effects at the documented rates. */
  heal_max_hp_10: {
    id: 'heal_max_hp_10',
    name: '+10% Max HP',
    desc: 'Максимальный запас здоровья увеличен на 10%.',
    price: 0,
    source: 'reward',
    rarity: 'common',
    apply: (p) => {
      const amount = Math.round(p.maxHp * 0.10);
      p.modifiers.maxHpBonus += amount;
      p.increaseMaxHp(amount, true);
    },
  },

  heal_damage_10: {
    id: 'heal_damage_10',
    name: '+10% Damage',
    desc: 'Весь наносимый урон увеличен на 10%.',
    price: 0,
    source: 'reward',
    rarity: 'common',
    apply: (p) => { p.modifiers.damageMul += 0.10; },
  },

  heal_speed_10: {
    id: 'heal_speed_10',
    name: '+10% Movement Speed',
    desc: 'Скорость передвижения увеличена на 10%.',
    price: 0,
    source: 'reward',
    rarity: 'common',
    apply: (p) => { p.modifiers.speedMul += 0.10; },
  },

  /* ---------------- Rarer rewards ---------------- */

  life_steal: {
    id: 'life_steal',
    name: 'Vampiric Edge',
    desc: '5% нанесённого урона возвращается как здоровье.',
    price: 140,
    source: 'both',
    rarity: 'rare',
    apply: (p) => { p.modifiers.lifeSteal += 0.05; },
  },

  armor_3: {
    id: 'armor_3',
    name: 'Iron Hide',
    desc: 'Каждый входящий удар ослаблен на 3 единицы.',
    price: 130,
    source: 'both',
    rarity: 'rare',
    apply: (p) => { p.modifiers.armor += 3; },
  },

  damage_25: {
    id: 'damage_25',
    name: '+25% Damage',
    desc: 'Весь наносимый урон увеличен на 25%.',
    price: 170,
    source: 'both',
    rarity: 'rare',
    apply: (p) => { p.modifiers.damageMul += 0.25; },
  },

  attack_speed_35: {
    id: 'attack_speed_35',
    name: '+35% Attack Speed',
    desc: 'Скорость атаки увеличена на 35%.',
    price: 175,
    source: 'both',
    rarity: 'rare',
    apply: (p) => { p.modifiers.attackSpeedMul += 0.35; },
  },
};

/** Upgrade ids that can appear as an arena reward. */
export const REWARD_UPGRADE_IDS = Object.values(UPGRADES)
  .filter((u) => u.source === 'both' || u.source === 'reward')
  .map((u) => u.id);

/** Upgrade ids sold in the shop. */
export const SHOP_UPGRADE_IDS = Object.values(UPGRADES)
  .filter((u) => u.source === 'both')
  .map((u) => u.id);

/**
 * @param {string} id
 * @returns {UpgradeDef}
 */
export function getUpgrade(id) {
  const def = UPGRADES[id];
  if (!def) throw new Error(`Unknown upgrade "${id}"`);
  return def;
}
