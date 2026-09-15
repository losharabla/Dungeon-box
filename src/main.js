/**
 * @fileoverview Composition root.
 *
 * SRP: build the object graph, start the loop, and route UI intents into
 * the game. This is the only module allowed to know about all the others;
 * every other module receives what it needs.
 *
 * Reading order for the architecture:
 *   core/       - engine primitives (loop, bus, state, input, collision)
 *   data/       - content definitions, no behaviour (design doc §30)
 *   entities/   - world objects and their state
 *   systems/    - the rules that operate on entities
 *   rendering/  - procedural Canvas drawing (design doc §23)
 *   ui/         - DOM interface outside the canvas
 */

import { EventBus, EVENTS } from './core/EventBus.js';
import { StateMachine } from './core/StateMachine.js';
import { InputService } from './core/InputService.js';
import { GameLoop } from './core/GameLoop.js';
import { Game } from './game/Game.js';
import { RenderSystem, Camera } from './rendering/RenderSystem.js';
import { SceneRenderer } from './rendering/SceneRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { bindGameAudio } from './audio/audioBindings.js';
import { createAudioControls } from './audio/audioControls.js';
import { getBoss } from './data/bosses.js';
import { roomTypeLabel } from './data/roomTypes.js';
import { CONFIG } from './core/Config.js';

/* ============================================================
   Boot
   ============================================================ */

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
if (!canvas) throw new Error('#game-canvas is missing from index.html');

const bus = new EventBus();
const state = new StateMachine(bus, 'menu');
const input = new InputService(canvas);
const camera = new Camera();
const render = new RenderSystem(canvas, camera);
const sceneRenderer = new SceneRenderer(render);

/**
 * Procedural mixer. Constructing it costs nothing — the AudioContext is not
 * created until the first user gesture (see `AudioSystem.unlock`), which is
 * both what the browser's autoplay policy requires and what keeps a
 * never-touched menu free of audio resources.
 */
const audio = new AudioSystem();
audio.attachUnlockHandlers();
bindGameAudio({ audio, bus });

/**
 * Which room overlay is currently showing, so the engine knows to freeze
 * the simulation while the player reads it.
 */
let activeOverlay = /** @type {null|'shop'|'healing'|'reward'|'pause'} */ (null);

/** Cached reward choices awaiting the player's decision. */
let pendingReward = /** @type {any[]} */ ([]);

/**
 * Victory that is waiting for the boss reward overlay to close.
 * @type {null|{final: boolean}}
 */
let pendingVictory = null;

/** Timers for transient notices and transitions. */
let noticeTimer = 0;
let transitionTimer = 0;

/* ============================================================
   UI intents
   ============================================================ */

const ui = new UIManager({
  startRun: () => startRun(),
  restart: () => {
    ui.hideOverlays();
    startRun();
  },
  nextFloor: () => {
    ui.hideOverlays();
    activeOverlay = null;
    game.nextFloor();
    state.transition('playing');
    ui.showScreen('playing');
    ui.showTransition(`FLOOR ${game.run.floorIndex + 1}`);
    transitionTimer = CONFIG.ui.floorTransitionDuration;
  },
  resume: () => resumeFromPause(),
  abandonRun: () => {
    ui.hideOverlays();
    activeOverlay = null;
    pendingVictory = null;
    if (game.getPlayer()) game.run.end('abandon', game.getPlayer());
    state.force('menu');
    ui.showScreen('menu');
  },
  shopLeave: () => closeOverlay(),
  healingLeave: () => closeOverlay(),
  rewardTake: () => {
    if (pendingReward.length > 0) {
      // "Take" without choosing picks the first option, so the button is
      // never a dead end if the player just wants to move on.
      game.takeReward(pendingReward[0]);
      pendingReward = [];
    }
    closeOverlay();
  },
  buy: (item) => {
    const player = game.getPlayer();
    if (!player) return;
    game.buy(item);
    ui.openShop(game.rooms.runtime?.shopStock ?? [], player);
  },
  pickReward: (choice) => {
    game.takeReward(choice);
    pendingReward = [];
    closeOverlay();
  },
  selectCharacter: () => {},
}, {
  // Narrow adapter: read the mixer, change a level, mute, click. The UI never
  // sees the audio engine itself.
  audio: createAudioControls(audio),
});

