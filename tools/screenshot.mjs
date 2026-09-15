/**
 * @fileoverview Capture real in-game screenshots, without adding a dependency.
 *
 * The offline rasteriser in `render-frame.mjs` is good for measuring
 * composition, but it is not a browser: it approximates gradients and stubs
 * `rotate`, `scale`, `clip` and every text call. That is fine for "is
 * something painted at the screen edge" and useless for a screenshot someone
 * is meant to look at — rotated weapons, clipped baked layers and the DOM HUD
 * would all be missing or wrong.
 *
 * So this drives a real browser instead. It launches the locally installed
 * Chrome/Edge/Chromium headless with the DevTools protocol enabled and talks
 * to it over Node's built-in `WebSocket` (Node 22+). No Puppeteer, no
 * Playwright, no `node_modules` — the same rule as the rest of the project.
 *
 * The game is driven the way a player drives it: real `Input.dispatchKeyEvent`
 * and `Input.dispatchMouseEvent` calls, not direct state mutation. Where a
 * screenshot needs a specific room the run is re-seeded and the door that
 * leads to that room type is taken, because the dungeon is a run of choices
 * and a shop only exists if you walk into one.
 *
 * Usage:
 *   node tools/screenshot.mjs                       # all shots -> docs/screenshots
 *   node tools/screenshot.mjs --out shots           # somewhere else
 *   node tools/screenshot.mjs --only arena,boss     # a subset
 *   node tools/screenshot.mjs --url http://localhost:8080/
 *   node tools/screenshot.mjs --browser <path>      # or set CHROME_PATH
 *   node tools/screenshot.mjs --no-sandbox          # CI containers only
 *
 * The server must already be running (`node tools/serve.mjs`); this script
 * refuses to guess and prints what to start.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VIEW = { width: 1280, height: 720 };

/* ============================================================
   Arguments
   ============================================================ */

const argv = process.argv.slice(2);

/** @param {string} name @param {string|null} fallback */
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  return value && !value.startsWith('--') ? value : 'true';
}

const OUT_DIR = path.resolve(ROOT, arg('out', 'docs/screenshots'));
const URL_BASE = arg('url', 'http://localhost:8080/');
const ONLY = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERBOSE = argv.includes('--verbose');
const NO_SANDBOX = argv.includes('--no-sandbox');

const log = (...args) => console.log(...args);
const debug = (...args) => { if (VERBOSE) console.log('   ·', ...args); };

/* ============================================================
   Browser discovery
   ============================================================ */

/** @returns {string|null} */
function findBrowser() {
  const explicit = arg('browser') || process.env.CHROME_PATH;
  if (explicit && explicit !== 'true') {
    if (!fs.existsSync(explicit)) fail(`--browser path does not exist: ${explicit}`);
    return explicit;
  }

  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);

  for (const c of candidates) if (fs.existsSync(c)) return c;

  // Last resort: something on PATH.
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'chrome', 'msedge']) {
    const found = whichSync(name);
    if (found) return found;
  }
  return null;
}

/** @param {string} name */
function whichSync(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
    }
  }
  return null;
}

/** @param {string} message */
function fail(message) {
  console.error(`screenshot: ${message}`);
  process.exit(2);
}

/* ============================================================
   DevTools protocol client
   ============================================================ */

