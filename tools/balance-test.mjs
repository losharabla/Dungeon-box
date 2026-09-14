/**
 * Balance regression suite.
 *
 * Two gameplay problems reported from play, each pinned by a test here:
 *
 *  1. Ranged enemies that keep their distance ("kiters": the skeleton and the
 *     mage) could not be caught by a melee class. Their retreat used the full
 *     movement speed, so a warrior closed the gap at a few pixels per second
 *     and the fight became an unwinnable chase. A kiter must always be
 *     catchable, which makes retreat speed a property of the AI and not a
 *     lucky number in one enemy's data.
 *
 *  2. Enemy projectiles had no counterplay for a melee class. A melee swing
 *     now destroys hostile shots inside its arc.
 *
 * Run with:  node tools/balance-test.mjs
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';
import { ENEMIES } from '../src/data/enemies.js';
import { CLASSES } from '../src/data/classes.js';
import { ultimatesForClass } from '../src/data/ultimates.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
const DT = CONFIG.loop.fixedStep;

const results = [];
/** @param {string} name @param {() => any} fn */
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

/**
 * @param {number} [seed]
 * @param {string} [classId]
 * @param {string} [ultId]
 */
function newGame(seed = 1234, classId = 'warrior', ultId = 'whirlwind') {
  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun(classId, ultId, seed);
  return game;
}

/** Screen-space cursor that aims at a world point. */
function aimAt(game, wx, wy) {
  return { x: wx - game.camera.x + VW / 2, y: wy - game.camera.y + VH / 2 };
}

/** Remove everything the room spawned, so a probe is isolated. */
function clearEnemies(game) {
  for (const e of game.registry.enemies) {
    e.alive = false;
    e.reapable = true;
    e.deathTimer = 99;
  }
  game.registry.reap();
}

/**
 * One neutral step: no attacking, no ultimate, aiming to the right unless
 * told otherwise.
 * @param {any} game
 * @param {{x: number, y: number}} move
 * @param {{dash?: boolean, ult?: boolean, aimX?: number}} [opts]
 */
function step(game, move, opts = {}) {
  game.update(DT, {
    move,
    aim: { x: VW / 2 + (opts.aimX ?? 300), y: VH / 2 },
    attackHeld: false,
    attackPressed: false,
    ultPressed: opts.ult === true,
    dashPressed: opts.dash === true,
  });
}

/* ---------- Checks ---------------------------------------------------- */

check('no distance-keeping enemy can outrun the slowest class', () => {
  const slowest = Math.min(...Object.values(CLASSES).map((c) => c.speed)) * CONFIG.world.speedUnit;

  for (const def of Object.values(ENEMIES)) {
    if (def.ai !== 'kiter' && def.ai !== 'bomber') continue;

    const retreat = def.speed * CONFIG.world.speedUnit * (def.retreatSpeedMul ?? 0.6);
    assert.ok(
      retreat < slowest,
      `${def.id} retreats at ${retreat.toFixed(0)} px/s but the slowest class moves ${slowest} px/s`,
    );
    // Outrunning is not enough: the gap must close at a usable rate.
    assert.ok(
      slowest - retreat > 40,
      `${def.id} can only be closed on at ${(slowest - retreat).toFixed(0)} px/s`,
    );
  }
});

check('a warrior reaches a retreating skeleton in a fair time', () => {
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);

  const room = game.rooms.runtime.room;
  const b = room.bounds;

  // Drop the skeleton as far away as the room allows along a direction with
  // clear line of sight, so it starts in its retreat band.
  let skeleton = null;
  for (const dist of [300, 285, 270, 255, 240]) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const cx = player.x + Math.cos(ang) * dist;
      const cy = player.y + Math.sin(ang) * dist;
      const margin = 30;
      if (cx < b.x + margin || cx > b.x + b.w - margin) continue;
      if (cy < b.y + margin || cy > b.y + b.h - margin) continue;
      if (game.collisionWorld.overlapsAny({ x: cx, y: cy, radius: 14 })) continue;
      if (!game.collisionWorld.hasLineOfSight(player.x, player.y, cx, cy)) continue;
      skeleton = game.spawner.spawnEnemy('skeleton', cx, cy);
      break;
    }
    if (skeleton) break;
  }
  assert.ok(skeleton, 'the test room must have space for a skeleton at range');

  // Reach = the sword's own reach plus the skeleton's body.
  const reach = player.weapon.range + skeleton.radius;
  assert.equal(player.weapon.kind, 'melee', 'the warrior must start with a melee weapon');

  let caught = null;
  for (let i = 0; i < 60 * 8; i++) {
    // This probe measures whether the gap can be closed, not whether the
    // player survives the walk; keep them on their feet like verify-arenas.
    player.hp = player.maxHp;

    const dx = skeleton.x - player.x;
    const dy = skeleton.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d <= reach) { caught = i * DT; break; }

    const aim = aimAt(game, skeleton.x, skeleton.y);
    game.update(DT, {
      move: { x: dx / d, y: dy / d },
      aim: { x: aim.x, y: aim.y },
      attackHeld: true, attackPressed: true, ultPressed: false,
    });
  }

  assert.ok(caught !== null, 'the warrior must be able to catch a retreating skeleton at all');
  // The room corners the skeleton eventually, so this is an upper bound on
  // "the fight is not an endless chase" rather than a precise measure.
  assert.ok(caught < 4, `closing on a skeleton took ${caught.toFixed(1)}s — too long to be fun`);
});