/* ============================================================
   Game instance and callbacks
   ============================================================ */

const game = new Game({
  bus,
  state,
  // The same instance the renderer uses: one camera, one source of truth.
  camera,
  callbacks: {
    onStateChange: (name) => { void name; },

    onRoomCleared: (runtime) => {
      // Arena cleared: offer the reward, then let the player leave.
      if (runtime.type === 'arena') {
        if (runtime.reward.length > 0) {
          openReward(runtime.reward);
        } else {
          showNotice('Room cleared — head for the door');
        }
      } else if (runtime.type === 'boss') {
        handleBossDefeated(runtime);
      }
    },

    onBossSpawned: (boss) => {
      ui.showTransition(getBoss(boss.bossId).name);
      transitionTimer = CONFIG.ui.bossTransitionDuration;
    },

    onPlayerDeath: () => {
      // The run end is confirmed by the Game once the death animation plays.
    },

    onNotice: (text) => showNotice(text),
  },
});

/* ============================================================
   Flow helpers
   ============================================================ */

/** Start a run from the character-select screen. */
function startRun() {
  const classId = ui.selectedClass;
  const ultId = ui.selectedUlt;
  ui.hideOverlays();
  ui.clearError();
  activeOverlay = null;
  pendingReward = [];
  pendingVictory = null;

  // This runs inside a click handler, which is the one place a browser lets a
  // suspended context start. The gesture listeners cover everything earlier.
  void audio.unlock();

  game.startRun(classId, ultId);
  state.force('playing');
  ui.showScreen('playing');
  ui.showTransition(`${game.getClassName()} — into the dungeon`);
  transitionTimer = 1.3;
  render.resize();
}

/** Open the reward overlay. */
function openReward(choices) {
  pendingReward = choices;
  activeOverlay = 'reward';
  ui.openReward(choices, /** @type {any} */ (game.getPlayer()));
  ui.setOverlay('reward', true);
}

/** Close whatever overlay is open and resume play. */
function closeOverlay() {
  ui.hideOverlays();
  activeOverlay = null;
  if (state.current === 'pause') state.force('playing');
  input.endFrame();
  // A boss victory waits for this moment: the reward overlay had to close
  // first, since it lives inside the playing screen the victory replaces.
  finishVictory();
}

/** Pause / resume (design doc §22). */
function togglePause() {
  if (state.current === 'playing' || state.current === 'boss') {
    state.force('pause');
    activeOverlay = 'pause';
    ui.setOverlay('pause', true);
  } else if (state.current === 'pause') {
    resumeFromPause();
  }
}

/** Resume from the pause overlay. */
function resumeFromPause() {
  ui.setOverlay('pause', false);
  activeOverlay = null;
  state.force('playing');
  // Drop any time accumulated while paused so nothing "jumps".
  loop.resetAccumulator();
}

/** Show a short notice in the HUD. */
function showNotice(text) {
  ui.setHint(text);
  noticeTimer = CONFIG.ui.noticeDuration;
}

/**
 * Victory handling for a cleared boss room (design doc §18).
 *
 * Every boss floor ends on the victory screen; only the last one ends the
 * run. The screen cannot appear before the reward overlay closes: overlays
 * live inside the `playing` screen, so showing `victory` first would hide
 * the reward choice along with the rest of the HUD.
 */
function handleBossDefeated(runtime) {
  // A simultaneous kill and death must not resurrect the run into a victory.
  const player = game.getPlayer();
  if (!player || !player.alive) return;

  pendingVictory = { final: game.run.isLastFloor() };

  // Boss rewards flow through the ordinary reward overlay first.
  if (runtime.reward.length > 0) {
    openReward(runtime.reward);
  } else {
    finishVictory();
  }
}

