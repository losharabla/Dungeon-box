/**
 * @fileoverview Boss rendering: three distinct large silhouettes.
 *
 * SRP: draw bosses and their attack telegraphs. Design doc §12-14 require
 * bosses to be visually far larger than the player and to clearly announce
 * dangerous attacks, so telegraphs are drawn by the boss that owns them.
 */

import { arcStroke, ellipse, glow, hexAlpha, polygonPath, shadow, tint } from './drawUtils.js';
import { drawTelegraph } from './projectileRenderer.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Boss.js').Boss} boss
 * @param {number} time
 * @param {import('./RenderSystem.js').RenderSystem} render
 */
export function drawBoss(ctx, boss, time, render) {
  // Telegraphs are drawn underneath everything, in world space.
  drawBossTelegraphs(ctx, boss, time);

  if (!render.isVisible(boss.x, boss.y, boss.radius + 80)) return;

  ctx.save();
  if (!boss.alive) {
    const t = Math.min(1, boss.deathTimer / 1.6);
    ctx.globalAlpha = 1 - t;
    ctx.translate(boss.x, boss.y);
    ctx.scale(1 - t * 0.12, 1 - t * 0.12);
    ctx.translate(-boss.x, -boss.y);
  }

  switch (boss.bossId) {
    case 'fire_lord': drawFireLord(ctx, boss, time); break;
    case 'executioner': drawExecutioner(ctx, boss, time); break;
    case 'stone_golem':
    default: drawStoneGolem(ctx, boss, time); break;
  }

  ctx.restore();

  // Phase 2 announces itself with a persistent aura.
  if (boss.alive && boss.phase === 2) {
    const pulse = 0.28 + Math.sin(time * 6) * 0.1;
    glow(ctx, boss.x, boss.y - boss.radius * 0.4, boss.radius * 2.4, '#ff3b3b', pulse);
  }
}

/* ============================================================
   Boss 1 — Stone Golem (design doc §12)
   ============================================================ */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Boss.js').Boss} boss
 * @param {number} time
 */
