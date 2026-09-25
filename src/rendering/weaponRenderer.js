/**
 * @fileoverview Weapon rendering — held in the hand, aimed, with recoil.
 *
 * SRP: draw the currently equipped weapon relative to its wielder.
 * Design doc §24: the weapon must follow the hand, rotate toward the
 * cursor, and show recoil and muzzle flash for firearms.
 */

import { glow, hexAlpha, polygonPath } from './drawUtils.js';
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

  switch (id) {
    case 'battle_axe':
      drawBattleAxe(ctx, time);
      break;
    case 'war_hammer':
      drawWarHammer(ctx, time);
      break;
    case 'bloodthirster':
      drawBloodthirster(ctx, time);
      break;
    case 'sword':
    default:
      drawSword(ctx, time);
      break;
  }

  ctx.restore();
}

/**
 * Sword: knightly arming sword with polished wheel pommel, textured grip with wire binding,
 * arched quillons with brass finials, and a double-edged tapered steel blade with central fuller.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawSword(ctx, time) {
  // Wheel pommel (steel with brass center rivet)
  ctx.fillStyle = '#3c4250';
  ctx.beginPath();
  ctx.arc(-10.5, 0, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7c8699';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  ctx.fillStyle = '#cca43b';
  ctx.beginPath();
  ctx.arc(-10.5, 0, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Contoured grip (rich dark leather)
  ctx.fillStyle = '#261510';
  ctx.beginPath();
  ctx.moveTo(-6.5, -2.4);
  ctx.lineTo(6.5, -2.2);
  ctx.lineTo(6.5, 2.2);
  ctx.lineTo(-6.5, 2.4);
  ctx.closePath();
  ctx.fill();

  // Silver wire grip wrap
  ctx.strokeStyle = '#8d95a5';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-4 + i * 2.8, -2.3);
    ctx.lineTo(-2 + i * 2.8, 2.3);
    ctx.stroke();
  }

  // Grip collar (brass ferrule)
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(5.2, -2.8, 2.2, 5.6);

  // Crossguard (sculpted steel with arched quillons and brass finials)
  ctx.fillStyle = '#424856';
  ctx.beginPath();
  ctx.moveTo(7.4, -2.5);
  ctx.quadraticCurveTo(8.5, -9, 7.5, -13);
  ctx.lineTo(11, -12);
  ctx.quadraticCurveTo(12, -7, 12, -2);
  // Center langet / ecusson pointing down the blade
  ctx.lineTo(14.5, 0);
  ctx.lineTo(12, 2);
  ctx.quadraticCurveTo(12, 7, 11, 12);
  ctx.lineTo(7.5, 13);
  ctx.quadraticCurveTo(8.5, 9, 7.4, 2.5);
  ctx.closePath();
  ctx.fill();

  // Guard center ridge highlight
  ctx.strokeStyle = '#9ca6ba';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(9, -11.5);
  ctx.lineTo(13.5, 0);
  ctx.lineTo(9, 11.5);
  ctx.stroke();

  // Brass finials at quillon tips
  ctx.fillStyle = '#cca43b';
  ctx.beginPath();
  ctx.arc(9.2, -12.5, 1.8, 0, Math.PI * 2);
  ctx.arc(9.2, 12.5, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Blade Upper Bevel (facing ambient light)
  const topSteel = ctx.createLinearGradient(14, 0, 75, 0);
  topSteel.addColorStop(0, '#757e91');
  topSteel.addColorStop(0.35, '#eef3fb');
  topSteel.addColorStop(0.7, '#b4bece');
  topSteel.addColorStop(1, '#d8e0ed');

  ctx.fillStyle = topSteel;
  ctx.beginPath();
  ctx.moveTo(12.5, -4.5);
  ctx.lineTo(60, -2.6);
  ctx.lineTo(75, 0);
  ctx.lineTo(14, 0);
  ctx.closePath();
  ctx.fill();

  // Blade Lower Bevel (in core shadow)
  const btmSteel = ctx.createLinearGradient(14, 0, 75, 0);
  btmSteel.addColorStop(0, '#383e4d');
  btmSteel.addColorStop(0.4, '#768094');
  btmSteel.addColorStop(0.8, '#4a5364');
  btmSteel.addColorStop(1, '#667082');

  ctx.fillStyle = btmSteel;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(75, 0);
  ctx.lineTo(60, 2.6);
  ctx.lineTo(12.5, 4.5);
  ctx.closePath();
  ctx.fill();

  // Fuller (central blood groove)
  ctx.fillStyle = '#222631';
  ctx.beginPath();
  ctx.moveTo(14.5, -0.9);
  ctx.lineTo(52, -0.6);
  ctx.lineTo(52, 0.6);
  ctx.lineTo(14.5, 0.9);
  ctx.closePath();
  ctx.fill();

  // Fuller reflection highlight line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(15, 0.5);
  ctx.lineTo(51, 0.4);
  ctx.stroke();

  // Razor top cutting edge highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(13, -4.3);
  ctx.lineTo(60, -2.5);
  ctx.lineTo(75, 0);
  ctx.stroke();

  // Subtle tip gleam
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.beginPath();
  ctx.arc(73, 0, 1.2, 0, Math.PI * 2);
  ctx.fill();
  void time;
}

/**
 * Battle Axe: heavy Nordic crescent war axe crafted for top-down / isometric view.
 * Seasoned ash haft with leather grip wrap, steel pommel ring, and langet plates.
 * The axe head is rendered in bold 3/4 isometric perspective:
 * - Thick forged eye socket collar with top haft wedge and thrusting spear
 * - Rear armor-breaking hammer poll / heavy square block
 * - Massive sweeping crescent bearded blade (spanning y = -24 to +22)
 * - Illuminated top spine bevel showing forged blade thickness
 * - Wide ground cutting edge with razor-sharp tempered silver bevel
 * - Traditional Nordic fuller slot in the blade cheek
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
/**
 * Battle Axe: legendary double-bitted crescent Greataxe designed for 2D top-down view.
 * Seasoned ash wood haft with criss-cross leather binding, steel butt-cap and langets.
 * At the head:
 * - Central forged steel socket collar with brass reinforcement bands
 * - Lethal diamond thrusting spear point extending forward along the haft axis
 * - Two sweeping crescent blades (top & bottom) with deep concave beard cutouts
 * - Sharp inner and outer horns on each blade
 * - Wide ground silver-tempered bevels and gleaming white razor cutting edges
 * - Traditional Nordic fuller grooves in the blade cheeks
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawBattleAxe(ctx, time) {
  // 1. Ash wood haft with top-down isometric shading
  const wood = ctx.createLinearGradient(0, -2.8, 0, 2.8);
  wood.addColorStop(0, '#5a341b');
  wood.addColorStop(0.45, '#3d2010');
  wood.addColorStop(1, '#221108');
  ctx.fillStyle = wood;
  ctx.fillRect(-16, -2.5, 66, 5.0);

  // 2. Steel butt-cap with forged lanyard ring
  ctx.fillStyle = '#424856';
  ctx.fillRect(-17.5, -3.2, 3.5, 6.4);
  ctx.strokeStyle = '#8d98ab';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(-19.5, 0, 2.6, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Leather handgrip wrap with criss-cross golden-brown binding
  ctx.fillStyle = '#1e110a';
  ctx.fillRect(-3, -2.9, 20, 5.8);
  ctx.strokeStyle = '#a67243';
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-1 + i * 3.8, -2.9);
    ctx.lineTo(2 + i * 3.8, 2.9);
    ctx.moveTo(2 + i * 3.8, -2.9);
    ctx.lineTo(-1 + i * 3.8, 2.9);
    ctx.stroke();
  }

  // Brass ferrule rings on grip
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(-3.5, -3.3, 1.8, 6.6);
  ctx.fillRect(16.5, -3.3, 1.8, 6.6);

  // 4. Steel protective langet plates along the haft under the axe eye
  ctx.fillStyle = '#495060';
  ctx.fillRect(26, -3.0, 14, 6.0);
  ctx.strokeStyle = '#7c8699';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(26, -3.0, 14, 6.0);
  // Rivet studs
  ctx.fillStyle = '#cca43b';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(28 + i * 4.5, 0, 1.0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Central Thrusting Spearhead projecting forward through the socket
  ctx.fillStyle = '#6e7a8e';
  ctx.beginPath();
  ctx.moveTo(48, -2.8);
  ctx.lineTo(68, 0);
  ctx.lineTo(48, 2.8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#b0bdd0';
  ctx.beginPath();
  ctx.moveTo(48, -2.8);
  ctx.lineTo(68, 0);
  ctx.lineTo(48, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#e6edf8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(48, 0);
  ctx.lineTo(68, 0);
  ctx.stroke();

  // 6. Central Forged Eye Collar
  const collarGrad = ctx.createLinearGradient(39, -5.5, 49, 5.5);
  collarGrad.addColorStop(0, '#566072');
  collarGrad.addColorStop(0.5, '#39404f');
  collarGrad.addColorStop(1, '#20242e');
  ctx.fillStyle = collarGrad;
  ctx.fillRect(39, -5.5, 10, 11);
  ctx.strokeStyle = '#7c889d';
  ctx.lineWidth = 1.0;
  ctx.strokeRect(39, -5.5, 10, 11);
  // Brass center wedge plate
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(43, -3.5, 2.2, 7.0);

  // ============================================================
  // DOUBLE-BITTED CRESCENT BLADES (Top & Bottom Wings)
  // ============================================================

  // --- UPPER CRESCENT BLADE (y = -5.5 to -28) ---
  const upperBody = ctx.createLinearGradient(24, -28, 58, -5);
  upperBody.addColorStop(0, '#586377');
  upperBody.addColorStop(0.4, '#383e4d');
  upperBody.addColorStop(1, '#1e222b');

  ctx.fillStyle = upperBody;
  ctx.beginPath();
  // Narrow socket throat base
  ctx.moveTo(41, -5.5);
  // Deep concave beard cutout curving back and up to rear horn at (24, -19)
  ctx.quadraticCurveTo(34, -7, 24, -19);
  // Wide crescent cutting edge sweep from rear horn to forward horn at (58, -19)
  ctx.quadraticCurveTo(41, -29, 58, -19);
  // Concave forward throat curving back to socket at (47, -5.5)
  ctx.quadraticCurveTo(51, -8, 47, -5.5);
  ctx.closePath();
  ctx.fill();

  // Upper blade wide silver cutting bevel
  const upperBevel = ctx.createLinearGradient(24, -29, 58, -17);
  upperBevel.addColorStop(0, '#ffffff');
  upperBevel.addColorStop(0.35, '#dbe4f2');
  upperBevel.addColorStop(0.7, '#8e9ab0');
  upperBevel.addColorStop(1, '#566073');

  ctx.fillStyle = upperBevel;
  ctx.beginPath();
  // Outer crescent edge
  ctx.moveTo(24, -19);
  ctx.quadraticCurveTo(41, -29, 58, -19);
  // Inner bevel boundary (parallel, 5px inward)
  ctx.quadraticCurveTo(41, -23.5, 24, -19);
  ctx.closePath();
  ctx.fill();

  // Polished razor edge highlight
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(24, -19);
  ctx.quadraticCurveTo(41, -29, 58, -19);
  ctx.stroke();

  // Upper blade fuller slot
  ctx.fillStyle = '#14171f';
  ctx.beginPath();
  ctx.moveTo(35, -12);
  ctx.lineTo(42, -19);
  ctx.lineTo(46, -15);
  ctx.lineTo(41, -9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5a6477';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Gold Nordic inlay rune on blade cheek
  ctx.strokeStyle = '#cca43b';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(42, -18); ctx.lineTo(38, -13); ctx.lineTo(44, -13);
  ctx.stroke();

  // --- LOWER CRESCENT BLADE (y = +5.5 to +28) ---
  const lowerBody = ctx.createLinearGradient(24, 28, 58, 5);
  lowerBody.addColorStop(0, '#444d5e');
  lowerBody.addColorStop(0.4, '#282d38');
  lowerBody.addColorStop(1, '#161920');

  ctx.fillStyle = lowerBody;
  ctx.beginPath();
  // Narrow socket throat base
  ctx.moveTo(41, 5.5);
  // Deep concave beard cutout curving back and down to lower rear horn at (24, 19)
  ctx.quadraticCurveTo(34, 7, 24, 19);
  // Wide crescent cutting edge sweep from rear horn to forward horn at (58, 19)
  ctx.quadraticCurveTo(41, 29, 58, 19);
  // Concave forward throat curving back to socket at (47, 5.5)
  ctx.quadraticCurveTo(51, 8, 47, 5.5);
  ctx.closePath();
  ctx.fill();

  // Lower blade cutting bevel
  const lowerBevel = ctx.createLinearGradient(24, 29, 58, 17);
  lowerBevel.addColorStop(0, '#eef3fb');
  lowerBevel.addColorStop(0.35, '#c5d1e2');
  lowerBevel.addColorStop(0.7, '#788499');
  lowerBevel.addColorStop(1, '#424a5a');

  ctx.fillStyle = lowerBevel;
  ctx.beginPath();
  // Outer crescent edge
  ctx.moveTo(24, 19);
  ctx.quadraticCurveTo(41, 29, 58, 19);
  // Inner bevel boundary (parallel, 5px inward)
  ctx.quadraticCurveTo(41, 23.5, 24, 19);
  ctx.closePath();
  ctx.fill();

  // Polished razor edge highlight
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(24, 19);
  ctx.quadraticCurveTo(41, 29, 58, 19);
  ctx.stroke();

  // Lower blade fuller slot
  ctx.fillStyle = '#14171f';
  ctx.beginPath();
  ctx.moveTo(35, 12);
  ctx.lineTo(42, 19);
  ctx.lineTo(46, 15);
  ctx.lineTo(41, 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5a6477';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Gold Nordic inlay rune on blade cheek
  ctx.strokeStyle = '#cca43b';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(42, 18); ctx.lineTo(38, 13); ctx.lineTo(44, 13);
  ctx.stroke();

  void time;
}

/**
 * War Hammer: heavy Dwarven crushing War Maul designed for 2D top-down view.
 * Seasoned ironwood shaft with studded leather grip, pommel spike, and langets.
 * At the head:
 * - Central octagonal socket collar with bronze reinforcement rings
 * - Forward armor-piercing diamond crown spike
 * - Rear curved raven's beak pick (bec-de-corbin)
 * - Two faceted crushing hammer heads (top & bottom) with sculpted waists/necks
 * - Chamfered 45-degree beveled corners on striking blocks
 * - Heavy steel impact plates with cross-hatched waffle teeth
 * - Glowing molten titan rune pulsing with forge heat
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawWarHammer(ctx, time) {
  // 1. Heavy ironwood shaft with top-light shading
  const wood = ctx.createLinearGradient(0, -3.0, 0, 3.0);
  wood.addColorStop(0, '#583620');
  wood.addColorStop(0.4, '#382012');
  wood.addColorStop(1, '#1c0f08');
  ctx.fillStyle = wood;
  ctx.fillRect(-17, -2.6, 65, 5.2);

  // 2. Spiked octagonal pommel counterweight
  ctx.fillStyle = '#383e4d';
  ctx.beginPath();
  ctx.moveTo(-17, -4.5);
  ctx.lineTo(-21, -3.2);
  ctx.lineTo(-24, 0); // rear spike
  ctx.lineTo(-21, 3.2);
  ctx.lineTo(-17, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8590a6';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // 3. Leather grip wrap with wire binding
  ctx.fillStyle = '#1c100a';
  ctx.fillRect(-4, -3.0, 20, 6.0);
  ctx.strokeStyle = '#8a5830';
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-2 + i * 4, -3.0);
    ctx.lineTo(1 + i * 4, 3.0);
    ctx.stroke();
  }

  // Brass collars on grip
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(-5, -3.4, 2.2, 6.8);
  ctx.fillRect(15.5, -3.4, 2.2, 6.8);

  // 4. Steel langet reinforcement straps
  ctx.fillStyle = '#4c5364';
  ctx.fillRect(22, -3.2, 15, 6.4);
  ctx.strokeStyle = '#768299';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(22, -3.2, 15, 6.4);
  // Rivet studs
  ctx.fillStyle = '#cca43b';
  ctx.beginPath();
  ctx.arc(25, 0, 1.1, 0, Math.PI * 2);
  ctx.arc(33, 0, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // 5. Rear Raven's Beak (Curved armor-piercing pick)
  ctx.fillStyle = '#383f4e';
  ctx.beginPath();
  ctx.moveTo(37, -4.5);
  ctx.quadraticCurveTo(28, -7, 18, -8); // beak hook tip
  ctx.lineTo(18, -5.5);
  ctx.quadraticCurveTo(27, -2, 37, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9ca7bc';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(37, -4.5);
  ctx.quadraticCurveTo(28, -7, 18, -8);
  ctx.stroke();

  // 6. Forward Diamond Crown Spike (x = 48..64)
  ctx.fillStyle = '#6e7a8e';
  ctx.beginPath();
  ctx.moveTo(47, -3.0);
  ctx.lineTo(64, 0);
  ctx.lineTo(47, 3.0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b0bdd2';
  ctx.beginPath();
  ctx.moveTo(47, -3.0);
  ctx.lineTo(64, 0);
  ctx.lineTo(47, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e6edf8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(47, 0);
  ctx.lineTo(64, 0);
  ctx.stroke();

  // 7. Sculpted Necks (Waists between collar and crushing heads)
  // Upper neck (y = -5.5 to -10)
  ctx.fillStyle = '#262b36';
  ctx.fillRect(38, -10, 8, 5);
  ctx.strokeStyle = '#5a6477';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(38, -10, 8, 5);

  // Lower neck (y = 5.5 to 10)
  ctx.fillStyle = '#262b36';
  ctx.fillRect(38, 5, 8, 5);
  ctx.strokeStyle = '#5a6477';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(38, 5, 8, 5);

  // 8. UPPER FACETED CRUSHING HEAD (y = -10 to -22)
  const headGradTop = ctx.createLinearGradient(32, -22, 52, -10);
  headGradTop.addColorStop(0, '#8e99ae');
  headGradTop.addColorStop(0.5, '#5c667a');
  headGradTop.addColorStop(1, '#3a404f');

  ctx.fillStyle = headGradTop;
  ctx.beginPath();
  ctx.moveTo(36, -10);
  ctx.lineTo(32, -14);
  ctx.lineTo(32, -18);
  ctx.lineTo(36, -22); // top impact face left
  ctx.lineTo(48, -22); // top impact face right
  ctx.lineTo(52, -18);
  ctx.lineTo(52, -14);
  ctx.lineTo(48, -10);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#9ca6bb';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Corner reinforcement brass plates on upper head
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(33, -13.5, 2.5, 2.5);
  ctx.fillRect(48.5, -13.5, 2.5, 2.5);

  // Top impact striking plate (hardened steel waffle-pattern face plate)
  ctx.fillStyle = '#dbe5f5';
  ctx.fillRect(35, -23.5, 14, 2.0);
  // Impact waffle teeth
  ctx.fillStyle = '#3a404f';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(36.5 + i * 3.2, -23.5, 1.3, 2.0);
  }

  // 9. LOWER FACETED CRUSHING HEAD (y = 10 to 22)
  const headGradBtm = ctx.createLinearGradient(32, 10, 52, 22);
  headGradBtm.addColorStop(0, '#586275');
  headGradBtm.addColorStop(0.5, '#383e4c');
  headGradBtm.addColorStop(1, '#20242e');

  ctx.fillStyle = headGradBtm;
  ctx.beginPath();
  ctx.moveTo(36, 10);
  ctx.lineTo(32, 14);
  ctx.lineTo(32, 18);
  ctx.lineTo(36, 22); // bottom impact face left
  ctx.lineTo(48, 22); // bottom impact face right
  ctx.lineTo(52, 18);
  ctx.lineTo(52, 14);
  ctx.lineTo(48, 10);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#626d80';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Corner reinforcement brass plates on lower head
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(33, 11, 2.5, 2.5);
  ctx.fillRect(48.5, 11, 2.5, 2.5);

  // Bottom impact striking plate
  ctx.fillStyle = '#828fa3';
  ctx.fillRect(35, 21.5, 14, 2.0);
  // Impact waffle teeth
  ctx.fillStyle = '#20242e';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(36.5 + i * 3.2, 21.5, 1.3, 2.0);
  }

  // 10. Central Octagonal Collar Body (Ступица)
  const collarGrad = ctx.createLinearGradient(36, -5.5, 48, 5.5);
  collarGrad.addColorStop(0, '#667084');
  collarGrad.addColorStop(0.5, '#474f5e');
  collarGrad.addColorStop(1, '#282d38');
  ctx.fillStyle = collarGrad;
  ctx.beginPath();
  ctx.moveTo(38, -5.5);
  ctx.lineTo(46, -5.5);
  ctx.lineTo(48, -2.5);
  ctx.lineTo(48, 2.5);
  ctx.lineTo(46, 5.5);
  ctx.lineTo(38, 5.5);
  ctx.lineTo(36, 2.5);
  ctx.lineTo(36, -2.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#8d98ab';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Corner steel rivets
  ctx.fillStyle = '#b8c4d8';
  ctx.beginPath();
  ctx.arc(38, -3.5, 0.9, 0, Math.PI * 2);
  ctx.arc(46, -3.5, 0.9, 0, Math.PI * 2);
  ctx.arc(38, 3.5, 0.9, 0, Math.PI * 2);
  ctx.arc(46, 3.5, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // 11. Glowing Ancient Titan/Dwarven Rune
  const runePulse = 0.65 + Math.sin(time * 4.5) * 0.3;
  glow(ctx, 42, 0, 14, '#ff8a1e', runePulse * 0.65);

  ctx.strokeStyle = hexAlpha('#ffe570', runePulse);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  // Titan Runic Sigil: bold diamond with inner cross
  ctx.moveTo(42, -4);
  ctx.lineTo(46, 0);
  ctx.lineTo(42, 4);
  ctx.lineTo(38, 0);
  ctx.closePath();
  ctx.moveTo(42, -4); ctx.lineTo(42, 4);
  ctx.moveTo(38, 0); ctx.lineTo(46, 0);
  ctx.stroke();
}

/**
 * Bloodthirster: legendary demonic cursed greatsword.
 * Spiked skull/horned pommel, barbed winged demon guard with crimson highlights,
 * massive flamberge/serrated obsidian-damascus blade with parrying flukes,
 * beating demonic eye in the ricasso, and glowing liquid blood veins.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawBloodthirster(ctx, time) {
  const pulse = 0.65 + Math.sin(time * 6.5) * 0.3;

  // Horned demonic skull pommel
  ctx.fillStyle = '#180e15';
  ctx.beginPath();
  ctx.moveTo(-15, -4);
  ctx.lineTo(-20, -6.5);
  ctx.lineTo(-23, -2);
  ctx.lineTo(-21, 0);
  ctx.lineTo(-23, 2);
  ctx.lineTo(-20, 6.5);
  ctx.lineTo(-15, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#852035';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Glowing ruby eyes in skull pommel
  ctx.fillStyle = '#ff1a4a';
  ctx.beginPath();
  ctx.arc(-19, -2, 1.0, 0, Math.PI * 2);
  ctx.arc(-19, 2, 1.0, 0, Math.PI * 2);
  ctx.fill();

  // Long two-handed grip (blackened demonic leather with wire wrap)
  ctx.fillStyle = '#1a0d14';
  ctx.fillRect(-15, -2.8, 23, 5.6);
  ctx.strokeStyle = '#99223c';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(-13 + i * 3.5, -2.8);
    ctx.lineTo(-11 + i * 3.5, 2.8);
    ctx.stroke();
  }

  // Demonic Winged Crossguard (sharp forward-swept curved horns)
  ctx.fillStyle = '#26111b';
  ctx.beginPath();
  ctx.moveTo(8, -3);
  ctx.quadraticCurveTo(9, -12, 16, -16);
  ctx.lineTo(13.5, -12);
  ctx.quadraticCurveTo(11, -7, 13, -2);
  ctx.lineTo(16, 0); // center guard crest
  ctx.lineTo(13, 2);
  ctx.quadraticCurveTo(11, 7, 13.5, 12);
  ctx.lineTo(16, 16);
  ctx.quadraticCurveTo(9, 12, 8, 3);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = hexAlpha('#ff2a55', pulse * 0.8);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(16, -16); ctx.quadraticCurveTo(10, -8, 14, 0); ctx.quadraticCurveTo(10, 8, 16, 16);
  ctx.stroke();

  // Massive Obsidian Damascus Blade (reaches x = 94!)
  const demonSteel = ctx.createLinearGradient(16, -6, 94, 6);
  demonSteel.addColorStop(0, '#541c2a');
  demonSteel.addColorStop(0.35, '#2a1420');
  demonSteel.addColorStop(0.7, '#150910');
  demonSteel.addColorStop(1, '#3b121e');

  // Fluted ricasso with side parrying hooks (flukes)
  ctx.fillStyle = '#2a111c';
  ctx.beginPath();
  ctx.moveTo(14, -4);
  ctx.lineTo(24, -4.5);
  ctx.lineTo(27, -8.5); // upper parrying hook
  ctx.lineTo(28, -4.5);
  ctx.lineTo(28, 4.5);
  ctx.lineTo(27, 8.5); // lower parrying hook
  ctx.lineTo(24, 4.5);
  ctx.lineTo(14, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#732135';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Serrated demon blade body
  ctx.fillStyle = demonSteel;
  ctx.beginPath();
  ctx.moveTo(28, -4.8);
  // Serrated wave 1
  ctx.lineTo(38, -6.0); ctx.lineTo(44, -4.2);
  // Serrated wave 2
  ctx.lineTo(54, -5.5); ctx.lineTo(60, -3.8);
  // Serrated wave 3
  ctx.lineTo(70, -4.6); ctx.lineTo(76, -3.0);
  // Taper to needle demon point
  ctx.lineTo(84, -2.4);
  ctx.lineTo(94, 0); // Lethal tip at x = 94
  ctx.lineTo(84, 2.4);
  // Serrated lower wave 3
  ctx.lineTo(76, 3.0); ctx.lineTo(70, 4.6);
  // Serrated lower wave 2
  ctx.lineTo(60, 3.8); ctx.lineTo(54, 5.5);
  // Serrated lower wave 1
  ctx.lineTo(44, 4.2); ctx.lineTo(38, 6.0);
  ctx.lineTo(28, 4.8);
  ctx.closePath();
  ctx.fill();

  // Dark fuller groove with internal crimson glow
  ctx.fillStyle = '#10070c';
  ctx.beginPath();
  ctx.moveTo(28, -1.2);
  ctx.lineTo(78, -0.6);
  ctx.lineTo(78, 0.6);
  ctx.lineTo(28, 1.2);
  ctx.closePath();
  ctx.fill();

  // Pulsing crimson blade aura
  glow(ctx, 48, 0, 22, '#ff1144', pulse * 0.45);

  // Beating Demonic Eye / Blood Crystal in the ricasso
  glow(ctx, 21, 0, 14, '#ff0033', pulse * 0.7);
  ctx.fillStyle = '#ff1144';
  ctx.beginPath();
  ctx.ellipse(21, 0, 4.5, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Demonic slit pupil
  ctx.fillStyle = '#080004';
  ctx.beginPath();
  ctx.ellipse(21, 0, 1.0, 2.4 * pulse, 0, 0, Math.PI * 2);
  ctx.fill();

  // Liquid blood veins branching along the fuller toward the point
  ctx.strokeStyle = hexAlpha('#ff3866', 0.7 + pulse * 0.3);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(24, 0);
  ctx.lineTo(40, -1);
  ctx.lineTo(54, 0.8);
  ctx.lineTo(68, -0.6);
  ctx.lineTo(82, 0);
  ctx.stroke();

  // Razor cursed crimson serrated edges
  ctx.strokeStyle = hexAlpha('#ff2852', 0.85 * pulse);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(28, -4.8);
  ctx.lineTo(38, -6.0); ctx.lineTo(44, -4.2);
  ctx.lineTo(54, -5.5); ctx.lineTo(60, -3.8);
  ctx.lineTo(70, -4.6); ctx.lineTo(76, -3.0);
  ctx.lineTo(84, -2.4); ctx.lineTo(94, 0);
  ctx.lineTo(84, 2.4); ctx.lineTo(76, 3.0);
  ctx.lineTo(70, 4.6); ctx.lineTo(60, 3.8);
  ctx.lineTo(54, 5.5); ctx.lineTo(44, 4.2);
  ctx.lineTo(38, 6.0); ctx.lineTo(28, 4.8);
  ctx.stroke();
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

  switch (id) {
    case 'shotgun':
      drawShotgun(ctx, metal, time);
      break;
    case 'sniper_rifle':
      drawSniperRifle(ctx, metal, time);
      break;
    case 'hellstorm':
      drawHellstorm(ctx, metal, time);
      break;
    case 'assault_rifle':
      drawAssaultRifle(ctx, metal, time);
      break;
    case 'pistol':
    default:
      drawPistol(ctx, metal);
      break;
  }

  ctx.restore();
}

/**
 * Pistol: crisp, balanced tactical semi-automatic sidearm.
 * Ergonomic angled grip, trigger guard with curved trigger, contoured slide
 * with front chamfer and rear slide serrations, ejection port with brass case,
 * and low-profile combat sights.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasGradient} metal
 */