class CDP {
  /** @param {string} url */
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new CDP(ws);
      ws.addEventListener('open', () => resolve(client), { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true });
    });
  }

  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this._id = 0;
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this._pending = new Map();
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== undefined) {
        const entry = this._pending.get(msg.id);
        if (!entry) return;
        this._pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.params ?? {})})`));
        else entry.resolve(msg.result);
        return;
      }
      for (const fn of this._listeners.get(msg.method) ?? []) fn(msg.params);
    });
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** @param {string} method @param {Function} fn */
  on(method, fn) {
    if (!this._listeners.has(method)) this._listeners.set(method, []);
    /** @type {Function[]} */ (this._listeners.get(method)).push(fn);
  }

  /**
   * Evaluate an expression in the page and return its value.
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* already gone */ }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {Promise<number>} an unused local port */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

/* ============================================================
   Browser lifecycle
   ============================================================ */

/** @param {string} url @returns {Promise<any>} */
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/**
 * Launch headless Chrome and return a connected page client.
 * @param {string} browser
 */
async function launch(browser) {
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rogalik-shots-'));

  const child = spawn(browser, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEW.width},${VIEW.height}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // Software rasterisation keeps the output identical on machines without a
    // usable GPU, which matters when the images are committed to the repo.
    '--disable-gpu',
    // Only for CI containers, where the browser's own sandbox cannot be set up.
    ...(NO_SANDBOX ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let version = null;
  for (let attempt = 0; attempt < 100 && !version; attempt++) {
    await wait(100);
    try { version = await fetchJson(`http://127.0.0.1:${port}/json/version`); } catch { /* not up yet */ }
  }
  if (!version) {
    child.kill();
    fail('the browser did not expose a DevTools endpoint (try --browser <path>)');
  }
  debug(`browser ${version.Browser}`);

  // The page target exists from launch because `about:blank` was requested.
  let target = null;
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    target = list.find((/** @type {any} */ t) => t.type === 'page');
    if (!target) await wait(100);
  }
  if (!target) {
    child.kill();
    fail('no page target appeared in the browser');
  }

  const client = await CDP.connect(target.webSocketDebuggerUrl);

  return {
    client,
    async dispose() {
      client.close();
      child.kill();
      await wait(200);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may still hold it */ }
    },
  };
}

/* ============================================================
   Page-side helpers
   ============================================================ */

/**
 * Installed once, after the game has booted. Everything here runs inside the
 * page and reads only what `main.js` already exposes for debugging.
 */
