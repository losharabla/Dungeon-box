/**
 * @fileoverview Game events → sound presets.
 *
 * SRP: translate. Systems already announce what happened on the EventBus, so
 * this module is the only place that decides *how it sounds* — no gameplay
 * system imports the audio engine and no preset id appears in game code.
 *
 * That indirection is also what keeps the mixer cheap: every subscription here
 * is a pure decision ("is this worth a voice?") made before any node is
 * created, and the engine's own culling then does the rest.
 */

import { EVENTS } from '../core/EventBus.js';
import { SOUND_PRESETS } from './soundPresets.js';
import { DEFAULT_MUSIC_TRACK, getMusicTrack } from './musicTracks.js';

/**
 * Weapon kind → firing preset. Melee is handled by the swing presets, because
 * the weight of a swing is what varies, not the weapon class.
 * @type {Record<string, string>}
 */
const WEAPON_FIRE_SOUND = {
  gun: 'shoot_light',
  magic: 'shoot_magic',
};

/**
 * Every preset this binding can ask for. Declared explicitly so a content test
 * can prove the binding never names a sound the engine does not have.
 * @type {readonly string[]}
 */
export const BOUND_SOUND_IDS = /** @type {const} */ ([
  'ui_click',
  'swing_light',
  'swing_heavy',
  'shoot_light',
  'shoot_heavy',
  'shoot_magic',
  'beam_start',
  'beam_overheat',
  'hit_flesh',
  'hit_crit',
  'hit_block',
  'shield_break',
  'enemy_death',
  'boss_death',
  'player_hurt',
  'defeat',
  'victory',
  'dash',
  'ult_ready',
  'ult_cast',
  'heal',
  'coin',
  'purchase',
  'wave_start',
  'room_clear',
  'door_open',
  'boss_spawn',
  'boss_phase',
]);

/**
 * Subscribe the mixer to a run's events.
 *
 * @param {object} deps
 * @param {import('./AudioSystem.js').AudioSystem} deps.audio
 * @param {import('../core/EventBus.js').EventBus} deps.bus
 * @returns {() => void} unsubscribe everything (used by tests)
 */