/** Show the victory screen once the player has taken the boss reward. */
function finishVictory() {
  if (!pendingVictory) return;
  const { final } = pendingVictory;
  pendingVictory = null;

  const player = game.getPlayer();
  if (!player) return;

  const bossName = getBoss(game.spawner.lastBossId).name;
  if (final) game.run.end('victory', player);
  state.force('victory');
  ui.renderStats(ui.el.statsVictory, player, game.run);
  ui.setVictorySubtitle(
    final
      ? `${bossName} defeated — the run is complete`
      : `${bossName} defeated — floor ${game.run.floorIndex + 1} cleared`,
  );
  // Beyond the last floor there is nothing to advance to (§12-14 rotation).
  ui.setNextFloorVisible(!final);
  ui.showScreen('victory');
}

/* ============================================================
   Adaptive particle quality
   ============================================================ */

/**
 * Trim particle emission when the frame rate sags, and restore it once the
 * frame budget is clearly free again.
 *
 * Driven by `render.fps`, the smoothed figure the loop already publishes —
 * so no new timers or services. The sustained-window hysteresis (2s to drop,
 * 5s to recover) means one GC hitch never dims the scene and a slow machine
 * is not allowed to oscillate between densities.
 */
const FPS_LOWPASS = 57; // clearly healthy: full density again after 5s
const FPS_LOW = 50; // sustained 2s below -> 0.6
const FPS_LOWER = 40; // sustained 2s below -> 0.35

let lowFpsTime = 0; // seconds spent under LOW this dip
let veryLowFpsTime = 0; // seconds spent under LOWER this dip
let goodFpsTime = 0; // seconds spent above LOWPASS this recovery window

/**
 * @param {number} frameDelta real seconds since the previous render
 */
function updateParticleQuality(frameDelta) {
  const fps = render.fps;

  // Clamp: a backgrounded tab's multi-second frame must not instantly
  // trigger (or recover from) a downgrade on stale data.
  const dt = frameDelta > 0.25 ? 0.25 : frameDelta;

  if (fps < FPS_LOWER) {
    veryLowFpsTime += dt;
    lowFpsTime += dt;
    goodFpsTime = 0;
  } else if (fps < FPS_LOW) {
    lowFpsTime += dt;
    veryLowFpsTime = 0;
    goodFpsTime = 0;
  } else if (fps > FPS_LOWPASS) {
    goodFpsTime += dt;
    lowFpsTime = 0;
    veryLowFpsTime = 0;
  } else {
    // The band between LOW and LOWPASS is neutral: it neither deepens the
    // downgrade nor pays back a recovery.
    lowFpsTime = 0;
    veryLowFpsTime = 0;
  }

  if (veryLowFpsTime >= 2) {
    game.particles.density = 0.35;
    audio.setQuality(0.5);
  } else if (lowFpsTime >= 2 && game.particles.density > 0.6) {
    game.particles.density = 0.6;
    audio.setQuality(0.75);
  } else if (goodFpsTime >= 5) {
    game.particles.density = 1;
    audio.setQuality(1);
  }
}

/* ============================================================
   Frame stepping
   ============================================================ */

/**
 * Fixed-step simulation.
 * @param {number} dt
 */
