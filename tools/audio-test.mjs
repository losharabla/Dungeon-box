/**
 * Audio stack test.
 *
 * SRP: prove the two halves of the mixer that cannot be checked by ear —
 * that the *bounds* hold (voice ceiling, retrigger guard, distance culling,
 * node recycling) and that the event bindings name sounds that exist.
 *
 * It runs against a minimal fake Web Audio implementation rather than a real
 * `AudioContext`, because what is under test is the engine's own bookkeeping:
 * how many nodes it creates, when it refuses to play, and what it recycles.
 * A real context would make those numbers unobservable.
 *
 * Run with:  node tools/audio-test.mjs
 */

import assert from 'node:assert/strict';

/* ============================================================
   Minimal Web Audio implementation
   ============================================================ */

class FakeParam {
  /** @param {number} value */
  constructor(value = 0) {
    this.value = value;
    /** @type {any[][]} */
    this.events = [];
  }
  setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, c) { this.value = v; this.events.push(['target', v, t, c]); return this; }
  cancelScheduledValues() { this.events.length = 0; return this; }
}

class FakeNode {
  /** @param {FakeContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {FakeNode[]} */
    this.outputs = [];
    this.disconnected = false;
    ctx.created.push(this);
  }
  connect(node) { this.outputs.push(node); return node; }
  disconnect() { this.outputs.length = 0; this.disconnected = true; }
}

class FakeGain extends FakeNode {
  constructor(ctx) { super(ctx); this.gain = new FakeParam(1); }
}

class FakeBiquad extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.type = 'lowpass';
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
    this.detune = new FakeParam(0);
  }
}

class FakePanner extends FakeNode {
  constructor(ctx) { super(ctx); this.pan = new FakeParam(0); }
}

class FakeCompressor extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.threshold = new FakeParam(-24);
    this.knee = new FakeParam(30);
    this.ratio = new FakeParam(12);
    this.attack = new FakeParam(0.003);
    this.release = new FakeParam(0.25);
  }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx);
    /** @type {number|null} */
    this.stopAt = null;
    this.started = false;
  }
  start(t) { this.started = true; this.startAt = t; }
  stop(t) { this.stopAt = t; }
}

class FakeOscillator extends FakeSource {
  constructor(ctx) {
    super(ctx);
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
  }
}

class FakeBufferSource extends FakeSource {
  constructor(ctx) {
    super(ctx);
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new FakeParam(1);
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'suspended';
    /** @type {any[]} every node ever created, for allocation accounting */
    this.created = [];
    /** @type {Map<string, number>} */
    this.counts = new Map();
    this.nodes = this.created;
    this.destination = new FakeNode(this);
    this._count('destination');
  }
  /** @param {string} kind */
  _count(kind) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }
  _track(node, kind) { this._count(kind); return node; }
  createGain() { return this._track(new FakeGain(this), 'gain'); }
  createBiquadFilter() { return this._track(new FakeBiquad(this), 'filter'); }
  createStereoPanner() { return this._track(new FakePanner(this), 'panner'); }
  createDynamicsCompressor() { return this._track(new FakeCompressor(this), 'compressor'); }
  createOscillator() { return this._track(new FakeOscillator(this), 'oscillator'); }
  createBufferSource() { return this._track(new FakeBufferSource(this), 'bufferSource'); }
  createMediaElementSource(element) {
    const node = new FakeNode(this);
    node.mediaElement = element;
    return this._track(node, 'mediaElementSource');
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    this._count('buffer');
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: (i) => data[i],
    };
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}

globalThis.AudioContext = FakeContext;

/**
 * A stand-in `HTMLAudioElement`.
 *
 * Only what `MusicPlayer` touches: `loop`, `preload`, `volume`, `src`, `paused`,
 * `play()`, `pause()`, `load()`, `removeAttribute()` and the `error` event.
 * `play()` resolves unless the test has armed an autoplay refusal, so the
 * "no gesture yet" path is exercised rather than assumed.
 */
