/**
 * @fileoverview Enemy definitions — pure data (design doc §11, §30).
 *
 * Each entry describes stats plus an `ai` block that tells the AI system
 * how the enemy behaves. Adding enemy #11 means adding an object here and
 * an entry in the renderer registry; no system code changes.
 */

/**
 * @typedef {'chaser'|'melee'|'kiter'|'bomber'|'dasher'|'shield'|'assassin'|'summoner'} AIArchetype
 */

/**
 * @typedef {object} EnemyDef
 * @property {string} id
 * @property {string} name
 * @property {AIArchetype} ai
 * @property {number} maxHp
 * @property {number} speed    Movement Speed units (× CONFIG.world.speedUnit)
 * @property {number} damage
 * @property {number} radius     physical footprint for walls/separation
 * @property {number} [hitWidth] width of the drawn body, in px. Sprites stand
 *   *above* their position, so a circle on the ground point only ever covered
 *   the legs: an orc is drawn 70px tall and used to be hittable across 3% of
 *   its silhouette. These box values come from `node tools/hitbox-audit.mjs`
 *   and are used for targeting only — never for movement.
 * @property {number} [hitUp]    how far the drawn body rises above the ground
 * @property {number} [hitDown]  how far it reaches below the ground point
 * @property {number} [hitRadius] circle half-width for art that fits a circle
 *   (used only when `hitWidth` is absent)
 * @property {number} xpValue  gold range on death
 * @property {number} goldMin
 * @property {number} goldMax
 * @property {number} attackCooldown
 * @property {number} attackRange
 * @property {'melee'|'ranged'} attackType
 * @property {number} weight     spawn weighting
 * @property {boolean} [elite]   eligible for elite waves
 * @property {string} desc
 * @property {object} [summon]   for the necromancer
 * @property {string} [summon.id]
 * @property {number} [summon.count]
 * @property {number} [summon.cooldown]
 * @property {number} [dashSpeed]      dasher archetype burst speed multiplier
 * @property {number} [dashCooldown]
 * @property {number} [preferRange]    kiters try to hold this distance
 * @property {number} [retreatSpeedMul] fraction of `speed` used while backing
 *   away. Must stay clearly below 1 so a melee class can always close the gap;
 *   a kiter that retreats at full speed can outrun the player forever.
 * @property {number} [parryable]      false makes a projectile immune to a melee parry
 * @property {number} [healthThreshold] berserker enrage trigger, 0..1
 * @property {number} [enrageSpeedMul]
 * @property {number} [enrageDamageMul]
 * @property {number} [stealth]        assassin invisibility ratio
 * @property {number} [turnRate]       how fast the enemy rotates to face the player
 * @property {number} [blockArc]       half-angle of a shield's frontal block, radians
 */

