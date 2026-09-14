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
    desc: 'Сбалансированный клинок. Средний урон, средняя скорость.',
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
    desc: 'Тяжёлый топор с широким замахом и небольшим AoE.',
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
    desc: 'Очень высокий урон, сильный knockback и шанс оглушить.',
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
    desc: 'Огненные снаряды, поджигающие цель.',
    projectile: {
      speed: 520, life: 1.25, radius: 8, visual: 'fire',
      explosionRadius: 34, explosionChance: 0.15,
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
    desc: 'Меньше урона, но надёжно замедляет врагов.',
    projectile: { speed: 560, life: 1.2, radius: 7, visual: 'ice' },
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
    desc: 'Быстрые снаряды с шансом дополнительной цепи молний.',
    projectile: { speed: 760, life: 1.0, radius: 5, visual: 'lightning' },
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
    desc: 'Высокая точность и скорость атаки, небольшой урон.',
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
    desc: 'Семь дробинок. Опустошает вблизи, слабеет на дистанции.',
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
    desc: 'Очень высокая скорострельность, слабая одиночная пуля.',
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
    desc: 'Огромный урон, низкая скорострельность, пробивает врагов насквозь.',
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
    desc: 'Убийство восстанавливает HP. Чем агрессивнее игра, тем больше жизни.',
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
    desc: 'Снаряды проходят сквозь врагов и взрываются при попадании.',
    projectile: {
      speed: 700, life: 1.6, radius: 11, visual: 'void',
      pierce: 99, explosionRadius: 74, explosionChance: 0.5,
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
    desc: 'Чем дольше непрерывный огонь, тем выше скорострельность.',
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