const PAGE_HELPERS = `window.__shot = {
  cfg: ${JSON.stringify(VIEW)},

  /** Start a fresh run and put the UI on the playing screen. */
  startRun(classId, ultId, seed) {
    const r = window.__roguelike;
    // Leave any open overlay by its own button. The engine tracks the open
    // overlay in a module-local and freezes the simulation while it is up, so
    // hiding the DOM alone would leave the next shot frozen.
    for (const action of ['shop-leave', 'healing-leave', 'resume']) {
      const button = document.querySelector('[data-action="' + action + '"]');
      const overlay = button && button.closest('.overlay');
      if (button && overlay && !overlay.hidden) button.click();
    }
    r.game.startRun(classId, ultId, seed);
    r.state.force('playing');
    r.ui.showScreen('playing');
    r.ui.hideOverlays();
    r.render.resize();
  },

  /**
   * Re-seed the run and walk the dungeon until a room of \`type\` is reached.
   * The floor is a run of choices, so the only honest way to a shop is to
   * take the door that offers one.
   *
   * \`wound\` drops the player to 40% HP immediately *before* stepping into the
   * target room, which is the only way to photograph an altar heal that is
   * not "restored 0 HP": the healing happens on entry.
   */
  gotoRoom(type, seed, classId, ultId, wound) {
    const r = window.__roguelike;
    for (let attempt = 0; attempt < 40; attempt++) {
      this.startRun(classId, ultId, seed + attempt);
      for (let step = 0; step < 24; step++) {
        const rt = r.game.rooms.runtime;
        if (rt && rt.type === type) return { ok: true, seed: seed + attempt, step };
        const doors = (rt && rt.room && rt.room.doors ? rt.room.doors : [])
          .filter((d) => Number.isFinite(Number(d.targetRoomId)));
        if (doors.length === 0) break;
        const door = doors.find((d) => d.targetType === type) || doors[doors.length - 1];
        rt.cleared = true;
        if (wound && door.targetType === type) {
          const p = r.game.getPlayer();
          if (p) p.hp = Math.round(p.maxHp * 0.4);
        }
        r.game.travelTo(Number(door.targetRoomId));
      }
    }
    return { ok: false };
  },

  /** A compact snapshot for the auto-player. */
  world() {
    const r = window.__roguelike;
    const p = r.game.getPlayer();
    if (!p) return null;
    const enemies = r.game.registry.enemies.filter((e) => e.alive);
    let best = null;
    let bestDistance = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestDistance) { bestDistance = d; best = e; }
    }
    const rt = r.game.rooms.runtime;
    return {
      room: rt ? rt.type : null,
      cleared: rt ? Boolean(rt.cleared) : false,
      alive: p.alive,
      hp: p.hp,
      maxHp: p.maxHp,
      x: p.x, y: p.y,
      camera: { x: r.game.camera.x, y: r.game.camera.y },
      center: rt ? { x: rt.room.center.x, y: rt.room.center.y } : null,
      nearest: best ? { x: best.x, y: best.y, d: bestDistance } : null,
      enemies: enemies.length,
      particles: r.game.particles.count,
      interaction: r.game.getInteraction() ? r.game.getInteraction().kind : null,
      // The beam as the renderer sees it, so a shot can be checked against
      // what was actually drawn rather than against what should have been.
      beam: r.game.beam.last
        ? {
          length: Math.round(Math.hypot(r.game.beam.last.x1 - r.game.beam.last.x0,
            r.game.beam.last.y1 - r.game.beam.last.y0)),
          hitBody: r.game.beam.last.hitBody,
          targets: r.game.beam.last.targets,
        }
        : null,
      beamHeat: Number((r.game.getPlayer().beam?.heat ?? 0).toFixed(2)),
    };
  },

  /** How many frames the loop has actually rendered: proves rAF is alive. */
  stats() {
    const r = window.__roguelike;
    const canvas = r.render.canvas;
    const rect = canvas.getBoundingClientRect();
    const p = r.game.getPlayer();
    return {
      fps: Math.round(r.loop.fps || 0),
      viewport: [window.innerWidth, window.innerHeight],
      canvasRect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      buffer: [canvas.width, canvas.height],
      player: p ? [Math.round(p.x), Math.round(p.y)] : null,
      camera: [Math.round(r.game.camera.x), Math.round(r.game.camera.y)],
      // Where the player is actually painted. If this is not the centre of the
      // canvas rect, the camera is not doing its job.
      playerOnScreen: p ? [
        Math.round(rect.left + (p.x - r.game.camera.x) + rect.width / 2),
        Math.round(rect.top + (p.y - r.game.camera.y) + rect.height / 2),
      ] : null,
    };
  },
}; true;`;

/* ============================================================
   Input
   ============================================================ */

const KEY_CODES = {
  KeyW: { key: 'w', vk: 87 },
  KeyA: { key: 'a', vk: 65 },
  KeyS: { key: 's', vk: 83 },
  KeyD: { key: 'd', vk: 68 },
  KeyQ: { key: 'q', vk: 81 },
  KeyE: { key: 'e', vk: 69 },
  Space: { key: ' ', vk: 32 },
  Escape: { key: 'Escape', vk: 27 },
};

/** @param {CDP} cdp @param {Set<string>} held @param {string[]} wanted */
async function holdKeys(cdp, held, wanted) {
  for (const code of [...held]) {
    if (wanted.includes(code)) continue;
    held.delete(code);
    const info = KEY_CODES[/** @type {keyof typeof KEY_CODES} */ (code)];
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: info.key, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk });
  }
  for (const code of wanted) {
    if (held.has(code)) continue;
    held.add(code);
    const info = KEY_CODES[/** @type {keyof typeof KEY_CODES} */ (code)];
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: info.key, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk });
  }
}

/** @param {CDP} cdp @param {string} code */
async function tapKey(cdp, code) {
  const info = KEY_CODES[/** @type {keyof typeof KEY_CODES} */ (code)];
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: info.key, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk });
  await wait(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: info.key, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk });
}

/* ============================================================
   The shots
   ============================================================ */