class FakeAudioElement {
  constructor() {
    this.loop = false;
    this.preload = '';
    this.volume = 1;
    this.src = '';
    this.paused = true;
    this.ended = false;
    this.error = null;
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this.plays = 0;
    this.pauses = 0;
    this.loads = 0;
    this.removed = 0;
    /** When set, `play()` rejects with this error. */
    this.refusal = null;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); }
  emit(type) { for (const fn of this._listeners.get(type) ?? []) fn({ type }); }
  play() {
    if (this.refusal) return Promise.reject(this.refusal);
    this.paused = false;
    this.plays++;
    return Promise.resolve();
  }
  pause() { this.paused = true; this.pauses++; }
  load() { this.loads++; }
  removeAttribute(name) { if (name === 'src') this.src = ''; this.removed++; }
}

// The music player builds its element through the `Audio` constructor, so the
// fake has to be installed before `MusicPlayer` is ever exercised.
globalThis.Audio = FakeAudioElement;

/** A localStorage stand-in that records what was written. */
function fakeStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get raw() { return map; },
  };
}

const { AudioSystem } = await import('../src/audio/AudioSystem.js');
const { SOUND_PRESETS } = await import('../src/audio/soundPresets.js');
const { bindGameAudio, BOUND_SOUND_IDS, missingBoundSounds } = await import('../src/audio/audioBindings.js');
const { sanitizeAudioSettings, loadAudioSettings, saveAudioSettings, AUDIO_STORAGE_KEY } =
  await import('../src/audio/audioSettings.js');
const { UI_SOUND_IDS } = await import('../src/audio/audioControls.js');
const { MUSIC_TRACKS, DEFAULT_MUSIC_TRACK, getMusicTrack } = await import('../src/audio/musicTracks.js');
const { CONFIG } = await import('../src/core/Config.js');
const { EventBus, EVENTS } = await import('../src/core/EventBus.js');

/* ============================================================
   Harness
   ============================================================ */

const results = [];
/** @param {string} name @param {() => any} fn */
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

/** A mixer that is already unlocked, with a controllable clock. */
async function runningMixer(settings) {
  const storage = fakeStorage();
  const audio = new AudioSystem({ storage, settings });
  await audio.unlock();
  const ctx = audio.ctx;
  assert.ok(ctx, 'the fake context must have been created');
  return { audio, ctx, storage };
}

/* ============================================================
   Settings
   ============================================================ */

await check('settings sanitize clamps and repairs every field independently', () => {
  const s = sanitizeAudioSettings({ master: 5, effects: -3, muted: 'yes' });
  assert.equal(s.master, 1, 'a level above 1 must clamp to 1');
  assert.equal(s.effects, 0, 'a negative level must clamp to 0');
  assert.equal(s.muted, false, 'a non-boolean mute keeps the default');

  // A corrupt field must not discard the good ones.
  const partial = sanitizeAudioSettings({ master: 0.2, effects: null });
  assert.equal(partial.master, 0.2, 'a valid field must survive a broken sibling');
  assert.equal(partial.effects, CONFIG.audio.defaults.effects);
});

await check('settings survive a save/load round trip and corrupt storage', () => {
  const storage = fakeStorage();
  saveAudioSettings(storage, { master: 0.25, effects: 0.5, muted: true });
  const loaded = loadAudioSettings(storage);
  assert.equal(loaded.master, 0.25);
  assert.equal(loaded.effects, 0.5);
  assert.equal(loaded.muted, true);

  storage.setItem(AUDIO_STORAGE_KEY, '{not json');
  const recovered = loadAudioSettings(storage);
  assert.equal(recovered.master, CONFIG.audio.defaults.master, 'corrupt JSON must fall back');

  // No storage at all (a headless run) must also be survivable.
  assert.equal(loadAudioSettings(null).master, CONFIG.audio.defaults.master);
  assert.equal(saveAudioSettings(null, recovered), false, 'a failed write reports itself');
});

/* ============================================================
   Bounds
   ============================================================ */

