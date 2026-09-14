/**
 * Render a real frame to a PNG so the visuals can be inspected directly.
 *
 * Implements a tiny software rasteriser covering the Canvas 2D calls the
 * game actually uses (fillRect, arcs, ellipse, lines, gradients as flat
 * colour, additive blending), then runs the real SceneRenderer over it.
 *
 * This is the only way to see the procedural art without a browser, and it
 * is what makes visual bugs like "nothing is drawn at the screen edge"
 * verifiable.
 *
 * Run with:  node tools/render-frame.mjs [outfile.png]
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = CONFIG.view.width;
const H = CONFIG.view.height;

/* ============================================================
   Software rasteriser
   ============================================================ */

class Surface {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    /** @type {Float64Array} RGB, 0..255 */
    this.data = new Float64Array(w * h * 3);
  }

  /**
   * @param {number} x @param {number} y
   * @param {number} r @param {number} g @param {number} b
   * @param {number} a 0..1
   * @param {boolean} additive
   */
  blend(x, y, r, g, b, a, additive) {
    if (a <= 0) return;
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 3;
    if (additive) {
      this.data[i] += r * a;
      this.data[i + 1] += g * a;
      this.data[i + 2] += b * a;
    } else {
      this.data[i] += (r - this.data[i]) * a;
      this.data[i + 1] += (g - this.data[i + 1]) * a;
      this.data[i + 2] += (b - this.data[i + 2]) * a;
    }
  }

  toPNG() {
    const w = this.w;
    const h = this.h;
    // Raw scanlines with filter byte 0.
    const raw = Buffer.alloc((w * 3 + 1) * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
      raw[p++] = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[p++] = Math.max(0, Math.min(255, Math.round(this.data[i])));
        raw[p++] = Math.max(0, Math.min(255, Math.round(this.data[i + 1])));
        raw[p++] = Math.max(0, Math.min(255, Math.round(this.data[i + 2])));
      }
    }
    return encodePNG(w, h, raw);
  }
}

/** @param {number} w @param {number} h @param {Buffer} raw */
function encodePNG(w, h, raw) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();

  /** @param {Buffer} buf */
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  /** @param {string} type @param {Buffer} data */
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Colour parsing ---------- */

/** @param {any} style */
function parseColor(style) {
  if (style && typeof style === 'object' && Array.isArray(style._stops)) {
    // A gradient: approximate with its middle stop, which is enough to read
    // the composition of a frame.
    const stops = style._stops;
    if (stops.length === 0) return [40, 40, 55];
    const mid = stops[Math.floor(stops.length / 2)];
    return parseColor(mid[1]);
  }
  if (typeof style !== 'string') return [255, 0, 255];
  const s = style.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // Matches both rgb() and rgba(), with or without spaces.
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  // Anything else renders as the magenta error colour, so a formatting
  // mistake is obvious rather than silent.
  return [255, 0, 255];
}

/** The alpha a gradient's middle stop carries, if any. */
function gradientAlpha(style) {
  if (style && typeof style === 'object' && Array.isArray(style._stops)) {
    const stops = style._stops;
    if (stops.length === 0) return 1;
    return styleAlpha(stops[Math.floor(stops.length / 2)][1]);
  }
  return styleAlpha(style);
}

/**
 * Samples a gradient at t in 0..1, interpolating between its stops.
 * @param {any} grad
 * @param {number} t
 * @returns {{rgb: number[], a: number}}
 */
function sampleGradient(grad, t) {
  const stops = grad._stops;
  if (!stops || stops.length === 0) return { rgb: [40, 40, 55], a: 1 };
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (t <= first[0]) return { rgb: parseColor(first[1]), a: styleAlpha(first[1]) };
  if (t >= last[0]) return { rgb: parseColor(last[1]), a: styleAlpha(last[1]) };

  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      const a0 = parseColor(c0);
      const a1 = parseColor(c1);
      const al0 = styleAlpha(c0);
      const al1 = styleAlpha(c1);
      return {
        rgb: [
          a0[0] + (a1[0] - a0[0]) * k,
          a0[1] + (a1[1] - a0[1]) * k,
          a0[2] + (a1[2] - a0[2]) * k,
        ],
        a: al0 + (al1 - al0) * k,
      };
    }
  }
  return { rgb: parseColor(last[1]), a: styleAlpha(last[1]) };
}