function drawStoneGolem(ctx, boss, time) {
  const r = boss.radius;
  const walk = Math.sin(time * 4.2) * (boss.vx || boss.vy ? 3.2 : 1.1);
  const hurt = boss.hurtFlash > 0 ? 0.55 : 0;
  const rock = hurt > 0 ? tint('#8a8172', 1.35) : '#8a8172';
  const rockDark = hurt > 0 ? tint('#5c5548', 1.35) : '#5c5548';

  shadow(ctx, boss.x, boss.y + r * 0.72, r * 1.25, 1.2);

  ctx.save();
  ctx.translate(boss.x, boss.y);

  // Legs: thick stone pillars.
  ctx.fillStyle = rockDark;
  ctx.fillRect(-r * 0.62, r * 0.12 + walk * 0.4, r * 0.42, r * 0.62 - walk * 0.4);
  ctx.fillRect(r * 0.2, r * 0.12 - walk * 0.4, r * 0.42, r * 0.62 + walk * 0.4);

  // Torso: an irregular boulder shape, not a rectangle.
  ctx.fillStyle = rock;
  ctx.beginPath();
  ctx.moveTo(-r * 0.9, -r * 0.1);
  ctx.lineTo(-r * 0.72, -r * 0.95);
  ctx.lineTo(-r * 0.2, -r * 1.16);
  ctx.lineTo(r * 0.55, -r * 1.0);
  ctx.lineTo(r * 0.9, -r * 0.24);
  ctx.lineTo(r * 0.66, r * 0.3);
  ctx.lineTo(-r * 0.72, r * 0.28);
  ctx.closePath();
  ctx.fill();

  // Cracks in the stone light up in phase 2.
  const crackIntensity = boss.phase === 2 ? 0.9 : 0.4;
  ctx.strokeStyle = hexAlpha('#ff6a1a', crackIntensity);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, -r * 0.84);
  ctx.lineTo(-r * 0.18, -r * 0.45);
  ctx.lineTo(-r * 0.4, -r * 0.1);
  ctx.moveTo(r * 0.28, -r * 0.9);
  ctx.lineTo(r * 0.1, -r * 0.5);
  ctx.lineTo(r * 0.42, -r * 0.16);
  ctx.stroke();

  // Shoulders: stacked slabs.
  ctx.fillStyle = rockDark;
  ctx.beginPath();
  ctx.moveTo(-r * 1.16, -r * 0.86);
  ctx.lineTo(-r * 0.6, -r * 1.1);
  ctx.lineTo(-r * 0.6, -r * 0.42);
  ctx.lineTo(-r * 1.08, -r * 0.34);
  ctx.closePath();
  ctx.moveTo(r * 1.16, -r * 0.86);
  ctx.lineTo(r * 0.6, -r * 1.1);
  ctx.lineTo(r * 0.6, -r * 0.42);
  ctx.lineTo(r * 1.08, -r * 0.34);
  ctx.closePath();
  ctx.fill();

  // Arms swing with the walk cycle.
  ctx.fillStyle = rock;
  ctx.save();
  ctx.translate(-r * 1.04, -r * 0.5);
  ctx.rotate(-walk * 0.05);
  ctx.fillRect(-r * 0.24, 0, r * 0.4, r * 0.78);
  ctx.restore();
  ctx.save();
  ctx.translate(r * 1.04, -r * 0.5);
  ctx.rotate(walk * 0.05);
  ctx.fillRect(-r * 0.16, 0, r * 0.4, r * 0.78);
  ctx.restore();

  // Head: a small blunt block with glowing eyes.
  ctx.fillStyle = rockDark;
  ctx.fillRect(-r * 0.34, -r * 1.5, r * 0.68, r * 0.42);
  if (boss.hurtFlash <= 0) {
    ctx.fillStyle = boss.phase === 2 ? '#ff5a2b' : '#ffb347';
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 1.32, r * 0.09, 0, Math.PI * 2);
    ctx.arc(r * 0.15, -r * 1.32, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ============================================================
   Boss 2 — Fire Lord (design doc §13)
   ============================================================ */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Boss.js').Boss} boss
 * @param {number} time
 */
function drawFireLord(ctx, boss, time) {
  const r = boss.radius;
  const hover = Math.sin(time * 2.2) * 5;
  const hurt = boss.hurtFlash > 0 ? 0.6 : 0;

  shadow(ctx, boss.x, boss.y + r * 0.8, r * 1.2, 0.9);

  // Heat haze under the boss.
  glow(ctx, boss.x, boss.y + r * 0.5, r * 2.1, '#ff4d1a', 0.22 + Math.sin(time * 4) * 0.06);

  ctx.save();
  ctx.translate(boss.x, boss.y - hover);

  // Robe of flame: layered tongues rather than a solid body.
  const layers = [
    { w: 1.18, h: 1.5, color: '#7d1d0a', alpha: 0.95 },
    { w: 0.92, h: 1.22, color: '#c8452f', alpha: 0.9 },
    { w: 0.62, h: 0.86, color: '#ff8a2b', alpha: 0.85 },
  ];
  for (const layer of layers) {
    ctx.fillStyle = hurt > 0 ? tint(layer.color, 1.4) : layer.color;
    ctx.globalAlpha = layer.alpha;
    ctx.beginPath();
    ctx.moveTo(-r * layer.w, r * 0.7);
    // Flickering flame edge.
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = -r * layer.w + t * r * layer.w * 2;
      const flick = Math.sin(time * 9 + i * 1.7) * r * 0.1;
      ctx.lineTo(x, -r * layer.h + flick - Math.sin(t * Math.PI) * r * 0.35);
    }
    ctx.lineTo(r * layer.w, r * 0.7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Crown / horns.
  ctx.fillStyle = hurt > 0 ? tint('#3a0f06', 1.6) : '#3a0f06';
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, -r * 1.05);
  ctx.lineTo(-r * 0.62, -r * 1.62);
  ctx.lineTo(-r * 0.16, -r * 1.24);
  ctx.lineTo(0, -r * 1.72);
  ctx.lineTo(r * 0.16, -r * 1.24);
  ctx.lineTo(r * 0.62, -r * 1.62);
  ctx.lineTo(r * 0.4, -r * 1.05);
  ctx.closePath();
  ctx.fill();

  // Eyes.
  if (boss.hurtFlash <= 0) {
    const intensity = boss.phase === 2 ? 1 : 0.75;
    glow(ctx, -r * 0.2, -r * 0.86, r * 0.3, '#ffd66b', intensity);
    glow(ctx, r * 0.2, -r * 0.86, r * 0.3, '#ffd66b', intensity);
  }

  // Floating ember motes.
  for (let i = 0; i < 5; i++) {
    const a = time * 1.6 + (i / 5) * Math.PI * 2;
    const rr = r * 1.5;
    const ex = Math.cos(a) * rr;
    const ey = Math.sin(a * 1.4) * rr * 0.5 - r * 0.5;
    glow(ctx, ex, ey, 7, '#ff9a2b', 0.5);
  }

  ctx.restore();
}

/* ============================================================
   Boss 3 — Executioner (design doc §14)
   ============================================================ */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Boss.js').Boss} boss
 * @param {number} time
 */
function drawExecutioner(ctx, boss, time) {
  const r = boss.radius;
  const walk = Math.sin(time * 6) * 3;
  const hurt = boss.hurtFlash > 0 ? 0.6 : 0;

  shadow(ctx, boss.x, boss.y + r * 0.7, r * 1.15, 1.1);

  ctx.save();
  ctx.translate(boss.x, boss.y);

  // Legs.
  ctx.strokeStyle = hurt > 0 ? tint('#241d2e', 2) : '#241d2e';
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.24, r * 0.1);
  ctx.lineTo(-r * 0.32 + walk, r * 0.72);
  ctx.moveTo(r * 0.24, r * 0.1);
  ctx.lineTo(r * 0.32 - walk, r * 0.72);
  ctx.stroke();

  // Long coat / tabard.
  ctx.fillStyle = hurt > 0 ? tint('#3a2f45', 1.6) : '#3a2f45';
  ctx.beginPath();
  ctx.moveTo(-r * 0.56, -r * 0.9);
  ctx.lineTo(r * 0.56, -r * 0.9);
  ctx.lineTo(r * 0.4, r * 0.34);
  ctx.lineTo(-r * 0.4, r * 0.34);
  ctx.closePath();
  ctx.fill();

  // Crimson sash.
  ctx.fillStyle = hurt > 0 ? tint('#a01f2e', 1.5) : '#a01f2e';
  ctx.fillRect(-r * 0.5, -r * 0.44, r * 1.0, r * 0.16);

  // Pauldrons with spikes.
  ctx.fillStyle = hurt > 0 ? tint('#1c1622', 2) : '#1c1622';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.5, -r * 0.92);
    ctx.lineTo(side * r * 1.02, -r * 0.72);
    ctx.lineTo(side * r * 0.96, -r * 0.24);
    ctx.lineTo(side * r * 0.5, -r * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(side * r * 0.82, -r * 0.66);
    ctx.lineTo(side * r * 1.24, -r * 0.98);
    ctx.lineTo(side * r * 0.94, -r * 0.38);
    ctx.closePath();
    ctx.fillStyle = hurt > 0 ? tint('#c8452f', 1.4) : '#c8452f';
    ctx.fill();
    ctx.fillStyle = hurt > 0 ? tint('#1c1622', 2) : '#1c1622';
  }

  // Hooded head with a glowing visor slit.
  ctx.fillStyle = hurt > 0 ? tint('#16111c', 2.4) : '#16111c';
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.94);
  ctx.lineTo(0, -r * 1.48);
  ctx.lineTo(r * 0.3, -r * 0.94);
  ctx.closePath();
  ctx.fill();

  if (boss.hurtFlash <= 0) {
    ctx.fillStyle = boss.phase === 2 ? '#ff2b4b' : '#ff8a5c';
    ctx.fillRect(-r * 0.18, -r * 1.18, r * 0.36, r * 0.07);
    glow(ctx, 0, -r * 1.14, r * 0.4, '#ff2b4b', boss.phase === 2 ? 0.8 : 0.45);
  }

  ctx.restore();

  // Twin executioner blades, rotating with the aim.
  drawExecutionerBlades(ctx, boss, time);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Boss.js').Boss} boss
 * @param {number} time
 */