function fixedUpdate(dt) {
  // Gameplay freezes while an overlay or the menu is showing, but the
  // animation clock below keeps running so the UI stays alive.
  const frozen = activeOverlay !== null
    || state.isAny(['menu', 'character_select', 'game_over', 'victory', 'pause']);

  if (frozen) {
    input.endFrame();
    return;
  }

  const aim = input.cursor;
  const move = input.getMoveVector();

  game.update(dt, {
    move,
    aim,
    attackHeld: input.mouseDown,
    attackPressed: input.mousePressed,
    beamHeld: input.beamDown,
    ultPressed: input.wasPressed('KeyQ'),
    dashPressed: input.wasPressed('Space'),
  });

  // --- Interaction (E) -------------------------------------------------
  if (input.wasPressed('KeyE')) {
    const result = game.interact();
    handleInteraction(result);
  }

  // --- Travel through doors automatically once cleared ------------------
  autoTravelIfAtDoor();

  // --- Pause ------------------------------------------------------------
  if (input.wasPressed('Escape')) togglePause();

  input.endFrame();
}

/**
 * @param {{kind: string, payload?: any}|null} result
 */
function handleInteraction(result) {
  if (!result) return;

  switch (result.kind) {
    case 'healing': {
      const payload = result.payload ?? {};
      activeOverlay = 'healing';
      ui.openHealing(payload.healed ?? 0, payload.bonusId ?? 'damage_10', /** @type {any} */ (game.getPlayer()));
      ui.setOverlay('healing', true);
      // The altar's bonus applies immediately; the overlay only reports it.
      const player = game.getPlayer();
      if (player && payload.bonusId) {
        // The bonus was already granted by the room controller on entry.
      }
      break;
    }

    case 'shop': {
      activeOverlay = 'shop';
      ui.openShop(result.payload?.stock ?? [], /** @type {any} */ (game.getPlayer()));
      ui.setOverlay('shop', true);
      break;
    }

    case 'travel': {
      showNotice(`Travel: ${roomTypeLabel(result.payload?.targetType)}`);
      break;
    }

    default:
      break;
  }
}

/**
 * Walk into an open door to leave a cleared room without pressing a key.
 *
 * The player must first step away from the doorway, otherwise arriving in
 * the next room (already standing in its entry doorway) would immediately
 * teleport them onward again.
 */
let doorArmed = true;
function autoTravelIfAtDoor() {
  const rt = game.rooms.runtime;
  const player = game.getPlayer();
  if (!rt || !player || !player.alive) return;
  if (!rt.cleared && rt.type !== 'start') return;
  if (activeOverlay) return;

  const node = game.run.currentNode();
  if (!node || node.next.length === 0) return;

  let entered = null;
  let enteredDistance = Infinity;
  for (const door of rt.room.doors) {
    if (!door.open) continue;
    const cx = door.rect.x + door.rect.w / 2;
    const cy = door.rect.y + door.rect.h / 2;
    const distance = Math.hypot(player.x - cx, player.y - cy);
    if (distance < 34 && distance < enteredDistance) {
      entered = door;
      enteredDistance = distance;
    }
  }

  // Hysteresis: re-arm only once the player is clear of every doorway.
  if (!entered) {
    doorArmed = true;
    return;
  }
  if (!doorArmed) return;

  // Travel to the room beyond the doorway the player walked into. The room
  // has several doors now, so the destination comes from the door itself
  // rather than from the neighbour list.
  const targetId = Number(entered.targetRoomId);
  if (!Number.isFinite(targetId) || !node.next.includes(targetId)) return;

  doorArmed = false;
  game.travelTo(targetId);
  showNotice(`Travel: ${roomTypeLabel(entered.targetType)}`);
}

/**
 * Render step.
 * @param {number} alpha
 * @param {number} frameDelta
 */
