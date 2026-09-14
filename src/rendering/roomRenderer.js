/**
 * @fileoverview Room rendering: floor, walls, doors, props.
 *
 * SRP: draw the arena. It reads a Room and nothing else — no entities, no
 * gameplay state.
 */

import {
  brickPattern, glow, hexAlpha, runeRing, tint, valueNoise,
} from './drawUtils.js';
import { roomTypeColor, roomTypeLabel } from '../data/roomTypes.js';

/**
 * Mottling colour for one bedrock cell, memoised per grid cell.
 *
 * The cell's tone is a pure function of its grid index and the cell never
 * moves in world space, so the value-noise lookup and the `rgba()` string it
 * produces are both computed once per cell instead of once per cell per frame
 * (a full viewport of them every frame, for something invisible in motion).
 * `null` means "too dark to draw": the original skipped the fill below the
 * same threshold.
 *
 * The key packs the two indices into one number — camera space keeps them
 * well inside the range where that stays exact — so a cache hit allocates
 * nothing, which is the entire point of the exercise.
 * @type {Map<number, string|null>}
 */
const bedrockMottleCache = new Map();
const BEDROCK_MOTTLE_MAX = 4096;
const BEDROCK_CELL = 96;
const BEDROCK_KEY_SPAN = 1e5;

/** @param {number} i @param {number} j @returns {string|null} */
function bedrockMottle(i, j) {
  const key = i * BEDROCK_KEY_SPAN + j;
  const hit = bedrockMottleCache.get(key);
  if (hit !== undefined) return hit;

  if (bedrockMottleCache.size >= BEDROCK_MOTTLE_MAX) bedrockMottleCache.clear();
  const n = valueNoise(i * BEDROCK_CELL * 0.017, j * BEDROCK_CELL * 0.017);
  const style = n > 0.72 ? `rgba(30,26,40,${(n - 0.72) * 0.55})` : null;
  bedrockMottleCache.set(key, style);
  return style;
}

export class RoomRenderer {
  /**
   * Draw the room in its own internal order.
   *
   * `SceneRenderer` normally calls the individual layers so it can interleave
   * world effects (hazards, telegraphs, interactables) between them; this
   * convenience entry point exists for previews and tests, and is kept in
   * step with that ordering.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   * @param {number} time seconds, drives ambient animation
   */
  draw(ctx, room, render, time) {
    this.drawBedrock(ctx, room, render, time);
    this.drawFloor(ctx, room, render, time);
    this.drawProps(ctx, room);
    this.drawWalls(ctx, room, render);
    this.drawDoors(ctx, room, time);
    this.drawVignette(ctx, room, render);
  }

  /* ============================================================
     Baking (see roomBake.js)

     The interior layers below are pure functions of the room, so they are
     painted once into offscreen canvases and blitted every frame. The live
     per-frame path is kept as the fallback for environments without
     compositing (`canBake` in roomBake.js), which keeps the headless tools
     byte-identical to the pre-bake behaviour.

     Baking preserves the original draw order exactly:
       ground (bedrock glow, floor, props) -> hazards/interactables ->
       walls -> doors -> sigil -> vignette darkening -> actors.
     ============================================================ */