function drawPistol(ctx, metal) {
  // Angled grip frame
  ctx.fillStyle = '#1e2229';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-4.5, 11);
  ctx.lineTo(-1, 12.5);
  ctx.lineTo(3.5, 11);
  ctx.lineTo(3.5, 0);
  ctx.closePath();
  ctx.fill();

  // Textured grip panel insert
  ctx.fillStyle = '#14161b';
  ctx.beginPath();
  ctx.moveTo(-0.5, 2);
  ctx.lineTo(-3.8, 10);
  ctx.lineTo(-1.2, 11.2);
  ctx.lineTo(2.2, 10);
  ctx.lineTo(2.2, 2);
  ctx.closePath();
  ctx.fill();

  // Beavertail at the back of the frame
  ctx.fillStyle = '#2a2f38';
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.quadraticCurveTo(-7, -1, -6, 2);
  ctx.lineTo(-2, 2);
  ctx.closePath();
  ctx.fill();

  // Trigger guard
  ctx.strokeStyle = '#323742';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(3, 1.5);
  ctx.quadraticCurveTo(6.5, 3.5, 3.5, 7.5);
  ctx.lineTo(0.5, 6.5);
  ctx.stroke();

  // Trigger
  ctx.strokeStyle = '#8d95a5';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(2.2, 2.5);
  ctx.quadraticCurveTo(2.8, 4.5, 1.6, 5.5);
  ctx.stroke();

  // Slide body
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.moveTo(-6, -6);
  ctx.lineTo(17.5, -6);
  ctx.lineTo(20.5, -3);
  ctx.lineTo(20.5, -0.5);
  ctx.lineTo(-6, -0.5);
  ctx.closePath();
  ctx.fill();

  // Slide top highlight line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-5.5, -5.5);
  ctx.lineTo(17, -5.5);
  ctx.stroke();

  // Rear cocking serrations
  ctx.strokeStyle = '#181b22';
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-4 + i * 2, -5.2);
    ctx.lineTo(-4 + i * 2, -1);
    ctx.stroke();
  }

  // Ejection port with brass cartridge
  ctx.fillStyle = '#14161c';
  ctx.fillRect(4, -5.8, 6, 2.5);
  ctx.fillStyle = '#cca43b';
  ctx.fillRect(5.5, -5.2, 3.5, 1.6);

  // Barrel crown
  ctx.fillStyle = '#686f7d';
  ctx.fillRect(20.5, -4.5, 2.5, 3);
  ctx.fillStyle = '#111317';
  ctx.fillRect(22.2, -3.8, 1, 1.6);

  // Sights
  ctx.fillStyle = '#1a1c22';
  ctx.fillRect(-5.5, -7.5, 2, 1.8);
  ctx.fillRect(17.5, -7.5, 2, 1.8);
  ctx.fillStyle = '#55ff77';
  ctx.fillRect(18.2, -7.0, 1, 1);
}