export function bindGameAudio({ audio, bus }) {
  /** @type {Array<() => void>} */
  const offs = [];
  /**
   * @param {string} event
   * @param {(payload: any) => void} handler
   */
  const on = (event, handler) => {
    offs.push(bus.on(event, handler));
  };

  /**
   * World position of a payload's actor, for panning and distance culling.
   * @param {any} entity
   */
  const at = (entity) => (
    entity && typeof entity.x === 'number'
      ? { x: entity.x, y: entity.y }
      : {}
  );

  /* ---------------- Music ---------------- */

  on(EVENTS.RUN_STARTED, () => {
    // The run's score. Starting a run is a click, so this call happens inside
    // the gesture the browser requires; `AudioSystem` handles the case where
    // the context has not finished resuming yet.
    audio.playMusic(getMusicTrack(DEFAULT_MUSIC_TRACK).url);
  });

  on(EVENTS.RUN_ENDED, ({ reason }) => {
    // Death and victory both end the score; only the sting differs.
    audio.stopMusic();
    if (reason === 'death') audio.play('defeat');
    else if (reason === 'victory') audio.play('victory');
  });

  /* ---------------- Attacks ---------------- */

  on(EVENTS.ATTACK_PERFORMED, ({ player, weapon }) => {
    if (!weapon) return;
    if (weapon.kind === 'melee') {
      // A heavier blade gets the wide sweep; the swing timing is a good proxy
      // for "this is going to feel like a haymaker".
      const heavy = (weapon.swingTime ?? 0) >= 0.25 || (weapon.range ?? 0) >= 84;
      audio.play(heavy ? 'swing_heavy' : 'swing_light', at(player));
      return;
    }
    const preset = WEAPON_FIRE_SOUND[weapon.kind] ?? 'shoot_light';
    // A shotgun's worth of pellets or one heavy round carries more weight.
    const punch = (weapon.projectile?.count ?? 1) > 1 || (weapon.baseDamage ?? 0) >= 40;
    audio.play(preset === 'shoot_light' && punch ? 'shoot_heavy' : preset, at(player));
  });

  /* ---------------- Beam ---------------- */

  // Only the edges are audible: the beam itself is silent, because the damage
  // it deals ticks twelve times a second and the mixer would spend the whole
  // fight on one weapon.
  on(EVENTS.BEAM_STARTED, ({ player }) => {
    audio.play('beam_start', at(player));
  });

  on(EVENTS.BEAM_OVERHEATED, ({ player }) => {
    audio.play('beam_overheat', at(player));
  });

  /* ---------------- Impacts ---------------- */

  on(EVENTS.DAMAGE_DEALT, ({ target, amount, crit }) => {
    if (!target || !(amount > 0)) return;
    if (target.faction === 'player') return; // covered by PLAYER_DAMAGED
    audio.play(crit ? 'hit_crit' : 'hit_flesh', at(target));
  });

  on(EVENTS.STATUS_APPLIED, ({ entity, status }) => {
    if (status === 'block') audio.play('hit_block', at(entity));
    else if (status === 'shieldBreak') audio.play('shield_break', at(entity));
  });

  on(EVENTS.PLAYER_DAMAGED, ({ amount }) => {
    // A heavier blow is louder, but the cue stays the same so the player
    // learns exactly one sound for "you are being hurt".
    audio.play('player_hurt', { gain: Math.min(1, 0.6 + (amount ?? 0) / 120) });
  });

  /* ---------------- Death ---------------- */

  on(EVENTS.ENTITY_DIED, ({ entity }) => {
    if (!entity) return;
    if (entity.faction === 'player') return; // RUN_ENDED owns that cue
    if (entity.kind === 'boss') audio.play('boss_death', at(entity));
    else audio.play('enemy_death', at(entity));
  });

  /* ---------------- Player abilities ---------------- */

  on(EVENTS.DASHED, ({ player }) => {
    audio.play('dash', at(player));
  });

  on(EVENTS.ULTIMATE_CHANGED, ({ ready }) => {
    if (ready) audio.play('ult_ready');
  });

  on(EVENTS.ULTIMATE_ACTIVATED, () => {
    audio.play('ult_cast');
  });

  on(EVENTS.HEALING_TAKEN, () => {
    audio.play('heal');
  });

  on(EVENTS.PLAYER_HEALED, () => {
    audio.play('heal', { gain: 0.7 });
  });

  /* ---------------- Economy and rewards ---------------- */

  on(EVENTS.GOLD_CHANGED, ({ delta }) => {
    // Only loot rings; spending gold must stay quiet.
    if ((delta ?? 0) > 0) audio.play('coin');
  });

  on(EVENTS.SHOP_PURCHASE, () => {
    audio.play('purchase');
  });

  on(EVENTS.WEAPON_PICKED, () => {
    audio.play('purchase', { gain: 0.8, pitch: 0.9 });
  });

  on(EVENTS.UPGRADE_TAKEN, () => {
    audio.play('purchase', { gain: 0.7, pitch: 1.15 });
  });

  /* ---------------- Rooms and floors ---------------- */

  on(EVENTS.WAVE_STARTED, () => {
    audio.play('wave_start');
  });

  on(EVENTS.ROOM_CLEARED, () => {
    audio.play('room_clear');
  });

  on(EVENTS.ROOM_ENTERED, ({ node }) => {
    // The entrance room is where a run begins: there is no door being walked
    // through, so it stays silent.
    if (!node || node.depth === 0) return;
    audio.play('door_open');
  });

  on(EVENTS.BOSS_SPAWNED, () => {
    audio.play('boss_spawn');
  });

  on(EVENTS.BOSS_PHASE, () => {
    audio.play('boss_phase');
  });

  return () => {
    for (const off of offs) off();
    offs.length = 0;
  };
}

/**
 * Presets named by `BOUND_SOUND_IDS` that do not exist in the preset table.
 * Content validation, used by the smoke test — a typo in a binding would
 * otherwise be a silently missing sound.
 * @returns {string[]}
 */
export function missingBoundSounds() {
  return BOUND_SOUND_IDS.filter((id) => !SOUND_PRESETS[id]);
}
