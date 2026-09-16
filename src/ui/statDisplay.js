/**
 * @fileoverview Stat readouts for the HUD and the offer cards.
 *
 * SRP: turn the player's modifiers and a weapon definition into the short
 * strings the interface shows. Pure functions — no DOM, no canvas, nothing
 * beyond the objects handed in — so the arithmetic behind a displayed number
 * is testable headlessly and the same helpers feed the bottom-left HUD block
 * and the shop/reward cards.
 *
 * Why this exists at all: the run's power is a stack of invisible
 * multipliers. "Vampiric Edge: 5% of the damage you deal is returned as
 * health" does not say what the player's total becomes, so a second copy
 * reads exactly like a broken one. Everything here answers "and now?".
 */

import { fmtInt } from '../core/MathUtils.js';

/** Names of the modifiers a `stat` descriptor can point at. */
const STAT_LABELS = {
  damageMul: 'Damage',
  speedMul: 'Move speed',
  attackSpeedMul: 'Attack speed',
  critChance: 'Crit chance',
  lifeSteal: 'Life steal',
  armor: 'Armor',
  maxHpBonus: 'Max HP',
  maxHp: 'Max HP',
};

/**
 * The character panel, in display order.
 *
 * `base` is what a fresh run starts with, so a chip still sitting on its
 * baseline renders dim: the panel is a record of what this run has added,
 * and a row of "+0%" would read as noise rather than as information.
 * @type {Array<{key: string, label: string, format: 'mul'|'pct'|'flat', base: number}>}
 */
export const STAT_CHIPS = [
  { key: 'damageMul', label: 'DMG', format: 'mul', base: 1 },
  { key: 'attackSpeedMul', label: 'ATK', format: 'mul', base: 1 },
  { key: 'speedMul', label: 'SPD', format: 'mul', base: 1 },
  { key: 'critChance', label: 'CRIT', format: 'pct', base: 0.05 },
  { key: 'lifeSteal', label: 'LEECH', format: 'pct', base: 0 },
  { key: 'armor', label: 'ARMOR', format: 'flat', base: 0 },
];

/**
 * Print one stat value the way its row reads it.
 *
 * `mul` is a *multiplier*: 1.10 is "+10%", not "110%". `pct` is already a
 * share: 0.05 is "5%". The distinction matters — the game says "+10%
 * damage", and the number on screen has to say the same thing.
 * @param {'mul'|'pct'|'flat'|'hp'} format
 * @param {number} value
 * @returns {string}
 */
function formatValue(format, value) {
  if (format === 'mul') {
    const pct = Math.round((value - 1) * 100);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
  }
  if (format === 'pct') return `${Math.round(value * 100)}%`;
  return fmtInt(value);
}

/**
 * One chip per row of `STAT_CHIPS`: the current total, and whether this run
 * has moved it off its baseline.
 * @param {any} player
 * @returns {Array<{label: string, text: string, boosted: boolean}>}
 */
export function characterStatChips(player) {
  const m = player?.modifiers ?? {};
  return STAT_CHIPS.map((row) => {
    const value = Number(m[row.key] ?? row.base);
    return {
      label: row.label,
      text: formatValue(row.format, value),
      boosted: value > row.base,
    };
  });
}

/**
 * Traits the headline numbers do not already say. Each entry reads one field
 * of the definition and renders only when it is set, so a plain sword shows
 * damage, cadence, dps and kind while a staff also shows its burn and its
 * held beam.
 * @type {Array<{when: (w: any) => boolean, text: (w: any) => string}>}
 */
