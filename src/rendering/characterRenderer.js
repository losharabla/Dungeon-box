/**
 * @fileoverview Procedural entity silhouettes.
 *
 * SRP: turn entity *data* into pixels. These functions read position,
 * facing, animation phase and health; they never mutate anything.
 *
 * Design doc §23/§24: each entity type gets its own function and its own
 * recognisable silhouette — there is deliberately no universal rectangle.
 * Design doc §3/§35: everything is built from Canvas primitives.
 */

import {
  ellipse, glow, hexAlpha, mix, shadow, tint,
} from './drawUtils.js';
import { swingPose } from './meleePose.js';

/* ============================================================
   Shared body assembly
   ============================================================ */

/**
 * A humanoid rig: shadow, legs, torso, head, plus a natural walk bob.
 *
 * Every character in the game (player classes, goblins, skeletons, orcs,
 * necromancers) is built from this one rig with different proportions and
 * colouring, which keeps them visually consistent while staying distinct.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} rig
 * @param {number} rig.x
 * @param {number} rig.y            ground contact point
 * @param {number} rig.scale
 * @param {number} rig.facing       radians
 * @param {number} rig.time         animation clock
 * @param {number} rig.moveAmount   0..1 how fast the character is moving
 * @param {string} rig.body
 * @param {string} rig.trim
 * @param {string} rig.skin
 * @param {number} [rig.hurt]       0..1 white flash amount
 * @param {number} [rig.lean]       extra forward lean in radians
 * @param {number} [rig.headRadius]
 * @param {number} [rig.shoulderWidth]
 * @param {number} [rig.legLength]
 * @param {number} [rig.bodyHeight]
 * @param {boolean} [rig.hunched]   draw the torso hunched forward
 * @param {number} [rig.attackPose] 0..1 melee wind-up intensity
 * @param {number} [rig.cloakSway] cloak/mantle sway in pixels
 * @param {boolean} [rig.alpha]
 */
