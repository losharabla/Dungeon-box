/**
 * @fileoverview Room-type presentation: the one place that decides what a
 * room type looks like.
 *
 * SRP: map a room *type* to its colour and its short label. The floor deals
 * the player a choice of rooms, the controller builds geometry, and several
 * renderers draw doors — without a shared table each of them would invent its
 * own palette and the same type would look different in the world and on the
 * HUD.
 *
 * The colours are the contract the player reads: a door, its plate and the
 * exit marker that share a colour describe the same kind of room, and the
 * `elite` variant is a second, louder colour — because "an arena or a harder
 * arena" is a real decision the player has to be able to see at a glance.
 */

/**
 * @typedef {'start'|'arena'|'shop'|'healing'|'boss'} RoomType
 */

/** Colour per room type. Keys are `RoomType`; `default` covers the unknown. */
export const ROOM_TYPE_COLORS = {
  start: '#b9c4d8',
  arena: '#4fd2ff',
  shop: '#ffcf6b',
  healing: '#6ffbb0',
  boss: '#ff5a3c',
  default: '#9aa4b8',
};

/** Colour of the harder variant of a room type. */
export const ROOM_TYPE_ELITE_COLORS = {
  arena: '#9d7bff',
  boss: '#ff2d1a',
};

/** Short uppercase label per room type, shown on the door plate. */
export const ROOM_TYPE_LABELS = {
  start: 'ВХОД',
  arena: 'БОЙ',
  shop: 'ЛАВКА',
  healing: 'ЛЕЧЕНИЕ',
  boss: 'БОСС',
  default: 'КОМНАТА',
};

/**
 * @param {string|null|undefined} type
 * @param {{elite?: boolean}} [opts]
 * @returns {string} a usable colour even for an unknown type
 */
export function roomTypeColor(type, opts = {}) {
  if (opts.elite) {
    const elite = ROOM_TYPE_ELITE_COLORS[/** @type {keyof typeof ROOM_TYPE_ELITE_COLORS} */ (type)];
    if (elite) return elite;
  }
  return ROOM_TYPE_COLORS[type] ?? ROOM_TYPE_COLORS.default;
}

/**
 * @param {string|null|undefined} type
 * @param {{elite?: boolean}} [opts]
 * @returns {string}
 */
export function roomTypeLabel(type, opts = {}) {
  const base = ROOM_TYPE_LABELS[type] ?? ROOM_TYPE_LABELS.default;
  return opts.elite ? `${base}+` : base;
}