/**
 * Each shot returns nothing and leaves the page in the state to capture.
 *
 * A shot may either leave the page ready for a single capture (`run`), or ask
 * for the busiest frame of a fight (`pick`). The second form exists because a
 * live fight does not hold still: the same seed produces a different frame
 * every run, and "the warrior had already killed everything" is a bad
 * screenshot that a fixed timestamp cannot avoid.
 *
 * @typedef {{
 *   name: string,
 *   caption: string,
 *   run?: (ctx: ShotContext) => Promise<void>,
 *   pick?: { seconds: number, score: (world: any) => number, opts?: object },
 * }} Shot
 * @typedef {{cdp: CDP, held: Set<string>}} ShotContext
 */

/** Aim at a world point and hold the attack. @param {CDP} cdp @param {number} x @param {number} y @param {boolean} down */
async function aimAt(cdp, x, y, down) {
  const cx = Math.max(1, Math.min(VIEW.width - 1, x));
  const cy = Math.max(1, Math.min(VIEW.height - 1, y));
  await cdp.send('Input.dispatchMouseEvent', {
    type: down ? 'mouseMoved' : 'mouseMoved',
    x: cx, y: cy, button: 'none', buttons: down ? 1 : 0,
  });
}

/** @param {CDP} cdp @param {boolean} down */
async function attack(cdp, down) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: down ? 'mousePressed' : 'mouseReleased',
    x: VIEW.width / 2, y: VIEW.height / 2, button: 'left', buttons: down ? 1 : 0, clickCount: 1,
  });
}

/**
 * The right button, which every staff fires its beam with.
 * @param {CDP} cdp @param {boolean} down
 */
async function beamAttack(cdp, down) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: down ? 'mousePressed' : 'mouseReleased',
    x: VIEW.width / 2, y: VIEW.height / 2, button: 'right', buttons: down ? 2 : 0, clickCount: 1,
  });
}

/**
 * Play the game for a while: face the nearest enemy, close the distance, swing.
 * Real input events only — the same path a player uses.
 *
 * @param {ShotContext} ctx
 * @param {number} seconds
 * @param {{approach?: boolean, ult?: boolean, attack?: boolean, beam?: boolean,
 *   hold?: boolean}} [opts]
 */
async function autoPlay(ctx, seconds, opts = {}) {
  const { cdp, held } = ctx;
  const approach = opts.approach !== false;
  const swings = opts.attack !== false;
  const beams = opts.beam === true;
  const end = Date.now() + seconds * 1000;
  let pressed = false;

  while (Date.now() < end) {
    const world = await cdp.eval('window.__shot.world()');
    if (!world || !world.alive) break;

    if (swings && !pressed) {
      await (beams ? beamAttack(cdp, true) : attack(cdp, true));
      pressed = true;
    }

    if (world.nearest) {
      const sx = world.nearest.x - world.camera.x + VIEW.width / 2;
      const sy = world.nearest.y - world.camera.y + VIEW.height / 2;
      await aimAt(cdp, sx, sy, true);

      const wanted = [];
      if (approach && world.nearest.d > 80) {
        const dx = world.nearest.x - world.x;
        const dy = world.nearest.y - world.y;
        // Below the dead zone the key is released, so the player stops
        // jittering on top of the enemy it is trying to hit.
        if (dx > 24) wanted.push('KeyD');
        else if (dx < -24) wanted.push('KeyA');
        if (dy > 24) wanted.push('KeyS');
        else if (dy < -24) wanted.push('KeyW');
      }
      await holdKeys(cdp, held, wanted);
    }

    if (opts.ult && world.ultReady) await tapKey(cdp, 'KeyQ');

    await wait(70);
  }

  // `hold` keeps the button down between slices, which a beam needs: releasing
  // it between candidates would mean every captured frame shows a staff that
  // has already stopped firing.
  if (pressed && !opts.hold) await (beams ? beamAttack(cdp, false) : attack(cdp, false));
  await holdKeys(cdp, held, []);
}
/**
 * Keep playing until the scene is worth photographing.
 *
 * A fight is not at its best at a fixed timestamp: five seconds in, the
 * warrior may have already cleared the wave and the shot is an empty room.
 * Waiting on the *state* ("at least three enemies and some particles in the
 * air") instead of on the clock is what makes the capture repeatable.
 *
 * @param {ShotContext} ctx
 * @param {(world: any) => boolean} ready
 * @param {number} timeout seconds
 */
