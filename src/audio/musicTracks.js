/**
 * @fileoverview Music tracks — pure data, exactly like `data/weapons.js`.
 *
 * The game is otherwise asset-free (every sprite and sound effect is
 * generated), so this file is the one place a real recording enters the
 * project. Keeping it declarative means adding a boss theme later is a new
 * entry plus a binding, not a change to the player.
 *
 * ## Measured properties of the shipped track
 *
 * `ffprobe` / `ffmpeg volumedetect` and `silencedetect` on
 * `assets/music/shadow-labyrinth.mp3`:
 *
 * | Property | Value |
 * | --- | --- |
 * | Duration | 172.27 s (2:52) |
 * | Format | MP3, 48 kHz stereo, 128 kbps |
 * | Integrated level | mean −15.8 dB, peak −0.6 dB |
 * | Head | silent to 0.78 s, then a fade-in (mean −25.6 dB over 0.78–2.28 s) |
 * | Tail | fades out from 171.70 s (mean −56.3 dB over the last 1.5 s) |
 *
 * Those two fades are why the file is shipped **unmodified**: the piece
 * already begins and ends in silence, so `loop` produces a natural breath at
 * the loop point instead of an edit. Trimming or crossfading it would need a
 * second lossy encode and would only make the seam worse.
 *
 * @typedef {object} MusicTrack
 * @property {string} id
 * @property {string} url        path relative to the served root
 * @property {string} title
 * @property {number} duration   seconds, measured
 * @property {string} credit
 */

/** @type {Record<string, MusicTrack>} */
export const MUSIC_TRACKS = {
  dungeon: {
    id: 'dungeon',
    url: 'assets/music/shadow-labyrinth.mp3',
    title: 'Shadow Labyrinth',
    duration: 172.27,
    credit: 'original score written for the game',
  },
};

/** The track a run is scored with. */
export const DEFAULT_MUSIC_TRACK = 'dungeon';

/**
 * @param {string} id
 * @returns {MusicTrack}
 */
export function getMusicTrack(id) {
  const track = MUSIC_TRACKS[id];
  if (!track) throw new Error(`Unknown music track "${id}"`);
  return track;
}
