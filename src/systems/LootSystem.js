/**
 * @fileoverview Loot generation and the shop stock.
 *
 * SRP: decide what rewards and stock exist, and price them. It reads the
 * player's class to pick sensible weapons, but it never applies effects —
 * that is `applyUpgrade`/`equip`, called by the room controller.
 */

import { rng } from '../core/Random.js';
import { CONFIG } from '../core/Config.js';
import { WEAPONS, getWeapon } from '../data/weapons.js';
import { SHOP_UPGRADE_IDS, getUpgrade } from '../data/upgrades.js';

/**
 * @typedef {object} LootEntry
 * @property {'weapon'|'upgrade'|'gold'|'potion'} kind
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {number} price
 * @property {boolean} [legendary]
 */

export class LootSystem {
  /**
   * Weapon ids the given class can use, split by tier.
   * @param {string} classId
   * @returns {{normal: string[], legendary: string[]}}
   */
  static weaponsFor(classId) {
    const normal = [];
    const legendary = [];
    for (const w of Object.values(WEAPONS)) {
      if (w.ownerClass !== classId && w.ownerClass !== 'any') continue;
      if (w.legendary) legendary.push(w.id);
      else normal.push(w.id);
    }
    return { normal, legendary };
  }

  /**
   * Roll one arena reward (design doc §15).
   *
   * The composition is deliberate: a legendary weapon is rare, a normal
   * weapon is common early, and upgrades always give a fallback so a reward
   * is never "nothing".
   *
   * @param {string} classId
   * @param {number} floorIndex
   * @param {boolean} [guaranteeWeapon]
   * @returns {LootEntry[]} 1-2 choices
   */
  rollArenaReward(classId, floorIndex, guaranteeWeapon = false) {
    /** @type {LootEntry[]} */
    const choices = [];
    const { normal, legendary } = LootSystem.weaponsFor(classId);

    const legendaryChance = 0.04 + floorIndex * 0.03;
    const weaponChance = guaranteeWeapon ? 1 : 0.42;

    if (normal.length > 0 && rng.chance(weaponChance)) {
      const wantLegendary = legendary.length > 0 && rng.chance(legendaryChance);
      const pool = wantLegendary ? legendary : normal;
      const id = rng.pickOne(pool);
      const w = getWeapon(id);
      choices.push({
        kind: 'weapon',
        id,
        name: w.name,
        desc: w.desc,
        price: 0,
        legendary: w.legendary === true,
      });
    }

    // Always offer an upgrade alongside, so the reward is never a dead end
    // for a player who already likes their weapon.
    const upgradeId = rng.pickOne(SHOP_UPGRADE_IDS);
    const up = getUpgrade(upgradeId);
    choices.push({
      kind: 'upgrade', id: upgradeId, name: up.name, desc: up.desc, price: 0,
    });

    // Gold is a guaranteed third option: simple, always useful.
    choices.push({
      kind: 'gold',
      id: 'gold_pile',
      name: 'Золото',
      desc: 'Куча монет для лавки.',
      price: 0,
    });

    return choices;
  }

  /**
   * Build the shop's stock (design doc §17).
   *
   * After a purchase the item must disappear, so each entry carries a
   * `sold` flag the shop screen toggles.
   *
   * @param {string} classId
   * @param {number} floorIndex
   * @returns {LootEntry[]}
   */
  buildShopStock(classId, floorIndex) {
    /** @type {LootEntry[]} */
    const stock = [];
    const { normal, legendary } = LootSystem.weaponsFor(classId);

    // One weapon offer, occasionally legendary at a steep price.
    const wantLegendary = legendary.length > 0 && rng.chance(0.12 + floorIndex * 0.04);
    const weaponId = rng.pickOne(wantLegendary ? legendary : normal);
    const w = getWeapon(weaponId);
    stock.push({
      kind: 'weapon',
      id: weaponId,
      name: w.name,
      desc: w.desc,
      price: w.legendary ? 260 : 50,
      legendary: w.legendary === true,
    });

    // A potion, matching the document's sample stock.
    stock.push({
      kind: 'potion',
      id: 'potion',
      name: 'Potion',
      desc: 'Восстанавливает 40% максимального здоровья.',
      price: 30,
    });

    // Two distinct upgrades at the documented price band.
    const upgradeIds = rng.sample(SHOP_UPGRADE_IDS, 2);
    for (const id of upgradeIds) {
      const up = getUpgrade(id);
      stock.push({
        kind: 'upgrade',
        id,
        name: up.name,
        desc: up.desc,
        price: up.price,
      });
    }

    // A healing service, so gold is never useless.
    stock.push({
      kind: 'potion',
      id: 'greater_potion',
      name: 'Greater Potion',
      desc: 'Полностью восстанавливает здоровье.',
      price: 120,
    });

    return stock;
  }

  /**
   * Boss rooms pay out a weapon offer plus gold (design doc §18).
   *
   * The weapon is a *chance* at the legendary tier rather than a guarantee:
   * three bosses per run rolling at `CONFIG.loot.bossLegendaryChance` still
   * make a boss the single best legendary source in the game, without the
   * rarest items becoming a certainty for anyone who finishes a campaign.
   *
   * The harder boss variant is the reason to take the louder door: it rolls
   * at `bossEliteLegendaryBonus` *above* the normal rate, so choosing the
   * fight with the elite guard buys a materially better shot at a legendary.
   *
   * @param {string} classId
   * @param {boolean} [elite] the boss was taken with its elite guard
   * @returns {LootEntry[]} 2 choices
   */
  rollBossReward(classId, elite = false) {
    const { normal, legendary } = LootSystem.weaponsFor(classId);
    /** @type {LootEntry[]} */
    const choices = [];

    const chance = CONFIG.loot.bossLegendaryChance
      + (elite ? CONFIG.loot.bossEliteLegendaryBonus : 0);
    const wantLegendary = legendary.length > 0 && rng.chance(Math.min(1, chance));
    const pool = wantLegendary ? legendary : (normal.length > 0 ? normal : legendary);
    if (pool.length > 0) {
      const id = rng.pickOne(pool);
      const w = getWeapon(id);
      choices.push({
        kind: 'weapon', id, name: w.name, desc: w.desc, price: 0,
        legendary: w.legendary === true,
      });
    }

    choices.push({
      kind: 'gold', id: 'gold_pile', name: 'Золото', desc: 'Богатая добыча.', price: 0,
    });
    return choices;
  }
}