async function autoPlayUntil(ctx, ready, timeout, opts = {}) {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    await autoPlay(ctx, 0.4, { ult: true, ...opts });
    const world = await ctx.cdp.eval('window.__shot.world()');
    if (!world || !world.alive) return world;
    // Capture on the way down rather than photographing a death screen.
    if (world.hp < world.maxHp * 0.25) return world;
    if (ready(world)) {
      // A short beat so the swing, the impact and the numbers are all
      // mid-flight at the moment of capture, but not so long that the impact
      // particles have already faded.
      await autoPlay(ctx, 0.12, { ult: true, ...opts });
      return ctx.cdp.eval('window.__shot.world()');
    }
  }
  return ctx.cdp.eval('window.__shot.world()');
}

/**
 * Play a fight and keep the best-looking frame of it.
 *
 * Candidate frames are captured every few hundred milliseconds and scored;
 * only the winner is written. Without this the same command produced a busy
 * arena one run and an empty room with a corpse in it the next, which is a
 * poor property for a tool whose output is committed to the repository.
 *
 * @param {CDP} cdp
 * @param {ShotContext} ctx
 * @param {{seconds: number, score: (world: any) => number, opts?: object}} pick
 * @returns {Promise<{data: string, world: any, score: number}|null>}
 */
async function playAndPick(cdp, ctx, pick) {
  const deadline = Date.now() + pick.seconds * 1000;
  let best = null;

  while (Date.now() < deadline) {
    await autoPlay(ctx, 0.45, { ult: true, ...(pick.opts ?? {}) });
    const world = await cdp.eval('window.__shot.world()');
    if (!world) break;

    // A frame is only a candidate if the player is alive and not about to
    // die. The busiest frame of a fight is very often the one where the
    // health bar is nearly empty, and "a screenshot of a losing fight" is not
    // a good look for the game however many particles are in it.
    const healthy = world.alive && world.hp >= world.maxHp * 0.3;
    if (healthy) {
      const score = pick.score(world);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (!best || score > best.score) best = { data, world, score };
      debug(`candidate score ${score} (hp ${world.hp}/${world.maxHp}, ${world.enemies} enemies, ${world.particles} particles${
        world.beam ? `, beam ${world.beam.length}px hitting ${world.beam.targets}` : ', no beam'})`);
    } else {
      debug(`skipped candidate (hp ${world.hp}/${world.maxHp})`);
      break;
    }
  }

  // A held shot keeps its button down across the whole candidate loop, so it
  // has to be let go once the winner has been captured.
  if (pick.opts?.hold) {
    await attack(cdp, false);
    await beamAttack(cdp, false);
  }

  return best;
}

/**
 * Walk to the middle of the room, where the shop and the altar live, then
 * press E. Genuine interaction: `getInteraction` only reports a shop within
 * 120px of the room centre, so standing there is the actual requirement.
 * @param {ShotContext} ctx
 * @param {number} [timeout]
 */
async function walkToCentre(ctx, timeout = 6) {
  const { cdp, held } = ctx;
  const end = Date.now() + timeout * 1000;
  while (Date.now() < end) {
    const world = await cdp.eval('window.__shot.world()');
    if (!world || !world.center || !world.alive) break;
    if (world.interaction) break;

    const dx = world.center.x - world.x;
    const dy = world.center.y - world.y;
    const wanted = [];
    if (dx > 20) wanted.push('KeyD');
    else if (dx < -20) wanted.push('KeyA');
    if (dy > 20) wanted.push('KeyS');
    else if (dy < -20) wanted.push('KeyW');
    await holdKeys(cdp, held, wanted);
    if (wanted.length === 0) break;
    await wait(70);
  }
  await holdKeys(ctx.cdp, ctx.held, []);
  await wait(150);
}

