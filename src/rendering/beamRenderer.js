/**
 * @fileoverview The held beam of a magic weapon.
 *
 * SRP: turn the segment `BeamSystem` recorded this step into pixels. It reads
 * and returns nothing — no state, no decisions about who is hit.
 *
 * The cost is fixed and small on purpose. A beam is continuous, so anything
 * per-pixel or per-particle here would be paid sixty times a second for as
 * long as the button is held: three strokes for the ray, two cached glow
 * sprites, and a jagged path instead of a straight one for the staff whose
 * beam is lightning. All of it is `lighter`-blended so overlapping beams and
 * torches add up instead of fighting.
 */

import { glow, tint, jaggedLine } from './drawUtils.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x0: number, y0: number, x1: number, y1: number, color: string,
 *   halfWidth: number, hitBody: boolean, shape?: string}} beam
 * @param {number} time rolling animation clock, seconds
 */
export function drawBeam(ctx, beam, time) {
  if (!beam) return;

  const length = Math.hypot(beam.x1 - beam.x0, beam.y1 - beam.y0);
  if (length < 2) return;

  const half = beam.halfWidth;
  // A perfectly steady line reads as a UI element rather than as energy, so
  // the ray breathes. Two frequencies keep it from looking like a sine wave.
  const flicker = 0.88 + Math.sin(time * 34) * 0.07 + Math.sin(time * 91) * 0.05;

  // Widest and faintest first, so the core stays hot in the middle.
  const passes = [
    { width: half * 6, alpha: 0.10, color: beam.color },
    { width: half * 2.6, alpha: 0.32, color: beam.color },
    { width: half, alpha: 0.90, color: tint(beam.color, 1.55) },
  ];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';

  for (const pass of passes) {
    ctx.globalAlpha = pass.alpha * flicker;
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = Math.max(1, pass.width);

    if (beam.shape === 'arc') {
      // Lightning does not travel in a straight line. A fresh jitter every
      // frame is what makes it crackle.
      jaggedLine(ctx, beam.x0, beam.y0, beam.x1, beam.y1, 9, 6, Math.random);
    } else {
      ctx.beginPath();
      ctx.moveTo(beam.x0, beam.y0);
      ctx.lineTo(beam.x1, beam.y1);
    }
    ctx.stroke();
  }

  ctx.restore();

  // Muzzle flare, and an impact bloom that is visibly brighter when the beam
  // is actually biting into a body rather than spending itself on a wall.
  glow(ctx, beam.x0, beam.y0, half * 7, beam.color, 0.45 * flicker);
  glow(
    ctx, beam.x1, beam.y1,
    half * (beam.hitBody ? 9 : 4.5),
    beam.color,
    (beam.hitBody ? 0.8 : 0.35) * flicker,
  );
}
