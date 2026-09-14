/**
 * @fileoverview Persistent floor decals (blood, scorch, chip marks).
 *
 * SRP: own the *state* of what is lying on the floor and its lifetime. How a
 * decal looks is the renderer's business (`decalArt.js`), and why one exists is
 * the combat system's business. This module is the bounded buffer in between.
 *
 * Why a ring buffer rather than "add and forget": decals are drawn every frame
 * on top of the baked floor, so an uncapped list is a slow-motion fill-rate
 * leak — the exact "it gets worse over time" symptom a long fight produces.
 * `capacity` therefore bounds the per-frame cost by construction, and the oldest
 * mark is evicted first, which is also the one that has faded the most.
 */

/**
 * A single mark on the floor.
 * @typedef {object} Decal
 * @property {number} x
 * @property {number} y
 * @property {number} life      seconds remaining
 * @property {number} maxLife
 * @property {number} size
 * @property {number} rotation
 * @property {string} kind      'blood' | 'scorch' | 'chip'
 * @property {string} color
 * @property {number} seed      stable per-decal randomness for the art
 */

const KIND_DEFAULTS = {
  blood: { size: 15, life: 26, color: '#7c1d16' },
  scorch: { size: 30, life: 30, color: '#1a1512' },
  chip: { size: 9, life: 20, color: '#3a3540' },
};

export class DecalLayer {
  /**
   * @param {number} [capacity] hard ceiling on simultaneous marks. Reaching it
   *   evicts the oldest instead of growing, so drawing cost is constant.
   */
  constructor(capacity = 96) {
    this.capacity = capacity;
    /** @type {Decal[]} */
    this.marks = [];
    this._cursor = 0;
    /** Marks evicted while still visible; read by the perf tools. */
    this.evictions = 0;
  }

  /**
   * Add a mark. Never grows past `capacity`.
   * @param {number} x
   * @param {number} y
   * @param {string} kind
   * @param {Partial<Decal>} [overrides]
   */
  add(x, y, kind = 'blood', overrides = {}) {
    const base = KIND_DEFAULTS[kind] ?? KIND_DEFAULTS.blood;
    /** @type {Decal} */
    const mark = {
      x, y,
      kind,
      life: base.life,
      maxLife: base.life,
      size: base.size,
      rotation: Math.random() * Math.PI * 2,
      color: base.color,
      seed: Math.random() * 1000,
      ...overrides,
    };
    mark.maxLife = mark.life;

    if (this.marks.length < this.capacity) {
      this.marks.push(mark);
    } else {
      // Ring-buffer overwrite: O(1), no shifting, and it evicts the oldest.
      if (this.marks[this._cursor] && this.marks[this._cursor].life > 0.5) this.evictions++;
      this.marks[this._cursor] = mark;
      this._cursor = (this._cursor + 1) % this.capacity;
    }
    return mark;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const list = this.marks;
    let write = 0;
    for (let read = 0; read < list.length; read++) {
      const d = list[read];
      d.life -= dt;
      if (d.life <= 0) continue;
      list[write++] = d;
    }
    list.length = write;
    if (this._cursor >= list.length) this._cursor = 0;
  }

  /**
   * Draw every mark that is at least partly on screen.
   *
   * The whole batch shares one composite mode and one alpha ramp is folded into
   * the colour, so the per-decal cost is a handful of path ops and no state
   * change. That keeps a full 96-mark floor cheap enough to leave on always.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  draw(ctx, render) {
    if (this.marks.length === 0) return;
    const view = render.getViewRect();
    ctx.save();
    for (const d of this.marks) {
      if (d.x < view.x - 64 || d.x > view.x + view.w + 64) continue;
      if (d.y < view.y - 64 || d.y > view.y + view.h + 64) continue;
      drawDecal(ctx, d);
    }
    ctx.restore();
  }

  clear() {
    this.marks.length = 0;
    this._cursor = 0;
    this.evictions = 0;
  }

  /** @returns {number} */
  get count() {
    return this.marks.length;
  }
}

/**
 * One floor mark. Shapes are built from the decal's own seed so a mark never
 * shimmers between frames, and the fade is applied through globalAlpha once
 * rather than by rebuilding colours.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Decal} d
 */
function drawDecal(ctx, d) {
  const t = d.life / d.maxLife;
  // Hold most of the opacity, then fade in the last third: a pool that dims
  // from the moment it lands reads as "fading art" instead of dried blood.
  const alpha = Math.min(1, t * 2.6) * 0.5;
  ctx.globalAlpha = alpha;

  if (d.kind === 'blood') {
    drawBloodPool(ctx, d);
  } else if (d.kind === 'scorch') {
    drawScorch(ctx, d);
  } else {
    drawChip(ctx, d);
  }
  ctx.globalAlpha = 1;
}

/** @param {CanvasRenderingContext2D} ctx @param {Decal} d */
function drawBloodPool(ctx, d) {
  const s = d.size;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rotation);
  ctx.fillStyle = d.color;
  ctx.beginPath();
  // An irregular blob from three offset circles: cheap, and it reads as a
  // splash rather than as a perfect decal.
  ctx.ellipse(0, 0, s, s * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.62, s * 0.28, s * 0.42, s * 0.3, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-s * 0.55, -s * 0.34, s * 0.3, s * 0.24, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Satellite droplets, positioned by the stable seed.
  for (let i = 0; i < 3; i++) {
    const a = d.seed * 0.37 + i * 2.2;
    const r = s * (1.15 + ((d.seed * (i + 3)) % 7) * 0.07);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.7, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {Decal} d */
function drawScorch(ctx, d) {
  const s = d.size;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rotation);
  ctx.fillStyle = d.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s, s * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.globalAlpha *= 0.55;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {Decal} d */
function drawChip(ctx, d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.seed);
  ctx.fillStyle = d.color;
  ctx.fillRect(-d.size / 2, -d.size / 3, d.size, d.size * 0.66);
  ctx.restore();
}
