/**
 * @fileoverview Entity rendering dispatch.
 *
 * SRP: map an entity's `kind` to its draw function. This is the one place
 * that knows which silhouette belongs to which enemy, which is what allows
 * new enemies to be added by adding a data row plus one registry entry
 * (design doc §23, §35).
 */

import { Enemy } from '../entities/Enemy.js';
import {
  drawAssassin, drawBat, drawBerserker, drawEnemyMage, drawGoblin,
  drawNecromancer, drawPyromancer, drawShieldbearer, drawSkeleton, drawSlime, drawOrc,
} from './characterRenderer.js';
import { drawBoss } from './bossRenderer.js';
import { drawPlayer } from './playerRenderer.js';
import { glow, hexAlpha, mix, shadow } from './drawUtils.js';

/**
 * @typedef {(ctx: CanvasRenderingContext2D, entity: any, time: number, moveAmount: number) => void} EntityDrawFn
 */

/** @type {Record<string, EntityDrawFn>} */
const ENEMY_RENDERERS = {
  slime: drawSlime,
  goblin: drawGoblin,
  skeleton: drawSkeleton,
  orc: drawOrc,
  bat: drawBat,
  enemy_mage: drawEnemyMage,
  pyromancer: drawPyromancer,
  shieldbearer: drawShieldbearer,
  assassin: drawAssassin,
  berserker: drawBerserker,
  necromancer: drawNecromancer,
};

/**
 * Draw one enemy, including its health bar and death fade.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Enemy} enemy
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawEnemy(ctx, enemy, time, render) {
  if (!render.isVisible(enemy.x, enemy.y, enemy.radius + 40)) return;

  ctx.save();

  // Death animation: fade and shrink out (design doc §24).
  if (!enemy.alive) {
    const t = Math.min(1, enemy.deathTimer / 0.5);
    ctx.globalAlpha = 1 - t;
    const scale = 1 + t * 0.25;
    ctx.translate(enemy.x, enemy.y);
    ctx.scale(scale, scale);
    ctx.translate(-enemy.x, -enemy.y);
  }

  // Status visuals are drawn beneath the body so they read as a ground aura.
  drawStatusAura(ctx, enemy, time);

  const draw = ENEMY_RENDERERS[enemy.kind];
  const moveAmount = Math.min(1, Math.hypot(enemy.vx, enemy.vy) / 120);

  if (draw) {
    draw(ctx, enemy, time, moveAmount);
  } else {
    // A visible fallback keeps an unknown kind debuggable instead of blank.
    ctx.fillStyle = '#ff00ff';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Health bar: only once damaged, to keep clean rooms clean.
  if (enemy.alive && enemy.hp < enemy.maxHp) {
    drawHealthBar(ctx, enemy, render);
  }
}

/**
 * Draw the floor aura contributed by active status effects.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Enemy} enemy
 * @param {number} time
 */