export function drawHumanoid(ctx, rig) {
  const {
    x, y, scale, facing, time, moveAmount, body, trim, skin,
    hurt = 0, lean = 0, attackPose = 0, cloakSway = 0, headRadius = 6, shoulderWidth = 11,
    legLength = 12, bodyHeight = 20, hunched = false, alpha = 1,
  } = rig;

  const s = scale;
  const walkPhase = time * 9;
  const bob = Math.sin(walkPhase) * 2.1 * moveAmount * s;
  const breath = Math.sin(time * 2.35) * (0.22 + (1 - moveAmount) * 0.42) * s;
  const sway = Math.sin(walkPhase) * 0.32 * moveAmount + cloakSway * 0.025;
  const poseLean = attackPose * 0.16;
  const poseShift = attackPose * 1.8 * s;
  // The body is drawn side-on but the head turn follows the aim, which
  // keeps aiming readable from any angle.
  const dirSign = Math.cos(facing) >= 0 ? 1 : -1;

  shadow(ctx, x, y + 2, 13 * s, alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - bob + breath * 0.35);
  ctx.rotate((lean + poseLean) * dirSign);

  const legSwing = Math.sin(walkPhase) * 4.2 * moveAmount * s;
  const legLift = Math.max(0, Math.cos(walkPhase)) * 0.8 * moveAmount * s;
  const legY = -legLength * s * 0.5;

  // --- Mantle / coat tail ---
  // Paint the cloth before the legs and torso. If it is painted afterward it
  // covers the legs with a moving polygon and makes the warrior's silhouette
  // appear to deform whenever the walk phase changes.
  // Keep the mantle present at rest; only its motion should disappear.
  {
    const cloth = hurt > 0 ? mix(body, '#ffffff', hurt) : tint(body, 0.82);
    const clothWave = Math.sin(time * 7.2 + 0.8) * (1.2 + moveAmount * 2.4) * s + cloakSway * 0.35;
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(-shoulderWidth * 0.42 * s, -legLength * s - bodyHeight * s + 2 * s);
    ctx.lineTo(shoulderWidth * 0.42 * s, -legLength * s - bodyHeight * s + 2 * s);
    ctx.lineTo(shoulderWidth * 0.7 * s + clothWave * dirSign, 1 * s);
    ctx.lineTo(clothWave * dirSign, 3.5 * s);
    ctx.lineTo(-shoulderWidth * 0.7 * s + clothWave * dirSign, 1 * s);
    ctx.closePath();
    ctx.fill();
  }

  // --- Legs ---
  ctx.strokeStyle = tint(body, 0.55);
  ctx.lineWidth = 4.2 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2.4 * s, legY);
  ctx.lineTo(-2.4 * s + legSwing - poseShift * dirSign, 2 * s - legLift);
  ctx.moveTo(2.4 * s, legY);
  ctx.lineTo(2.4 * s - legSwing - poseShift * dirSign, 2 * s - legLift * 0.35);
  ctx.stroke();

  // --- Torso ---
  const torsoH = bodyHeight * s;
  const torsoW = shoulderWidth * s * (1 + breath * 0.018);
  const torsoTop = -legLength * s - torsoH;

  ctx.fillStyle = hurt > 0 ? mix(body, '#ffffff', hurt) : body;
  ctx.beginPath();
  const lean2 = hunched ? 2.4 * s * dirSign : 0;
  ctx.moveTo(-torsoW / 2 - sway, torsoTop + lean2);
  ctx.lineTo(torsoW / 2 + sway, torsoTop + lean2);
  ctx.lineTo(torsoW / 2 * 0.78 + sway, torsoTop + torsoH);
  ctx.lineTo(-torsoW / 2 * 0.78 - sway, torsoTop + torsoH);
  ctx.closePath();
  ctx.fill();

  // --- Belt / trim ---
  ctx.fillStyle = hurt > 0 ? mix(trim, '#ffffff', hurt) : trim;
  ctx.fillRect(-torsoW / 2 * 0.86 - sway, torsoTop + torsoH * 0.66, torsoW * 0.86, 3.2 * s);

  // Chest emblem keeps the dark silhouette from reading as a flat blob.
  ctx.fillStyle = hexAlpha(trim, 0.55);
  ctx.beginPath();
  ctx.arc(sway, torsoTop + torsoH * 0.32, 3.1 * s, 0, Math.PI * 2);
  ctx.fill();

  // --- Shoulders ---
  ctx.fillStyle = hurt > 0 ? mix(body, '#ffffff', hurt) : tint(body, 1.15);
  ctx.beginPath();
  ctx.arc(-torsoW / 2 - sway, torsoTop + 2.5 * s, 3.6 * s, 0, Math.PI * 2);
  ctx.arc(torsoW / 2 + sway, torsoTop + 2.5 * s, 3.6 * s, 0, Math.PI * 2);
  ctx.fill();

  // --- Head ---
  const headY = torsoTop - headRadius * s * 0.82;
  ctx.fillStyle = hurt > 0 ? mix(skin, '#ffffff', hurt) : skin;
  ctx.beginPath();
  ctx.arc(sway * 1.2 + dirSign * 1.2 * s, headY, headRadius * s, 0, Math.PI * 2);
  ctx.fill();

  // Eyes give the character a facing even in near-darkness.
  if (hurt <= 0) {
    ctx.fillStyle = 'rgba(255,80,80,0.92)';
    ctx.beginPath();
    ctx.arc(sway * 1.2 + dirSign * (headRadius * 0.42) * s, headY - 1 * s, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  return { headY: torsoTop - headRadius * s * 0.82, torsoTop, torsoH, s };
}

/* ============================================================
   Player classes (design doc §6, §7, §8)
   ============================================================ */

/**
 * Warrior: broad shoulders, heavy pauldrons, plate skirt.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 * @param {number} moveAmount
 */
export function drawWarrior(ctx, player, time, moveAmount, pose = 0) {
  const hurt = player.hurtFlash > 0 ? 0.65 : 0;
  pose = swingPose(player).extension;
  drawHumanoid(ctx, {
    x: player.x, y: player.y, scale: 1.06, facing: player.facing,
    time, moveAmount, hurt, attackPose: pose,
    cloakSway: Math.sin(time * 6.5) * moveAmount * 4 + (player.attack.recoil ?? 0) * 3,
    body: '#7c8598', trim: '#b03a2e', skin: '#d7ab86',
    shoulderWidth: 15, bodyHeight: 22, legLength: 13, headRadius: 6.4,
  });
}

/**
 * Mage: tall hood, robe that widens into a hem, staff glow handled by the
 * weapon renderer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 * @param {number} moveAmount
 */
export function drawMage(ctx, player, time, moveAmount, pose = 0) {
  const hurt = player.hurtFlash > 0 ? 0.65 : 0;
  const s = 0.98;
  shadow(ctx, player.x, player.y + 2, 12 * s);

  const bob = Math.sin(time * 8.4) * 1.8 * moveAmount * s;
  const breath = Math.sin(time * 2.35) * (0.2 + (1 - moveAmount) * 0.4) * s;
  const clothWave = Math.sin(time * 6.8) * (1 + moveAmount * 2.8) + (player.attack.recoil ?? 0) * 3;
  ctx.save();
  ctx.translate(player.x, player.y - bob + breath * 0.3);
  ctx.rotate(Math.cos(player.facing) * pose * 0.08);

  // Robe: a trapezoid that sways with movement.
  const sway = Math.sin(time * 8.4) * 1.5 * moveAmount;
  const hem = 20 * s;
  const top = -34 * s;
  ctx.fillStyle = hurt > 0 ? mix('#4d5bb0', '#ffffff', hurt) : '#4d5bb0';
  ctx.beginPath();
  ctx.moveTo(-6 * s + sway, top);
  ctx.lineTo(6 * s + sway, top);
  ctx.lineTo(hem + clothWave * 0.25, 2 * s);
  ctx.lineTo(-hem + clothWave * 0.25, 2 * s);
  ctx.closePath();
  ctx.fill();

  // Robe trim.
  ctx.fillStyle = hurt > 0 ? mix('#7fd8ff', '#ffffff', hurt) : '#7fd8ff';
  ctx.fillRect(-6.5 * s + sway, top + 14 * s, 13 * s, 2.6 * s);

  // Deep hood.
  ctx.fillStyle = '#3a4690';
  ctx.beginPath();
  ctx.moveTo(-8 * s + sway, top + 2 * s);
  ctx.lineTo(0, top - 12 * s);
  ctx.lineTo(8 * s + sway, top + 2 * s);
  ctx.closePath();
  ctx.fill();

  // Face: two glowing eyes inside the hood shadow.
  ctx.fillStyle = 'rgba(4,6,18,0.92)';
  ctx.beginPath();
  ctx.arc(sway, top - 4 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  if (hurt <= 0) {
    const flick = 0.7 + Math.sin(time * 6) * 0.3;
    ctx.fillStyle = hexAlpha('#7fd8ff', flick);
    ctx.beginPath();
    ctx.arc(sway - 2 * s, top - 4.5 * s, 1.5 * s, 0, Math.PI * 2);
    ctx.arc(sway + 2 * s, top - 4.5 * s, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Gunner: coat with tails, wide brim hat, bandolier.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 * @param {number} moveAmount
 */
export function drawGunner(ctx, player, time, moveAmount, pose = 0) {
  const hurt = player.hurtFlash > 0 ? 0.65 : 0;
  const s = 1.0;
  drawHumanoid(ctx, {
    x: player.x, y: player.y, scale: s, facing: player.facing,
    time, moveAmount, hurt, attackPose: pose,
    cloakSway: Math.sin(time * 7) * moveAmount * 5 + (player.attack.recoil ?? 0) * 4,
    body: '#6d5540', trim: '#c9913f', skin: '#e0b48c',
    shoulderWidth: 13, bodyHeight: 20, legLength: 13, headRadius: 5.8,
  });

  // Wide-brim hat, drawn after the rig so it sits on top of the head.
  const bob = Math.sin(time * 9) * 2.1 * moveAmount * s;
  const headY = player.y - bob - 13 * s - 20 * s - 5.8 * s * 0.82;
  ctx.save();
  ctx.translate(player.x, headY - 2 * s);
  ctx.fillStyle = hurt > 0 ? mix('#3d2f22', '#ffffff', hurt) : '#3d2f22';
  ellipse(ctx, 0, 0, 13 * s, 3.4 * s);
  ellipse(ctx, 0, -3 * s, 7 * s, 4.2 * s);
  ctx.restore();

  // Bandolier strap.
  ctx.save();
  ctx.translate(player.x, player.y - bob);
  ctx.strokeStyle = hurt > 0 ? mix('#c9913f', '#ffffff', hurt) : '#c9913f';
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath();
  ctx.moveTo(-7 * s, -33 * s);
  ctx.lineTo(6 * s, -16 * s);
  ctx.stroke();
  ctx.restore();
}

/* ============================================================
   Enemies (design doc §11)
   ============================================================ */

/**
 * Slime: a wobbling gelatinous dome with a highlight and a visible core.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawSlime(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const wob = Math.sin(time * 5.5 + e.age) * 0.14;
  const base = hurt > 0 ? mix('#4caf6d', '#ffffff', hurt) : '#4caf6d';
  const rx = e.radius * (1.18 + wob);
  const ry = e.radius * (0.86 - wob);

  shadow(ctx, e.x, e.y + e.radius * 0.75, e.radius * 1.1);

  ctx.save();
  ctx.translate(e.x, e.y);

  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.ellipse(0, 0, rx, ry * 0.72, 0, 0, Math.PI);
  ctx.fill();

  // Internal core.
  ctx.fillStyle = hexAlpha('#0d3d21', 0.6);
  ctx.beginPath();
  ctx.arc(0, ry * 0.12, e.radius * 0.34, 0, Math.PI * 2);
  ctx.fill();

  // Wet highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.ellipse(-rx * 0.36, -ry * 0.42, e.radius * 0.26, e.radius * 0.15, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  glow(ctx, e.x, e.y + e.radius * 0.2, e.radius * 1.5, '#4caf6d', 0.16);
}

/**
 * Goblin: small, hunched, big ears, crude blade.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawGoblin(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.65 : 0;
  const s = e.radius / 15;
  const time2 = time + e.age;
  const bob = Math.sin(time2 * 11) * 1.8 * s;

  shadow(ctx, e.x, e.y + e.radius * 0.55, e.radius * 0.9);

  ctx.save();
  ctx.translate(e.x, e.y - bob);
  const sign = e.dirX >= 0 ? 1 : -1;

  // Legs.
  ctx.strokeStyle = '#3f6b32';
  ctx.lineWidth = 3.4 * s;
  ctx.lineCap = 'round';
  const swing = Math.sin(time2 * 11) * 3.4 * s;
  ctx.beginPath();
  ctx.moveTo(-1.6 * s, -3 * s); ctx.lineTo(-1.6 * s + swing, 4 * s);
  ctx.moveTo(2 * s, -3 * s); ctx.lineTo(2 * s - swing, 4 * s);
  ctx.stroke();

  // Hunched body.
  const body = hurt > 0 ? mix('#5d9c46', '#ffffff', hurt) : '#5d9c46';
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -9 * s, 8 * s, 8.5 * s, sign * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Head with huge ears.
  const headY = -19 * s;
  ctx.fillStyle = hurt > 0 ? mix('#6fb04f', '#ffffff', hurt) : '#6fb04f';
  ctx.beginPath();
  ctx.arc(sign * 1.5 * s, headY, 6.4 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4d7a38';
  ctx.beginPath();
  ctx.moveTo(sign * 5 * s, headY - 2 * s);
  ctx.lineTo(sign * 13 * s, headY - 8 * s);
  ctx.lineTo(sign * 5.5 * s, headY + 2.5 * s);
  ctx.closePath();
  ctx.moveTo(-sign * 3 * s, headY - 2 * s);
  ctx.lineTo(-sign * 10 * s, headY - 8 * s);
  ctx.lineTo(-sign * 3.5 * s, headY + 2.5 * s);
  ctx.closePath();
  ctx.fill();

  // Eyes.
  if (hurt <= 0) {
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.arc(sign * 1 * s, headY - 1 * s, 1.7 * s, 0, Math.PI * 2);
    ctx.arc(sign * 5 * s, headY - 1 * s, 1.7 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crude blade held toward the facing direction.
  ctx.save();
  ctx.rotate(e.facing);
  ctx.fillStyle = '#b9bcc4';
  ctx.beginPath();
  ctx.moveTo(e.radius * 0.6, -2 * s);
  ctx.lineTo(e.radius * 1.25, -0.6 * s);
  ctx.lineTo(e.radius * 0.6, 2.4 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/**
 * Skeleton: bone-white rib cage, skull, bow. Ranged kiter.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawSkeleton(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.7 : 0;
  const s = e.radius / 14;
  const time2 = time + e.age;
  const bob = Math.sin(time2 * 8) * 1.5 * s;
  const bone = hurt > 0 ? mix('#ded8c4', '#ffffff', hurt) : '#ded8c4';

  shadow(ctx, e.x, e.y + e.radius * 0.6, e.radius * 0.85);

  ctx.save();
  ctx.translate(e.x, e.y - bob);

  // Leg bones.
  ctx.strokeStyle = bone;
  ctx.lineWidth = 3 * s;
  ctx.lineCap = 'round';
  const swing = Math.sin(time2 * 8) * 3 * s;
  ctx.beginPath();
  ctx.moveTo(-2 * s, -4 * s); ctx.lineTo(-2 * s + swing, 5 * s);
  ctx.moveTo(2.5 * s, -4 * s); ctx.lineTo(2.5 * s - swing, 5 * s);
  ctx.stroke();

  // Spine + ribs.
  ctx.beginPath();
  ctx.moveTo(0, -4 * s);
  ctx.lineTo(0, -20 * s);
  ctx.stroke();

  ctx.lineWidth = 2.2 * s;
  for (let i = 0; i < 4; i++) {
    const ry = -8 * s - i * 3.2 * s;
    const rw = (7 - i * 0.9) * s;
    ctx.beginPath();
    ctx.moveTo(-rw, ry);
    ctx.quadraticCurveTo(0, ry + 2.4 * s, rw, ry);
    ctx.stroke();
  }

  // Skull.
  const headY = -25 * s;
  ctx.fillStyle = bone;
  ctx.beginPath();
  ctx.arc(0, headY, 6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bone;
  ctx.beginPath();
  ctx.moveTo(-3.4 * s, headY + 4 * s);
  ctx.lineTo(3.4 * s, headY + 4 * s);
  ctx.lineTo(2 * s, headY + 8 * s);
  ctx.lineTo(-2 * s, headY + 8 * s);
  ctx.closePath();
  ctx.fill();

  // Eye sockets glow.
  ctx.fillStyle = 'rgba(6,10,16,0.95)';
  ctx.beginPath();
  ctx.arc(-2.4 * s, headY - 1 * s, 2 * s, 0, Math.PI * 2);
  ctx.arc(2.4 * s, headY - 1 * s, 2 * s, 0, Math.PI * 2);
  ctx.fill();
  if (hurt <= 0) {
    ctx.fillStyle = 'rgba(120,220,255,0.95)';
    ctx.beginPath();
    ctx.arc(-2.4 * s, headY - 1 * s, 1 * s, 0, Math.PI * 2);
    ctx.arc(2.4 * s, headY - 1 * s, 1 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bow, rotated toward the aim.
  ctx.save();
  ctx.rotate(e.facing);
  ctx.strokeStyle = '#8a6a42';
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.arc(e.radius * 0.75, 0, 9 * s, -1.1, 1.1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(230,230,230,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(e.radius * 0.75 + Math.cos(-1.1) * 9 * s, Math.sin(-1.1) * 9 * s);
  ctx.lineTo(e.radius * 0.75 + Math.cos(1.1) * 9 * s, Math.sin(1.1) * 9 * s);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/**
 * Orc: massive shoulders, tusks, cleaver.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawOrc(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const time2 = time + e.age;
  drawHumanoid(ctx, {
    x: e.x, y: e.y, scale: e.radius / 15 * 1.12, facing: e.facing,
    time: time2, moveAmount: 0.55, hurt,
    body: '#5a6b3a', trim: '#8b3a2a', skin: '#6d8046',
    shoulderWidth: 18, bodyHeight: 24, legLength: 12, headRadius: 7, hunched: true,
  });

  // Tusks in front of the face.
  const sign = e.dirX >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(e.x + sign * 4, e.y - 34);
  ctx.fillStyle = '#f0ead6';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(sign * 3, -5); ctx.lineTo(sign * 5, 0); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Bat: fast, erratic, with flapping membrane wings.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawBat(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const flap = Math.sin((time + e.age) * 17);
  const body = hurt > 0 ? mix('#4a3a55', '#ffffff', hurt) : '#4a3a55';

  shadow(ctx, e.x, e.y + e.radius * 0.9, e.radius * 0.7, 0.7);

  ctx.save();
  ctx.translate(e.x, e.y);

  // Wings.
  ctx.fillStyle = hexAlpha(body, 0.92);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side * e.radius * 1.6, -e.radius * (0.4 + flap * 0.9), side * e.radius * 2.1, e.radius * 0.3);
    ctx.quadraticCurveTo(side * e.radius * 1.5, e.radius * 0.1, side * e.radius * 1.3, e.radius * 0.55);
    ctx.quadraticCurveTo(side * e.radius * 0.9, e.radius * 0.2, 0, e.radius * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  // Body + ears.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, e.radius * 0.6, e.radius * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-e.radius * 0.5, -e.radius * 0.5);
  ctx.lineTo(-e.radius * 0.75, -e.radius * 1.35);
  ctx.lineTo(-e.radius * 0.1, -e.radius * 0.75);
  ctx.closePath();
  ctx.moveTo(e.radius * 0.5, -e.radius * 0.5);
  ctx.lineTo(e.radius * 0.75, -e.radius * 1.35);
  ctx.lineTo(e.radius * 0.1, -e.radius * 0.75);
  ctx.closePath();
  ctx.fill();

  if (hurt <= 0) {
    ctx.fillStyle = '#ff5a5a';
    ctx.beginPath();
    ctx.arc(-e.radius * 0.22, -e.radius * 0.18, e.radius * 0.14, 0, Math.PI * 2);
    ctx.arc(e.radius * 0.22, -e.radius * 0.18, e.radius * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Enemy Mage: floating robed caster with an orbiting orb.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawEnemyMage(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const time2 = time + e.age;
  const hover = Math.sin(time2 * 2.6) * 3.2;
  const robe = hurt > 0 ? mix('#6b2f6b', '#ffffff', hurt) : '#6b2f6b';

  shadow(ctx, e.x, e.y + e.radius * 0.9, e.radius * 0.8, 0.75);

  ctx.save();
  ctx.translate(e.x, e.y - hover);

  // Tattered robe.
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-6, -22);
  ctx.lineTo(6, -22);
  ctx.lineTo(15, 6);
  ctx.lineTo(11, 3);
  ctx.lineTo(7, 8);
  ctx.lineTo(3, 3);
  ctx.lineTo(-2, 8);
  ctx.lineTo(-7, 3);
  ctx.lineTo(-11, 8);
  ctx.lineTo(-15, 6);
  ctx.closePath();
  ctx.fill();

  // Hood.
  ctx.fillStyle = tint(robe, 0.7);
  ctx.beginPath();
  ctx.moveTo(-8, -20);
  ctx.lineTo(0, -34);
  ctx.lineTo(8, -20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(6,4,12,0.9)';
  ctx.beginPath();
  ctx.arc(0, -24, 4.6, 0, Math.PI * 2);
  ctx.fill();

  if (hurt <= 0) {
    ctx.fillStyle = 'rgba(220,120,255,0.95)';
    ctx.beginPath();
    ctx.arc(-1.8, -24.5, 1.4, 0, Math.PI * 2);
    ctx.arc(1.8, -24.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Orbiting cast orb.
  const orbAngle = time2 * 2.2;
  const ox = e.x + Math.cos(orbAngle) * 22;
  const oy = e.y - 14 + Math.sin(orbAngle) * 8;
  glow(ctx, ox, oy, 14, '#c05cff', 0.6);
  ctx.fillStyle = '#e2b0ff';
  ctx.beginPath();
  ctx.arc(ox, oy, 3.4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Shieldbearer: tower shield on the facing side, armoured body behind it.
 * The shield visibly dims and cracks as its stamina drains, so the player
 * can read when it is about to break (§11.7 counterplay).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawShieldbearer(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const time2 = time + e.age;
  drawHumanoid(ctx, {
    x: e.x, y: e.y, scale: 1.02, facing: e.facing,
    time: time2, moveAmount: 0.5, hurt,
    body: '#4c5468', trim: '#8a6a3a', skin: '#b9a284',
    shoulderWidth: 16, bodyHeight: 22, legLength: 12, headRadius: 6.2,
  });

  const broken = (e.shieldBreakTimer ?? 0) > 0;
  const stamina = e.shieldMaxStamina > 0
    ? Math.max(0, Math.min(1, (e.shieldStamina ?? 0) / e.shieldMaxStamina))
    : 1;

  // A broken shield is gone entirely, which is the visual reward for
  // sustained pressure.
  if (broken) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(time * 18) * 0.2;
    ctx.strokeStyle = '#ff7a5c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y - 16, e.radius + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Tower shield drawn over the rig, in the aim direction.
  ctx.save();
  ctx.translate(e.x, e.y - 16);
  ctx.rotate(e.facing);
  const grad = ctx.createLinearGradient(0, -14, 0, 14);
  const wear = 0.45 + stamina * 0.55;
  grad.addColorStop(0, hurt > 0 ? '#ffffff' : mix('#7c8398', '#3a4050', 1 - wear));
  grad.addColorStop(0.5, hurt > 0 ? '#dddddd' : mix('#565d70', '#2a2f3c', 1 - wear));
  grad.addColorStop(1, hurt > 0 ? '#aaaaaa' : mix('#3a4050', '#1c2028', 1 - wear));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(11, -16);
  ctx.lineTo(17, -13);
  ctx.lineTo(17, 13);
  ctx.lineTo(11, 16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9a7a3a';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Cracks appear as stamina falls, warning that the shield is failing.
  if (stamina < 0.75) {
    const crackAlpha = (1 - stamina) * 0.9;
    ctx.strokeStyle = `rgba(255,120,90,${crackAlpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(13, -11);
    ctx.lineTo(15.5, -3);
    ctx.lineTo(12.5, 3);
    ctx.lineTo(15, 11);
    ctx.stroke();
    if (stamina < 0.4) {
      ctx.beginPath();
      ctx.moveTo(16.5, -12);
      ctx.lineTo(14, -5);
      ctx.lineTo(16.5, 4);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Stamina bar above the shield, only while it is under pressure.
  if (stamina < 0.99) {
    const w = 26;
    const x = e.x - w / 2;
    const y = e.y - e.radius - 22;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, 4);
    ctx.fillStyle = stamina > 0.5 ? '#9fd8ff' : '#ff9a5c';
    ctx.fillRect(x, y, w * stamina, 2);
    ctx.restore();
  }
}

/**
 * Assassin: hooded, cloaked, mostly transparent while stealthed.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawAssassin(ctx, e, time) {
  const stealth = e.stealthAlpha ?? 1;
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const time2 = time + e.age;

  drawHumanoid(ctx, {
    x: e.x, y: e.y, scale: 0.95, facing: e.facing,
    time: time2, moveAmount: 0.9, hurt,
    body: '#23202e', trim: '#8a1f3d', skin: '#2c2740',
    shoulderWidth: 11, bodyHeight: 20, legLength: 13, headRadius: 5.6,
    alpha: 0.25 + stealth * 0.75,
  });

  if (stealth < 1) {
    // Distortion ring hints at the assassin while cloaked (design doc §11.8).
    ctx.save();
    ctx.globalAlpha = (1 - stealth) * 0.5;
    ctx.strokeStyle = 'rgba(170,60,110,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y - 16, e.radius + 6 + Math.sin(time2 * 7) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Berserker: bare-chested brute with war paint; glows as HP drops.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawBerserker(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const time2 = time + e.age;
  // Enrage visually tracks the §11.9 low-HP buff.
  const rage = 1 - Math.min(1, e.hp / Math.max(1, e.maxHp));

  drawHumanoid(ctx, {
    x: e.x, y: e.y, scale: 1.05, facing: e.facing,
    time: time2, moveAmount: 0.75, hurt,
    body: '#8c5a44', trim: '#c0392b', skin: '#d9a074',
    shoulderWidth: 17, bodyHeight: 23, legLength: 12, headRadius: 6.6,
  });

  if (rage > 0.01) {
    glow(ctx, e.x, e.y - 18, 34 + rage * 22, '#ff4b2b', rage * (0.28 + Math.sin(time2 * 8) * 0.08));
  }
}

/**
 * Necromancer: skeletal caster in violet robes with a skull-topped staff.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} e
 * @param {number} time
 */
export function drawNecromancer(ctx, e, time) {
  const hurt = e.hurtFlash > 0 ? 0.6 : 0;
  const time2 = time + e.age;
  const hover = Math.sin(time2 * 2.2) * 2.5;
  const robe = hurt > 0 ? mix('#2f3a55', '#ffffff', hurt) : '#2f3a55';

  shadow(ctx, e.x, e.y + e.radius * 0.9, e.radius * 0.8, 0.8);

  ctx.save();
  ctx.translate(e.x, e.y - hover);

  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-7, -22);
  ctx.lineTo(7, -22);
  ctx.lineTo(16, 8);
  ctx.lineTo(-16, 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = tint(robe, 0.72);
  ctx.beginPath();
  ctx.moveTo(-9, -20);
  ctx.lineTo(0, -36);
  ctx.lineTo(9, -20);
  ctx.closePath();
  ctx.fill();

  // Skull face.
  ctx.fillStyle = '#ded8c4';
  ctx.beginPath();
  ctx.arc(0, -26, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a12';
  ctx.beginPath();
  ctx.arc(-2, -27, 1.7, 0, Math.PI * 2);
  ctx.arc(2, -27, 1.7, 0, Math.PI * 2);
  ctx.fill();
  if (hurt <= 0) {
    ctx.fillStyle = 'rgba(120,255,180,0.95)';
    ctx.beginPath();
    ctx.arc(-2, -27, 0.9, 0, Math.PI * 2);
    ctx.arc(2, -27, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // Staff with a glowing green focus.
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(6, 6);
  ctx.lineTo(12, -26);
  ctx.stroke();
  ctx.restore();

  const fx = e.x + 12;
  const fy = e.y - 26 - hover;
  glow(ctx, fx, fy, 16, '#6bff9e', 0.55 + Math.sin(time2 * 5) * 0.15);
}