/**
 * Shotgun: heavy pump-action combat trench gun.
 * Contoured walnut stock with rubber buttpad, milled steel receiver with red
 * shell in the ejection port, parallel barrel + full-length magazine tube with
 * dual-ring barrel clamp, ribbed pump forend, and brass bead sight.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasGradient} metal
 * @param {number} time
 */
function drawShotgun(ctx, metal, time) {
  // Contoured walnut stock
  ctx.fillStyle = '#462916';
  ctx.beginPath();
  ctx.moveTo(-3, 0.5);
  ctx.lineTo(-10, -1.8);
  ctx.lineTo(-21, -1.8);
  ctx.lineTo(-21, 6.5);
  ctx.quadraticCurveTo(-13, 6, -3, 3.2);
  ctx.closePath();
  ctx.fill();

  // Stock top grain highlight
  ctx.fillStyle = '#5c361e';
  ctx.beginPath();
  ctx.moveTo(-4, 0.5);
  ctx.lineTo(-10, -1.5);
  ctx.lineTo(-20, -1.5);
  ctx.lineTo(-20, 0.5);
  ctx.closePath();
  ctx.fill();

  // Rubber recoil pad
  ctx.fillStyle = '#18191d';
  ctx.fillRect(-23, -1.8, 2.2, 8.3);

  // Stock grip checkering accent
  ctx.strokeStyle = '#6e452a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-9, 0.2);
  ctx.lineTo(-6, 3.2);
  ctx.moveTo(-11, 1.2);
  ctx.lineTo(-8, 4.2);
  ctx.stroke();

  // Receiver
  ctx.fillStyle = metal;
  ctx.fillRect(-3, -5, 20, 8);

  // Trigger guard & trigger
  ctx.strokeStyle = '#2b303b';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(2, 3);
  ctx.quadraticCurveTo(6, 4.5, 3.5, 7.2);
  ctx.lineTo(0, 6.2);
  ctx.stroke();

  ctx.strokeStyle = '#9ea6b5';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(2.2, 3.2);
  ctx.lineTo(1.2, 5.5);
  ctx.stroke();

  // Ejection port with 12-gauge shell
  ctx.fillStyle = '#16181f';
  ctx.fillRect(4, -4.2, 9, 3.2);
  ctx.fillStyle = '#b82626';
  ctx.fillRect(5.5, -3.8, 5, 2.4);
  ctx.fillStyle = '#d4a838';
  ctx.fillRect(10.5, -4.0, 1.8, 2.8);

  // Receiver top bevel highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-2.5, -4.5);
  ctx.lineTo(16.5, -4.5);
  ctx.stroke();

  // Top main barrel
  ctx.fillStyle = '#565c6c';
  ctx.fillRect(17, -4.2, 35, 3.2);

  // Barrel top highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(17, -3.8);
  ctx.lineTo(51.5, -3.8);
  ctx.stroke();

  // Lower magazine tube
  ctx.fillStyle = '#3c414d';
  ctx.fillRect(17, -0.8, 28, 2.8);
  ctx.fillStyle = '#22252c';
  ctx.fillRect(44, -0.8, 2, 2.8);

  // Barrel clamp bracket
  ctx.fillStyle = '#252830';
  ctx.fillRect(40.5, -4.8, 3, 7.2);

  // Brass front bead sight
  ctx.fillStyle = '#e8bc42';
  ctx.beginPath();
  ctx.arc(49.5, -5.2, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Ribbed pump forend
  ctx.fillStyle = '#252830';
  ctx.fillRect(22, -0.5, 14, 4.4);
  ctx.strokeStyle = '#434958';
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(24 + i * 2.8, 0);
    ctx.lineTo(24 + i * 2.8, 3.8);
    ctx.stroke();
  }

  // Steel action bar
  ctx.strokeStyle = '#7c8494';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(16, 0.5);
  ctx.lineTo(22, 0.5);
  ctx.stroke();
}