await check('the context is lazy and nothing plays before the first gesture', async () => {
  const audio = new AudioSystem({ storage: fakeStorage() });
  assert.equal(audio.ctx, null, 'no context may exist before a gesture');
  assert.equal(audio.play('hit_flesh'), null, 'a locked mixer must stay silent');
  assert.ok(SOUND_PRESETS.hit_flesh, 'the preset used above must exist');

  const unlocked = await audio.unlock();
  assert.equal(unlocked, true, 'unlock must resume the context');
  assert.ok(audio.ctx, 'unlock must create the context');

  // Noise is generated once per context, not per sound.
  assert.equal(audio.ctx.counts.get('buffer'), 3, 'exactly three shared noise buffers');
  audio.destroy();
});

await check('the same preset cannot retrigger inside its cooldown', async () => {
  const { audio, ctx } = await runningMixer();
  const first = audio.play('swing_light');
  assert.ok(first, 'the first swing must play');

  // Same instant: inside the guard, so it must be refused rather than stacked.
  const second = audio.play('swing_light');
  assert.equal(second, null, 'a retrigger inside the cooldown must be dropped');
  assert.equal(audio.stats.dropped, 1, 'the drop must be counted for the debug overlay');

  // Past the guard, the same preset is welcome again.
  ctx.currentTime += 1;
  assert.ok(audio.play('swing_light'), 'the preset must be playable after its cooldown');
  audio.destroy();
});

await check('the voice ceiling is never exceeded, however hard the fight is', async () => {
  const { audio, ctx } = await runningMixer();
  const ids = Object.keys(SOUND_PRESETS);
  let guard = 0;
  for (let i = 0; i < 400 && guard < 400; i++) {
    ctx.currentTime += 0.25;
    audio.play(ids[i % ids.length]);
    guard++;
    assert.ok(
      audio._voices.length <= CONFIG.audio.maxVoices,
      `voices ${audio._voices.length} exceeded the ceiling ${CONFIG.audio.maxVoices}`,
    );
  }
  assert.ok(audio.stats.played > 0, 'the scenario must actually play sounds');
  assert.ok(audio.stats.peakVoices <= CONFIG.audio.maxVoices, 'the peak must respect the ceiling');
  audio.destroy();
});

await check('a distant sound is culled before any node is created', async () => {
  const { audio, ctx } = await runningMixer();
  audio.setListener(0, 0);
  const before = ctx.created.length;

  const far = audio.play('enemy_death', { x: CONFIG.audio.audibleRadius * 3, y: 0 });
  assert.equal(far, null, 'a sound outside the audible radius must not play');
  assert.equal(ctx.created.length, before, 'culling must cost zero nodes');
  assert.ok(audio.stats.dropped > 0, 'the cull must be counted');

  // Just inside the radius it does play, and quietly.
  const near = audio.play('enemy_death', { x: CONFIG.audio.audibleRadius * 0.9, y: 0 });
  assert.ok(near, 'a sound inside the radius must play');
  audio.destroy();
});

await check('a critical cue steals a voice from an incidental one', async () => {
  const { audio, ctx } = await runningMixer();
  const ceiling = CONFIG.audio.maxVoices;

  // Fill the mix with the least important sound there is.
  for (let i = 0; i < ceiling; i++) {
    ctx.currentTime += 0.5;
    audio.play('coin', { gain: 0.2 });
  }
  assert.equal(audio._voices.length, ceiling, 'the mix must be saturated');
  const stolenBefore = audio.stats.stolen;

  const critical = audio.play('boss_phase');
  assert.ok(critical, 'a critical cue must always get a voice');
  assert.ok(audio.stats.stolen > stolenBefore, 'it must have taken one, not been refused');
  assert.equal(critical.priority, 4, 'boss_phase must be a critical preset');

  // The reverse must not happen: an incidental cue cannot evict a critical one.
  const saturated = [];
  for (let i = 0; i < ceiling; i++) {
    ctx.currentTime += 0.5;
    saturated.push(audio.play('victory', { gain: 0.1 }));
  }
  const droppedBefore = audio.stats.dropped;
  assert.equal(audio.play('coin'), null, 'an incidental cue must not evict a critical one');
  assert.ok(audio.stats.dropped > droppedBefore, 'the refusal must be counted');
  audio.destroy();
});

