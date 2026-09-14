/**
 * @fileoverview World-level effect rendering: boss hazards, ultimate
 * visuals, floor markers and pickups.
 *
 * SRP: draw transient world effects that are not entities — telegraph
 * pools, fire zones, meteor markers, chain lightning, shockwaves. It owns
 * no timing logic; it renders whatever state it is given.
 */

import { drawChainLightning, drawTelegraph } from './projectileRenderer.js';
import { glow, hexAlpha, polygonPath, runeRing } from './drawUtils.js';
import { roomTypeColor } from '../data/roomTypes.js';

/**
 * Draw boss hazards: telegraphs that become damaging zones (design doc §13).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<any>} hazards
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawHazards(ctx, hazards, time, render) {
  for (const h of hazards) {
    if (!render.isVisible(h.x, h.y, h.radius + 60)) continue;

    // Progress from 0 (just telegraphed) to 1 (about to activate/expire).
    const progress = 1 - h.life / Math.max(0.001, h.maxLife);

    switch (h.kind) {
      case 'meteor':
        drawMeteorMarker(ctx, h, progress, time);
        break;
      case 'fire':
        drawFireZone(ctx, h, progress, time);
        break;
      case 'shockwave':
        drawShockwave(ctx, h, progress);
        break;
      case 'delay':
        // Purely a scheduler entry with no visual.
        break;
      default:
        drawTelegraph(ctx, h.x, h.y, h.radius, progress, h.color ?? '#ff8a5c', time);
        break;
    }
  }
}

/**
 * An incoming meteor: a filling circle plus a falling rock once it commits.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} h
 * @param {number} progress
 * @param {number} time
 */