check('the AI actually applies the retreat multiplier', () => {
  // The data can claim `retreatSpeedMul: 0.55` while the AI ignores it, which
  // is exactly how a kiter becomes uncatchable again. Measure the skeleton's
  // real speed on open floor while it backs away from a stationary player.
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);

  const room = game.rooms.runtime.room;
  const skeleton = game.spawner.spawnEnemy('skeleton', room.center.x + 40, room.center.y);
  // Inside the retreat band (preferRange * 0.72), with open floor behind.
  player.x = skeleton.x - 150;
  player.y = skeleton.y;

  const base = skeleton.getSpeed();
  assert.ok(base > 0, 'the skeleton must have a movement speed');

  const x0 = skeleton.x;
  const y0 = skeleton.y;
  const steps = 12; // 0.2s: long enough to measure, short enough to stay in band
  for (let i = 0; i < steps; i++) {
    player.hp = player.maxHp;
    game.update(DT, {
      move: { x: 0, y: 0 },
      aim: { x: VW / 2, y: VH / 2 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }

  const travelled = Math.hypot(skeleton.x - x0, skeleton.y - y0);
  const measured = travelled / (steps * DT);
  assert.ok(measured > 5, `the skeleton must actually retreat (moved ${measured.toFixed(0)} px/s)`);
  assert.ok(
    measured < base * 0.8,
    `retreating ran at ${measured.toFixed(0)} px/s against a base of ${base.toFixed(0)} px/s — `
    + 'the retreat multiplier is not being applied',
  );
});

check('a melee swing destroys hostile shots inside its arc', () => {
  const game = newGame();
  const player = game.getPlayer();
  player.lookAt(player.x + 100, player.y);
  player.startSwing(0.2);

  const front = game.projectiles.spawn({
    x: player.x + 60, y: player.y, vx: -120, vy: 0,
    faction: 'enemy', damage: 5, radius: 6, life: 2,
  });
  const behind = game.projectiles.spawn({
    x: player.x - 60, y: player.y, vx: 120, vy: 0,
    faction: 'enemy', damage: 5, radius: 6, life: 2,
  });

  const destroyed = game.projectiles.parrySwing(player);
  assert.equal(destroyed, 1, 'exactly the shot in the swing arc may break');
  assert.equal(front.alive, false, 'the shot in front must break on the weapon');
  assert.equal(behind.alive, true, 'the shot behind must fly on');
});

check('the parry window lasts the whole swing, not one frame', () => {
  const game = newGame();
  const player = game.getPlayer();
  player.lookAt(player.x + 100, player.y);
  player.startSwing(0.3);

  // The parry must keep working on later frames of the same swing, so a shot
  // that arrives just after the damage frame is still caught.
  for (let i = 0; i < 5; i++) player.update(DT);
  assert.ok(player.isSwinging, 'the swing must still be running for this check');

  const late = game.projectiles.spawn({
    x: player.x + 55, y: player.y, vx: -100, vy: 0,
    faction: 'enemy', damage: 5, radius: 6, life: 2,
  });
  assert.equal(game.projectiles.parrySwing(player), 1);
  assert.equal(late.alive, false);
});

check('Game.update itself runs the parry during a real swing', () => {
  // Guards the wiring, not just the method: the same class of bug as a
  // system nobody calls.
  const game = newGame();
  const player = game.getPlayer();
  const shot = game.projectiles.spawn({
    x: player.x + 60, y: player.y, vx: 200, vy: 0,
    faction: 'enemy', damage: 5, radius: 6, life: 3,
  });

  // Aim well to the right so the swing faces the shot.
  game.update(DT, {
    move: { x: 0, y: 0 },
    aim: { x: VW / 2 + 320, y: VH / 2 },
    attackHeld: true, attackPressed: true, ultPressed: false,
  });

  assert.equal(shot.alive, false, 'a real swing through Game.update must break the shot');
});

check('shots flagged unparryable and player shots are left alone', () => {
  const game = newGame();
  const player = game.getPlayer();
  player.lookAt(player.x + 100, player.y);
  player.startSwing(0.2);

  const armoured = game.projectiles.spawn({
    x: player.x + 60, y: player.y, vx: -120, vy: 0,
    faction: 'enemy', damage: 5, radius: 6, life: 2, parryable: false,
  });
  const own = game.projectiles.spawn({
    x: player.x + 50, y: player.y, vx: 120, vy: 0,
    faction: 'player', damage: 5, radius: 6, life: 2,
  });

  assert.equal(game.projectiles.parrySwing(player), 0);
  assert.equal(armoured.alive, true, 'an unparryable shot must survive the swing');
  assert.equal(own.alive, true, 'the player must not swat their own shots');
});

check('a ranged class gets no parry from its weapon', () => {
  const game = newGame(1234, 'gunner', 'ricochet');
  const player = game.getPlayer();
  assert.notEqual(player.weapon.kind, 'melee', 'the gunner must start with a ranged weapon');
  player.lookAt(player.x + 100, player.y);
  player.startSwing(0.2);

  game.projectiles.spawn({
    x: player.x + 60, y: player.y, vx: -120, vy: 0,
    faction: 'enemy', damage: 5, radius: 6, life: 2,
  });

  assert.equal(game.projectiles.parrySwing(player), 0);
});

/* ---------- Ultimate charge (§21, hybrid) ----------------------------- */

check('the ultimate charges from the clock alone', () => {
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);
  assert.equal(player.ultCharge, 0, 'a fresh run must start with no charge');

  // Five idle seconds in an empty room: no damage dealt, none taken, no kill.
  for (let i = 0; i < 60 * 5; i++) step(game, { x: 0, y: 0 });

  const expected = CONFIG.combat.ultChargePerSecond * 5;
  assert.ok(
    player.ultCharge > expected * 0.9,
    `five idle seconds must grant about ${expected} charge, got ${player.ultCharge.toFixed(1)}`,
  );
});

check('time alone eventually fills the warrior ultimate', () => {
  const rate = CONFIG.combat.ultChargePerSecond;
  assert.ok(rate > 0, 'the passive charge rate must be positive, or ults never arrive on the clock');
  const needed = 100 / rate;

  for (const classId of ['warrior']) {
    const game = newGame(1234, classId, ultimatesForClass(classId)[0].id);
    const player = game.getPlayer();
    clearEnemies(game);

    let readyAt = null;
    const limit = Math.ceil(needed * 60) + 120;
    for (let i = 0; i < limit; i++) {
      player.hp = player.maxHp;
      if (player.ultReady) { readyAt = i * DT; break; }
      step(game, { x: 0, y: 0 });
    }

    assert.ok(
      readyAt !== null,
      `${classId} never charged its ultimate from the clock within ${(limit * DT).toFixed(0)}s`,
    );
    assert.ok(
      readyAt <= needed + 1,
      `${classId} needed ${readyAt.toFixed(1)}s of clock for a full charge, expected ~${needed.toFixed(0)}s`,
    );
  }
});

check('a kill is still a charge source', () => {
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);
  const victim = game.spawner.spawnEnemy('slime', player.x + 180, player.y);

  const before = player.ultCharge;
  game.combat.applyHit(victim, { damage: 9999 }, player);
  assert.equal(victim.alive, false, 'the victim must die');

  assert.ok(
    player.ultCharge - before >= CONFIG.combat.ultChargePerKill,
    `a kill must grant at least ${CONFIG.combat.ultChargePerKill} charge, got `
    + `${(player.ultCharge - before).toFixed(1)}`,
  );
});