await check('released voices hand their gain and filter nodes back to the pools', async () => {
  const { audio, ctx } = await runningMixer();
  // Play a burst, let every voice finish, and repeat. Node creation must not
  // grow with the number of sounds played.
  const playBurst = () => {
    for (let i = 0; i < 12; i++) {
      ctx.currentTime += 0.5;
      audio.play('shoot_light');
      audio.play('hit_flesh');
    }
    ctx.currentTime += 5; // past every tail
    audio.update();
  };

  playBurst();
  const afterFirst = { gain: ctx.counts.get('gain'), filter: ctx.counts.get('filter') };
  for (let round = 0; round < 5; round++) playBurst();
  const afterMany = { gain: ctx.counts.get('gain'), filter: ctx.counts.get('filter') };

  assert.ok(
    afterMany.gain < afterFirst.gain * 2 + 8,
    `gain nodes must be recycled (${afterFirst.gain} -> ${afterMany.gain})`,
  );
  assert.ok(
    afterMany.filter < afterFirst.filter * 2 + 8,
    `filter nodes must be recycled (${afterFirst.filter} -> ${afterMany.filter})`,
  );
  assert.equal(audio._voices.length, 0, 'every finished voice must be released');
  audio.destroy();
});

await check('muting silences the graph without tearing it down', async () => {
  const { audio } = await runningMixer();
  audio.setMuted(true);
  assert.equal(audio.play('hit_flesh'), null, 'nothing may play while muted');
  assert.equal(audio.effectiveMaster(), 0, 'the effective master level must be zero');
  assert.ok(audio.masterGain.gain.value === 0 || audio.masterGain.gain.events.length > 0,
    'the master gain must have been driven to zero');
  // The context stays alive: unmuting must not need another user gesture.
  assert.ok(audio.ctx, 'muting must not close the context');

  audio.setMuted(false);
  assert.ok(audio.play('hit_flesh'), 'unmuting must restore playback');
  audio.destroy();
});

await check('degraded quality lowers the ceiling and trims the mix immediately', async () => {
  const { audio, ctx } = await runningMixer();
  const full = audio._maxVoices();

  // Saturate at full quality, then downgrade: the trim must be immediate.
  for (let i = 0; i < full; i++) {
    ctx.currentTime += 0.5;
    audio.play('coin', { gain: 0.2 });
  }
  assert.equal(audio._voices.length, full);

  audio.setQuality(0.5);
  assert.ok(audio._maxVoices() < full, 'degraded quality must lower the ceiling');
  assert.ok(
    audio._voices.length <= audio._maxVoices(),
    `the mix must be trimmed at once (${audio._voices.length} > ${audio._maxVoices()})`,
  );

  audio.setQuality(1);
  assert.equal(audio._maxVoices(), full, 'recovery must restore the full ceiling');
  audio.destroy();
});

await check('a finished voice is pruned by the clock, not by a timer', async () => {
  const { audio, ctx } = await runningMixer();
  audio.play('swing_heavy');
  assert.equal(audio._voices.length, 1, 'the swing must be live');

  // Before it ends it is still live; after it ends one `update()` clears it.
  ctx.currentTime += 0.05;
  audio.update();
  assert.equal(audio._voices.length, 1, 'a ringing voice must not be pruned early');

  ctx.currentTime += 2;
  audio.update();
  assert.equal(audio._voices.length, 0, 'update() must reap the finished voice');
  assert.equal(audio.stats.voices, 0, 'the diagnostic count must agree');
  audio.destroy();
});

await check('a pathological burst keeps both the graph and the fading list bounded', async () => {
  const { audio, ctx } = await runningMixer();
  // Every preset fired at the same instant: distinct presets dodge the
  // retrigger guard, so this is the worst case the mixer can be handed.
  const ids = Object.keys(SOUND_PRESETS);
  for (const id of ids) audio.play(id);

  assert.ok(ids.length > CONFIG.audio.maxVoices, 'the burst must exceed the ceiling to be a test');
  assert.ok(
    audio._voices.length <= CONFIG.audio.maxVoices,
    `ringing voices must stay capped (${audio._voices.length})`,
  );
  assert.ok(
    audio._releasing.length <= CONFIG.audio.maxVoices,
    `fading voices must stay capped (${audio._releasing.length})`,
  );
  // The hard bound that matters: node creation cannot grow with the burst.
  const gains = ctx.counts.get('gain');
  const cap = CONFIG.audio.maxVoices * 2 * 4 + 8;
  assert.ok(gains <= cap, `gain nodes must stay bounded (${gains} > ${cap})`);
  audio.destroy();
});

