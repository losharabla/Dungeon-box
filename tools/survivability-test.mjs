/**
 * Survivability benchmark: can a melee class live inside the pack?
 *
 * Every other harness plays the classes with the invincibility cheat
 * (`player.hp = player.maxHp` each step), which measures whether a room can
 * be *reached and cleared*, not whether a class can survive it. That blind
 * spot is exactly where the warrior's problem lived: with no post-hit mercy
 * window, four mid-run chasers land their blows on the same frames and delete
 * a 150 HP melee player in about two seconds, while a ranged class never
 * enters the zone at all and shows nothing wrong in any existing test.
 *
 * This probe fights the same scripted pack, in the same room, with the same
 * brain for all three classes and no cheat, and reports how long each class
 * lasts. It runs the scenario twice — once with the pre-fix numbers, once
 * with the shipped ones — so the report is a before/after rather than a
 * number nobody can interpret.
 *
 * It is a controlled benchmark, not a simulation of skilled play: the bot
 * never dashes, never seeks cover, and holds the attack button down.
 */
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';
import { rng } from '../src/core/Random.js';
import { CLASSES } from '../src/data/classes.js';
import { WEAPONS, getWeapon } from '../src/data/weapons.js';
import { ENEMIES } from '../src/data/enemies.js';
import { NavGrid } from './NavGrid.mjs';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');

const DT = CONFIG.loop.fixedStep;
const VW = CONFIG.view.width;
const VH = CONFIG.view.height;

let failures = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

/** @param {any} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * @param {string} classId
 * @param {string} ultimateId
 * @param {number} seed
 * @returns {any}
 */
function newGame(classId, ultimateId, seed) {
  // The run seed pins the floor layout; the shared gameplay stream pins the
  // wave composition; `withSeededRandom` below pins the enemy jitter. Together
  // they make a benchmark run reproducible, which is what lets the pre-fix and
  // shipped numbers be compared blow for blow.
  rng.seed = (seed * 2654435761) >>> 0 || 1;
  rng.reset();

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun(classId, ultimateId, seed);
  return game;
}

const realRandom = Math.random;

/**
 * Run `fn` with a seeded `Math.random`.
 *
 * Enemy attack timers, strafe directions and stealth windows come from
 * `Math.random`, so two invocations of the same scenario normally differ.
 * A benchmark needs the opposite: the same enemy behaviour both times, so the
 * only difference between the "before" and "after" columns is the balance
 * data under test.
 *
 * @template T
 * @param {number} seed
 * @param {() => T} fn
 * @returns {T}
 */
function withSeededRandom(seed, fn) {
  let state = (seed * 40503 + 97) >>> 0 || 1;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = realRandom;
  }
}

/* ============================================================
   The scenario
   ============================================================ */

/**
 * Difficulty of the arena the probe fights: the late-arena wave recipe
 * (4 / 6 / 3 elites) at floor-2 scaling. The first arena is tier 1; the
 * probe swaps in the tier-2 recipe after entering so the fight is the one
 * that actually decides runs, without simulating two floors of travel.
 */
const BENCH_TIER = 2;
const BENCH_FLOOR = 1;

/**
 * Fight one real arena out with a scripted bot and report the outcome.
 *
 * No invincibility cheat: the point of the probe is to measure survival. The
 * waves, their timing and the door seal all come from RoomController, so the
 * sequencing is production code and only the difficulty tier is injected.
 *
 * @param {object} opts
 * @param {string} opts.classId
 * @param {string} opts.ultimateId
 * @param {string} opts.weaponId
 * @param {number} opts.seed
 * @param {number} [opts.maxSeconds]
 * @returns {{seconds: number, alive: boolean, cleared: boolean, hpFraction: number,
 *   damageTaken: number, kills: number, ground: number}}
 */
