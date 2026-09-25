/**
 * @fileoverview Projectile rendering.
 *
 * SRP: draw flying things. Each visual archetype from the weapon data gets
 * its own silhouette so a player can tell a fireball from an ice shard at a
 * glance (design doc §9, §25).
 */

import { glow, hexAlpha, jaggedLine, tint } from './drawUtils.js';
import { CONFIG } from '../core/Config.js';

/**
 * Draw one projectile.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} p projectile from ProjectileSystem
 * @param {number} time
 */
export function drawProjectile(ctx, p, time) {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const angle = Math.atan2(p.vy, p.vx);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);

  switch (p.visual) {
    case 'fire': drawFire(ctx, p, time); break;
    case 'ice': drawIce(ctx, p, time); break;
    case 'lightning': drawLightningBolt(ctx, p, time); break;
    case 'void': drawVoid(ctx, p, time); break;
    case 'hellfire': drawHellfire(ctx, p, time); break;
    case 'sniper': drawSniper(ctx, p, time); break;
    case 'pellet': drawPellet(ctx, p); break;
    case 'bullet': drawBullet(ctx, p); break;
    case 'enemy_orbs': drawEnemyOrb(ctx, p, time); break;
    case 'rock': drawRock(ctx, p, speed); break;
    case 'molotov': drawMolotov(ctx, p, time); break;
    default: drawBullet(ctx, p); break;
  }

  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx */
function drawBullet(ctx, p) {
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(-5, -1.4, 10, 2.8);
  ctx.fillStyle = hexAlpha('#ffb347', 0.45);
  ctx.fillRect(-13, -1, 8, 2);
}