/* ---------- Whirlwind -------------------------------------------------- */

check('whirlwind speeds the warrior up instead of slowing him down', () => {
  // Baseline: plain walking for the same wall-clock time.
  const walkGame = newGame();
  const walker = walkGame.getPlayer();
  clearEnemies(walkGame);
  const walkFrom = walker.x;
  for (let i = 0; i < 30; i++) step(walkGame, { x: 1, y: 0 });
  const walked = walker.x - walkFrom;

  // Same thing with the spin running.
  const spinGame = newGame();
  const spinner = spinGame.getPlayer();
  clearEnemies(spinGame);
  spinner.addUltCharge(100);
  assert.ok(spinner.ultReady, 'the warrior must be able to fire the ultimate');

  const spinFrom = spinner.x;
  step(spinGame, { x: 1, y: 0 }, { ult: true });
  assert.ok(spinner.ultActiveTimer > 0, 'the spin must be running');
  assert.ok(
    spinner.movementScale > 1,
    `whirlwind must be a mobility buff, movementScale is ${spinner.movementScale}`,
  );
  for (let i = 0; i < 30; i++) step(spinGame, { x: 1, y: 0 });
  const spun = spinner.x - spinFrom;

  assert.ok(
    spun > walked * 1.15,
    `the spin must cover more ground than walking (${spun.toFixed(0)}px vs ${walked.toFixed(0)}px)`,
  );
});