function fightArena({ classId, ultimateId, weaponId, seed, maxSeconds = 120 }) {
  const game = newGame(classId, ultimateId, seed);
  const player = game.getPlayer();
  player.equip(getWeapon(weaponId));

  // Walk into the arena on this floor. The first offer of every step is a
  // fight, so this is deterministic.
  const arenaOffer = game.run.exits().find((offer) => offer.type === 'arena');
  assert(arenaOffer, 'a floor must offer an arena to benchmark');
  game.travelTo(arenaOffer.id);

  const rt = game.rooms.runtime;
  assert(rt.type === 'arena', `expected an arena, entered "${rt.type}"`);

  // Inject the late-arena recipe and its scaling before the first wave lands.
  game.spawner.setFloor(BENCH_FLOOR);
  rt.waveDefs = game.spawner.buildWaves(BENCH_TIER);
  rt.waveIndex = 0;
  rt.wavePending = true;
  rt.spawnTimer = rt.waveDefs[0].delay;

  const room = rt.room;
  const toScreen = (wx, wy) => ({
    x: wx - game.camera.x + VW / 2,
    y: wy - game.camera.y + VH / 2,
  });

  const nav = new NavGrid(room.bounds, game.collisionWorld, player.radius);
  const bounds = room.bounds;
  let path = [];
  let repath = 0;
  let t = 0;

  // The ranged classes keep the pack at arm's length; the warrior has to walk
  // into it, which is the whole point of the benchmark.
  const standOff = classId === 'warrior' ? 0 : 165;

  while (t < maxSeconds && player.alive && !rt.cleared) {
    const enemies = game.registry.enemies.filter((e) => e.alive);

    let target = enemies[0] ?? null;
    let best = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < best) { best = d; target = e; }
    }

    let goalX = target ? target.x : room.center.x;
    let goalY = target ? target.y : room.center.y;
    if (!target && rt.cleared) {
      const door = room.doors.find((d) => d.open);
      if (door) { goalX = door.rect.x + door.rect.w / 2; goalY = door.rect.y + door.rect.h / 2; }
    }

    repath -= DT;
    if (path.length === 0 || repath <= 0) {
      path = nav.findPath(player.x, player.y, goalX, goalY) ?? [];
      repath = 0.35;
    }
    while (path.length > 0 && Math.hypot(path[0].x - player.x, path[0].y - player.y) < 24) {
      path.shift();
    }

    let mx = (path[0]?.x ?? goalX) - player.x;
    let my = (path[0]?.y ?? goalY) - player.y;

    if (target && standOff > 0 && best < standOff) {
      const away = Math.atan2(player.y - target.y, player.x - target.x);
      mx = mx * 0.4 + Math.cos(away) * 0.6;
      my = my * 0.4 + Math.sin(away) * 0.6;
    }
    // Never wander out of the room through a doorway.
    const margin = 26;
    if (player.x < bounds.x + margin) mx += 1;
    if (player.x > bounds.x + bounds.w - margin) mx -= 1;
    if (player.y < bounds.y + margin) my += 1;
    if (player.y > bounds.y + bounds.h - margin) my -= 1;

    const len = Math.hypot(mx, my) || 1;
    game.update(DT, {
      move: { x: mx / len, y: my / len },
      aim: toScreen(goalX, goalY),
      attackHeld: Boolean(target),
      attackPressed: Boolean(target),
      ultPressed: player.ultReady,
      dashPressed: false,
    });
    t += DT;
  }

  return {
    seconds: t,
    alive: player.alive,
    cleared: rt.cleared === true,
    hpFraction: player.hp / player.maxHp,
    damageTaken: player.stats.damageTaken,
    kills: player.stats.kills,
    ground: game.registry.enemies.filter((e) => e.alive).length,
  };
}

/**
 * Run the benchmark for one class across every seed.
 * @param {{classId: string, ultimateId: string, weaponId: string}} cfg
 * @returns {{cleared: number, alive: number, seconds: number, hpFraction: number,
 *   damageTaken: number, kills: number, runs: number}}
 */
function benchmark(cfg) {
  const seeds = [11, 29, 47, 83, 101];
  let cleared = 0;
  let alive = 0;
  let seconds = 0;
  let hp = 0;
  let taken = 0;
  let kills = 0;

  for (const seed of seeds) {
    const result = withSeededRandom(seed, () => fightArena({
      classId: cfg.classId, ultimateId: cfg.ultimateId, weaponId: cfg.weaponId, seed,
    }));
    if (result.cleared) cleared++;
    if (result.alive) alive++;
    seconds += result.seconds;
    hp += result.hpFraction;
    taken += result.damageTaken;
    kills += result.kills;
  }

  return {
    cleared,
    alive,
    runs: seeds.length,
    seconds: seconds / seeds.length,
    hpFraction: hp / seeds.length,
    damageTaken: taken / seeds.length,
    kills: kills / seeds.length,
  };
}

const CLASSES_TO_TEST = [
  { classId: 'warrior', ultimateId: 'whirlwind', weaponId: 'sword' },
  { classId: 'mage', ultimateId: 'meteor', weaponId: 'fire_staff' },
  { classId: 'gunner', ultimateId: 'bullet_storm', weaponId: 'pistol' },
];

/* ============================================================
   Pre-fix data, so the report can show the delta
   ============================================================ */

const CURRENT = {
  speed: CLASSES.warrior.speed,
  swordDamage: WEAPONS.sword.baseDamage,
  swordCooldown: WEAPONS.sword.cooldown,
  axeDamage: WEAPONS.battle_axe.baseDamage,
  hammerDamage: WEAPONS.war_hammer.baseDamage,
  iframe: CONFIG.combat.playerHurtIframe,
};