/** @type {Record<string, EnemyDef>} */
export const ENEMIES = {
  /* 1 — Slime */
  slime: {
    id: 'slime', name: 'Slime', ai: 'chaser',
    // The gel squashes to 32px wide with its skirt 11px below the origin.
    maxHp: 34, speed: 1.5, damage: 8, radius: 15,
    hitWidth: 33, hitUp: 15, hitDown: 12,
    goldMin: 3, goldMax: 7, xpValue: 1,
    attackCooldown: 0.9, attackRange: 26, attackType: 'melee',
    weight: 10,
    desc: 'Crawls slowly straight at the player. Low HP, weak blow.',
  },

  /* 2 — Goblin */
  goblin: {
    id: 'goblin', name: 'Goblin', ai: 'melee',
    maxHp: 26, speed: 3.4, damage: 10, radius: 13,
    hitWidth: 35, hitUp: 24, hitDown: 8,
    goldMin: 5, goldMax: 11, xpValue: 1,
    attackCooldown: 0.65, attackRange: 30, attackType: 'melee',
    weight: 10,
    desc: 'A fast melee fighter with a small HP pool.',
  },

  /* 3 — Skeleton */
  skeleton: {
    id: 'skeleton', name: 'Skeleton', ai: 'kiter',
    maxHp: 32, speed: 2.0, damage: 11, radius: 13,
    hitWidth: 26, hitUp: 31, hitDown: 7,
    goldMin: 6, goldMax: 13, xpValue: 1,
    attackCooldown: 1.5, attackRange: 420, attackType: 'ranged',
    preferRange: 250, retreatSpeedMul: 0.55, weight: 9,
    desc: 'Fires projectiles and tries to keep its distance.',
  },

  /* 4 — Orc */
  orc: {
    id: 'orc', name: 'Orc', ai: 'melee',
    // Drawn 37x70 with the crown at y-66: the tallest silhouette in the game,
    // and the worst mismatch before hit boxes existed (3% covered).
    maxHp: 92, speed: 1.9, damage: 20, radius: 18,
    hitWidth: 43, hitUp: 69, hitDown: 7,
    goldMin: 12, goldMax: 22, xpValue: 2,
    attackCooldown: 1.1, attackRange: 38, attackType: 'melee',
    weight: 7, elite: true,
    desc: 'Slow and tough, and it hurts badly up close.',
  },

  /* 5 — Bat */
  bat: {
    id: 'bat', name: 'Bat', ai: 'dasher',
    // The wing membrane is 46px across and it is what the player sees and
    // aims at, so the combat box spans it. Movement keeps the 11px body.
    maxHp: 20, speed: 3.0, damage: 7, radius: 11,
    hitWidth: 47, hitUp: 16, hitDown: 9,
    goldMin: 4, goldMax: 9, xpValue: 1,
    attackCooldown: 0.55, attackRange: 26, attackType: 'melee',
    dashSpeed: 4.2, dashCooldown: 2.6, weight: 8,
    desc: 'Very fast, and it periodically dashes at the player.',
  },

  /* 6 — Mage */
  enemy_mage: {
    id: 'enemy_mage', name: 'Mage', ai: 'bomber',
    // The robe is 31px wide and 42px tall. The detached orbiting focus stays
    // cosmetic and is intentionally not part of the body hit box.
    maxHp: 38, speed: 1.9, damage: 15, radius: 14,
    hitWidth: 32, hitUp: 37, hitDown: 7,
    goldMin: 10, goldMax: 18, xpValue: 2,
    attackCooldown: 2.2, attackRange: 400, attackType: 'ranged',
    preferRange: 260, retreatSpeedMul: 0.6, weight: 6, elite: true,
    desc: 'Ranged, with AoE blasts, and it keeps its distance.',
  },

  /* 7 — Shieldbearer */
  shieldbearer: {
    id: 'shieldbearer', name: 'Shieldbearer', ai: 'shield',
    maxHp: 78, speed: 1.8, damage: 16, radius: 16,
    hitWidth: 36, hitUp: 49, hitDown: 6,
    goldMin: 12, goldMax: 20, xpValue: 2,
    attackCooldown: 1.1, attackRange: 36, attackType: 'melee',
    /**
     * Deliberately sluggish turning: the shield only covers the front arc
     * (§11.7 "vulnerable from behind"), so the player can out-manoeuvre it.
     * With an instant turn rate the weakness would be impossible to reach.
     */
    turnRate: 1.5,
    /** Half-angle of the blocked frontal arc, in radians. */
    blockArc: 0.85,
    weight: 6, elite: true,
    desc: 'Blocks blows from the front and is vulnerable from behind. Turns slowly.',
  },

  /* 8 — Assassin */
  assassin: {
    id: 'assassin', name: 'Assassin', ai: 'assassin',
    maxHp: 28, speed: 3.2, damage: 22, radius: 13,
    hitWidth: 22, hitUp: 44, hitDown: 5,
    goldMin: 14, goldMax: 24, xpValue: 2,
    attackCooldown: 0.7, attackRange: 32, attackType: 'melee',
    stealth: 0.12, weight: 5, elite: true,
    desc: 'Vanishes, blinks in beside you and strikes fast.',
  },

  /* 9 — Berserker */
  berserker: {
    id: 'berserker', name: 'Berserker', ai: 'melee',
    maxHp: 66, speed: 2.6, damage: 18, radius: 16,
    hitWidth: 34, hitUp: 52, hitDown: 6,
    goldMin: 13, goldMax: 23, xpValue: 2,
    attackCooldown: 0.85, attackRange: 36, attackType: 'melee',
    healthThreshold: 0.4, enrageSpeedMul: 1.6, enrageDamageMul: 1.5,
    weight: 7, elite: true,
    desc: 'At low HP it moves faster and hits harder.',
  },

  /* 10 — Necromancer */
  necromancer: {
    id: 'necromancer', name: 'Necromancer', ai: 'summoner',
    maxHp: 44, speed: 1.7, damage: 9, radius: 15,
    hitWidth: 33, hitUp: 39, hitDown: 7,
    goldMin: 18, goldMax: 30, xpValue: 3,
    attackCooldown: 2.0, attackRange: 380, attackType: 'ranged',
    preferRange: 320,
    summon: { id: 'skeleton', count: 2, cooldown: 6.5 },
    weight: 4, elite: true,
    desc: 'Weak itself, but it keeps summoning skeletons. Priority target.',
  },
};

/** Ids usable in ordinary arena waves (elites are added for elite waves). */
export const BASIC_ENEMY_IDS = Object.values(ENEMIES).filter((e) => !e.elite).map((e) => e.id);

/** Ids reserved for elite waves. */
export const ELITE_ENEMY_IDS = Object.values(ENEMIES).filter((e) => e.elite).map((e) => e.id);

/**
 * @param {string} id
 * @returns {EnemyDef}
 */
export function getEnemy(id) {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Unknown enemy "${id}"`);
  return def;
}
