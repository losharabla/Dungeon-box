/**
 * @fileoverview Player rendering: class dispatch, ultimate auras, HUD rings.
 *
 * SRP: draw the player. It selects the class silhouette, overlays the
 * active ultimate's visual and the invulnerability shield, and draws the
 * aim reticle.
 */

import { drawGunner, drawMage, drawWarrior } from './characterRenderer.js';
import { drawMeleeSlash, drawPlayerWeapon } from './weaponRenderer.js';
import { arcStroke, glow, hexAlpha } from './drawUtils.js';
import { swingPose } from './meleePose.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 * @param {number} moveAmount
 */
export function drawPlayer(ctx, player, time, moveAmount = 0) {
  // Ground effects go under the character.
  drawGroundEffects(ctx, player, time);

  ctx.save();
  if (!player.alive) {
    // Death animation: slump and fade (design doc §24).
    const t = Math.min(1, player.deathTimer / 1.0);
    ctx.globalAlpha = 1 - t * 0.85;
    ctx.translate(player.x, player.y);
    ctx.rotate(t * 1.1 * (player.dirX >= 0 ? 1 : -1));
    ctx.translate(-player.x, -player.y);
  }

  const move = moveAmount || Math.min(1, Math.hypot(player.vx, player.vy) / 140);
  const attackPose = swingPose(player).extension;

  // Post-hit mercy window (CONFIG.combat.playerHurtIframe). The window makes
  // enemy blows land as "МИМО", so the silhouette blinks to say *why* nothing
  // is connecting. The cosine ends on a peak, so the alpha is already back to
  // 1 on the frame the status expires and the sprite cannot pop.
  const mercy = player.status.timeLeft('hurtIframe');
  if (mercy > 0 && player.alive) {
    ctx.globalAlpha *= 0.55 + 0.45 * Math.cos(mercy * 25);
  }

  switch (player.classId) {
    case 'mage': drawMage(ctx, player, time, move, attackPose); break;
    case 'gunner': drawGunner(ctx, player, time, move, attackPose); break;
    case 'warrior':
    default: drawWarrior(ctx, player, time, move, attackPose); break;
  }

  if (player.alive) {
    drawPlayerWeapon(ctx, player, time);
  }

  ctx.restore();

  // Overlays that must sit above the body.
  if (player.alive) {
    drawMeleeSlash(ctx, player);
    drawUltimateAura(ctx, player, time);
    drawShield(ctx, player, time);
    drawHitFlash(ctx, player);
  }
}

/**
 * Shadows and ground markers that belong beneath the character.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 */
function drawGroundEffects(ctx, player, time) {
  if (player.ultActiveTimer > 0 && player.spinVisual) {
    // Whirlwind ground ring.
    const pulse = 0.6 + Math.sin(time * 12) * 0.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexAlpha('#ffb347', pulse * 0.7);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexAlpha('#ffe9a8', pulse * 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 92, time * 3, time * 3 + Math.PI * 1.3);
    ctx.stroke();
    ctx.restore();
  }

  if (player.status.has('ricochet')) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexAlpha('#9fd8ff', 0.4 + Math.sin(time * 8) * 0.15);
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -time * 40;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Per-ultimate body overlay (design doc §6-8, §25).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 */
function drawUltimateAura(ctx, player, time) {
  if (player.ultActiveTimer <= 0) return;

  if (player.spinVisual) {
    // Spinning blade trail around the warrior.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const a = time * 16 + (i / 5) * Math.PI * 2;
      arcStroke(ctx, player.x, player.y, 78 + i * 6, a, a + 1.1, 5, '#ffd98a', 0.55);
    }
    ctx.restore();
  }

  if (player.shieldVisual) {
    glow(ctx, player.x, player.y - 12, 52, '#ffe9a8', 0.45);
  }

  if (player.classId === 'mage' && player.ultActiveDuration - (player.ultActiveDuration - player.ultActiveTimer) < 999) {
    // Time Stop tints the whole screen through ScreenFlashSystem instead.
  }

  if (player.classId === 'gunner' && player.status.has('bulletstorm')) {
    glow(ctx, player.x, player.y - 14, 40, '#ffbe4d', 0.35 + Math.sin(time * 18) * 0.1);
  }

  if (player.status.has('hasted')) {
    // Combat Stim haste streaks.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const off = ((time * 160 + i * 40) % 90) - 45;
      ctx.strokeStyle = hexAlpha('#6ffbb0', 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x - 16, player.y - 6 + off * 0.4);
      ctx.lineTo(player.x - 30, player.y - 6 + off * 0.4);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * The invulnerability shield bubble (design doc §6, ultimate 2).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 */
function drawShield(ctx, player, time) {
  if (!player.status.has('invulnerable')) return;

  const t = Math.min(1, player.status.timeLeft('invulnerable'));
  const r = player.radius + 20;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const g = ctx.createRadialGradient(player.x, player.y - 10, r * 0.55, player.x, player.y - 10, r);
  g.addColorStop(0, 'rgba(255,233,168,0)');
  g.addColorStop(0.75, `rgba(255,233,168,${0.18 * t})`);
  g.addColorStop(1, `rgba(255,255,220,${0.5 * t})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(player.x, player.y - 10, r, 0, Math.PI * 2);
  ctx.fill();

  // Hexagonal ward pattern.
  ctx.strokeStyle = hexAlpha('#ffe9a8', 0.55 * t);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + time * 0.8;
    const x = player.x + Math.cos(a) * r;
    const y = player.y - 10 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * A brief red vignette while the player is hurt.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 */
function drawHitFlash(ctx, player) {
  if (player.hurtFlash <= 0) return;
  const t = player.hurtFlash / 0.14;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, player.x, player.y - 12, 40, '#ff3b3b', 0.5 * t);
  ctx.restore();
}

/**
 * The mouse reticle, drawn in world space at the aim point.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} time
 * @param {string} color
 */
export function drawReticle(ctx, x, y, time, color = '#ff8a5c') {
  const r = 9;
  const spin = time * 1.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.strokeStyle = hexAlpha(color, 0.9);
  ctx.lineWidth = 2;
  // Four broken brackets rather than a full circle, so it never hides the
  // target underneath.
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, r, (i / 4) * Math.PI * 2 + 0.25, (i / 4) * Math.PI * 2 + 1.32);
    ctx.stroke();
  }
  ctx.fillStyle = hexAlpha(color, 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