/** The shipped numbers as they were before the melee pass. */
const BASELINE = {
  speed: 3,
  swordDamage: 18,
  swordCooldown: 0.44,
  axeDamage: 32,
  hammerDamage: 52,
  iframe: 0,
};

/** @param {typeof CURRENT} v */
function applyData(v) {
  CLASSES.warrior.speed = v.speed;
  WEAPONS.sword.baseDamage = v.swordDamage;
  WEAPONS.sword.cooldown = v.swordCooldown;
  WEAPONS.battle_axe.baseDamage = v.axeDamage;
  WEAPONS.war_hammer.baseDamage = v.hammerDamage;
  CONFIG.combat.playerHurtIframe = v.iframe;
}

/* ============================================================
   Unit-level checks on the mercy window itself
   ============================================================ */

/** @returns {any} a warrior standing in a sealed room with nothing in it */
function emptyRoom() {
  const game = newGame('warrior', 'whirlwind', 4242);
  game.rooms.runtime.room.seal();
  return game;
}

check('a simultaneous burst lands as one blow, not four', () => {
  const game = emptyRoom();
  const player = game.getPlayer();
  const startHp = player.hp;

  // Four chasers each attack on their own timer and can share a frame.
  for (let i = 0; i < 4; i++) {
    game.combat.applyHit(player, { damage: 10 }, { x: player.x + 40, y: player.y, faction: 'enemy' });
  }

  const lost = startHp - player.hp;
  assert(lost === 10, `four same-frame blows took ${lost} HP; the window must cap them at one (10)`);
});

check('the window reopens after CONFIG.combat.playerHurtIframe', () => {
  const game = emptyRoom();
  const player = game.getPlayer();
  const enemy = { x: player.x + 40, y: player.y, faction: 'enemy' };
  const window = CONFIG.combat.playerHurtIframe;
  assert(window > 0, 'the mercy window must be enabled for melee to be playable');

  game.combat.applyHit(player, { damage: 10 }, enemy);
  const afterFirst = player.hp;

  // Halfway through the window the player is still protected.
  for (let t = 0; t < window / 2; t += DT) game.update(DT, { move: { x: 0, y: 0 }, aim: { x: VW / 2, y: VH / 2 } });
  game.combat.applyHit(player, { damage: 10 }, enemy);
  assert(player.hp === afterFirst, 'a blow inside the window must not land');

  // Once it elapses the next blow lands again.
  for (let t = 0; t < window; t += DT) game.update(DT, { move: { x: 0, y: 0 }, aim: { x: VW / 2, y: VH / 2 } });
  game.combat.applyHit(player, { damage: 10 }, enemy);
  assert(player.hp < afterFirst, 'a blow after the window must land');
});

check('burning ticks through the mercy window', () => {
  const game = emptyRoom();
  const player = game.getPlayer();
  player.status.apply('burn', 2.4, 1);
  player.burnDamage = 6;

  const before = player.hp;
  // One full tick interval (0.4s) of damage-over-time, inside the window.
  game.combat.applyHit(player, { damage: 5 }, { x: player.x + 20, y: player.y, faction: 'enemy' });
  const afterHit = player.hp;
  assert(player.status.isInvulnerable(), 'the hit must open the window');

  game.combat.updateStatusDamage(0.4, [player]);
  assert(player.hp < afterHit, 'damage over time must ignore the mercy window');
  assert(afterHit <= before, 'the hit itself must land');
});

check('the melee class is no longer outrun by everything that chases it', () => {
  const warrior = CLASSES.warrior.speed * CONFIG.world.speedUnit;
  for (const def of Object.values(ENEMIES)) {
    if (!['chaser', 'melee', 'assassin'].includes(def.ai)) continue;
    // A dash is a burst, not a walk: only sustained speed matters here.
    const speed = def.speed * CONFIG.world.speedUnit;
    assert(
      speed <= warrior,
      `${def.id} walks at ${speed.toFixed(0)} px/s, faster than the warrior's ${warrior.toFixed(0)}`,
    );
  }
});

