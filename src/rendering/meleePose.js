/**
 * @fileoverview One timing source for a melee swing.
 *
 * SRP: turn the countdown on `player.attack` into normalised animation
 * phases. The body, the weapon and the slash VFX are the same gesture seen
 * from three modules; if each derives its progress on its own they drift the
 * moment anyone edits a curve.
 *
 * The bug this replaces: the body leaned on `sin(progress*PI)`, the slash
 * trail swept *linearly* across the whole swing, and the weapon chopped
 * through its own sine pulse. Three curves with three different peak moments
 * meant the blade wound up and bounced while the light trail marched off at
 * its own pace behind it. Now the blade angle and the trail's leading edge
 * come from one function, so they cannot disagree, and the body pose is keyed
 * to the same timeline.
 */

/**
 * Swing timeline, as a fraction of the weapon's `swingTime`.
 * windEnd    - the pull-back finishes and the arm is coiled.
 * contactEnd - the blade reaches the far edge of the arc; everything after
 *              is recovery, so even a fast weapon finishes its follow
 *              through inside its own swing window.
 */
export const SWING = {
  windEnd: 0.3,
  contactEnd: 0.6,
};

/** @param {number} x @returns {number} */
function clamp01(x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

/** Smoothstep so the pose has no corners. @param {number} t @returns {number} */
function ease(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Normalised progress of the current melee swing, 0 (strike starts) → 1
 * (swing animation over).
 * @param {import('../entities/Player.js').Player} player
 * @returns {number|null} null when no swing is running
 */
export function swingProgress(player) {
  const a = player?.attack;
  if (!a || !player.isSwinging || a.swingTotal <= 0) return null;
  return clamp01(1 - a.swingTime / a.swingTotal);
}

/**
 * The full pose for this step of the swing.
 * @param {import('../entities/Player.js').Player} player
 * @returns {{progress: number|null, sweep: number, extension: number, recover: number}}
 *   sweep     0..1 how far the blade has travelled through its arc
 *   extension -0.45..1 body commitment (negative = pulling back)
 *   recover   0..1 blend back to the aim line during recovery
 */
export function swingPose(player) {
  const progress = swingProgress(player);
  if (progress === null) return { progress, sweep: 0, extension: 0, recover: 0 };

  const { windEnd, contactEnd } = SWING;

  let extension;
  if (progress < windEnd) {
    extension = -0.45 * (1 - ease(progress / windEnd));
  } else if (progress < contactEnd) {
    extension = ease((progress - windEnd) / (contactEnd - windEnd));
  } else {
    extension = 1 - ease((progress - contactEnd) / (1 - contactEnd));
  }

  return {
    progress,
    sweep: clamp01(progress / contactEnd),
    extension,
    recover: clamp01((progress - contactEnd) / (1 - contactEnd)),
  };
}

/**
 * Angle the blade should sit at, relative to the aim line, so it matches the
 * slash trail's leading edge exactly.
 * @param {import('../entities/Player.js').Player} player
 * @param {number} arc the weapon's full sweep in radians
 * @returns {number} radians; 0 when not swinging
 */
export function bladeAngle(player, arc) {
  const pose = swingPose(player);
  if (pose.progress === null) return 0;
  const half = (arc ?? 1.4) / 2;
  const swept = -half + pose.sweep * (half * 2);
  // Ease back to the aim line during recovery so the swing ends where idle
  // begins, instead of snapping when the countdown expires.
  return swept * (1 - pose.recover);
}