/** @param {CanvasRenderingContext2D} ctx */
function drawPellet(ctx, p) {
  ctx.fillStyle = '#e8d9a8';
  ctx.beginPath();
  ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx */
function drawSniper(ctx, p) {
  ctx.fillStyle = '#dff2ff';
  ctx.fillRect(-22, -1.6, 44, 3.2);
  glow(ctx, 0, 0, 16, '#7fd8ff', 0.5);
}

/** Minimal flame tick, the fire head's mark in flight. */
function drawFire(ctx, p, time) {
  void time;
  const r = p.radius;
  glow(ctx, 0, 0, r * 3.2, '#ff6a1a', 0.65);
  ctx.fillStyle = '#ffd47a';
  ctx.beginPath();
  ctx.moveTo(-r * 1.2, -r * 0.6);
  ctx.lineTo(r * 1.4, 0);
  ctx.lineTo(-r * 1.2, r * 0.6);
  ctx.closePath();
  ctx.fill();
}

/** Minimal diamond, the ice head's mark in flight. */
function drawIce(ctx, p, time) {
  void time;
  const r = p.radius * 1.1;
  glow(ctx, 0, 0, p.radius * 2.8, '#7fd8ff', 0.55);
  ctx.fillStyle = '#dff6ff';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(-r, 0);
  ctx.lineTo(0, r * 0.7);
  ctx.closePath();
  ctx.fill();
}

/** Minimal bolt, the lightning head's mark in flight. One fixed polygon, so
 *  the shot no longer reseeds Math.random every frame to draw itself. */
function drawLightningBolt(ctx, p, time) {
  void time;
  const r = p.radius;
  glow(ctx, 0, 0, r * 3.4, '#ffe14d', 0.65);
  ctx.fillStyle = '#fff9c4';
  ctx.beginPath();
  ctx.moveTo(r * 1.6, -r * 0.5);
  ctx.lineTo(-r * 0.2, -r * 0.5);
  ctx.lineTo(r * 0.2, 0);
  ctx.lineTo(-r * 1.6, r * 0.5);
  ctx.lineTo(r * 0.2, r * 0.5);
  ctx.lineTo(-r * 0.2, 0);
  ctx.closePath();
  ctx.fill();
}

/** Minimal hole: dark core in a thin ring, the void head's mark in flight. */
function drawVoid(ctx, p, time) {
  void time;
  const r = p.radius;
  glow(ctx, 0, 0, r * 3.2, '#a03cff', 0.7);
  ctx.fillStyle = 'rgba(8,2,16,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexAlpha('#c05cff', 0.9);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  ctx.stroke();
}

/** @param {CanvasRenderingContext2D} ctx */
function drawHellfire(ctx, p, time) {
  glow(ctx, 0, 0, p.radius * 3.2, '#ff8a1a', 0.7);
  ctx.fillStyle = '#fff0b0';
  ctx.beginPath();
  ctx.arc(0, 0, p.radius * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexAlpha('#ff3d00', 0.55);
  ctx.fillRect(-p.radius * 3.4, -p.radius * 0.35, p.radius * 3, p.radius * 0.7);
  void time;
}

/** @param {CanvasRenderingContext2D} ctx */
function drawEnemyOrb(ctx, p, time) {
  const pulse = 0.65 + Math.sin(time * 9 + p.seed) * 0.2;
  const color = p.color ?? '#c05cff';
  glow(ctx, 0, 0, p.radius * 3.2, color, pulse);
  ctx.fillStyle = tint(color.startsWith('#') ? color : '#c05cff', 1.5);
  ctx.beginPath();
  ctx.arc(0, 0, p.radius * 0.75, 0, Math.PI * 2);
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx */
function drawRock(ctx, p, speed) {
  void speed;
  ctx.fillStyle = '#6b6357';
  const r = p.radius;
  ctx.beginPath();
  ctx.moveTo(r * 1.2, 0);
  ctx.lineTo(r * 0.3, -r * 0.9);
  ctx.lineTo(-r * 0.9, -r * 0.5);
  ctx.lineTo(-r * 1.1, r * 0.6);
  ctx.lineTo(r * 0.2, r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,26,22,0.9)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/** A tumbling molotov cocktail flask trailing flame. */
function drawMolotov(ctx, p, time) {
  const r = p.radius || 7;
  glow(ctx, 0, 0, r * 2.8, '#ff5a1a', 0.65);

  const rot = time * 14 + (p.seed ?? 0);
  ctx.save();
  ctx.rotate(rot);

  // Glass flask body
  ctx.fillStyle = 'rgba(235, 110, 20, 0.9)';
  ctx.beginPath();
  ctx.arc(0, 2, r * 0.75, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 230, 180, 0.75)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Flask neck & cork
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(-2, -r - 1, 4, r * 0.6);

  // Burning rag / fuse flame
  const flicker = Math.sin(time * 24 + (p.seed ?? 0)) * 1.5;
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(-2.5, -r - 1);
  ctx.lineTo(flicker, -r - 6.5);
  ctx.lineTo(2.5, -r - 1);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Chain lightning between several targets (design doc §7, ultimates).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} points
 * @param {number} t 0..1 progress, drives the fade
 */
export function drawChainLightning(ctx, points, t) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.max(0, t);

  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? 'rgba(120,200,255,0.55)' : '#fffbe0';
    ctx.lineWidth = pass === 0 ? 7 : 2.4;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      ctx.beginPath();
      jaggedLine(ctx, a.x, a.y, b.x, b.y, 7, 9, Math.random);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * A ground telegraph: the warning that a boss attack is incoming
 * (design doc §25: boss attacks must be visually announced).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} progress 0..1 fill amount
 * @param {string} color
 * @param {number} time
 */
export function drawTelegraph(ctx, x, y, radius, progress, color, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Outer ring.
  ctx.strokeStyle = hexAlpha(color, 0.75);
  ctx.lineWidth = 2.4;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -time * 26;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Filling disc shows how long is left before the strike lands.
  const p = Math.max(0, Math.min(1, progress));
  ctx.fillStyle = hexAlpha(color, 0.16 + p * 0.24);
  ctx.beginPath();
  ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Debug overlay: entity colliders and the camera centre. Off by default.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/EntityRegistry.js').EntityRegistry} registry
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawDebugOverlay(ctx, registry, render) {
  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(0,255,140,0.7)';
  ctx.beginPath();
  ctx.arc(render.camera.x, render.camera.y, 6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,90,90,0.75)';
  for (const e of registry.enemies) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (registry.player) {
    ctx.strokeStyle = 'rgba(120,200,255,0.9)';
    ctx.beginPath();
    ctx.arc(registry.player.x, registry.player.y, registry.player.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(
    render.camera.x - CONFIG.view.width / 2,
    render.camera.y - CONFIG.view.height / 2,
    CONFIG.view.width,
    CONFIG.view.height,
  );
  ctx.restore();
}
