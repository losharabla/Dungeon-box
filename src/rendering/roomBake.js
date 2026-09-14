/**
 * @fileoverview Bakes each room's static layers into offscreen canvases.
 *
 * SRP: cache what never changes during a room visit. Walls, floor tiling,
 * the light pool and props are functions of the room alone, yet the
 * per-frame path re-issued ~230 fillRects and ~125 strokes for them every
 * 16 ms - the painted-area probe in frame-cost showed that a single frame
 * was covering the viewport several times over with content that never
 * moves. Baking collapses all of it into a handful of drawImage blits; what
 * stays live is only the genuinely moving furniture: bedrock base (tracks
 * the camera), doors, hazards, sigils, and the actors.
 *
 * `canBake` is the capability probe that keeps headless tools honest: the
 * software rasteriser and the recording contexts in tools/ do not advertise
 * drawImage (and tools without a document stub have no canvas factory at
 * all), so they keep exercising the per-frame path byte for byte as before,
 * while a real browser takes the baked path. frame-cost.mjs stubs both
 * sides precisely so the baked path - the one that actually ships - is the
 * one its budgets measure.
 */

/** Device-pixel budget per baked layer (~8M px ≈ 32MB RGBA). */
const BAKE_MAX_PIXELS = 8e6;
/** Browser hard limit for a single canvas dimension. */
const BAKE_MAX_SIDE = 8192;

/**
 * Pad around the room that guarantees the baked bedrock edge-glow survives
 * the blit: the glow reaches 150 px past the half-diagonal extent, and on
 * the room's short side it overflows by that much plus the aspect margin.
 * @param {{w: number, h: number}} b
 */
function groundPad(b) {
  return (Math.max(b.w, b.h) - Math.min(b.w, b.h)) / 2 + 160;
}

/**
 * Pad for the wall layer. `Room._buildWalls` grows the four wall blocks
 * *outward* from the interior so the playable area is exactly `bounds`, which
 * puts every wall rectangle outside it: `b.x - t` .. `b.x + b.w + t`. A bake
 * canvas limited to the interior therefore clips the whole masonry away and
 * the room renders as a bare, borderless rectangle. `wallThickness` is what
 * the geometry needs; the extra 2 covers the outer contour stroke.
 * @param {import('../entities/Room.js').Room} room
 */
function wallPad(room) {
  return room.wallThickness + 2;
}

export class RoomBaker {
  constructor() {
    /** @type {boolean|null} */
    this._capable = null;
    /** @type {null | {key: string, ground: any, walls: any, darkening: any}} */
    this.current = null;
  }

  /**
   * Whether offscreen baking is available in this environment.
   * @param {CanvasRenderingContext2D} ctx
   * @returns {boolean}
   */
  canBake(ctx) {
    if (this._capable === null) {
      this._capable = (() => {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
        if (typeof ctx.drawImage !== 'function') return false;
        try {
          const probe = document.createElement('canvas');
          probe.width = 2;
          probe.height = 2;
          return typeof probe.getContext === 'function' && !!probe.getContext('2d');
        } catch {
          return false;
        }
      })();
    }
    return this._capable;
  }

  /**
   * Device pixels per world unit for this frame; the bake is built at this
   * scale so the blit is 1:1 on screen and bricks stay crisp.
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  static deviceScale(render) {
    return render.scale * render._dpr;
  }

  /**
   * The bake for this room at this device scale, rebuilt only when the room
   * (or a room-local layer like fresh decals) changed. `null` when baking is
   * unavailable, which leaves the caller on the per-frame path.
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   * @param {import('./roomRenderer.js').RoomRenderer} rr
   * @returns {null | {ground: any, walls: any, darkening: any}}
   */
  ensure(room, render, rr) {
    if (!this.canBake(render.ctx)) return null;
    const scale = RoomBaker.deviceScale(render);
    // Identity of the Room *object* is the key, not its id: node ids restart
    // from zero on every floor, so two different rooms can share one id, and
    // a key built from the id alone would blit stale geometry. Props length
    // covers mid-room additions (fresh decals) - they repaint the ground
    // layer once, not every frame.
    const cur = this.current;
    if (cur && cur.room === room && cur.props === room.props.length && cur.scale === scale) {
      return cur;
    }

    const b = room.bounds;
    const pad = groundPad(b);
    const gRect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    const rRect = { x: b.x, y: b.y, w: b.w, h: b.h };
    // The wall layer must cover the outward-growing wall blocks, not just the
    // interior, or the blit crops away the whole masonry - see wallPad.
    const wpad = wallPad(room);
    const wRect = { x: b.x - wpad, y: b.y - wpad, w: b.w + wpad * 2, h: b.h + wpad * 2 };

    // Shrink the bake resolution until each layer fits the pixel and side
    // budgets. Slightly softer bricks on very large rooms at 4K is the
    // accepted trade; frame time is not negotiable.
    let k = Math.min(scale, 2);
    const area = Math.max(gRect.w * gRect.h, wRect.w * wRect.h);
    const longest = Math.max(gRect.w, gRect.h);
    while (k > 0.75 && (area * k * k > BAKE_MAX_PIXELS || longest * k > BAKE_MAX_SIDE)) {
      k -= 0.25;
    }

    const ground = this._canvas(gRect, k, (ctx) => rr.bakeGround(ctx, room, gRect));
    const walls = this._canvas(wRect, k, (ctx) => rr.bakeWalls(ctx, room));
    const darkening = this._canvas(rRect, k, (ctx) => rr.bakeDarkening(ctx, room));

    this.current = { room, props: room.props.length, scale, ground, walls, darkening };
    return this.current;
  }

  /**
   * Allocate one bake surface and paint it with `paint` in world coordinates.
   * @param {{x:number,y:number,w:number,h:number}} rect
   * @param {number} k
   * @param {(ctx: CanvasRenderingContext2D) => void} paint
   */
  _canvas(rect, k, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(rect.w * k));
    canvas.height = Math.max(1, Math.ceil(rect.h * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('bake canvas unavailable');
    ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
    paint(ctx);
    return { canvas, k, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }

  /** Forget any cached bake (future explicit invalidation point). */
  invalidate() {
    this.current = null;
  }
}

/**
 * Blit the visible part of one baked layer. The caller's ctx is in world
 * space (camera applied); the layer stores its world rect, so the crop is a
 * rect intersection and the 9-argument form maps canvas device pixels back
 * to world units 1:1. Blitting the *whole* quad every frame would pay for
 * the full room every frame - the crop is what keeps the baked path's
 * painted area near one viewport instead of several.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{canvas: any, k: number, x: number, y: number, w: number, h: number}} layer
 * @param {{x: number, y: number, w: number, h: number}} view
 */
export function blit(ctx, layer, view) {
  const x0 = Math.max(layer.x, view.x);
  const y0 = Math.max(layer.y, view.y);
  const x1 = Math.min(layer.x + layer.w, view.x + view.w);
  const y1 = Math.min(layer.y + layer.h, view.y + view.h);
  if (x1 <= x0 || y1 <= y0) return;
  const k = layer.k;
  ctx.drawImage(
    layer.canvas,
    (x0 - layer.x) * k, (y0 - layer.y) * k, (x1 - x0) * k, (y1 - y0) * k,
    x0, y0, x1 - x0, y1 - y0,
  );
}