/**
 * Assault Rifle: tactical modern carbine.
 * Skeleton buffer tube stock with rubber pad, ergonomic angled pistol grip,
 * flat-top Picatinny rail with reflex red-dot optic, curved high-capacity
 * banana magazine, vented M-LOK handguard, and birdcage flash suppressor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasGradient} metal
 * @param {number} time
 */
function drawAssaultRifle(ctx, metal, time) {
  // Buffer tube & skeletal stock
  ctx.fillStyle = '#333742';
  ctx.fillRect(-14, -2.5, 11, 2.8);
  ctx.fillStyle = '#21242c';
  ctx.beginPath();
  ctx.moveTo(-13, -2.5);
  ctx.lineTo(-17.5, -4.5);
  ctx.lineTo(-17.5, 5);
  ctx.lineTo(-13, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#14151a';
  ctx.fillRect(-19, -4.5, 1.8, 9.5);

  // Pistol grip
  ctx.fillStyle = '#20242c';
  ctx.beginPath();
  ctx.moveTo(-0.5, 0);
  ctx.lineTo(-5.5, 11);
  ctx.lineTo(-2, 12.5);
  ctx.lineTo(3.2, 11);
  ctx.lineTo(3.2, 0);
  ctx.closePath();
  ctx.fill();

  // Grip backstrap texture
  ctx.strokeStyle = '#121418';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-1.5, 2.5);
  ctx.lineTo(-4.5, 9.5);
  ctx.stroke();

  // Trigger guard & trigger
  ctx.strokeStyle = '#2f3440';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(2.5, 1.5);
  ctx.quadraticCurveTo(6, 3.5, 3.5, 7);
  ctx.lineTo(0, 6.2);
  ctx.stroke();

  ctx.strokeStyle = '#8d95a5';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(2, 2.5);
  ctx.lineTo(1.2, 5);
  ctx.stroke();

  // Receiver & Upper
  ctx.fillStyle = metal;
  ctx.fillRect(-3, -5.5, 22, 7);

  // Top Picatinny optic rail
  ctx.fillStyle = '#262933';
  ctx.fillRect(-2, -7, 24, 1.6);
  ctx.strokeStyle = '#1a1c22';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0 + i * 3.5, -7);
    ctx.lineTo(0 + i * 3.5, -5.5);
    ctx.stroke();
  }

  // Reflex red-dot sight
  ctx.fillStyle = '#181b22';
  ctx.fillRect(5, -8.2, 10, 1.4);
  ctx.strokeStyle = '#2d3340';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(6, -12, 8, 4);
  ctx.fillStyle = 'rgba(70, 180, 240, 0.35)';
  ctx.fillRect(7, -11.5, 6, 3);
  ctx.fillStyle = '#ff2233';
  ctx.fillRect(9.5, -10.2, 1.2, 1.2);

  // Curved banana magazine
  ctx.fillStyle = '#181b22';
  ctx.beginPath();
  ctx.moveTo(5.5, 1.5);
  ctx.quadraticCurveTo(7.5, 8, 12, 13.5);
  ctx.lineTo(15.5, 12.8);
  ctx.quadraticCurveTo(11.5, 7.5, 10, 1.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#2b303c';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(7 + i * 1.6, 4.5 + i * 2.6);
    ctx.lineTo(11 + i * 1.6, 4 + i * 2.6);
    ctx.stroke();
  }

  // Vented handguard
  ctx.fillStyle = '#2a2f3a';
  ctx.fillRect(19, -4.8, 18, 5.8);
  // M-LOK cooling slots
  ctx.fillStyle = '#12141a';
  ctx.fillRect(22, -2.8, 3.5, 1.8);
  ctx.fillRect(27.5, -2.8, 3.5, 1.8);
  ctx.fillRect(33, -2.8, 2.5, 1.8);

  ctx.fillStyle = '#20242d';
  ctx.fillRect(19, -5.8, 18, 1.2);

  // Barrel & flash suppressor
  ctx.fillStyle = '#626877';
  ctx.fillRect(37, -2.8, 9, 2.6);
  ctx.fillStyle = '#343844';
  ctx.fillRect(46, -3.4, 5, 3.8);
  ctx.fillStyle = '#121418';
  ctx.fillRect(47.5, -3.8, 1.2, 1.2);
  ctx.fillRect(47.5, -0.4, 1.2, 1.2);
}

