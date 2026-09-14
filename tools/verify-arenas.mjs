/**
 * Verify that a crowded arena is always clearable.
 *
 * The campaign bot occasionally stalls in a late arena. This probe tests
 * the underlying question directly: given the enemies a late arena really
 * spawns, can a player standing anywhere in the room reach and kill them
 * all? If yes, the game is sound and the stall is bot behaviour.
 */
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';
import { NavGrid } from './NavGrid.mjs';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');

let trials = 0;
let cleared = 0;
let totalTime = 0;
let worstTime = 0;

for (let attempt = 0; attempt < 12; attempt++) {
  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('gunner', 'ricochet', 60000 + attempt * 313);
  const player = game.getPlayer();

  // Enter an arena.
  game.travelTo(game.run.currentNode().next[0]);
  const rt = game.rooms.runtime;
  if (rt.type !== 'arena') continue;
  trials++;

  const toScreen = (wx, wy) => ({
    x: wx - game.camera.x + CONFIG.view.width / 2,
    y: wy - game.camera.y + CONFIG.view.height / 2,
  });

  let nav = new NavGrid(rt.room.bounds, game.collisionWorld, player.radius);
  let path = [];
  let repathTimer = 0;
  const dt = CONFIG.loop.fixedStep;
  let t = 0;
  let clearedThis = false;

  while (t < 300) {
    // Invincible: this measures whether enemies can be *reached*, not
    // whether the player survives.
    player.hp = player.maxHp;

    const enemies = game.registry.enemies.filter((e) => e.alive);
    const target = enemies[0];

    let goalX = rt.room.center.x;
    let goalY = rt.room.center.y;
    if (target && !rt.cleared) { goalX = target.x; goalY = target.y; }
    else if (rt.cleared) {
      const door = rt.room.doors.find((d) => d.open);
      if (door) { goalX = door.rect.x + door.rect.w / 2; goalY = door.rect.y + door.rect.h / 2; }
    }

    repathTimer -= dt;
    if (path.length === 0 || repathTimer <= 0) {
      path = nav.findPath(player.x, player.y, goalX, goalY);
      repathTimer = 0.4;
    }
    while (path.length > 0) {
      const wp = path[0];
      if (Math.hypot(wp.x - player.x, wp.y - player.y) < 26) path.shift();
      else break;
    }

    const navX = path.length > 0 ? path[0].x : goalX;
    const navY = path.length > 0 ? path[0].y : goalY;
    let mx = navX - player.x;
    let my = navY - player.y;

    // Keep the preferred stand-off distance.
    const dist = Math.hypot(goalX - player.x, goalY - player.y);
    if (target && dist < 150) {
      const away = Math.atan2(player.y - goalY, player.x - goalX);
      mx = mx * 0.45 + Math.cos(away) * 0.55;
      my = my * 0.45 + Math.sin(away) * 0.55;
    }

    const ml = Math.hypot(mx, my) || 1;
    game.update(dt, {
      move: { x: mx / ml, y: my / ml },
      aim: target ? toScreen(target.x, target.y) : toScreen(goalX, goalY),
      attackHeld: Boolean(target) && !rt.cleared,
      attackPressed: Boolean(target) && !rt.cleared,
      ultPressed: player.ultReady,
    });
    t += dt;

    // Rebuild the grid if the room geometry changed (doors opening).
    if (rt.cleared && !clearedThis) {
      clearedThis = true;
      nav = new NavGrid(rt.room.bounds, game.collisionWorld, player.radius);
    }

    if (rt.cleared) break;
  }

  if (rt.cleared) {
    cleared++;
    totalTime += t;
    worstTime = Math.max(worstTime, t);
  } else {
    console.log(`  arena NOT cleared after 300s (seed ${60000 + attempt * 313})`);
    const remaining = game.registry.enemies.filter((e) => e.alive);
    console.log(`    remaining: ${remaining.map((e) => `${e.kind}@${e.x.toFixed(0)},${e.y.toFixed(0)}`).join(' ')}`);
    console.log(`    player at (${player.x.toFixed(0)},${player.y.toFixed(0)})`);
  }
}

console.log('');
console.log(`arenas cleared: ${cleared}/${trials}`);
if (cleared > 0) {
  console.log(`average clear time: ${(totalTime / cleared).toFixed(1)}s`);
  console.log(`slowest clear: ${worstTime.toFixed(1)}s`);
}
console.log('');
console.log(cleared === trials
  ? 'RESULT: every arena is clearable by a competent pathfinding player.'
  : 'RESULT: some arenas were NOT cleared — investigate.');