/** The alpha embedded in an rgba() string, if any. */
function styleAlpha(style) {
  if (typeof style !== 'string') return 1;
  const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)/.exec(style);
  return m ? Number(m[1]) : 1;
}

/* ---------- 2D context ---------- */

function makeContext(surface) {
  const grad = {
    _stops: /** @type {Array<[number, string]>} */ ([]),
    addColorStop(p, c) { this._stops.push([p, c]); },
  };

  const st = {
    a: 1, d: 1, e: 0, f: 0,
    fillStyle: '#fff', strokeStyle: '#fff', lineWidth: 1,
    globalAlpha: 1, gco: 'source-over',
  };
  const stack = [];
  /** @type {Array<{x:number,y:number}>} */
  let path = [];
  let current = { x: 0, y: 0 };
  let startPt = { x: 0, y: 0 };

  /** World -> surface coords. */
  const tx = (x) => x * st.a + st.e;
  const ty = (y) => y * st.d + st.f;

  const ctx = {
    canvas: { width: W, height: H },
    get fillStyle() { return st.fillStyle; },
    set fillStyle(v) { st.fillStyle = v; },
    get strokeStyle() { return st.strokeStyle; },
    set strokeStyle(v) { st.strokeStyle = v; },
    get lineWidth() { return st.lineWidth; },
    set lineWidth(v) { st.lineWidth = v; },
    get globalAlpha() { return st.globalAlpha; },
    set globalAlpha(v) { st.globalAlpha = v; },
    get globalCompositeOperation() { return st.gco; },
    set globalCompositeOperation(v) { st.gco = v; },
    font: '', textAlign: '', textBaseline: '', lineCap: '', lineDashOffset: 0,
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    setLineDash() {},
    save() { stack.push({ ...st }); },
    restore() { const s = stack.pop(); if (s) Object.assign(st, s); },
    translate(x, y) { st.e += x * st.a; st.f += y * st.d; },
    rotate() {}, scale() {},
    setTransform(a, b, c, d, e, f) { st.a = a; st.d = d; st.e = e; st.f = f; },

    beginPath() { path = []; },
    closePath() {},
    moveTo(x, y) { current = { x, y }; startPt = { x, y }; path.push({ x, y }); },
    lineTo(x, y) { current = { x, y }; path.push({ x, y }); },
    arc(cx, cy, r, a0, a1) {
      const steps = Math.max(6, Math.min(48, Math.ceil(r * 1.4)));
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (a1 - a0) * (i / steps);
        path.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    },
    arcTo(x1, y1, x2, y2) { path.push({ x: x1, y: y1 }); },
    ellipse(cx, cy, rx, ry, rot, a0, a1) {
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (a1 - a0) * (i / steps);
        const px = Math.cos(a) * rx;
        const py = Math.sin(a) * ry;
        path.push({
          x: cx + px * Math.cos(rot) - py * Math.sin(rot),
          y: cy + px * Math.sin(rot) + py * Math.cos(rot),
        });
      }
    },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = current;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const mt = 1 - t;
        path.push({
          x: mt * mt * p0.x + 2 * mt * t * cx + t * t * x,
          y: mt * mt * p0.y + 2 * mt * t * cy + t * t * y,
        });
      }
      current = { x, y };
    },
    rect(x, y, w, h) {
      path.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h });
    },
    clip() {},

    /** Scanline polygon fill. */
    fill() {
      if (path.length < 3) return;
      const pts = path.map((p) => ({ x: tx(p.x), y: ty(p.y) }));
      const [r, g, b] = parseColor(st.fillStyle);
      const a = st.globalAlpha * gradientAlpha(st.fillStyle);
      const additive = st.gco === 'lighter';
      const ys = pts.map((p) => p.y);
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const y1 = Math.min(surface.h - 1, Math.ceil(Math.max(...ys)));

      for (let y = y0; y <= y1; y++) {
        /** @type {number[]} */
        const xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const pi = pts[i];
          const pj = pts[j];
          if ((pi.y > y) !== (pj.y > y)) {
            xs.push(pi.x + ((y - pi.y) / (pj.y - pi.y)) * (pj.x - pi.x));
          }
        }
        if (xs.length < 2) continue;
        xs.sort((m, n) => m - n);
        for (let k = 0; k < xs.length; k += 2) {
          const sx = Math.max(0, Math.floor(xs[k]));
          const ex = Math.min(surface.w - 1, Math.ceil(xs[k + 1]));
          for (let x = sx; x <= ex; x++) surface.blend(x, y, r, g, b, a, additive);
        }
      }
    },

    stroke() {
      if (path.length < 2) return;
      const [r, g, b] = parseColor(st.strokeStyle);
      const a = st.globalAlpha * gradientAlpha(st.strokeStyle);
      const additive = st.gco === 'lighter';
      const lw = Math.max(1, st.lineWidth);
      for (let i = 0; i < path.length - 1; i++) {
        const p0 = { x: tx(path[i].x), y: ty(path[i].y) };
        const p1 = { x: tx(path[i + 1].x), y: ty(path[i + 1].y) };
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const steps = Math.max(1, Math.ceil(dist));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = p0.x + (p1.x - p0.x) * t;
          const py = p0.y + (p1.y - p0.y) * t;
          const half = lw / 2;
          for (let oy = -half; oy <= half; oy += 1) {
            for (let ox = -half; ox <= half; ox += 1) {
              surface.blend(px + ox, py + oy, r, g, b, a, additive);
            }
          }
        }
      }
    },

    fillRect(x, y, w, h) {
      const style = st.fillStyle;
      const isGradient = style && typeof style === 'object' && Array.isArray(style._stops);
      const additive = st.gco === 'lighter';
      const x0 = tx(x);
      const y0 = ty(y);
      const x1 = tx(x + w);
      const y1 = ty(y + h);
      const sx = Math.max(0, Math.floor(Math.min(x0, x1)));
      const ex = Math.min(surface.w - 1, Math.ceil(Math.max(x0, x1)));
      const sy = Math.max(0, Math.floor(Math.min(y0, y1)));
      const ey = Math.min(surface.h - 1, Math.ceil(Math.max(y0, y1)));

      if (!isGradient) {
        const [r, g, b] = parseColor(style);
        const a = st.globalAlpha * styleAlpha(style);
        for (let py = sy; py <= ey; py++) {
          for (let px = sx; px <= ex; px++) surface.blend(px, py, r, g, b, a, additive);
        }
        return;
      }

      // Interpolate the gradient across the rect so the lighting reads
      // correctly. Radial and linear are both approximated by the distance
      // from the rect's centre along its longer axis, which is accurate
      // enough to judge composition.
      const rectW = Math.max(1, Math.abs(x1 - x0));
      const rectH = Math.max(1, Math.abs(y1 - y0));
      const maxR = Math.hypot(rectW, rectH) / 2;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;

      for (let py = sy; py <= ey; py++) {
        for (let px = sx; px <= ex; px++) {
          const t = Math.min(1, Math.hypot(px - cx, py - cy) / maxR);
          const s = sampleGradient(style, t);
          surface.blend(px, py, s.rgb[0], s.rgb[1], s.rgb[2], st.globalAlpha * s.a, additive);
        }
      }
    },
    strokeRect(x, y, w, h) {
      const [r, g, b] = parseColor(st.strokeStyle);
      const a = st.globalAlpha * gradientAlpha(st.strokeStyle);
      const additive = st.gco === 'lighter';
      const x0 = tx(x), y0 = ty(y), x1 = tx(x + w), y1 = ty(y + h);
      for (let px = Math.floor(x0); px <= Math.ceil(x1); px++) {
        for (const py of [Math.floor(y0), Math.floor(y0) + 1, Math.ceil(y1) - 1, Math.ceil(y1)]) {
          surface.blend(px, py, r, g, b, a, additive);
        }
      }
      for (let py = Math.floor(y0); py <= Math.ceil(y1); py++) {
        for (const px of [Math.floor(x0), Math.floor(x0) + 1, Math.ceil(x1) - 1, Math.ceil(x1)]) {
          surface.blend(px, py, r, g, b, a, additive);
        }
      }
    },
    clearRect() {},
    fillText() {}, strokeText() {},
    measureText: () => ({ width: 0 }),
  };
  return ctx;
}