/**
 * Sniper Rifle: heavy precision anti-materiel bolt-action rifle.
 * Skeletonized precision chassis, match vertical grip with palm shelf,
 * detachable steel box magazine, bolt handle with teardrop knob,
 * securely mounted dual-ring high-power telescopic scope with coated lens,
 * long fluted match barrel, folded tactical bipod, and massive tank muzzle brake.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasGradient} metal
 * @param {number} time
 */
function drawSniperRifle(ctx, metal, time) {
  // Skeletonized buttstock & cheek rest
  ctx.fillStyle = '#252a2e';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-8, -2);
  ctx.lineTo(-18, -2);
  ctx.lineTo(-24, -4);
  ctx.lineTo(-24, 7);
  ctx.lineTo(-20, 6);
  ctx.lineTo(-12, 1.5);
  ctx.closePath();
  ctx.fill();

  // Adjustable cheek-rest riser
  ctx.fillStyle = '#16191d';
  ctx.fillRect(-17, -4.8, 9, 2.8);

  // Thick rubber recoil buttpad
  ctx.fillStyle = '#101216';
  ctx.fillRect(-26, -4, 2.2, 11);

  // Match vertical grip with bottom palm shelf
  ctx.fillStyle = '#1a1d23';
  ctx.beginPath();
  ctx.moveTo(-0.5, 0);
  ctx.lineTo(-2.5, 11);
  ctx.lineTo(-5, 12);
  ctx.lineTo(3.5, 12);
  ctx.lineTo(2.5, 0);
  ctx.closePath();
  ctx.fill();

  // Match trigger guard & straight trigger
  ctx.strokeStyle = '#2b303a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(2, 1.8);
  ctx.quadraticCurveTo(6.5, 3.8, 3.5, 7.5);
  ctx.lineTo(-0.5, 6.5);
  ctx.stroke();

  ctx.strokeStyle = '#a4adb9';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(2.2, 2.5);
  ctx.lineTo(2.2, 5.5);
  ctx.stroke();

  // Detachable steel box magazine
  ctx.fillStyle = '#1c1f26';
  ctx.fillRect(8, 2, 9, 6.2);
  ctx.strokeStyle = '#2f3542';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(8, 2, 9, 6.2);

  // Monolithic receiver
  ctx.fillStyle = metal;
  ctx.fillRect(0, -4.8, 24, 6.8);

  // Bolt handle angled back with polished steel teardrop knob
  ctx.strokeStyle = '#5a6170';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(4, -3.5);
  ctx.lineTo(2, -6.5);
  ctx.stroke();
  ctx.fillStyle = '#c0c8d6';
  ctx.beginPath();
  ctx.arc(1.5, -7, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Scope mount rings (dual cantilever rings)
  ctx.fillStyle = '#1e2229';
  ctx.fillRect(5, -6.8, 3, 2.2);
  ctx.fillRect(18, -6.8, 3, 2.2);

  // Main 30mm scope tube
  ctx.fillStyle = '#22262f';
  ctx.fillRect(2, -10.2, 28, 3.2);

  // Center elevation & windage turrets
  ctx.fillStyle = '#181b22';
  ctx.fillRect(14, -12.4, 4, 2.4);

  // Rear ocular bell (eyepiece)
  ctx.fillStyle = '#1c1f27';
  ctx.beginPath();
  ctx.moveTo(4, -10.2);
  ctx.lineTo(0, -11.2);
  ctx.lineTo(0, -5.8);
  ctx.lineTo(4, -6.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#101216';
  ctx.fillRect(-1.5, -11.2, 1.6, 5.4);

  // Front objective bell
  ctx.fillStyle = '#1c1f27';
  ctx.beginPath();
  ctx.moveTo(27, -10.2);
  ctx.lineTo(34, -11.8);
  ctx.lineTo(34, -5.2);
  ctx.lineTo(27, -6.8);
  ctx.closePath();
  ctx.fill();

  // Coated sapphire objective lens
  ctx.fillStyle = '#3eb5f5';
  ctx.fillRect(34, -11.2, 1.2, 5.4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(34, -10.2, 1.2, 1.4);

  // Scope top highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(3, -9.8);
  ctx.lineTo(26, -9.8);
  ctx.stroke();

  // Long fluted match barrel
  ctx.fillStyle = '#525866';
  ctx.fillRect(24, -2.6, 42, 3.6);
  ctx.strokeStyle = '#343842';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(27, -0.8);
  ctx.lineTo(60, -0.8);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(24, -2.2);
  ctx.lineTo(64, -2.2);
  ctx.stroke();

  // Folded tactical bipod legs
  ctx.fillStyle = '#22252c';
  ctx.fillRect(44, 1.0, 14, 2.2);
  ctx.fillStyle = '#393f4c';
  ctx.fillRect(43, 0.5, 3, 3);

  // Massive dual-port muzzle brake
  ctx.fillStyle = '#262932';
  ctx.fillRect(66, -3.8, 8, 6.0);
  ctx.fillStyle = '#101216';
  ctx.fillRect(68, -4.2, 1.6, 1.2);
  ctx.fillRect(68, 1.8, 1.6, 1.2);
  ctx.fillRect(71.5, -4.2, 1.6, 1.2);
  ctx.fillRect(71.5, 1.8, 1.6, 1.2);
}

/**
 * Hellstorm: legendary rotary Gatling minigun.
 * Armored motor housing with carrying handle and rear spade grips,
 * internal cooling vents pulsing with heat, ammo belt chute, and an authentic
 * 3D rotating cluster of 6 heavy barrels with overheated cherry-red muzzle tips
 * and dynamic fiery aura.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasGradient} metal
 * @param {number} time
 */
function drawHellstorm(ctx, metal, time) {
  // Spade grip assembly
  ctx.fillStyle = '#22252d';
  ctx.fillRect(-14, -4, 6, 8.5);
  ctx.strokeStyle = '#3a404c';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-13, -5.5);
  ctx.lineTo(-13, 6);
  ctx.stroke();
  ctx.fillStyle = '#c43a28';
  ctx.fillRect(-9, -0.8, 2, 2.2);

  // Motor housing
  ctx.fillStyle = metal;
  ctx.fillRect(-8, -6.5, 26, 13);

  // Top carrying handle
  ctx.strokeStyle = '#2b303c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, -6.5);
  ctx.lineTo(0, -11.5);
  ctx.lineTo(13, -11.5);
  ctx.lineTo(13, -6.5);
  ctx.stroke();
  ctx.fillStyle = '#181a20';
  ctx.fillRect(2, -12.5, 9, 2);

  // Ammo belt feed chute on underside
  ctx.fillStyle = '#282c35';
  ctx.fillRect(-2, 6.5, 12, 5.5);
  ctx.fillStyle = '#d4aa3b';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(0 + i * 3.5, 8.5, 2.2, 3);
  }

  // Bronze armor reinforcement plate & heat vents
  ctx.fillStyle = '#4f3b2d';
  ctx.fillRect(2, -5.2, 14, 10.4);

  // Glowing heat coils inside motor vents
  const heatPulse = 0.55 + Math.sin(time * 8) * 0.25;
  ctx.fillStyle = hexAlpha('#ff5511', heatPulse);
  ctx.fillRect(4, -3.2, 10, 1.8);
  ctx.fillRect(4, 1.4, 10, 1.8);

  // Rotor faceplate & axle
  ctx.fillStyle = '#343844';
  ctx.fillRect(18, -6.0, 4, 12.0);
  ctx.fillStyle = '#20232c';
  ctx.fillRect(22, -1.6, 40, 3.2);

  // Rotating 3D Gatling Barrel Assembly (6 barrels)
  const spin = time * 16;
  const numBarrels = 6;
  const barrelRadius = 4.8;
  const barrelLen = 42;

  const barrels = [];
  for (let i = 0; i < numBarrels; i++) {
    const angle = spin + (i / numBarrels) * Math.PI * 2;
    const yOff = Math.sin(angle) * barrelRadius;
    const depth = Math.cos(angle);
    barrels.push({ yOff, depth });
  }
  barrels.sort((a, b) => a.depth - b.depth);

  for (const b of barrels) {
    const front = b.depth > 0;
    const t = (b.depth + 1) * 0.5;
    const r = Math.round(50 + t * 75);
    const g = Math.round(55 + t * 80);
    const bl = Math.round(65 + t * 90);
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(22, b.yOff - 1.4, barrelLen, 2.8);

    if (front) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(22, b.yOff - 0.8);
      ctx.lineTo(22 + barrelLen - 6, b.yOff - 0.8);
      ctx.stroke();
    }
  }

  // Barrel support clamp rings
  ctx.fillStyle = '#22262e';
  ctx.fillRect(40, -5.8, 3.2, 11.6);
  ctx.fillRect(58, -5.8, 3.2, 11.6);

  // Overheated cherry-red muzzle tips
  const glowPulse = 0.55 + Math.sin(time * 10) * 0.2;
  ctx.fillStyle = hexAlpha('#ff5500', 0.85 * glowPulse);
  ctx.fillRect(59, -5.2, 5, 10.4);

  // Fiery heat aura around minigun muzzle
  glow(ctx, 62, 0, 20, '#ff5511', 0.45 + Math.sin(time * 12) * 0.15);
}

