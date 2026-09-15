/**
 * @fileoverview Boss definitions — pure data (design doc §12, §13, §14).
 *
 * A boss is an enemy definition plus an ordered list of attack patterns and
 * a phase-two threshold. The BossController interprets this; the data file
 * only declares it.
 */

/**
 * @typedef {object} BossAttack
 * @property {string} id
 * @property {'slam'|'shockwave'|'rockVolley'|'summon'|'fireball'|'fireRain'|'fireWall'|'dash'|'combo'|'spin'|'teleport'|'cloneVolley'} kind
 * @property {number} telegraph   seconds of warning before it lands
 * @property {number} damage
 * @property {number} radius
 * @property {number} cooldown
 * @property {number} [count]
 */

/**
 * @typedef {object} BossDef
 * @property {string} id
 * @property {string} name
 * @property {string} title
 * @property {number} maxHp
 * @property {number} speed
 * @property {number} damage
 * @property {number} radius
 * @property {number} [hitWidth] width of the drawn sprite; bosses are painted
 *   far wider than their physical footprint
 * @property {number} [hitUp]    how far the sprite rises above the ground point
 * @property {number} [hitDown]  how far it reaches below it
 * @property {number} goldMin
 * @property {number} goldMax
 * @property {number} phase2At      HP fraction that triggers phase 2
 * @property {number} phase2SpeedMul
 * @property {number} phase2CooldownMul
 * @property {BossAttack[]} attacks
 * @property {string} desc
 * @property {string} palette       base colour family for rendering
 */

/** @type {Record<string, BossDef>} */
export const BOSSES = {
  /* ---------------- Boss 1 (design doc §12) ---------------- */
  stone_golem: {
    id: 'stone_golem',
    name: 'STONE GOLEM',
    title: 'Warden of the First Hall',
    maxHp: 900,
    speed: 1.5,
    damage: 26,
    radius: 46,
    // Shoulders are drawn at ±1.16r and arms beyond that, so the sprite is
    // 121px across and 103px tall while the footprint is 92px. Measured by
    // `node tools/hitbox-audit.mjs`.
    hitWidth: 122,
    hitUp: 70,
    hitDown: 35,
    goldMin: 120,
    goldMax: 180,
    phase2At: 0.5,
    phase2SpeedMul: 1.55,
    phase2CooldownMul: 0.62,
    palette: '#6b6357',
    desc: 'A huge stone colossus: melee blows, a ground slam, hurled rocks and summoned reinforcements.',
    attacks: [
      { id: 'slam', kind: 'slam', telegraph: 0.55, damage: 30, radius: 92, cooldown: 3.4 },
      { id: 'shockwave', kind: 'shockwave', telegraph: 0.85, damage: 24, radius: 190, cooldown: 6.5 },
      { id: 'rocks', kind: 'rockVolley', telegraph: 0.7, damage: 18, radius: 12, cooldown: 5.2, count: 5 },
      // Two minions on a long cooldown: enough to add pressure without
      // burying the boss behind a wall of bodies.
      { id: 'summon', kind: 'summon', telegraph: 0.9, damage: 0, radius: 0, cooldown: 13, count: 2 },
    ],
  },

  /* ---------------- Boss 2 (design doc §13) ---------------- */
  fire_lord: {
    id: 'fire_lord',
    name: 'FIRE LORD',
    title: 'Lord of the Burning Halls',
    maxHp: 1050,
    speed: 1.9,
    damage: 22,
    radius: 42,
    // Drawn 99px wide and 106px tall, crown at y-80.
    hitWidth: 100,
    hitUp: 81,
    hitDown: 27,
    goldMin: 160,
    goldMax: 230,
    phase2At: 0.5,
    phase2SpeedMul: 1.4,
    phase2CooldownMul: 0.55,
    palette: '#c8452f',
    desc: 'A ranged AoE boss. The arena turns into a sea of fire - keep moving at all times.',
    attacks: [
      { id: 'fireball', kind: 'fireball', telegraph: 0.45, damage: 22, radius: 16, cooldown: 1.9, count: 3 },
      { id: 'rain', kind: 'fireRain', telegraph: 1.0, damage: 26, radius: 66, cooldown: 7.0, count: 7 },
      { id: 'wall', kind: 'fireWall', telegraph: 1.2, damage: 30, radius: 28, cooldown: 9.0, count: 2 },
      { id: 'summon', kind: 'summon', telegraph: 0.8, damage: 0, radius: 0, cooldown: 14, count: 2 },
    ],
  },

  /* ---------------- Boss 3 (design doc §14) ---------------- */
  executioner: {
    id: 'executioner',
    name: 'EXECUTIONER',
    title: 'The Final Executioner',
    maxHp: 1400,
    speed: 2.6,
    damage: 32,
    radius: 40,
    // Drawn 118px wide and 88px tall, but the blades sweep out to ±68 and
    // rotate with facing, so the centred box has to reach that far.
    hitWidth: 139,
    hitUp: 62,
    hitDown: 31,
    goldMin: 240,
    goldMax: 340,
    phase2At: 0.5,
    phase2SpeedMul: 1.5,
    phase2CooldownMul: 0.5,
    palette: '#3a2f45',
    desc: 'A fast, mobile executioner: dashes, flurries of blows, a spinning attack and a teleport.',
    attacks: [
      { id: 'dash', kind: 'dash', telegraph: 0.5, damage: 34, radius: 54, cooldown: 3.4 },
      { id: 'combo', kind: 'combo', telegraph: 0.4, damage: 18, radius: 70, cooldown: 4.6, count: 3 },
      { id: 'spin', kind: 'spin', telegraph: 0.65, damage: 30, radius: 140, cooldown: 6.8 },
      { id: 'teleport', kind: 'teleport', telegraph: 0.3, damage: 0, radius: 0, cooldown: 5.6 },
      { id: 'clones', kind: 'cloneVolley', telegraph: 0.8, damage: 20, radius: 12, cooldown: 8.5, count: 6 },
    ],
  },
};

/** Boss order per floor (design doc §19: Boss Arena ends each run). */
export const BOSS_ORDER = ['stone_golem', 'fire_lord', 'executioner'];

/**
 * @param {string} id
 * @returns {BossDef}
 */
export function getBoss(id) {
  const def = BOSSES[id];
  if (!def) throw new Error(`Unknown boss "${id}"`);
  return def;
}

/**
 * Pick the boss for a given floor index (0-based), cycling after the last.
 * @param {number} floorIndex
 * @returns {BossDef}
 */
export function bossForFloor(floorIndex) {
  const id = BOSS_ORDER[Math.min(floorIndex, BOSS_ORDER.length - 1)];
  return getBoss(id ?? 'stone_golem');
}