function drawStatusAura(ctx, enemy, time) {
  if (enemy.status.has('burn')) {
    for (let i = 0; i < 3; i++) {
      const a = time * 3 + (i / 3) * Math.PI * 2;
      const r = enemy.radius * 0.8;
      const x = enemy.x + Math.cos(a) * r;
      const y = enemy.y + Math.sin(a) * r * 0.4 - 4;
      const size = 4 + Math.sin(time * 11 + i) * 1.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
      g.addColorStop(0, 'rgba(255,190,90,0.85)');
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, size * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (enemy.status.has('slow')) {
    ctx.save();
    ctx.strokeStyle = 'rgba(150,220,255,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = time * 20;
    ctx.beginPath();
    ctx.ellipse(enemy.x, enemy.y + enemy.radius * 0.4, enemy.radius * 1.5, enemy.radius * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (enemy.status.has('stun')) {
    // Circling stars over a stunned head.
    ctx.save();
    ctx.fillStyle = 'rgba(255,240,140,0.95)';
    for (let i = 0; i < 3; i++) {
      const a = time * 4 + (i / 3) * Math.PI * 2;
      const x = enemy.x + Math.cos(a) * enemy.radius * 0.9;
      const y = enemy.y - enemy.radius * 1.6 + Math.sin(a) * 4;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (enemy.status.has('timestop')) {
    // Frozen enemies get a cold, still silhouette tint.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(80,160,220,0.18)';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * A small health bar above an enemy.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Enemy} enemy
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
function drawHealthBar(ctx, enemy, render) {
  if (!render.isVisible(enemy.x, enemy.y, enemy.radius + 40)) return;

  const width = Math.max(26, enemy.radius * 2.1);
  const height = 4;
  const x = enemy.x - width / 2;
  const y = enemy.y - enemy.radius - 14;
  const fraction = Math.max(0, enemy.hp / enemy.maxHp);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
  // Bosses use their dedicated bar; enemies use a simple red fill.
  ctx.fillStyle = fraction > 0.5 ? '#7ed07e' : (fraction > 0.25 ? '#e8b955' : '#d4384a');
  ctx.fillRect(x, y, width * fraction, height);
  ctx.restore();
}

/**
 * Draw every enemy in the registry, back to front so overlapping bodies
 * layer sensibly (lower on screen draws in front).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/EntityRegistry.js').EntityRegistry} registry
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawEnemies(ctx, registry, time, render) {
  const sorted = registry.enemies.slice().sort((a, b) => a.y - b.y);
  for (const enemy of sorted) {
    if (enemy.kind === 'boss') {
      drawBoss(ctx, enemy, time, render);
    } else {
      drawEnemy(ctx, enemy, time, render);
    }
  }
}

/**
 * Register a renderer for a custom enemy kind at runtime.
 * @param {string} kind
 * @param {EntityDrawFn} fn
 */
export function registerEnemyRenderer(kind, fn) {
  ENEMY_RENDERERS[kind] = fn;
}

/**
 * Procedural explosive barrel.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Barrel.js').Barrel} barrel
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawBarrel(ctx, barrel, time, render) {
  if (!render.isVisible(barrel.x, barrel.y, barrel.radius + 30)) return;

  const hurt = barrel.hurtFlash > 0 ? 0.6 : 0;
  const wood = hurt > 0 ? mix('#734722', '#ffffff', hurt) : '#734722';
  const iron = hurt > 0 ? mix('#444852', '#ffffff', hurt) : '#444852';

  // Ground shadow
  shadow(ctx, barrel.x, barrel.y + 6, barrel.radius * 0.9, 0.7);

  ctx.save();
  ctx.translate(barrel.x, barrel.y);

  const w = 24;
  const h = 26;
  const hw = w / 2;

  // Barrel wooden staves body
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.moveTo(-hw + 2, -h);
  ctx.quadraticCurveTo(-hw - 3, -h / 2, -hw + 2, 0);
  ctx.lineTo(hw - 2, 0);
  ctx.quadraticCurveTo(hw + 3, -h / 2, hw - 2, -h);
  ctx.closePath();
  ctx.fill();

  // Dark stave lines
  ctx.strokeStyle = '#432812';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.35, -h);
  ctx.quadraticCurveTo(-hw * 0.45, -h / 2, -hw * 0.35, 0);
  ctx.moveTo(hw * 0.35, -h);
  ctx.quadraticCurveTo(hw * 0.45, -h / 2, hw * 0.35, 0);
  ctx.stroke();

  // Top & bottom iron hoops
  ctx.fillStyle = iron;
  ctx.fillRect(-hw - 1.5, -h + 4, w + 3, 3.5);
  ctx.fillRect(-hw - 1.5, -7.5, w + 3, 3.5);

  // Central explosive hazard mark
  const heatPulse = 0.8 + Math.sin(time * 6 + barrel.x) * 0.2;
  ctx.fillStyle = hexAlpha('#ff4d1a', 0.85 * heatPulse);
  ctx.beginPath();
  ctx.moveTo(0, -h / 2 - 4);
  ctx.lineTo(4, -h / 2 + 2);
  ctx.lineTo(-4, -h / 2 + 2);
  ctx.closePath();
  ctx.fill();
  glow(ctx, 0, -h / 2, 10 * heatPulse, '#ff5a1a', 0.4);

  // Subtle health bar if damaged
  if (barrel.hp < barrel.maxHp && barrel.alive) {
    const fraction = Math.max(0, barrel.hp / barrel.maxHp);
    const barW = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-barW / 2 - 1, -h - 7, barW + 2, 4);
    ctx.fillStyle = fraction > 0.4 ? '#ff9a3c' : '#ff3b30';
    ctx.fillRect(-barW / 2, -h - 6, barW * fraction, 2);
  }

  ctx.restore();
}

/**
 * Draw all barrels in the world.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Barrel.js').Barrel[]} barrels
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawBarrels(ctx, barrels, time, render) {
  if (!barrels || barrels.length === 0) return;
  for (const b of barrels) {
    if (b.alive) drawBarrel(ctx, b, time, render);
  }
}

export { drawPlayer };