/* ---------- Dash (Space) ---------------------------------------------- */

check('a dash covers more ground than walking', () => {
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);

  assert.equal(player.dashReady, true, 'a fresh player must be ready to dash');
  const from = player.x;
  step(game, { x: 1, y: 0 }, { dash: true });
  assert.ok(player.isDashing, 'the dash must start');

  // Ride out the burst.
  for (let i = 0; i < 11 && player.isDashing; i++) step(game, { x: 1, y: 0 });
  const dashed = player.x - from;

  // The same elapsed time on foot, from a clean player.
  const walkGame = newGame();
  const walker = walkGame.getPlayer();
  clearEnemies(walkGame);
  const walkFrom = walker.x;
  for (let i = 0; i < 12; i++) step(walkGame, { x: 1, y: 0 });
  const walked = walker.x - walkFrom;

  assert.ok(
    dashed > walked * 2,
    `a dash must be a burst, not a nudge (${dashed.toFixed(0)}px vs ${walked.toFixed(0)}px walked)`,
  );
});

check('the dash respects its cooldown', () => {
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);

  assert.equal(player.tryDash(1, 0), true, 'the first dash must start');
  assert.equal(player.tryDash(1, 0), false, 'a second dash mid-burst must be refused');

  // Past the burst, but still inside the recharge.
  for (let i = 0; i < 20; i++) step(game, { x: 0, y: 0 });
  assert.equal(player.isDashing, false, 'the burst must have ended');
  assert.equal(player.dashReady, false, 'the dash must still be recharging');
  assert.equal(player.tryDash(1, 0), false, 'a dash on cooldown must be refused');

  // And it comes back.
  for (let i = 0; i < 60 * 2; i++) step(game, { x: 0, y: 0 });
  assert.equal(player.dashReady, true, 'the dash must recharge');
});

check('Space dashes through Game.update, from the input flag', () => {
  // Guards the wiring end to end: key -> input flag -> Game -> movement.
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);

  const from = player.x;
  step(game, { x: 1, y: 0 }, { dash: true });

  assert.ok(player.isDashing, 'Game.update must start the dash from dashPressed');
  assert.ok(
    player.x - from > 5,
    `the dash must move the player in the same step, moved ${(player.x - from).toFixed(1)}px`,
  );
});

check('a standing dash uses the aim direction', () => {
  const game = newGame();
  const player = game.getPlayer();
  clearEnemies(game);

  // No movement input: the burst should follow where the player is facing.
  player.lookAt(player.x - 200, player.y);
  assert.equal(player.tryDash(0, 0), true);
  assert.ok(player.dashDirX < -0.9, `expected a dash to the left, got ${player.dashDirX.toFixed(2)}`);
  assert.ok(Math.abs(player.dashDirY) < 0.1);
});

check('mage and gunner retain combat-only charge', () => {
  for (const id of ['mage', 'gunner']) {
    const game = newGame(1234, id, ultimatesForClass(id)[0].id);
    for (let i = 0; i < 2100; i++) step(game, { x: 0, y: 0 });
    assert.equal(game.player.ultCharge, 0);
    const victim = game.spawner.spawnEnemy('slime', game.player.x + 180, game.player.y);
    game.combat.applyHit(victim, { damage: 999 }, game.player);
    assert.ok(game.player.ultCharge > 0);
  }
});

check('standing dash follows a changed cursor in the same step', () => {
  const game = newGame();
  game.player.facing = 0;
  const x = game.player.x;
  step(game, { x: 0, y: 0 }, { dash: true, aimX: -300 });
  assert.ok(game.player.x < x);
  assert.ok(game.player.dashDirX < -0.9);
});

/* ---------- Report ---------------------------------------------------- */

let failures = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${r.name}`);
    console.log(`        ${r.error?.message ?? r.error}`);
    if (r.error?.stack) {
      console.log(String(r.error.stack).split('\n').slice(1, 4).join('\n'));
    }
  }
}
console.log('');
console.log(`${results.length - failures}/${results.length} balance checks passed`);
process.exit(failures > 0 ? 1 : 0);