await check('a runtime with no Web Audio stays silent instead of throwing', async () => {
  // The whole feature must be optional: a browser without the API (or a
  // headless harness) has to be able to construct and drive the mixer.
  const saved = globalThis.AudioContext;
  delete globalThis.AudioContext;
  try {
    const audio = new AudioSystem({ storage: fakeStorage() });
    assert.equal(audio.supported, false, 'the missing API must be detected');
    assert.equal(await audio.unlock(), false, 'unlock must report failure, not throw');
    assert.equal(audio.play('hit_flesh'), null, 'play must be a silent no-op');
    assert.equal(audio.ctx, null, 'no context may be built');

    // Every other entry point must also survive being called.
    audio.setQuality(0.4);
    audio.setListener(100, 100);
    audio.setSetting('master', 0.3);
    audio.setMuted(true);
    audio.update();
    audio.destroy();
    assert.equal(audio.settings.master, 0.3, 'settings must still work without audio');
  } finally {
    globalThis.AudioContext = saved;
  }
});

/* ============================================================
   Music
   ============================================================ */

/** Let the `play()` promise settle before asserting on its outcome. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

await check('the shipped music track is real audio, not a placeholder', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const track = getMusicTrack(DEFAULT_MUSIC_TRACK);
  assert.equal(track.url, MUSIC_TRACKS[DEFAULT_MUSIC_TRACK].url);
  assert.ok(!track.url.startsWith('/'), 'the url must be relative to the served root');
  assert.ok(track.duration > 60, 'a music bed must be longer than a jingle');

  const file = path.join(ROOT, track.url);
  assert.ok(fs.existsSync(file), `${track.url} must exist in the repository`);
  const size = fs.statSync(file).size;
  assert.ok(size > 1_000_000, `a full track must be more than a stub (${size} bytes)`);

  // Either an ID3 tag or a raw MPEG frame sync: a Git-LFS pointer or an empty
  // placeholder would fail both, which is the failure worth catching.
  const head = fs.readFileSync(file).subarray(0, 4);
  const isId3 = head.toString('latin1', 0, 3) === 'ID3';
  const isFrameSync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  assert.ok(isId3 || isFrameSync, 'the file must be an MPEG audio stream');

  // The declared MIME type has to be one the dev server actually serves.
  const serve = fs.readFileSync(path.join(ROOT, 'tools', 'serve.mjs'), 'utf8');
  assert.match(serve, /'\.mp3':\s*'audio\/mpeg'/, 'serve.mjs must serve .mp3 as audio/mpeg');
  assert.match(serve, /Accept-Ranges/, 'serve.mjs must advertise range support for media');
});

await check('music streams through the graph at the level the mixer sets', async () => {
  const { audio, ctx } = await runningMixer();
  const track = getMusicTrack(DEFAULT_MUSIC_TRACK);

  assert.equal(audio.playMusic(track.url), true, 'the track must load');
  await settle();

  const music = audio.music;
  assert.ok(music.element, 'a media element must be created');
  assert.equal(music.element.loop, true, 'the track must loop: it scores a whole run');
  assert.ok(music.element.src.endsWith(track.url), 'the element must point at the track');
  assert.equal(music.stats.plays, 1, 'the element must actually be playing');

  // Routing: element -> player gain -> master bus, and *not* through the
  // effects compressor, so a burst of hits cannot pump the music.
  assert.ok(music.source, 'the element must be routed through Web Audio');
  assert.equal(music.source.mediaElement, music.element, 'the source must wrap the element');
  assert.equal(music.source.outputs[0], music.gain, 'the element must feed the music gain');
  assert.equal(music.gain.outputs[0], audio.masterGain, 'the music gain must feed the master bus');
  assert.ok(
    !audio.effectsGain.outputs.includes(music.gain),
    'music must not share the effects bus',
  );

  // The slider reaches the graph.
  audio.setSetting('music', 0);
  assert.ok(music.gain.gain.value <= 0.001, `music 0 must silence the bed (${music.gain.gain.value})`);
  audio.setSetting('music', 1);
  assert.ok(music.gain.gain.value >= 0.99, `music 1 must open the bed (${music.gain.gain.value})`);

  // Mute is applied by the master bus, which music is connected to.
  audio.setMuted(true);
  assert.ok(audio.masterGain.gain.value <= 0.001, 'mute must reach the master bus');
  audio.setMuted(false);

  void ctx;
  audio.destroy();
});

await check('the same track is not restarted, a different one is reloaded', async () => {
  const { audio } = await runningMixer();
  const track = getMusicTrack(DEFAULT_MUSIC_TRACK);

  audio.playMusic(track.url);
  await settle();
  const first = audio.music.element;
  const playsAfterFirst = audio.music.stats.plays;

  // Starting a new floor must not restart the score from the top.
  audio.playMusic(track.url);
  await settle();
  assert.equal(audio.music.element, first, 'the element must be reused for the same track');
  assert.equal(audio.music.stats.plays, playsAfterFirst, 'the same track must not restart');

  audio.playMusic('assets/music/other-theme.mp3');
  await settle();
  assert.notEqual(audio.music.element, first, 'a new track needs a new element');
  assert.ok(audio.music.element.src.endsWith('other-theme.mp3'));
  assert.equal(first.pauses > 0, true, 'the previous track must be stopped');

  audio.destroy();
});

await check('a refused play() is not a load error, and is retried on unlock', async () => {
  // The realistic first-run sequence: the track is requested, the browser
  // refuses because there has been no gesture yet, and a later unlock retries.
  const { audio } = await runningMixer();
  const track = getMusicTrack(DEFAULT_MUSIC_TRACK);

  audio.music.setTrack(track.url);
  audio.music.element.refusal = Object.assign(new Error('no gesture'), { name: 'NotAllowedError' });
  audio.music.wanted = true;
  audio.music.start(0);
  await settle();

  assert.equal(audio.music.stats.blocked, 1, 'an autoplay refusal must be counted as blocked');
  assert.equal(audio.music.stats.errors, 0, 'a refusal is not a load failure');
  assert.equal(audio.music.playing, false, 'nothing is playing yet');
  assert.equal(audio.music.wanted, true, 'the request must still stand');

  // The gesture arrives: unlock resumes and honours the pending request.
  audio.music.element.refusal = null;
  await audio.unlock();
  await settle();
  assert.equal(audio.music.playing, true, 'unlock must start the pending track');
  assert.equal(audio.music.stats.blocked, 1, 'the successful retry is not another refusal');

  audio.destroy();
});

await check('a broken track is recorded, never thrown, and leaves the game alive', async () => {
  const { audio } = await runningMixer();
  const failures = [];
  audio.music.onError = (err) => failures.push(err);

  audio.playMusic('assets/music/missing.mp3');
  await settle();
  audio.music.element.error = new Error('decode failed');
  audio.music.element.emit('error');

  assert.equal(audio.music.stats.errors, 1, 'the failure must be counted for the debug overlay');
  assert.equal(failures.length, 1, 'the failure must be reported once');
  assert.equal(audio.music.wanted, false, 'a broken track must not keep asking to play');

  // The rest of the mixer is unaffected.
  assert.ok(audio.play('hit_flesh'), 'effects must still work after a music failure');

  audio.destroy();
});

await check('stop fades out and pauses on the audio clock, not on a timer', async () => {
  const { audio, ctx } = await runningMixer();
  audio.playMusic(MUSIC_TRACKS[DEFAULT_MUSIC_TRACK].url);
  await settle();
  const el = audio.music.element;
  assert.equal(el.paused, false, 'the track must be playing first');

  audio.stopMusic(2);
  assert.equal(el.paused, false, 'the element must keep playing through the fade');

  ctx.currentTime += 1;
  audio.update();
  assert.equal(el.paused, false, 'the fade is not over yet');

  ctx.currentTime += 1.5;
  audio.update();
  assert.equal(el.paused, true, 'the element must pause once the fade has played out');
  assert.equal(audio.music.wanted, false, 'the player must remember it is stopping');

  // Starting again reuses the same buffered element.
  audio.playMusic(MUSIC_TRACKS[DEFAULT_MUSIC_TRACK].url);
  await settle();
  assert.equal(audio.music.element, el, 'restarting must not reload the track');
  assert.equal(el.paused, false, 'restarting must resume playback');
  assert.equal(el.removed, 0, 'the media must not be re-sourced, so nothing is re-fetched');

  audio.destroy();
});

await check('a runtime without a media element stays silent instead of throwing', async () => {
  const saved = globalThis.Audio;
  delete globalThis.Audio;
  try {
    const { audio } = await runningMixer();
    const started = audio.playMusic(MUSIC_TRACKS[DEFAULT_MUSIC_TRACK].url);
    assert.equal(started, false, 'there is nothing to play with');
    assert.equal(audio.musicPlaying, false);
    assert.ok(audio.play('hit_flesh'), 'effects must be unaffected');
    audio.update();
    audio.destroy();
  } finally {
    globalThis.Audio = saved;
  }
});

/* ============================================================
   Bindings
   ============================================================ */