/**
 * The four magic staves: distinct shafts, grip wraps, pommels, ornate sockets,
 * and magical elemental heads that react to charge (beam held) and heat.
 */

/**
 * Fire Staff: ancient charred ironwood staff bound in gold, crowned with a
 * dragon-talon brazier holding a radiant miniature sun/solar core with dancing
 * flame tongues.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 * @param {number} charge
 * @param {number} heat
 */
function drawFireStaff(ctx, time, charge, heat) {
  // Scorched ironwood shaft
  ctx.fillStyle = '#2d1e17';
  ctx.fillRect(-12, -2.4, 66, 4.8);

  // Leather grip wrap
  ctx.fillStyle = '#523624';
  ctx.fillRect(-4, -2.8, 14, 5.6);
  ctx.strokeStyle = '#784e33';
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-2 + i * 3.2, -2.8);
    ctx.lineTo(0 + i * 3.2, 2.8);
    ctx.stroke();
  }

  // Brass ferrule rings
  ctx.fillStyle = '#cba145';
  ctx.fillRect(-10, -3.0, 2.4, 6.0);
  ctx.fillRect(11, -3.0, 2.0, 6.0);
  ctx.fillRect(49, -3.2, 2.5, 6.4);

  // Counterweight pommel with embedded glowing ember
  ctx.fillStyle = '#cba145';
  ctx.beginPath();
  ctx.moveTo(-10, -2.4);
  ctx.lineTo(-14, -4.5);
  ctx.lineTo(-15.5, 0);
  ctx.lineTo(-14, 4.5);
  ctx.lineTo(-10, 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff3311';
  ctx.beginPath();
  ctx.arc(-13, 0, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Dragon-talon brazier socket
  ctx.fillStyle = '#cba145';
  ctx.beginPath();
  ctx.moveTo(50, -2.4);
  ctx.quadraticCurveTo(55, -8.5, 62, -6.5);
  ctx.lineTo(59, -4.5);
  ctx.quadraticCurveTo(54, -6.0, 52, -1.2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(50, 2.4);
  ctx.quadraticCurveTo(55, 8.5, 62, 6.5);
  ctx.lineTo(59, 4.5);
  ctx.quadraticCurveTo(54, 6.0, 52, 1.2);
  ctx.closePath();
  ctx.fill();

  // Floating solar core
  const cx = 59;
  const coreR = 4.5 + charge * 2.5;
  const sway = Math.sin(time * 6) * 1.5;

  // Dancing flame tongues
  const flameLen = 10 + charge * 6;
  ctx.fillStyle = charge > 0.05 ? '#ffe066' : '#ff7a2b';
  // Upper flame tongue
  ctx.beginPath();
  ctx.moveTo(cx - 2, -2);
  ctx.quadraticCurveTo(cx + 3, -flameLen * 0.7, cx + flameLen + sway, -3);
  ctx.quadraticCurveTo(cx + 5, 0, cx - 2, 0);
  ctx.closePath();
  ctx.fill();
  // Lower flame tongue
  ctx.beginPath();
  ctx.moveTo(cx - 2, 0);
  ctx.quadraticCurveTo(cx + 4, flameLen * 0.6, cx + flameLen - sway, 3);
  ctx.quadraticCurveTo(cx + 3, 2, cx - 2, 2);
  ctx.closePath();
  ctx.fill();

  // Central radiant orb
  const hot = heat > 0.55;
  ctx.fillStyle = hot ? '#ffffff' : (charge > 0.05 ? '#fff1a8' : '#ff9533');
  ctx.beginPath();
  ctx.arc(cx, 0, coreR, 0, Math.PI * 2);
  ctx.fill();

  glow(ctx, cx, 0, 18 + charge * 14, '#ff6a1a', 0.45 + charge * 0.35);
  if (hot) glow(ctx, cx, 0, 13, '#ffe14d', (heat - 0.55) * 2.2);
}

/**
 * Ice Staff: ancient silvered frostwood staff, wrapped in azure ribbon,
 * crowned with crystalline filigree frost prongs holding a floating
 * multifaceted glacial diamond.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 * @param {number} charge
 */
function drawIceStaff(ctx, time, charge) {
  // Silvered frostwood shaft
  ctx.fillStyle = '#3a4452';
  ctx.fillRect(-12, -2.2, 66, 4.4);

  // Shaft top frost highlight
  ctx.strokeStyle = 'rgba(215, 240, 255, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-11, -1.8);
  ctx.lineTo(48, -1.8);
  ctx.stroke();

  // Azure silk grip wrap
  ctx.fillStyle = '#223c52';
  ctx.fillRect(-4, -2.6, 14, 5.2);
  ctx.strokeStyle = '#6bb6e8';
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-2 + i * 3.2, -2.6);
    ctx.lineTo(0 + i * 3.2, 2.6);
    ctx.stroke();
  }

  // Silver ferrule rings
  ctx.fillStyle = '#a6b8cd';
  ctx.fillRect(-10, -2.8, 2.2, 5.6);
  ctx.fillRect(11, -2.8, 2.0, 5.6);
  ctx.fillRect(49, -3.0, 2.4, 6.0);

  // Faceted silver pommel with ice-shard drop
  ctx.fillStyle = '#a6b8cd';
  ctx.beginPath();
  ctx.moveTo(-10, -2.2);
  ctx.lineTo(-14, -3.8);
  ctx.lineTo(-16, 0);
  ctx.lineTo(-14, 3.8);
  ctx.lineTo(-10, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d4f2ff';
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  ctx.lineTo(-18.5, 0);
  ctx.lineTo(-15, 1.2);
  ctx.closePath();
  ctx.fill();

  // Filigree frost prongs
  ctx.fillStyle = '#a8c5e0';
  ctx.beginPath();
  ctx.moveTo(50, -2.0);
  ctx.quadraticCurveTo(54, -8.0, 62, -6.5);
  ctx.lineTo(58, -4.5);
  ctx.quadraticCurveTo(54, -5.5, 52, -1.0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(50, 2.0);
  ctx.quadraticCurveTo(54, 8.0, 62, 6.5);
  ctx.lineTo(58, 4.5);
  ctx.quadraticCurveTo(54, 5.5, 52, 1.0);
  ctx.closePath();
  ctx.fill();

  // Floating glacial diamond
  const cx = 59;
  const r = 7.5 + charge * 3 + Math.sin(time * 2.4) * 0.8;
  ctx.fillStyle = '#d8f4ff';
  polygonPath(ctx, cx, 0, r, 4, Math.PI / 4);
  ctx.fill();

  // Inner diamond facet lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(cx - r, 0); ctx.lineTo(cx + r, 0);
  ctx.moveTo(cx, -r); ctx.lineTo(cx, r);
  ctx.stroke();

  // Orbiting micro-shards
  const orbDist = r + 4;
  const rot = time * 2.0;
  ctx.fillStyle = '#9fe2ff';
  polygonPath(ctx, cx + Math.cos(rot) * orbDist, Math.sin(rot) * (orbDist * 0.5), 2.2, 4, Math.PI / 4);
  ctx.fill();
  polygonPath(ctx, cx - Math.cos(rot) * orbDist, -Math.sin(rot) * (orbDist * 0.5), 2.2, 4, Math.PI / 4);
  ctx.fill();

  glow(ctx, cx, 0, 18 + charge * 12, '#7fd8ff', 0.45 + charge * 0.35);
}

/**
 * Lightning Staff: blackened bronze conductive staff, bound in copper conduit
 * windings, crowned with dual Tesla arc horns cradling a high-energy plasma
 * sphere with crackling electric arcs.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 * @param {number} charge
 */
function drawLightningStaff(ctx, time, charge) {
  // Blackened bronze shaft
  ctx.fillStyle = '#2b2721';
  ctx.fillRect(-12, -2.4, 66, 4.8);

  // Insulated dark grip
  ctx.fillStyle = '#1b1915';
  ctx.fillRect(-4, -2.8, 14, 5.6);

  // Copper / brass conductor spiral winding
  ctx.strokeStyle = '#d89e3a';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(14 + i * 8, -2.4);
    ctx.lineTo(18 + i * 8, 2.4);
    ctx.stroke();
  }

  // Brass collar rings
  ctx.fillStyle = '#d89e3a';
  ctx.fillRect(-10, -3.0, 2.4, 6.0);
  ctx.fillRect(11, -3.0, 2.0, 6.0);
  ctx.fillRect(49, -3.2, 2.5, 6.4);

  // Grounding spherical capacitor pommel
  ctx.fillStyle = '#d89e3a';
  ctx.beginPath();
  ctx.arc(-13, 0, 3.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#64d2ff';
  ctx.beginPath();
  ctx.arc(-13, 0, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Dual Tesla arc horns
  ctx.fillStyle = '#d89e3a';
  ctx.beginPath();
  ctx.moveTo(50, -2.2);
  ctx.quadraticCurveTo(54, -9.5, 63, -8.0);
  ctx.lineTo(60, -6.0);
  ctx.quadraticCurveTo(54, -7.0, 52, -1.2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(50, 2.2);
  ctx.quadraticCurveTo(54, 9.5, 63, 8.0);
  ctx.lineTo(60, 6.0);
  ctx.quadraticCurveTo(54, 7.0, 52, 1.2);
  ctx.closePath();
  ctx.fill();

  // Conductive electrode tips
  ctx.fillStyle = '#ffeaa0';
  ctx.fillRect(61.5, -8.5, 2.2, 2.2);
  ctx.fillRect(61.5, 6.3, 2.2, 2.2);

  // Plasma core
  const cx = 59;
  const coreR = 3.6 + charge * 2.2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, 0, coreR, 0, Math.PI * 2);
  ctx.fill();

  // Crackling lightning arcs jumping between tines and core
  const s = 1 + charge * 0.4;
  const jitter1 = Math.sin(time * 28) * 2;
  const jitter2 = Math.cos(time * 34) * 2;

  ctx.strokeStyle = '#ffe855';
  ctx.lineWidth = 1.3 * s;
  ctx.beginPath();
  ctx.moveTo(62, -7.5);
  ctx.lineTo(cx + 2 + jitter1, -3);
  ctx.lineTo(cx, 0);
  ctx.stroke();

  ctx.strokeStyle = '#6ee5ff';
  ctx.lineWidth = 1.1 * s;
  ctx.beginPath();
  ctx.moveTo(62, 7.5);
  ctx.lineTo(cx + 2 + jitter2, 3);
  ctx.lineTo(cx, 0);
  ctx.stroke();

  glow(ctx, cx, 0, 18 + charge * 16, '#ffe14d', 0.45 + charge * 0.4);
}

/**
 * Staff of the Void: legendary cosmic obsidian staff, etched with pulsing
 * violet void runes, crowned with menacing eclipse horns cradling a miniature
 * Black Hole singularity with glowing event horizon and orbiting cosmic rings.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 * @param {number} charge
 */
function drawVoidStaff(ctx, time, charge) {
  // Cosmic obsidian shaft
  ctx.fillStyle = '#161120';
  ctx.fillRect(-13, -2.5, 68, 5.0);

  // Dark leather grip wrap
  ctx.fillStyle = '#100c17';
  ctx.fillRect(-4, -2.9, 14, 5.8);

  // Pulsing ethereal void runes along the shaft
  const rPulse = 0.55 + Math.sin(time * 5) * 0.35;
  ctx.strokeStyle = hexAlpha('#c05cff', rPulse);
  ctx.lineWidth = 1.2;
  for (const x of [16, 26, 36]) {
    ctx.beginPath();
    ctx.moveTo(x - 2, -1.8);
    ctx.lineTo(x + 2, 1.8);
    ctx.moveTo(x + 2, -1.8);
    ctx.lineTo(x - 2, 1.8);
    ctx.stroke();
  }

  // Dark iron collars
  ctx.fillStyle = '#2f2142';
  ctx.fillRect(-10, -3.2, 2.4, 6.4);
  ctx.fillRect(11, -3.2, 2.0, 6.4);
  ctx.fillRect(50, -3.4, 2.5, 6.8);

  // Spiked void prism pommel
  ctx.fillStyle = '#28173d';
  ctx.beginPath();
  ctx.moveTo(-10, -2.5);
  ctx.lineTo(-16, -4.5);
  ctx.lineTo(-18, 0);
  ctx.lineTo(-16, 4.5);
  ctx.lineTo(-10, 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9d4edd';
  ctx.beginPath();
  ctx.arc(-15, 0, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Sweeping eclipse horns
  ctx.fillStyle = '#291840';
  ctx.beginPath();
  ctx.moveTo(51, -2.4);
  ctx.quadraticCurveTo(56, -10.5, 66, -8.0);
  ctx.lineTo(62, -5.5);
  ctx.quadraticCurveTo(56, -7.0, 53, -1.2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(51, 2.4);
  ctx.quadraticCurveTo(56, 10.5, 66, 8.0);
  ctx.lineTo(62, 5.5);
  ctx.quadraticCurveTo(56, 7.0, 53, 1.2);
  ctx.closePath();
  ctx.fill();

  // Razor purple horn edges
  ctx.strokeStyle = '#8a2be2';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(53, -2.4); ctx.quadraticCurveTo(57, -10.5, 66, -8.0);
  ctx.moveTo(53, 2.4); ctx.quadraticCurveTo(57, 10.5, 66, 8.0);
  ctx.stroke();

  // The Black Hole Singularity & Accretion Disk
  const cx = 60;
  const holeR = 4.8 + charge * 2.2;
  const diskR = 8.5 + charge * 4.0;

  // Accretion disk / outer event horizon ring
  ctx.strokeStyle = hexAlpha('#c05cff', 0.85);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, 0, diskR, 0, Math.PI * 2);
  ctx.stroke();

  // Orbiting cosmic void ring
  const rot = time * 1.6;
  ctx.strokeStyle = hexAlpha('#e2a8ff', 0.55 + charge * 0.35);
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.ellipse(cx, 0, diskR + 2, (diskR + 2) * 0.45, rot, 0, Math.PI * 2);
  ctx.stroke();

  // Event horizon (pitch black cosmic void core)
  ctx.fillStyle = '#08040e';
  ctx.beginPath();
  ctx.arc(cx, 0, holeR, 0, Math.PI * 2);
  ctx.fill();

  glow(ctx, cx, 0, 22 + charge * 14, '#b038ff', 0.5 + charge * 0.4);
}

/**
 * Draw the magic staff equipped by the player.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../entities/Player.js').Player} player
 * @param {number} time
 */
function drawStaff(ctx, player, time) {
  const id = player.weaponId;
  const beam = player.beam;
  // 0 while idle, rising to 1 while the beam is held: the head opens with it.
  const charge = beam && beam.firing ? Math.min(1, 0.35 + beam.ramp * 0.9) : 0;
  const heat = beam ? beam.heat : 0;

  ctx.save();
  ctx.rotate(Math.sin(time * 2.4) * 0.05);

  switch (id) {
    case 'ice_staff':
      drawIceStaff(ctx, time, charge);
      break;
    case 'lightning_staff':
      drawLightningStaff(ctx, time, charge);
      break;
    case 'staff_of_the_void':
      drawVoidStaff(ctx, time, charge);
      break;
    case 'fire_staff':
    default:
      drawFireStaff(ctx, time, charge, heat);
      break;
  }

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