check('melee damage pays for the range it gives up', () => {
  const dps = (/** @type {string} */ id) => WEAPONS[id].baseDamage / WEAPONS[id].cooldown;
  const sword = dps('sword');
  assert(sword >= 50, `the starting blade must sustain at least 50 DPS, has ${sword.toFixed(1)}`);
  assert(
    sword > dps('fire_staff'),
    `the melee starting weapon (${sword.toFixed(1)} DPS) must out-damage the mage's `
    + `(${dps('fire_staff').toFixed(1)})`,
  );
  // The heavier blades trade reach for weight; both must be worth the wind-up.
  assert(dps('battle_axe') >= 44, `the axe must sustain at least 44 DPS, has ${dps('battle_axe').toFixed(1)}`);
  assert(dps('war_hammer') >= 52, `the hammer must sustain at least 52 DPS, has ${dps('war_hammer').toFixed(1)}`);
  // A melee blow has to outweigh a rapid-fire round: that stagger is what buys
  // the warrior the time to survive standing this close.
  assert(
    WEAPONS.sword.baseDamage > WEAPONS.assault_rifle.baseDamage * 2,
    'a sword blow must be worth more than two rifle rounds',
  );
});

/* ============================================================
   Before / after report
   ============================================================ */

console.log('\n  late arena: late wave recipe (4/6/elite 3), floor-2 scaling, no invincibility cheat');
console.log('  class      mercy window   avg time   cleared   survived   hp left   damage taken');

/** @type {Record<string, ReturnType<typeof benchmark>>} */
const before = {};
/** @type {Record<string, ReturnType<typeof benchmark>>} */
const after = {};

applyData(BASELINE);
for (const cfg of CLASSES_TO_TEST) {
  before[cfg.classId] = benchmark(cfg);
  const r = before[cfg.classId];
  console.log(
    `  ${cfg.classId.padEnd(10)} off            `
    + `${r.seconds.toFixed(1).padStart(6)}s   ${r.cleared}/${r.runs}       `
    + `${r.alive}/${r.runs}       `
    + `${(r.hpFraction * 100).toFixed(0).padStart(3)}%      ${r.damageTaken.toFixed(0)}`,
  );
}

applyData(CURRENT);
for (const cfg of CLASSES_TO_TEST) {
  after[cfg.classId] = benchmark(cfg);
  const r = after[cfg.classId];
  console.log(
    `  ${cfg.classId.padEnd(10)} on             `
    + `${r.seconds.toFixed(1).padStart(6)}s   ${r.cleared}/${r.runs}       `
    + `${r.alive}/${r.runs}       `
    + `${(r.hpFraction * 100).toFixed(0).padStart(3)}%      ${r.damageTaken.toFixed(0)}`,
  );
}

check('the mercy window is what keeps the warrior alive', () => {
  const now = after.warrior;
  const was = before.warrior;
  assert(
    now.alive > was.alive,
    `the warrior must finish more arenas on his feet (${now.alive}/${now.runs} vs ${was.alive}/${was.runs})`,
  );
  assert(
    now.cleared > was.cleared,
    `the warrior must clear more late arenas (${now.cleared}/${now.runs} vs ${was.cleared}/${was.runs})`,
  );
  assert(
    now.damageTaken < was.damageTaken,
    `the warrior must take less damage (${now.damageTaken.toFixed(0)} vs ${was.damageTaken.toFixed(0)})`,
  );
});

check('the warrior is no longer the class that dies first', () => {
  const warrior = after.warrior;
  // Delivered by this pass: the melee class finishes a late arena on its
  // feet more often than not, where it used to die in four of five seeds.
  assert(
    warrior.alive * 2 > warrior.runs,
    `the warrior must survive most late arenas (${warrior.alive}/${warrior.runs})`,
  );
  assert(
    warrior.cleared * 2 > warrior.runs,
    `the warrior must clear most late arenas (${warrior.cleared}/${warrior.runs})`,
  );
});

/* ------------------------------------------------------------
   Honest gap report (printed, not asserted)
   ------------------------------------------------------------ */

const damageRatio = after.warrior.damageTaken / after.gunner.damageTaken;
const timeRatio = after.warrior.seconds / after.gunner.seconds;

console.log('');
console.log('  still open:');
console.log(
  `    the warrior takes ${damageRatio.toFixed(1)}x the gunner's damage and needs `
  + `${timeRatio.toFixed(1)}x the time to clear the same arena`,
);
console.log(
  `    survival: warrior ${after.warrior.alive}/${after.warrior.runs}, `
  + `mage ${after.mage.alive}/${after.mage.runs}, gunner ${after.gunner.alive}/${after.gunner.runs}`,
);
console.log(
  '    the bot never dashes and never disengages, so this is a lower bound for melee:',
);
console.log(
  '    a melee class that cannot retreat is measured at its worst, a kiter at its best.',
);
console.log('');

console.log('');
if (failures === 0) {
  console.log('Survivability benchmark: all checks passed');
} else {
  console.log(`Survivability benchmark: ${failures} check(s) failed`);
}
process.exit(failures > 0 ? 1 : 0);