await check('every preset the bindings ask for exists', () => {
  assert.deepEqual(missingBoundSounds(), [], 'a binding must never name a missing sound');
  assert.ok(BOUND_SOUND_IDS.length >= 20, 'the run must actually be scored with sound');
  for (const id of BOUND_SOUND_IDS) {
    const preset = SOUND_PRESETS[id];
    assert.ok(preset.layers.length > 0, `${id} must have at least one layer`);
    assert.ok(preset.gain > 0 && preset.gain <= 1, `${id} needs a sane gain`);
    assert.ok(Number.isInteger(preset.priority), `${id} needs a numeric priority`);
    for (const layer of preset.layers) {
      assert.ok(layer.dur > 0, `${id} has a layer with no duration`);
      assert.ok(
        layer.source === 'noise' || layer.source === 'tone',
        `${id} has an unknown layer source "${layer.source}"`,
      );
    }
  }
});

await check('no preset is dead weight and none is missing', () => {
  // The game events and the interface between them must cover the preset table
  // exactly. A preset nothing can reach is unused code; an id in either list
  // that has no preset is a silently silent sound.
  const reachable = new Set([...BOUND_SOUND_IDS, ...UI_SOUND_IDS]);
  const declared = Object.keys(SOUND_PRESETS);

  const unreachable = declared.filter((id) => !reachable.has(id));
  assert.deepEqual(unreachable, [], 'every preset must be reachable from an event or the UI');

  const undeclared = [...reachable].filter((id) => !SOUND_PRESETS[id]);
  assert.deepEqual(undeclared, [], 'every requested sound must exist');

  assert.equal(new Set(BOUND_SOUND_IDS).size, BOUND_SOUND_IDS.length,
    'the binding list must not repeat an id');
});