const TRAITS = [
  { when: (w) => w.critBonus > 0, text: (w) => `+${Math.round(w.critBonus * 100)}% crit` },
  { when: (w) => w.burnDamage > 0, text: (w) => `burn ${fmtInt(w.burnDamage)}/s` },
  { when: (w) => w.slowChance > 0, text: (w) => `slow ${Math.round(w.slowChance * 100)}%` },
  { when: (w) => w.stunChance > 0, text: (w) => `stun ${Math.round(w.stunChance * 100)}%` },
  { when: (w) => w.chainChance > 0, text: (w) => `chain ${Math.round(w.chainChance * 100)}%` },
  {
    when: (w) => (w.projectile?.pierce ?? 0) > 0,
    text: (w) => (w.projectile.pierce >= 99 ? 'pierce all' : `pierce ${fmtInt(w.projectile.pierce)}`),
  },
  {
    when: (w) => (w.projectile?.explosionRadius ?? w.explosionRadius) > 0,
    text: (w) => `blast ${fmtInt(w.projectile?.explosionRadius ?? w.explosionRadius)}px`,
  },
  { when: (w) => w.healOnKill > 0, text: (w) => `+${fmtInt(w.healOnKill)} hp/kill` },
  { when: (w) => w.heatRamp > 0, text: () => 'accelerates' },
  { when: (w) => w.knockback >= 200, text: (w) => `knockback ${fmtInt(w.knockback)}` },
  {
    when: (w) => Boolean(w.beam),
    text: (w) => (w.beam.damageMax
      ? `beam ${fmtInt(w.beam.damage)}→${fmtInt(w.beam.damageMax)}/s`
      : `beam ${fmtInt(w.beam.damage)}/s`),
  },
];

/**
 * The one-line summary of a weapon: damage per hit (or per pellet), cadence,
 * a paper dps, its kind, and its traits.
 *
 * The dps figure is deliberately *unramped*: the Hellstorm's heat and the
 * lightning staff's beam ramp are transient, so folding them in would make
 * the number flicker while the trigger is held and the line uncacheable. The
 * attack-speed modifier is included, because that one is permanent.
 * @param {any} weapon a `WeaponDef`
 * @param {any} player
 * @returns {string} empty when there is no weapon
 */
export function weaponStatLine(weapon, player) {
  if (!weapon) return '';
  const m = player?.modifiers ?? {};
  const damageMul = Number(m.damageMul ?? 1);
  const rateMul = Math.max(0.1, Number(m.attackSpeedMul ?? 1));
  const pellets = Math.max(1, Number(weapon.projectile?.count ?? 1));
  const perHit = Number(weapon.baseDamage ?? 0) * damageMul;
  const cooldown = Math.max(0.01, Number(weapon.cooldown ?? 1) / rateMul);
  const dps = (perHit * pellets) / cooldown;

  const kind = weapon.kind === 'melee' ? 'melee' : weapon.kind === 'magic' ? 'staff' : 'gun';
  const parts = [
    pellets > 1 ? `${fmtInt(perHit)}×${pellets} dmg` : `${fmtInt(perHit)} dmg`,
    `${cooldown.toFixed(2)}s`,
    `${fmtInt(dps)} dps`,
    kind,
  ];
  for (const trait of TRAITS) if (trait.when(weapon)) parts.push(trait.text(weapon));
  return parts.join(' · ');
}

/**
 * What an upgrade does to the player's *total*, as one line:
 * "Life steal 5% → 10%", "Max HP 150 → 170".
 *
 * Reading the current value off the player is the whole point: the same card
 * is shown to someone who has never taken the upgrade and to someone who has
 * taken it twice, and "does it stack?" has to be answerable from the card.
 * @param {any} def an `UpgradeDef` (see data/upgrades.js)
 * @param {any} player
 * @returns {string|null} null when the definition carries no `stat`
 */
export function upgradeDeltaLine(def, player) {
  const stat = def?.stat;
  if (!stat) return null;
  const label = STAT_LABELS[stat.key] ?? stat.key;

  if (stat.format === 'hp') {
    // The printed value is the health pool itself, and the amount is either
    // flat or a share of that pool — exactly what `apply` does.
    const before = Number(player?.maxHp ?? 0);
    const amount = stat.fraction != null
      ? Math.round(before * stat.fraction)
      : Number(stat.add ?? 0);
    return `${label} ${fmtInt(before)} → ${fmtInt(before + amount)}`;
  }

  const m = player?.modifiers ?? {};
  const before = Number(m[stat.key] ?? 0);
  const after = before + Number(stat.add ?? 0);
  return `${label} ${formatValue(stat.format, before)} → ${formatValue(stat.format, after)}`;
}