function renderFrame(alpha, frameDelta) {
  void alpha;
  render.fps = loop.fps;
  updateParticleQuality(frameDelta);

  // The mixer prunes finished voices against the audio clock (one pass, no
  // per-voice timers) and pans world sounds around the camera, so what is on
  // screen and what is on the stereo field agree.
  audio.update();
  audio.setListener(camera.x, camera.y);

  // Animation clock runs even while the game is paused, which keeps the
  // menu characters and room runes alive.
  sceneRenderer.update(Math.min(frameDelta, 0.05));

  // Menu character previews animate independently of the world.
  ui.animatePreviews(sceneRenderer.time);

  // Transient timers.
  if (noticeTimer > 0) {
    noticeTimer -= frameDelta;
    if (noticeTimer <= 0) ui.setHint('');
  }
  if (transitionTimer > 0) {
    transitionTimer -= frameDelta;
    if (transitionTimer <= 0) ui.hideTransition();
  }

  const rt = game.rooms.runtime;
  const player = game.getPlayer();
  const aimWorld = camera.screenToWorld(input.cursor.x, input.cursor.y);

  const showWorld = state.isAny(['playing', 'boss', 'pause', 'shop', 'healing'])
    && rt !== null
    && player !== null;

  if (showWorld && rt && player) {
    sceneRenderer.draw({
      room: rt.room,
      runtime: rt,
      registry: game.registry,
      projectiles: game.projectiles,
      beam: game.beam,
      particles: game.particles,
      floatingText: game.floatingText,
      decals: game.decals,
      hazards: game.bossController.hazards,
      ultimateVisuals: game.ultimates.visuals,
      loop,
      screenFlash: game.screenFlash,
      audio,
      aimWorld,
      showReticle: !activeOverlay,
    });
  } else {
    // Menu / game-over screens: clear the canvas behind the DOM overlay.
    render.beginFrame();
  }

  ui.updateHud(player, game.run, game.rooms);
  updateContextHint();
}

/**
 * Contextual prompt near the bottom of the HUD.
 */
function updateContextHint() {
  if (noticeTimer > 0 || activeOverlay) return;

  const interaction = game.getInteraction();
  if (interaction?.kind === 'healing') ui.setHint('[E] Restore health');
  else if (interaction?.kind === 'shop') ui.setHint('[E] Open the shop');
  else if (interaction?.kind === 'door') {
    // Name the destination: the door colour already encodes it, and the hint
    // is what turns that colour into a word.
    ui.setHint(`Door leads to: ${roomTypeLabel(interaction.door?.targetType)}`);
  } else {
    const player = game.getPlayer();
    // An overheated staff is a blocking state the player has to notice, so it
    // outranks the ultimate prompt.
    if (player && player.beam.locked) ui.setHint('STAFF OVERHEATED — let it cool');
    else if (player && player.ultReady) ui.setHint('[Q] ULTIMATE READY');
    else ui.setHint('');
  }
}

/* ============================================================
   Loop
   ============================================================ */

const loop = new GameLoop({
  onFixedUpdate: fixedUpdate,
  onRender: renderFrame,
});

// --- Resize handling ---------------------------------------------------
function handleResize() {
  render.resize();
}
window.addEventListener('resize', handleResize);

// --- Global error surface ---------------------------------------------
window.addEventListener('error', (event) => {
  ui.showError(`Error: ${event.message}\n${event.filename}:${event.lineno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  ui.showError(`Unhandled rejection: ${String(event.reason)}`);
});

// --- Boot --------------------------------------------------------------
render.resize();
input.attach();
state.onEnter('playing', () => ui.showScreen('playing'));
state.onEnter('menu', () => ui.showScreen('menu'));
state.onEnter('character_select', () => ui.showScreen('character_select'));
state.onEnter('game_over', () => ui.showScreen('game_over'));
state.onEnter('victory', () => ui.showScreen('victory'));

// React to run end so the correct screen appears with fresh statistics.
bus.on(EVENTS.RUN_ENDED, ({ reason, player }) => {
  if (reason === 'death') {
    // Dying while a victory is pending must not resurrect the run screen.
    pendingVictory = null;
    ui.renderStats(ui.el.statsGameOver, player, game.run);
    state.force('game_over');
    ui.showScreen('game_over');
    activeOverlay = null;
    ui.hideOverlays();
  }
});

// Start on the main menu.
ui.showScreen('menu');
loop.start();

// Expose a minimal handle for debugging in the console.
Object.assign(window, { __roguelike: { game, bus, state, render, ui, loop, audio } });