/** @type {Shot[]} */
const SHOTS = [
  {
    name: 'menu',
    caption: 'Main menu',
    async run({ cdp }) {
      await wait(900);
    },
  },

  {
    name: 'characters',
    caption: 'Class and ultimate select',
    async run({ cdp }) {
      await cdp.eval(`document.querySelector('[data-action="goto"][data-target="character_select"]').click(); true`);
      await wait(700);
      // Pick the mage so the shot shows a class other than the default.
      await cdp.eval(`(() => {
        const cards = [...document.querySelectorAll('#class-grid > *')];
        const mage = cards.find((c) => /mage/i.test(c.textContent)) || cards[1];
        if (mage) mage.click();
        return cards.length;
      })()`);
      await wait(500);
    },
  },

  {
    name: 'arena',
    caption: 'Arena combat',
    async run(ctx) {
      const where = await ctx.cdp.eval(`window.__shot.gotoRoom('arena', 7, 'warrior', 'whirlwind')`);
      debug('arena at', JSON.stringify(where));
      // Wave 1 is three bodies and wave 2 only starts once wave 1 is dead, so
      // three is the busiest an arena gets while the player holds fire. Let
      // them arrive without swinging, then fight and keep the best frame.
      await autoPlayUntil(ctx, (w) => w.enemies >= 3, 12, { attack: false, approach: false });
    },
    pick: {
      seconds: 5,
      opts: { approach: true },
      score: (w) => w.particles * 2 + w.enemies * 30,
    },
  },

  {
    name: 'boss',
    caption: 'Boss fight',
    async run(ctx) {
      const where = await ctx.cdp.eval(`window.__shot.gotoRoom('boss', 3, 'mage', 'meteor')`);
      debug('boss at', JSON.stringify(where));
      await wait(1800);
    },
    pick: {
      // The mage keeps its distance, and the golem telegraphs before it
      // lands, so the busiest frame is the one where its attack is on screen.
      seconds: 7,
      opts: { approach: false },
      score: (w) => w.particles + w.enemies * 10,
    },
  },

  {
    name: 'shop',
    caption: 'Merchant',
    async run(ctx) {
      const where = await ctx.cdp.eval(`window.__shot.gotoRoom('shop', 11, 'gunner', 'bullet_storm')`);
      debug('shop at', JSON.stringify(where));
      // Hand the player gold so the shelf shows both states: a run that has
      // just started has none, and every price would be greyed out.
      await ctx.cdp.eval(`(() => { const p = window.__roguelike.game.getPlayer(); p.gold = 140; return p.gold; })()`);
      await walkToCentre(ctx);
      await tapKey(ctx.cdp, 'KeyE');
      await wait(600);
    },
  },

  {
    name: 'altar',
    caption: 'Healing altar',
    async run(ctx) {
      // Arrive wounded so the overlay can report a real heal: the altar does
      // its work on entry, not when the player presses E.
      const where = await ctx.cdp.eval(`window.__shot.gotoRoom('healing', 5, 'warrior', 'whirlwind', true)`);
      debug('altar at', JSON.stringify(where));
      await walkToCentre(ctx);
      await tapKey(ctx.cdp, 'KeyE');
      await wait(700);
    },
  },

  {
    name: 'pause',
    caption: 'Pause and the sound mixer',
    async run(ctx) {
      await ctx.cdp.eval(`window.__shot.gotoRoom('arena', 7, 'warrior', 'whirlwind')`);
      await wait(900);
      await tapKey(ctx.cdp, 'Escape');
      await wait(700);
    },
  },

  {
    name: 'beam',
    caption: 'Staff beam (right button)',
    async run(ctx) {
      const where = await ctx.cdp.eval(`window.__shot.gotoRoom('arena', 7, 'mage', 'meteor')`);
      debug('beam at', JSON.stringify(where));
      // Let a few bodies arrive so the beam has something to burn.
      await autoPlayUntil(ctx, (w) => w.enemies >= 3, 12, { attack: false, approach: false });
    },
    pick: {
      // Short: the gauge locks the staff out after three seconds, and a shot
      // of an overheated staff is a shot of nothing happening. The button
      // stays down for the whole loop so every candidate has a live beam.
      seconds: 2.2,
      opts: { approach: false, beam: true, hold: true },
      score: (w) => w.particles * 2 + w.enemies * 30,
    },
  },
];