/* ============================================================
   Render one frame
   ============================================================ */

const { Game } = await import('../src/game/Game.js');
const { RenderSystem } = await import('../src/rendering/RenderSystem.js');
const { SceneRenderer } = await import('../src/rendering/SceneRenderer.js');

const bus = new EventBus();
const game = new Game({
  bus,
  state: new StateMachine(bus, 'menu'),
  callbacks: {
    onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
    onPlayerDeath: () => {}, onNotice: () => {},
  },
});

const classId = process.argv[3] ?? 'warrior';
const ultId = process.argv[4] ?? 'whirlwind';
const roomArg = process.argv[5] ?? 'arena';
game.startRun(classId, ultId, 1234);

// Walk the graph to the requested room type so the frame is interesting.
if (roomArg !== 'start') {
  for (let guard = 0; guard < 20; guard++) {
    const rtNow = game.rooms.runtime;
    if (!rtNow || rtNow.type === roomArg) break;
    rtNow.cleared = true;
    const node = game.run.currentNode();
    if (!node || node.next.length === 0) break;
    game.travelTo(node.next[0]);
  }
}

// Play a few seconds so enemies spawn and the arena is populated.
for (let i = 0; i < 60 * 6; i++) {
  const player = game.getPlayer();
  const target = game.registry.enemies.find((e) => e.alive);
  const dx = target ? target.x - player.x : 0;
  const dy = target ? target.y - player.y : 1;
  const d = Math.hypot(dx, dy) || 1;
  game.update(1 / 60, {
    move: d > 120 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 },
    aim: target
      ? { x: target.x - game.camera.x + W / 2, y: target.y - game.camera.y + H / 2 }
      : { x: W / 2, y: H / 2 },
    attackHeld: Boolean(target), attackPressed: Boolean(target), ultPressed: player.ultReady,
  });
}