  /**
   * Bedrock minus its edge glow: the base fill and the large-scale mottling.
   * The glow is world-anchored and identical every frame, so the baked path
   * folds it into the ground layer and this method skips it; the live path
   * keeps drawing both together via `drawBedrock`.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  drawBedrockBase(ctx, room, render) {
    const view = render.getViewRect();
    ctx.save();
    ctx.fillStyle = '#08070d';
    ctx.fillRect(view.x, view.y, view.w, view.h);
    this.drawMottle(ctx, view);
    ctx.restore();
  }

  /** @param {CanvasRenderingContext2D} ctx @param {{x:number,y:number,w:number,h:number}} view */
  drawMottle(ctx, view) {
    const cell = 96;
    const startX = Math.floor(view.x / cell) * cell;
    const startY = Math.floor(view.y / cell) * cell;
    for (let y = startY; y < view.y + view.h; y += cell) {
      for (let x = startX; x < view.x + view.w; x += cell) {
        const style = bedrockMottle(x / cell, y / cell);
        if (style === null) continue;
        ctx.fillStyle = style;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }

  /**
   * Paint the baked ground layer over `rect` (the full bake canvas, room plus
   * pad): bedrock edge glow, then the floor and its props on top, exactly as
   * the per-frame order does it.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {{x: number, y: number, w: number, h: number}} rect
   */
  bakeGround(ctx, room, rect) {
    const b = room.bounds;
    // The soft glow hugging the room's outer edge, painted onto the pad so
    // the ring survives blitting over the live bedrock base.
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const inner = Math.max(b.w, b.h) * 0.5;
    const g = ctx.createRadialGradient(cx, cy, inner * 0.85, cx, cy, inner + 150);
    g.addColorStop(0, 'rgba(48,40,58,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    const whole = { getViewRect: () => ({ x: b.x, y: b.y, w: b.w, h: b.h }) };
    this.drawFloor(ctx, room, whole, 0);
    this.drawProps(ctx, room);
  }

  /**
   * Paint every wall (bricks, highlight, contour) - no view culling, the
   * bake canvas *is* the room rect.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   */
  bakeWalls(ctx, room) {
    const b = room.bounds;
    const whole = { getViewRect: () => ({ x: b.x, y: b.y, w: b.w, h: b.h }), isRectVisible: () => true };
    this.drawWalls(ctx, room, whole);
  }

  /**
   * The darkened room border, painted over the whole room rect for the
   * baked path (the live path clamps to the view; the blit re-clips for us).
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   */
  bakeDarkening(ctx, room) {
    const b = room.bounds;
    const c = room.center;
    const grad = ctx.createRadialGradient(
      c.x, c.y, Math.min(b.w, b.h) * 0.22,
      c.x, c.y, Math.max(b.w, b.h) * 0.62,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  /**
   * Room-type floor sigils: animated, so they are never baked.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   */
  drawRoomSigil(ctx, room) {
    const c = room.center;
    if (room.type === 'healing') {
      runeRing(ctx, c.x, c.y, 86, '#6ffbb0', performance.now() / 1400, 0.5);
      runeRing(ctx, c.x, c.y, 58, '#b9ffe0', -performance.now() / 900, 0.4);
      glow(ctx, c.x, c.y, 150, '#4dffa8', 0.16);
    } else if (room.type === 'shop') {
      runeRing(ctx, c.x, c.y, 74, '#ffcf6b', performance.now() / 2200, 0.4);
      glow(ctx, c.x, c.y, 160, '#ffb347', 0.12);
    } else if (room.type === 'boss') {
      runeRing(ctx, c.x, c.y, 210, '#ff5a3c', performance.now() / 3000, 0.28);
      runeRing(ctx, c.x, c.y, 150, '#ff8a5c', -performance.now() / 2400, 0.2);
    }
  }

  /**
   * Solid rock filling everything outside the room, covering the whole
   * visible viewport.
   *
   * Kept deliberately dark and low-contrast: it exists only so the overscan
   * beyond the walls is not empty void, and a busy texture here would
   * compete with the arena for attention.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   * @param {number} time
   */
  drawBedrock(ctx, room, render, time) {
    const view = render.getViewRect();

    // Flat near-black base.
    ctx.save();
    ctx.fillStyle = '#08070d';
    ctx.fillRect(view.x, view.y, view.w, view.h);

    // Very subtle large-scale mottling, at a low alpha so it reads as
    // texture in deep shadow rather than as a pattern.
    const cell = 96;
    const startX = Math.floor(view.x / cell) * cell;
    const startY = Math.floor(view.y / cell) * cell;

    for (let y = startY; y < view.y + view.h; y += cell) {
      for (let x = startX; x < view.x + view.w; x += cell) {
        const style = bedrockMottle(x / cell, y / cell);
        if (style === null) continue;
        ctx.fillStyle = style;
        ctx.fillRect(x, y, cell, cell);
      }
    }

    // A soft glow hugging the room's outer edge so the carved space reads as
    // lit from within, fading quickly into the dark.
    const b = room.bounds;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const inner = Math.max(b.w, b.h) * 0.5;
    const g = ctx.createRadialGradient(cx, cy, inner * 0.85, cx, cy, inner + 150);
    g.addColorStop(0, 'rgba(48,40,58,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(view.x, view.y, view.w, view.h);

    void time;
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   * @param {number} time
   */
  drawFloor(ctx, room, render, time) {
    const b = room.bounds;
    // Only the visible slice is drawn, so large rooms stay cheap.
    const view = render.getViewRect();
    const x0 = Math.max(b.x, view.x);
    const y0 = Math.max(b.y, view.y);
    const x1 = Math.min(b.x + b.w, view.x + view.w);
    const y1 = Math.min(b.y + b.h, view.y + view.h);
    if (x1 <= x0 || y1 <= y0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();

    // Base stone with a warm centre falloff per room type.
    const palette = FLOOR_PALETTES[room.type] ?? FLOOR_PALETTES.arena;
    ctx.fillStyle = palette.base;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    // Tile grid.
    const tile = 64;
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let x = Math.floor(x0 / tile) * tile; x <= x1; x += tile) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.floor(y0 / tile) * tile; y <= y1; y += tile) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ambient light pool in the middle of the room.
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) * 0.62);
    g.addColorStop(0, palette.light);
    g.addColorStop(0.55, hexAlpha(palette.lightTint, 0.35));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   */
  drawProps(ctx, room) {
    for (const prop of room.props) {
      if (prop.kind === 'crack') {
        ctx.save();
        ctx.translate(prop.x, prop.y);
        ctx.rotate(prop.rotation);
        ctx.strokeStyle = `rgba(0,0,0,${prop.alpha * 1.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-prop.radius, 0);
        ctx.lineTo(-prop.radius * 0.25, prop.radius * 0.2);
        ctx.lineTo(prop.radius * 0.35, -prop.radius * 0.15);
        ctx.lineTo(prop.radius, prop.radius * 0.1);
        ctx.stroke();
        ctx.restore();
      } else if (prop.kind === 'rubble') {
        ctx.save();
        ctx.translate(prop.x, prop.y);
        ctx.rotate(prop.rotation);
        ctx.fillStyle = `rgba(255,255,255,${prop.alpha * 0.22})`;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const rr = prop.radius * 0.28;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, prop.radius * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        // Blood/dust stain.
        const g = ctx.createRadialGradient(prop.x, prop.y, 0, prop.x, prop.y, prop.radius);
        g.addColorStop(0, `rgba(20,4,6,${prop.alpha})`);
        g.addColorStop(1, 'rgba(20,4,6,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  drawWalls(ctx, room, render) {
    for (const wall of room.walls) {
      if (!render.isRectVisible(wall)) continue;

      // Brick dimensions are left to brickPattern so it can size them to the
      // wall's thin axis. Passing a fixed size here would overflow a vertical
      // wall (18px thick) with 20px-tall courses and shred the masonry.
      brickPattern(ctx, wall.x, wall.y, wall.w, wall.h, '#3a3648', '#171622');

      ctx.save();
      ctx.beginPath();
      ctx.rect(wall.x, wall.y, wall.w, wall.h);
      ctx.clip();

      // Inner-edge highlight sells the depth of the wall block.
      const isHorizontal = wall.w >= wall.h;
      if (isHorizontal) {
        const g = ctx.createLinearGradient(0, wall.y, 0, wall.y + wall.h);
        g.addColorStop(0, 'rgba(255,220,180,0.18)');
        g.addColorStop(0.35, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = g;
      } else {
        const g = ctx.createLinearGradient(wall.x, 0, wall.x + wall.w, 0);
        g.addColorStop(0, 'rgba(255,220,180,0.14)');
        g.addColorStop(0.35, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = g;
      }
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.restore();

      // Crisp outer contour.
      ctx.strokeStyle = 'rgba(12,10,18,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(wall.x + 1, wall.y + 1, wall.w - 2, wall.h - 2);
    }
  }

  /**
   * Doors: a glowing portal when open, a barred slab when sealed.
   *
   * An open door is painted in the colour of the room *beyond* it and
   * carries that room's name on a small plate, so which exit leads where is
   * readable without hunting for a legend. A sealed door keeps its red
   * warning look: while a fight runs, what is behind it does not matter.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {number} time
   */
  drawDoors(ctx, room, time) {
    const c = room.center;
    for (const door of room.doors) {
      const r = door.rect;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;

      if (door.open) {
        const color = roomTypeColor(door.targetType, { elite: door.elite === true });
        const pulse = 0.55 + Math.sin(time * 3) * 0.18;
        glow(ctx, cx, cy, Math.max(r.w, r.h) * 1.35, color, pulse * 0.5);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = tint(color, 0.26);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
        ctx.strokeStyle = hexAlpha(color, 0.85);
        ctx.lineWidth = door.elite === true ? 3 : 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

        // The plate sits just outside the doorway, along the door's outward
        // normal, so it never covers the opening the player has to walk into.
        const nx = cx - c.x;
        const ny = cy - c.y;
        const len = Math.hypot(nx, ny) || 1;
        this._drawDoorPlate(
          ctx,
          cx + (nx / len) * 34,
          cy + (ny / len) * 26,
          roomTypeLabel(door.targetType, { elite: door.elite === true }),
          color,
        );
      } else {
        // Sealed: heavy iron bars with a red warning glow.
        ctx.save();
        ctx.fillStyle = '#241a1c';
        ctx.fillRect(r.x, r.y, r.w, r.h);

        const horizontal = r.w >= r.h;
        ctx.strokeStyle = '#5d4a4e';
        ctx.lineWidth = 4;
        const bars = 4;
        for (let i = 1; i <= bars; i++) {
          const t = i / (bars + 1);
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(r.x + r.w * t, r.y + 2);
            ctx.lineTo(r.x + r.w * t, r.y + r.h - 2);
          } else {
            ctx.moveTo(r.x + 2, r.y + r.h * t);
            ctx.lineTo(r.x + r.w - 2, r.y + r.h * t);
          }
          ctx.stroke();
        }
        ctx.restore();
        glow(ctx, cx, cy, Math.max(r.w, r.h) * 1.1, '#ff4d4d', 0.28 + Math.sin(time * 6) * 0.08);
      }
    }
  }

  /**
   * A small dark plate naming a door's destination, tinted with the type
   * colour that marks it in the world. Text width is measured when the
   * context supports it and estimated otherwise, so the plate still fits on
   * a minimal recording context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {string} label
   * @param {string} color
   */
  _drawDoorPlate(ctx, x, y, label, color) {
    ctx.save();
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let width = label.length * 8;
    if (typeof ctx.measureText === 'function') {
      const measured = ctx.measureText(label)?.width;
      if (Number.isFinite(measured) && measured > 0) width = measured;
    }

    const plateW = width + 16;
    const plateH = 19;
    ctx.globalAlpha = 0.74;
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(x - plateW / 2, y - plateH / 2, plateW, plateH);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - plateW / 2 + 0.5, y - plateH / 2 + 0.5, plateW - 1, plateH - 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  /**
   * Room-type specific floor sigil plus a soft edge darkening.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../entities/Room.js').Room} room
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  drawVignette(ctx, room, render) {
    const b = room.bounds;
    const c = room.center;

    if (room.type === 'healing') {
      runeRing(ctx, c.x, c.y, 86, '#6ffbb0', performance.now() / 1400, 0.5);
      runeRing(ctx, c.x, c.y, 58, '#b9ffe0', -performance.now() / 900, 0.4);
      glow(ctx, c.x, c.y, 150, '#4dffa8', 0.16);
    } else if (room.type === 'shop') {
      runeRing(ctx, c.x, c.y, 74, '#ffcf6b', performance.now() / 2200, 0.4);
      glow(ctx, c.x, c.y, 160, '#ffb347', 0.12);
    } else if (room.type === 'boss') {
      runeRing(ctx, c.x, c.y, 210, '#ff5a3c', performance.now() / 3000, 0.28);
      runeRing(ctx, c.x, c.y, 150, '#ff8a5c', -performance.now() / 2400, 0.2);
    }

    // Darkened border so the play area reads as enclosed (design doc §3).
    const view = render.getViewRect();
    const x0 = Math.max(b.x, view.x);
    const y0 = Math.max(b.y, view.y);
    const x1 = Math.min(b.x + b.w, view.x + view.w);
    const y1 = Math.min(b.y + b.h, view.y + view.h);
    if (x1 <= x0 || y1 <= y0) return;

    const grad = ctx.createRadialGradient(
      c.x, c.y, Math.min(b.w, b.h) * 0.22,
      c.x, c.y, Math.max(b.w, b.h) * 0.62,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

/** Per-room-type colour palettes. */
const FLOOR_PALETTES = {
  arena: {
    base: '#171522',
    grid: '#241f30',
    light: 'rgba(90,70,60,0.20)',
    lightTint: '#5a463c',
  },
  start: {
    base: '#191724',
    grid: '#262133',
    light: 'rgba(70,90,110,0.22)',
    lightTint: '#465a6e',
  },
  healing: {
    base: '#131c1a',
    grid: '#1d2b27',
    light: 'rgba(40,120,90,0.24)',
    lightTint: '#28785a',
  },
  shop: {
    base: '#1d1a14',
    grid: '#2b2618',
    light: 'rgba(140,110,40,0.24)',
    lightTint: '#8c6e28',
  },
  boss: {
    base: '#1e1214',
    grid: '#2d191c',
    light: 'rgba(150,40,30,0.26)',
    lightTint: '#96281e',
  },
};