function drawMeteorMarker(ctx, h, progress, time) {
  // Warning ring while the telegraph runs.
  drawTelegraph(ctx, h.x, h.y, h.radius, progress, '#ff6a1a', time);

  // The rock only appears in the last third, streaking down from above.
  if (progress > 0.62) {
    const t = (progress - 0.62) / 0.38;
    const fallY = h.y - (1 - t) * 520;
    glow(ctx, h.x, fallY, 46 * (0.5 + t * 0.5), '#ff6a1a', 0.75);
    ctx.save();
    ctx.fillStyle = '#3a2418';
    ctx.beginPath();
    ctx.arc(h.x, fallY, 20 + t * 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexAlpha('#ffb347', 0.6);
    ctx.beginPath();
    ctx.arc(h.x, fallY - 6, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Impact trail.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(h.x, fallY, h.x, h.y);
    g.addColorStop(0, 'rgba(255,120,20,0.5)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(h.x - 12, fallY, 24, h.y - fallY);
    ctx.restore();
  }
}

/**
 * A wall of fire: flickering tongues that become lethal once active.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} h
 * @param {number} progress
 * @param {number} time
 */
function drawFireZone(ctx, h, progress, time) {
  // Telegraph phase shows an outline only.
  if (progress < 0.28) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexAlpha('#ff4d1a', 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Active flame: several tongues rising from the base.
  const intensity = Math.min(1, (progress - 0.28) / 0.3);
  glow(ctx, h.x, h.y, h.radius * 2.2, '#ff4d1a', 0.4 * intensity);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const phase = time * 7 + i * 2.1 + h.x * 0.02;
    const height = h.radius * (1.6 + Math.sin(phase) * 0.4);
    const wobble = Math.sin(phase * 1.7) * h.radius * 0.25;
    const g = ctx.createLinearGradient(h.x, h.y, h.x, h.y - height);
    g.addColorStop(0, 'rgba(255,80,20,0.75)');
    g.addColorStop(0.55, 'rgba(255,150,40,0.45)');
    g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(h.x - h.radius * 0.6, h.y);
    ctx.quadraticCurveTo(h.x - h.radius * 0.4 + wobble, h.y - height * 0.6, h.x + wobble, h.y - height);
    ctx.quadraticCurveTo(h.x + h.radius * 0.4 + wobble, h.y - height * 0.6, h.x + h.radius * 0.6, h.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * An expanding ring used for shockwaves and meteor impacts.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} h
 * @param {number} progress
 */
function drawShockwave(ctx, h, progress) {
  const r = h.radius * (0.25 + progress * 0.75);
  const alpha = 1 - progress;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hexAlpha(h.color ?? '#c8a878', alpha * 0.85);
  ctx.lineWidth = 6 * alpha + 2;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = hexAlpha('#ffffff', alpha * 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Ultimate visuals that outlive their logic (chain lightning, slashes,
 * meteor rings).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<any>} visuals
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawUltimateVisuals(ctx, visuals, time, render) {
  for (const v of visuals) {
    const t = v.life / v.maxLife;

    if (v.kind === 'chain' && v.points) {
      drawChainLightning(ctx, v.points, t);
      // Bright nodes at each struck target.
      for (const p of v.points) {
        glow(ctx, p.x, p.y, 22 * t + 6, '#8fe3ff', t * 0.8);
      }
    } else if (v.kind === 'shockwave') {
      drawShockwave(ctx, v, 1 - t);
    } else if (v.kind === 'slash') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = v.radius * (0.6 + (1 - t) * 0.5);
      ctx.strokeStyle = hexAlpha(v.color, t * 0.9);
      ctx.lineWidth = 14 * t + 2;
      ctx.beginPath();
      ctx.arc(v.x, v.y, r, -0.9, 0.9);
      ctx.stroke();
      ctx.restore();
    }
    void time;
    void render;
  }
}

/**
 * Draw the environmental marker for a room's interaction point: the healing
 * altar, the shop keeper's stall, and the exit portals.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Room.js').Room} room
 * @param {any} runtime
 * @param {number} time
 */
export function drawRoomInteractables(ctx, room, runtime, time) {
  const c = room.center;

  if (room.type === 'healing') {
    drawHealingAltar(ctx, c.x, c.y, time);
  }

  if (room.type === 'shop') {
    drawShopStall(ctx, c.x, c.y, time);
  }
}

/**
 * The healing altar (design doc §16).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} time
 */
function drawHealingAltar(ctx, x, y, time) {
  const pulse = 0.6 + Math.sin(time * 2.4) * 0.25;

  glow(ctx, x, y - 18, 90, '#4dffa8', 0.22 * pulse);
  runeRing(ctx, x, y + 26, 58, hexAlpha('#6ffbb0', 0.6), time * 0.6);

  // Pedestal.
  ctx.fillStyle = '#2a3a34';
  ctx.beginPath();
  ctx.moveTo(x - 30, y + 34);
  ctx.lineTo(x + 30, y + 34);
  ctx.lineTo(x + 20, y + 6);
  ctx.lineTo(x - 20, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3d5248';
  ctx.fillRect(x - 34, y + 32, 68, 8);

  // Floating crystal.
  const bob = Math.sin(time * 1.8) * 5;
  const cy = y - 18 + bob;
  glow(ctx, x, cy, 44 * pulse, '#6ffbb0', 0.7);
  ctx.fillStyle = '#b9ffe0';
  polygonPath(ctx, x, cy, 17, 6, time * 0.5);
  ctx.fill();
  ctx.strokeStyle = hexAlpha('#ffffff', 0.8);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Rising motes.
  for (let i = 0; i < 4; i++) {
    const t = (time * 0.5 + i / 4) % 1;
    glow(ctx, x + Math.sin(time + i) * 14, y + 20 - t * 70, 6, '#6ffbb0', (1 - t) * 0.7);
  }
}

/**
 * The shop stall (design doc §17).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} time
 */
function drawShopStall(ctx, x, y, time) {
  glow(ctx, x, y - 10, 90, '#ffb347', 0.18 + Math.sin(time * 2) * 0.05);

  // Counter.
  ctx.fillStyle = '#3a2c18';
  ctx.fillRect(x - 52, y + 12, 104, 14);
  ctx.fillStyle = '#4d3a20';
  ctx.fillRect(x - 46, y + 4, 92, 10);

  // Wares: a few glowing trinkets on the counter.
  const colors = ['#e8b955', '#7fd8ff', '#ff6b8a'];
  for (let i = 0; i < 3; i++) {
    const px = x - 30 + i * 30;
    const float = Math.sin(time * 2 + i) * 3;
    glow(ctx, px, y - 6 + float, 16, colors[i] ?? '#e8b955', 0.55);
    ctx.fillStyle = colors[i] ?? '#e8b955';
    polygonPath(ctx, px, y - 6 + float, 6, 4, time * (0.6 + i * 0.2));
    ctx.fill();
  }

  // Hooded merchant silhouette behind the counter.
  ctx.fillStyle = '#4a3a2a';
  ctx.beginPath();
  ctx.moveTo(x - 22, y + 4);
  ctx.lineTo(x - 14, y - 28);
  ctx.lineTo(x, y - 42);
  ctx.lineTo(x + 14, y - 28);
  ctx.lineTo(x + 22, y + 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#1c140c';
  ctx.beginPath();
  ctx.arc(x, y - 26, 8, 0, Math.PI * 2);
  ctx.fill();

  if (Math.sin(time * 3) > -0.6) {
    ctx.fillStyle = '#ffcf6b';
    ctx.beginPath();
    ctx.arc(x - 3, y - 27, 1.6, 0, Math.PI * 2);
    ctx.arc(x + 3, y - 27, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw the room's ambient lighting pass: torch flicker, floating dust motes in
 * the light shafts, and any warm/cool wash that should sit *above* the baked
 * structure but *below* the actors.
 *
 * Kept as a distinct pass so the atmosphere can be tuned (or budgeted) in one
 * place. The default implementation reads the room's own props for torch
 * positions, and degrades to drawing nothing when the room has none, which is
 * what lets the headless recording tools and rooms without torches skip the
 * cost entirely.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Room.js').Room} room
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawAtmosphere(ctx, room, time, render) {
  const bounds = room.bounds;
  const points = [
    { x: bounds.x + 42, y: bounds.y + 42, phase: 0.2 },
    { x: bounds.x + bounds.w - 42, y: bounds.y + 42, phase: 1.8 },
    { x: bounds.x + 42, y: bounds.y + bounds.h - 42, phase: 3.1 },
    { x: bounds.x + bounds.w - 42, y: bounds.y + bounds.h - 42, phase: 4.7 },
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of points) {
    if (!render.isVisible(p.x, p.y, 150)) continue;
    // Each torch owns its alpha. Mote particles below use a per-particle fade;
    // carrying that value into the next torch made every later corner dimmer
    // than the first one.
    ctx.globalAlpha = 1;
    const flicker = 0.78 + Math.sin(time * 8 + p.phase) * 0.12 + Math.sin(time * 17 + p.phase * 2) * 0.06;
    glow(ctx, p.x, p.y - 8, 92 + flicker * 18, '#ff9b45', 0.12 * flicker);
    ctx.fillStyle = hexAlpha('#ffd27a', 0.72 * flicker);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 26 - flicker * 5);
    ctx.quadraticCurveTo(p.x - 8, p.y - 12, p.x, p.y - 4);
    ctx.quadraticCurveTo(p.x + 8, p.y - 12, p.x, p.y - 26 - flicker * 5);
    ctx.fill();
    ctx.fillStyle = '#5a3824';
    ctx.fillRect(p.x - 3, p.y - 5, 6, 12);
    for (let i = 0; i < 3; i++) {
      const rise = (time * (10 + i) + p.phase * 20 + i * 0.37) % 28;
      ctx.globalAlpha = (1 - rise / 28) * 0.22;
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(time * 2 + i + p.phase) * 7, p.y - 34 - rise, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // The mote loop uses per-particle alpha. Reset it before the next light or
  // the final mote's fade leaks into subsequent scene layers.
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Draw the currently-open doors as glowing exits the player can walk into.
 *
 * Each marker is drawn in the colour of the room the door leads to — the
 * same colour as the door plate and the HUD node — so the chevron reads as
 * "walk here to reach a *shop*" rather than as a generic arrow.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Room.js').Room} room
 * @param {boolean} active
 * @param {number} time
 */
export function drawExitMarkers(ctx, room, active, time) {
  if (!active) return;
  for (const door of room.doors) {
    if (!door.open) continue;
    // A door with no destination is scenery, not an exit.
    if (door.targetRoomId === undefined || door.targetRoomId === null) continue;
    const color = roomTypeColor(door.targetType, { elite: door.elite === true });
    const cx = door.rect.x + door.rect.w / 2;
    const cy = door.rect.y + door.rect.h / 2;
    const pulse = 0.5 + Math.sin(time * 4) * 0.25;
    glow(ctx, cx, cy, 70, color, pulse * 0.5);
    // Chevron pointing into the doorway.
    ctx.save();
    ctx.translate(cx, cy - 34 - Math.sin(time * 3) * 4);
    ctx.fillStyle = hexAlpha(color, 0.9);
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.lineTo(11, 0);
    ctx.lineTo(0, 13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