const surface = new Surface(W, H);
const ctx = makeContext(surface);
const render = new RenderSystem(/** @type {any} */ ({
  width: 0, height: 0,
  parentElement: { style: { setProperty() {} } },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  getContext: () => ctx,
}), game.camera);
render.resize();

const scene = new SceneRenderer(render);
const rt = game.rooms.runtime;
scene.draw({
  room: rt.room,
  runtime: rt,
  registry: game.registry,
  projectiles: game.projectiles,
  particles: game.particles,
  floatingText: game.floatingText,
  hazards: game.bossController.hazards,
  ultimateVisuals: game.ultimates.visuals,
  screenFlash: game.screenFlash,
  aimWorld: { x: game.getPlayer().x + 60, y: game.getPlayer().y },
  showReticle: true,
});

const out = process.argv[2] ?? path.join(ROOT, 'tools', 'frame.png');
fs.writeFileSync(out, surface.toPNG());

console.log(`room      : ${rt.type}`);
console.log(`player    : (${game.getPlayer().x.toFixed(0)}, ${game.getPlayer().y.toFixed(0)})`);
console.log(`camera    : (${game.camera.x.toFixed(0)}, ${game.camera.y.toFixed(0)})`);
console.log(`enemies   : ${game.registry.enemies.filter((e) => e.alive).length}`);
console.log(`particles : ${game.particles.count}`);
console.log(`wrote     : ${out}`);