await check('game events map onto the right presets', () => {
  /** @type {string[]} */
  const played = [];
  /** @type {string[]} */
  const musicStarted = [];
  let musicStopped = 0;
  const fake = {
    play: (id) => { played.push(id); },
    playMusic: (url) => { musicStarted.push(url); },
    stopMusic: () => { musicStopped++; },
  };
  const bus = new EventBus();
  const off = bindGameAudio({ audio: /** @type {any} */ (fake), bus });

  const player = { x: 10, y: 10, faction: 'player' };
  const enemy = { x: 40, y: 40, faction: 'enemy', kind: 'skeleton' };

  // A run is scored from the moment it starts.
  bus.emit(EVENTS.RUN_STARTED, { player, seed: 1 });
  assert.deepEqual(musicStarted, [MUSIC_TRACKS[DEFAULT_MUSIC_TRACK].url],
    'starting a run must start the run track');
  assert.deepEqual(played, [], 'and nothing else');

  bus.emit(EVENTS.ATTACK_PERFORMED, { player, weapon: { kind: 'melee', swingTime: 0.18, range: 74 } });
  bus.emit(EVENTS.ATTACK_PERFORMED, { player, weapon: { kind: 'melee', swingTime: 0.34, range: 88 } });
  bus.emit(EVENTS.ATTACK_PERFORMED, { player, weapon: { kind: 'gun', baseDamage: 9, projectile: { count: 1 } } });
  bus.emit(EVENTS.ATTACK_PERFORMED, { player, weapon: { kind: 'magic', baseDamage: 22 } });
  bus.emit(EVENTS.DAMAGE_DEALT, { target: enemy, amount: 12, crit: false });
  bus.emit(EVENTS.DAMAGE_DEALT, { target: enemy, amount: 40, crit: true });
  bus.emit(EVENTS.DAMAGE_DEALT, { target: player, amount: 0, crit: false });
  bus.emit(EVENTS.STATUS_APPLIED, { entity: enemy, status: 'block' });
  bus.emit(EVENTS.STATUS_APPLIED, { entity: enemy, status: 'shieldBreak' });
  bus.emit(EVENTS.DASHED, { player });
  bus.emit(EVENTS.ULTIMATE_CHANGED, { ready: true });
  bus.emit(EVENTS.BOSS_PHASE, { phase: 2 });

  assert.deepEqual(played, [
    'swing_light', 'swing_heavy', 'shoot_light', 'shoot_magic',
    'hit_flesh', 'hit_crit',
    'hit_block', 'shield_break',
    'dash', 'ult_ready', 'boss_phase',
  ], 'the mapping must be exactly this');

  // Loot rings, spending does not.
  played.length = 0;
  bus.emit(EVENTS.GOLD_CHANGED, { delta: 12 });
  bus.emit(EVENTS.GOLD_CHANGED, { delta: -80 });
  assert.deepEqual(played, ['coin'], 'only gained gold may ring');

  // Only a room reached through a door makes a door sound: the entrance does
  // not, because the run has not started walking yet.
  played.length = 0;
  bus.emit(EVENTS.ROOM_ENTERED, { node: { depth: 0, type: 'start' } });
  bus.emit(EVENTS.ROOM_ENTERED, { node: { depth: 1, type: 'arena' } });
  assert.deepEqual(played, ['door_open'], 'the entrance must stay silent');

  // A boss death is not an ordinary death, and the run end owns the outcome cue.
  played.length = 0;
  bus.emit(EVENTS.ENTITY_DIED, { entity: { ...enemy, kind: 'boss' } });
  bus.emit(EVENTS.ENTITY_DIED, { entity: enemy });
  bus.emit(EVENTS.ENTITY_DIED, { entity: { ...player, faction: 'player' } });
  assert.deepEqual(played, ['boss_death', 'enemy_death'],
    'the player death cue belongs to the run end');

  played.length = 0;
  bus.emit(EVENTS.RUN_ENDED, { reason: 'victory' });
  assert.deepEqual(played, ['victory'], 'victory plays its sting');
  assert.equal(musicStopped, 1, 'and the score stops with the run');

  played.length = 0;
  bus.emit(EVENTS.RUN_ENDED, { reason: 'death' });
  assert.deepEqual(played, ['defeat'], 'death plays its own sting');
  assert.equal(musicStopped, 2, 'death stops the score too');

  // Unsubscribing must be complete: a leaked listener would double every cue.
  off();
  played.length = 0;
  musicStopped = 0;
  bus.emit(EVENTS.DASHED, { player });
  bus.emit(EVENTS.RUN_ENDED, { reason: 'victory' });
  assert.deepEqual(played, [], 'every binding must unsubscribe');
  assert.equal(musicStopped, 0, 'music handling must unsubscribe as well');
  assert.equal(musicStarted.length, 1, 'and must not start a second track');
});

/* ============================================================
   Report
   ============================================================ */

let failures = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${r.name}`);
    console.log(`        ${r.error?.message ?? r.error}`);
    if (r.error?.stack) console.log(String(r.error.stack).split('\n').slice(1, 4).join('\n'));
  }
}
console.log('');
console.log(`${results.length - failures}/${results.length} audio checks passed`);
if (failures > 0) process.exit(1);
