/**
 * @fileoverview Weapon rendering — held in the hand, aimed, with recoil.
 *
 * SRP: draw the currently equipped weapon relative to its wielder.
 * Design doc §24: the weapon must follow the hand, rotate toward the
 * cursor, and show recoil and muzzle flash for firearms.
 */

import { glow, hexAlpha, polygonPath, jaggedLine } from './drawUtils.js';
import { bladeAngle, swingPose } from './meleePose.js';

/**
 * Draw the weapon the player is holding.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 */
export function drawPlayerWeapon(ctx, player, time) {
  const angle = player.visualFacing;
  const recoil = player.attack.recoil;
  const swinging = player.isSwinging;
  // Melee uses the same facing snapshot as the slash VFX. Ranged weapons keep
  // the smoothed visual facing, so their recoil remains independent.
  const meleeAngle = player.weapon.kind === 'melee'
    ? (swinging ? player.swingAngle : angle) + bladeAngle(player, player.weapon.arc)
    : angle;

  ctx.save();
  // Hand anchor: slightly forward and at chest height.
  ctx.translate(player.x, player.y - 14);
  ctx.rotate(meleeAngle);

  const behind = Math.cos(angle) < 0;
  // Weapons pointing left must be mirrored so they are never upside-down.
  if (behind) ctx.scale(1, -1);

  const kind = player.weapon.kind;
  if (kind === 'melee') {
    drawMeleeWeapon(ctx, player, time, recoil);
  } else if (kind === 'gun') {
    drawGun(ctx, player, time, recoil);
  } else {
    drawStaff(ctx, player, time);
  }

  ctx.restore();

  if (player.attack.muzzleFlash > 0) {
    drawMuzzleFlash(ctx, player, angle);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 * @param {number} recoil
 */
function drawMeleeWeapon(ctx, player, time, recoil) {
  const id = player.weaponId;
  // Every model shares the same hand anchor, recoil and meleePose angle. Only
  // the silhouette changes, so visuals never change range, arc or hit timing.
  const pose = swingPose(player);
  const swingOffset = pose.progress === null ? 0 : pose.extension * 1.4;

  ctx.save();
  ctx.translate(-recoil * 6 + swingOffset * 6, 0);
  if (pose.progress === null) ctx.rotate(Math.sin(time * 3.2) * 0.045);

  const steelGrad = ctx.createLinearGradient(18, 0, 68, 0);
  steelGrad.addColorStop(0, '#4f5668');
  steelGrad.addColorStop(0.42, '#e1e5ed');
  steelGrad.addColorStop(0.72, '#a2a9b8');
  steelGrad.addColorStop(1, '#596071');

  if (id === 'battle_axe') {
    // Battle axe: asymmetric bearded head, leather-wrapped haft and a bright
    // cutting edge. Its low beard and broad crescent read differently from
    // both the narrow starter sword and the blocky hammer.
    ctx.fillStyle = '#4a2f1d';
    ctx.fillRect(3, -2.8, 49, 5.6);
    ctx.strokeStyle = '#a36b3d';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(10 + i * 7, -3);
      ctx.lineTo(13 + i * 7, 3);
      ctx.stroke();
    }
    ctx.fillStyle = steelGrad;
    ctx.beginPath();
    ctx.moveTo(45, -3);
    ctx.quadraticCurveTo(52, -22, 68, -18);
    ctx.quadraticCurveTo(73, -4, 67, 5);
    ctx.quadraticCurveTo(63, 13, 52, 10);
    ctx.lineTo(48, 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f5f7fb';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(52, -19);
    ctx.quadraticCurveTo(64, -18, 68, -12);
    ctx.quadraticCurveTo(71, -7, 68, -2);
    ctx.stroke();
    ctx.fillStyle = '#8f6a42';
    ctx.fillRect(43, -4.5, 5, 9);
  } else if (id === 'war_hammer') {
    // War hammer: reinforced two-handed shaft, faceted maul head, rear spike
    // and a warm rune. The large vertical mass is readable at a glance.
    ctx.fillStyle = '#382417';
    ctx.fillRect(2, -3.5, 48, 7);
    ctx.fillStyle = '#8f6a42';
    ctx.fillRect(12, -4, 3, 8);
    ctx.fillRect(31, -4, 3, 8);
    const hammerGrad = ctx.createLinearGradient(46, -16, 46, 16);
    hammerGrad.addColorStop(0, '#b9c1ce');
    hammerGrad.addColorStop(0.48, '#687082');
    hammerGrad.addColorStop(1, '#343b4b');
    ctx.fillStyle = hammerGrad;
    ctx.beginPath();
    ctx.moveTo(43, -15);
    ctx.lineTo(66, -12);
    ctx.lineTo(70, -7);
    ctx.lineTo(70, 7);
    ctx.lineTo(66, 12);
    ctx.lineTo(43, 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d9dee7';
    ctx.fillRect(65, -9, 7, 18);
    ctx.fillStyle = '#4b5364';
    ctx.beginPath();
    ctx.moveTo(43, -12); ctx.lineTo(34, -17); ctx.lineTo(43, -5); ctx.closePath();
    ctx.moveTo(43, 12); ctx.lineTo(34, 17); ctx.lineTo(43, 5); ctx.closePath();
    ctx.fill();
    const rune = 0.65 + Math.sin(time * 5) * 0.25;
    glow(ctx, 54, 0, 13, '#ff9c3a', rune * 0.45);
    ctx.strokeStyle = hexAlpha('#ffd166', rune);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(50, -4); ctx.lineTo(58, 4); ctx.moveTo(58, -4); ctx.lineTo(50, 4);
    ctx.stroke();
  } else if (id === 'bloodthirster') {
    // Bloodthirster: a separate cursed greatsword silhouette, not a red sword
    // recolour. The hooked guard, dark fuller and pulsing heart mark its tier.
    ctx.fillStyle = '#21161b';
    ctx.fillRect(-10, -3.2, 22, 6.4);
    ctx.strokeStyle = '#8f3040';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-8 + i * 4, -3);
      ctx.lineTo(-5 + i * 4, 3);
      ctx.stroke();
    }
    ctx.fillStyle = '#512633';
    ctx.beginPath();
    ctx.moveTo(9, -3);
    ctx.quadraticCurveTo(13, -13, 18, -9);
    ctx.lineTo(14, -1);
    ctx.quadraticCurveTo(18, 9, 13, 13);
    ctx.lineTo(9, 3);
    ctx.closePath();
    ctx.fill();
    const darkSteel = ctx.createLinearGradient(16, 0, 78, 0);
    darkSteel.addColorStop(0, '#6a3945');
    darkSteel.addColorStop(0.35, '#322431');
    darkSteel.addColorStop(1, '#130f19');
    ctx.fillStyle = darkSteel;
    ctx.beginPath();
    ctx.moveTo(15, -6); ctx.lineTo(69, -4); ctx.lineTo(80, 0);
    ctx.lineTo(69, 4); ctx.lineTo(15, 6); ctx.closePath();
    ctx.fill();
    const pulse = 0.65 + Math.sin(time * 8) * 0.25;
    glow(ctx, 42, 0, 17, '#e5224d', pulse * 0.55);
    ctx.fillStyle = '#9d1738';
    ctx.beginPath();
    ctx.moveTo(42, -5); ctx.lineTo(48, 0); ctx.lineTo(42, 6); ctx.lineTo(36, 0); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexAlpha('#ff5570', pulse);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(19, -3); ctx.quadraticCurveTo(31, 2, 42, -1);
    ctx.quadraticCurveTo(55, -4, 72, 0);
    ctx.moveTo(19, 3); ctx.quadraticCurveTo(31, -2, 42, 1);
    ctx.quadraticCurveTo(55, 4, 72, 0);
    ctx.stroke();
  } else {
    // Sword: disciplined knightly longsword with a strong crossguard, fuller
    // and tapered point. The clean horizontal silhouette is the starter model.
    ctx.fillStyle = '#432b1d';
    ctx.fillRect(-8, -2.7, 18, 5.4);
    ctx.fillStyle = '#9c7b42';
    ctx.fillRect(8, -8, 5, 16);
    ctx.fillStyle = '#d1b36a';
    ctx.fillRect(6, -6.5, 9, 2);
    ctx.fillRect(6, 4.5, 9, 2);
    ctx.fillStyle = steelGrad;
    ctx.beginPath();
    ctx.moveTo(13, -4.8); ctx.lineTo(63, -3); ctx.lineTo(74, 0);
    ctx.lineTo(63, 3); ctx.lineTo(13, 4.8); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(66, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.beginPath(); ctx.moveTo(63, -3); ctx.lineTo(74, 0); ctx.lineTo(63, 3); ctx.stroke();
  }

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 * @param {number} recoil
 */
function drawGun(ctx, player, time, recoil) {
  const id = player.weaponId;
  const kick = recoil * 7;

  ctx.save();
  ctx.translate(-kick, 0);
  ctx.rotate(Math.sin(time * 2.6) * 0.03);

  const metal = ctx.createLinearGradient(0, -6, 0, 6);
  metal.addColorStop(0, '#6e7482');
  metal.addColorStop(0.5, '#3d4250');
  metal.addColorStop(1, '#22262f');

  if (id === 'shotgun') {
    ctx.fillStyle = '#4a3524';
    ctx.fillRect(-10, -3, 20, 7);                 // stock
    ctx.fillStyle = metal;
    ctx.fillRect(8, -4, 34, 8);                   // receiver
    ctx.fillStyle = '#5a6070';
    ctx.fillRect(40, -3.4, 26, 6.8);              // barrel
    ctx.fillStyle = '#2f333d';
    ctx.fillRect(40, 2.4, 20, 3.4);               // pump
  } else if (id === 'sniper_rifle') {
    ctx.fillStyle = '#3f2f20';
    ctx.fillRect(-14, -3, 22, 7);
    ctx.fillStyle = metal;
    ctx.fillRect(6, -3.6, 32, 7.2);
    ctx.fillStyle = '#5a6070';
    ctx.fillRect(36, -2.4, 44, 4.8);              // long barrel
    // Scope.
    ctx.fillStyle = '#20242c';
    ctx.fillRect(14, -12, 24, 7);
    ctx.fillStyle = hexAlpha('#7fd8ff', 0.9);
    ctx.beginPath();
    ctx.arc(38, -8.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'hellstorm') {
    // Legendary minigun: multiple rotating barrels.
    const spin = time * 14;
    ctx.fillStyle = metal;
    ctx.fillRect(-8, -6, 24, 12);
    ctx.fillStyle = '#4a4f5c';
    ctx.fillRect(16, -7, 30, 14);
    for (let i = 0; i < 4; i++) {
      const off = Math.sin(spin + (i / 4) * Math.PI * 2) * 4.2;
      ctx.fillStyle = i % 2 === 0 ? '#7a8090' : '#565c6a';
      ctx.fillRect(44, off - 2.2, 18, 4.4);
    }
    glow(ctx, 60, 0, 22, '#ff7a2b', 0.4 + Math.sin(time * 12) * 0.14);
  } else {
    // Pistol / assault rifle.
    const rifle = id === 'assault_rifle';
    ctx.fillStyle = '#2f333d';
    ctx.fillRect(-4, 0, 10, 14);                  // grip
    ctx.fillStyle = metal;
    ctx.fillRect(-6, -5, rifle ? 34 : 24, 10);
    ctx.fillStyle = '#5a6070';
    ctx.fillRect(rifle ? 26 : 16, -2.6, rifle ? 24 : 15, 5.2);
    if (rifle) {
      ctx.fillStyle = '#2a2e37';
      ctx.fillRect(2, 3, 8, 12);                  // magazine
    }
  }

  ctx.restore();
}

/**
 * The four staffs.
 *
 * Each staff is a different weapon, so each one is a different *silhouette*:
 * a brazier on a wooden shaft, a splintered crystal cluster, a forked rod, and
 * a shard hanging in a counter-rotating halo. The shaft and the sway are
 * shared — only the head changes — but the head is what the player actually
 * recognises across a dark room.
 *
 * Every head also has to say which of the two firing modes is live. `charge`
 * is the beam: at 0 the head is closed and idle, at 1 it is open and throwing
 * light, so a player watching their own character can tell bolts from beam
 * without reading the HUD.
 *
 * @typedef {object} StaffHead
 * @property {string} color
 * @property {string} shaftTop
 * @property {string} shaftBottom
 * @property {(ctx: CanvasRenderingContext2D, time: number, charge: number, heat: number) => void} head
 */

/** @type {Record<string, StaffHead>} */
const STAFF_HEADS = {
  fire_staff: {
    color: '#ff7a2b',
    shaftTop: '#6b5636',
    shaftBottom: '#33291a',
    head(ctx, time, charge, heat) {
      const cx = 58;
      // Brazier: a shallow bowl clamped to the tip.
      ctx.fillStyle = '#3a2b1d';
      ctx.beginPath();
      ctx.moveTo(cx - 7, -5);
      ctx.lineTo(cx + 7, -5);
      ctx.lineTo(cx + 4, 5);
      ctx.lineTo(cx - 4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6b5636';
      ctx.fillRect(cx - 9, -8, 18, 3);

      // Three tongues of flame; they lean and swell while the beam is held.
      const flicker = time * 6;
      const size = 10 + charge * 8;
      for (let i = -1; i <= 1; i++) {
        const lean = Math.sin(flicker + i * 1.7) * 2.4;
        ctx.fillStyle = i === 0 ? '#ffd166' : '#ff7a2b';
        ctx.beginPath();
        ctx.moveTo(cx + i * 3 - 2, -6);
        ctx.lineTo(cx + i * 5 + lean, -6 - size * (1 - Math.abs(i) * 0.28));
        ctx.lineTo(cx + i * 3 + 2, -6);
        ctx.closePath();
        ctx.fill();
      }
      glow(ctx, cx, -8, 22 + charge * 14, '#ff7a2b', 0.5 + charge * 0.35);
      // Near the lock-out the bowl glows white, which is the only warning the
      // player gets before the staff refuses to fire.
      if (heat > 0.55) glow(ctx, cx, -8, 15, '#ffe14d', (heat - 0.55) * 2.2);
    },
  },

  ice_staff: {
    color: '#7fd8ff',
    shaftTop: '#8fa3b8',
    shaftBottom: '#3d4a59',
    head(ctx, time, charge) {
      const cx = 58;
      // A cluster of shards rather than one crystal: the staff reads as
      // splintered ice even in silhouette.
      const spin = time * (0.5 + charge * 2.4);
      const shards = [
        { r: 12, sides: 4, rot: spin, color: '#d8f4ff' },
        { r: 9, sides: 3, rot: -spin * 1.4 + 0.6, offset: -7 },
        { r: 7, sides: 3, rot: -spin * 1.1 + 2.2, offset: 7 },
      ];
      for (const s of shards) {
        ctx.fillStyle = s.color;
        polygonPath(ctx, cx + (s.offset ?? 0) * 0.5, (s.offset ?? 0) * 0.55, s.r, s.sides, s.rot);
        ctx.fill();
      }
      ctx.fillStyle = hexAlpha('#ffffff', 0.75 + charge * 0.25);
      polygonPath(ctx, cx, 0, 4 + charge * 2, 3, spin * 1.8);
      ctx.fill();
      glow(ctx, cx, 0, 24 + charge * 12, '#7fd8ff', 0.5 + charge * 0.35);
    },
  },

  lightning_staff: {
    color: '#ffe14d',
    shaftTop: '#7b8496',
    shaftBottom: '#2f3542',
    head(ctx, time, charge) {
      const cx = 58;
      // A forked rod: two prongs with the charge held between them.
      ctx.strokeStyle = '#9aa4b8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 7, 0);
      ctx.lineTo(cx + 7, -10);
      ctx.moveTo(cx - 7, 0);
      ctx.lineTo(cx + 7, 10);
      ctx.stroke();

      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.arc(cx, 0, 4.5 + charge * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Arcs crackle between the prongs only while the beam is live; the
      // jitter is reseeded every frame, which is what makes it crackle rather
      // than wave.
      if (charge > 0.01) {
        ctx.strokeStyle = hexAlpha('#fff6c0', 0.35 + charge * 0.6);
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          jaggedLine(ctx, cx - 7, 0, cx + 7, (i - 1) * 8, 4, 3.5, Math.random);
        }
      }
      glow(ctx, cx, 0, 20 + charge * 16, '#ffe14d', 0.45 + charge * 0.4);
    },
  },

  staff_of_the_void: {
    color: '#c05cff',
    shaftTop: '#4a3b5c',
    shaftBottom: '#1c1424',
    head(ctx, time, charge) {
      const cx = 58;
      const spin = time * (1.4 + charge * 3.2);
      // A hole rather than an object: dark core, bright rim.
      ctx.fillStyle = '#120a1a';
      polygonPath(ctx, cx, 0, 9 + charge * 2.5, 6, -spin * 0.6);
      ctx.fill();

      ctx.strokeStyle = hexAlpha('#c05cff', 0.65);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, 0, 13 + charge * 4, spin, spin + Math.PI * 1.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, 0, 17 + charge * 4, -spin * 0.7, -spin * 0.7 + Math.PI * 0.8);
      ctx.stroke();

      glow(ctx, cx, 0, 30 + charge * 16, '#c05cff', 0.5 + charge * 0.4);
    },
  },
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 */
function drawStaff(ctx, player, time) {
  const def = STAFF_HEADS[player.weaponId] ?? STAFF_HEADS.fire_staff;
  const beam = player.beam;
  // 0 while idle, rising to 1 while the beam is held: the head opens with it.
  const charge = beam && beam.firing ? Math.min(1, 0.35 + beam.ramp * 0.9) : 0;
  const heat = beam ? beam.heat : 0;

  ctx.save();
  ctx.rotate(Math.sin(time * 2.4) * 0.05);

  // One gradient for all four: the shaft material differs, the shape does not.
  const shaft = ctx.createLinearGradient(0, -3, 0, 3);
  shaft.addColorStop(0, def.shaftTop);
  shaft.addColorStop(1, def.shaftBottom);
  ctx.fillStyle = shaft;
  ctx.fillRect(-10, -2.6, 62, 5.2);

  def.head(ctx, time, charge, heat);

  ctx.restore();
}

/**
 * Muzzle flash and ejected sparks (design doc §25).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} angle
 */
function drawMuzzleFlash(ctx, player, angle) {
  const t = player.attack.muzzleFlash / 0.07;
  const dist = player.weapon.kind === 'melee' ? 0 : 46;
  const mx = player.x + Math.cos(angle) * dist;
  const my = player.y - 14 + Math.sin(angle) * dist;

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(angle);
  ctx.globalAlpha = Math.min(1, t);

  const size = 15 * (0.6 + t * 0.7);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  grad.addColorStop(0, 'rgba(255,255,235,0.95)');
  grad.addColorStop(0.3, 'rgba(255,200,90,0.75)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();

  // Star-shaped flash spikes.
  ctx.fillStyle = 'rgba(255,240,190,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, -3.2); ctx.lineTo(size * 1.5, 0); ctx.lineTo(0, 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(3.4, 0); ctx.lineTo(0, 8); ctx.lineTo(-3.4, 0);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * The melee slash arc drawn at the player's position (design doc §25).
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 */
export function drawMeleeSlash(ctx, player) {
  if (!player.isSwinging || player.attack.swingTotal <= 0) return;

  const pose = swingPose(player);
  const progress = pose.progress ?? 0;
  const arc = player.weapon.arc ?? 1.4;
  const range = player.weapon.range;
  // The blade sweeps from one edge of the arc to the other.
  const sweepFrom = player.swingAngle - arc / 2;
  const sweepTo = player.swingAngle + arc / 2;
  // The visible slash uses the exact blade angle used by the weapon mesh.
  // During recovery the blade eases back to aim; deriving the head from the
  // same helper prevents the light trail from hanging at the old impact angle.
  const head = player.swingAngle + bladeAngle(player, arc);
  const tail = head - (sweepTo - sweepFrom) * 0.38;
  const fade = 1 - progress;
  const legendary = player.weapon.legendary === true;
  const color = legendary ? '#ff3355' : '#dff2ff';

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Trailing blade arc.
  const grad = ctx.createRadialGradient(player.x, player.y - 10, range * 0.25, player.x, player.y - 10, range);
  grad.addColorStop(0, hexAlpha(color, 0));
  grad.addColorStop(0.6, hexAlpha(color, 0.22 * fade));
  grad.addColorStop(1, hexAlpha(color, 0.55 * fade));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(player.x, player.y - 10);
  ctx.arc(player.x, player.y - 10, range, tail, head);
  ctx.closePath();
  ctx.fill();

  // Bright leading edge.
  ctx.strokeStyle = hexAlpha(color, 0.9 * fade);
  ctx.lineWidth = 3.4 * (0.4 + fade);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(player.x, player.y - 10, range * 0.94, tail, head);
  ctx.stroke();

  ctx.restore();
}