function drawExecutionerBlades(ctx, boss, time) {
  const r = boss.radius;
  // During the spin attack the blades whirl around the body.
  const spinning = boss.pending?.def.kind === 'spin';
  const swing = Math.sin(time * 7) * 0.35;

  ctx.save();
  ctx.translate(boss.x, boss.y - r * 0.3);

  const bladeAngles = spinning
    ? [time * 22, time * 22 + Math.PI]
    : [boss.facing - 0.55 + swing, boss.facing + 0.55 - swing];

  for (const angle of bladeAngles) {
    ctx.save();
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(r * 0.6, 0, r * 1.9, 0);
    grad.addColorStop(0, '#5a6070');
    grad.addColorStop(0.5, '#e6ebf5');
    grad.addColorStop(1, '#8f96a8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -r * 0.1);
    ctx.lineTo(r * 1.85, -r * 0.06);
    ctx.lineTo(r * 2.05, 0);
    ctx.lineTo(r * 1.85, r * 0.06);
    ctx.lineTo(r * 0.6, r * 0.1);
    ctx.closePath();
    ctx.fill();
    // Blood groove.
    ctx.strokeStyle = hexAlpha('#a01f2e', 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 0.68, 0);
    ctx.lineTo(r * 1.8, 0);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/* ============================================================
   Telegraphs (§25)
   ============================================================ */

/**
 * Draw the ground warning for the boss's pending attack.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Boss.js').Boss} boss
 * @param {number} time
 */
export function drawBossTelegraphs(ctx, boss, time) {
  const pending = boss.pending;
  if (!pending || !boss.alive) return;

  const a = pending.def;
  // Progress runs 0 -> 1 as the strike approaches.
  const progress = 1 - pending.timer / Math.max(0.001, pending.total);

  switch (a.kind) {
    case 'slam':
    case 'combo': {
      const cx = boss.x + Math.cos(pending.aimAngle) * (boss.radius + 26);
      const cy = boss.y + Math.sin(pending.aimAngle) * (boss.radius + 26);
      drawTelegraph(ctx, cx, cy, a.radius, progress, '#ff8a5c', time);
      break;
    }

    case 'spin':
    case 'shockwave':
      drawTelegraph(ctx, boss.x, boss.y, a.radius, progress, '#c8a878', time);
      break;

    case 'dash': {
      // A directional lane marker showing the charge path.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(boss.x, boss.y);
      ctx.rotate(pending.aimAngle);
      const len = 420;
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, hexAlpha('#b070ff', 0.45 * progress));
      g.addColorStop(1, hexAlpha('#b070ff', 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, -a.radius * 0.55, len, a.radius * 1.1);
      ctx.strokeStyle = hexAlpha('#d0a0ff', 0.7);
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 10]);
      ctx.lineDashOffset = -time * 60;
      ctx.strokeRect(0, -a.radius * 0.55, len, a.radius * 1.1);
      ctx.restore();
      break;
    }

    case 'rockVolley':
    case 'fireball':
    case 'cloneVolley': {
      // Show the firing arc so the spread is readable in advance.
      ctx.save();
      const base = pending.aimAngle - (a.count ?? 3) * 0.11;
      const spread = (a.count ?? 3) * 0.22;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(boss.x, boss.y, boss.radius, boss.x, boss.y, boss.radius + 420);
      g.addColorStop(0, hexAlpha('#ff8a5c', 0.28 * progress));
      g.addColorStop(1, hexAlpha('#ff8a5c', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(boss.x, boss.y);
      ctx.arc(boss.x, boss.y, boss.radius + 420, base, base + spread);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'summon': {
      // Summoning circles where the minions will appear.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < (a.count ?? 3); i++) {
        const ang = (i / (a.count ?? 3)) * Math.PI * 2 + time;
        const dist = boss.radius + 60;
        const x = boss.x + Math.cos(ang) * dist;
        const y = boss.y + Math.sin(ang) * dist;
        ctx.strokeStyle = hexAlpha('#c8a878', 0.8);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 24 * (0.5 + progress * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        polygonPath(ctx, x, y, 14 * progress, 6, time * 2);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }

    case 'teleport': {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = progress;
      glow(ctx, boss.x, boss.y, boss.radius * 2, '#b070ff', 0.5);
      ctx.restore();
      break;
    }

    default:
      break;
  }

  // Multi-part attacks need per-hazard markers; those are owned by the
  // controller and drawn by the effects renderer instead.
  void ellipse;
  void arcStroke;
}