/* ============================================================
   Main
   ============================================================ */

const browser = findBrowser();
if (!browser) {
  fail('no Chrome, Edge or Chromium found. Pass --browser <path> or set CHROME_PATH.');
}

// Fail early and precisely if the game is not being served.
let unreachable = '';
try {
  const res = await fetch(URL_BASE, { method: 'GET' });
  if (!res.ok) unreachable = `HTTP ${res.status}`;
} catch (err) {
  unreachable = err?.cause?.message ?? err?.message ?? String(err);
}
if (unreachable) {
  // The advice depends on where the game was meant to be: telling someone to
  // start the dev server when they pointed the tool at a public URL is worse
  // than saying nothing.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(URL_BASE);
  fail(
    `${URL_BASE} is not reachable (${unreachable})\n`
    + (local
      ? '  start it first:  node tools/serve.mjs'
      : '  check the URL, or your connection to it'),
  );
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const chosen = SHOTS.filter((s) => ONLY.length === 0 || ONLY.includes(s.name));
if (chosen.length === 0) fail(`--only matched nothing. Known shots: ${SHOTS.map((s) => s.name).join(', ')}`);

log(`browser : ${browser}`);
log(`game    : ${URL_BASE}`);
log(`output  : ${OUT_DIR}`);
log('');

const { client: cdp, dispose } = await launch(browser);

try {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false,
  });

  const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
  await cdp.send('Page.navigate', { url: URL_BASE });
  await loaded;

  // Wait for the composition root to publish its handle.
  let booted = false;
  for (let attempt = 0; attempt < 100 && !booted; attempt++) {
    booted = await cdp.eval('Boolean(window.__roguelike && window.__roguelike.game)');
    if (!booted) await wait(100);
  }
  if (!booted) fail('the game did not boot: window.__roguelike never appeared');

  await cdp.eval(PAGE_HELPERS);
  await wait(500);

  const held = new Set();
  for (const shot of chosen) {
    process.stdout.write(`  ${shot.name.padEnd(12)} ${shot.caption} ... `);

    let captured = null;
    if (shot.run) await shot.run({ cdp, held });
    if (shot.pick) captured = await playAndPick(cdp, { cdp, held }, shot.pick);

    // A dead player means the run screen replaced the world: that is a failed
    // capture, not a screenshot of a fight.
    const world = captured ? captured.world : await cdp.eval('window.__shot.world()');
    if (world && !world.alive) {
      log('SKIPPED (the player died)');
      continue;
    }

    const stats = await cdp.eval('window.__shot.stats()');
    debug('geometry', JSON.stringify(stats));

    // The game surfaces uncaught page errors in its own box rather than
    // failing silently. Reading it here is the difference between "the
    // overlay did not open" and knowing why.
    const dom = await cdp.eval(`(() => {
      const box = document.getElementById('error-box');
      return {
        screen: [...document.querySelectorAll('[data-screen]')].filter((s) => !s.hidden).map((s) => s.dataset.screen),
        overlays: [...document.querySelectorAll('.overlay')].filter((o) => !o.hidden).map((o) => o.id),
        error: box && !box.hidden ? box.textContent.slice(0, 160) : null,
      };
    })()`);
    debug('dom', JSON.stringify(dom));
    if (dom.error) log(`\n     ! page error: ${dom.error}`);

    // Either the frame the picker already chose, or the page as it stands.
    const data = captured
      ? captured.data
      : (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;

    const file = path.join(OUT_DIR, `${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    const size = fs.statSync(file).size;
    log(`${(size / 1024).toFixed(0)} KB  @${stats.fps}fps${world ? `  ${world.enemies} enemies, ${world.particles} particles` : ''}`);
  }
} finally {
  await dispose();
}

log('');
log(`wrote ${chosen.length} shot(s) to ${path.relative(ROOT, OUT_DIR) || OUT_DIR}`);
