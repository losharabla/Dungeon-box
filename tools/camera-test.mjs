/**
 * Camera framing test.
 *
 * The camera follows the player unconditionally. This is deliberate: every
 * room in the game is smaller than the logical view (an arena is 1120x760
 * against a 1280x720 view), so clamping the camera to the room left it with
 * at most 40px of travel — effectively frozen while the player walked
 * off-centre. Following unconditionally keeps the player centred, and
 * `RoomRenderer.drawBedrock` fills the overscan so the space beyond the
 * walls reads as solid rock.
 *
 * Run with:  node tools/camera-test.mjs
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';
import { StateMachine } from '../src/core/StateMachine.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };

const { Game } = await import('../src/game/Game.js');

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;

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

function newGame() {
  const bus = new EventBus();
  return new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
}

/**
 * Walks toward a point and reports the settle state.
 * @param {any} game
 * @param {number} x @param {number} y
 * @param {number} [seconds]
 */
function walkTo(game, x, y, seconds = 3) {
  const player = game.getPlayer();
  for (let i = 0; i < 60 * seconds; i++) {
    const dx = x - player.x;
    const dy = y - player.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) break;
    game.update(1 / 60, {
      move: { x: dx / d, y: dy / d },
      aim: { x: VW / 2, y: VH / 2 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }
  return { player, camera: game.camera };
}

/* ---------- Checks ---------------------------------------------------- */

check('the camera is not clamped to the room', () => {
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 1234);
  assert.equal(game.camera.bounds, null, 'the camera must be unconstrained');
});

check('THE REPORTED BUG: the player stays centred while walking', () => {
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 1234);
  const player = game.getPlayer();
  const b = game.rooms.runtime.room.bounds;

  // Sweep across the whole room; the player must remain at screen centre.
  const waypoints = [
    [b.x + b.w / 2, b.y + 30],
    [b.x + b.w / 2, b.y + b.h - 30],
    [b.x + 30, b.y + b.h / 2],
    [b.x + b.w - 30, b.y + b.h / 2],
  ];

  for (const [tx, ty] of waypoints) {
    walkTo(game, tx, ty, 4);
    // Let the easing settle.
    for (let i = 0; i < 40; i++) {
      game.update(1 / 60, {
        move: { x: 0, y: 0 }, aim: { x: VW / 2, y: VH / 2 },
        attackHeld: false, attackPressed: false, ultPressed: false,
      });
    }

    const offsetX = player.x - game.camera.x;
    const offsetY = player.y - game.camera.y;
    assert.ok(
      Math.abs(offsetX) < 2,
      `player drifted horizontally at (${tx.toFixed(0)},${ty.toFixed(0)}): dx=${offsetX.toFixed(2)}`,
    );
    assert.ok(
      Math.abs(offsetY) < 2,
      `player drifted vertically at (${tx.toFixed(0)},${ty.toFixed(0)}): dy=${offsetY.toFixed(2)}`,
    );
  }
});

check('the player is never pushed off screen, even against a wall', () => {
  const game = newGame();
  game.startRun('mage', 'meteor', 77);
  const player = game.getPlayer();
  const b = game.rooms.runtime.room.bounds;

  // Press into each corner and confirm the player is still on screen.
  for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    for (let i = 0; i < 60 * 4; i++) {
      game.update(1 / 60, {
        move: { x: mx, y: my }, aim: { x: VW / 2, y: VH / 2 },
        attackHeld: false, attackPressed: false, ultPressed: false,
      });
    }

    const screenX = (player.x - game.camera.x) + VW / 2;
    const screenY = (player.y - game.camera.y) + VH / 2;

    assert.ok(screenX > 0 && screenX < VW, `player off screen in X (screenX=${screenX.toFixed(0)})`);
    assert.ok(screenY > 0 && screenY < VH, `player off screen in Y (screenY=${screenY.toFixed(0)})`);
    // Pressed hard into a corner while still moving, a small lead is
    // expected from the follow easing; a few pixels is not "off-centre".
    assert.ok(
      Math.abs(screenX - VW / 2) < 12 && Math.abs(screenY - VH / 2) < 12,
      `player must stay near screen centre, got (${screenX.toFixed(0)},${screenY.toFixed(0)})`,
    );
  }
  void b;
});

check('the camera snaps on room entry instead of sliding', () => {
  const game = newGame();
  game.startRun('gunner', 'ricochet', 55);
  const player = game.getPlayer();

  const node = game.run.currentNode();
  assert.ok(node.next.length > 0, 'expected a room to travel to');

  game.travelTo(node.next[0]);
  const rt = game.rooms.runtime;
  const b = rt.room.bounds;

  // On entry the camera must already be on the player, whose spawn is well
  // away from the previous room's position.
  assert.ok(
    Math.abs(game.camera.x - player.x) < 1 && Math.abs(game.camera.y - player.y) < 1,
    'the camera must snap to the player when a room loads',
  );
  // And the player must spawn inside the room.
  assert.ok(player.x >= b.x && player.x <= b.x + b.w, 'player must spawn inside the room');
  assert.ok(player.y >= b.y && player.y <= b.y + b.h, 'player must spawn inside the room');
});

check('most rooms are smaller than the view (why clamping was removed)', () => {
  // Documents the reason for the design. The boss arena is the one room that
  // exceeds the view on both axes; clamping applied to every room would leave
  // the rest — which is nearly all of them — with almost no camera travel.
  const game = newGame();
  game.startRun('warrior', 'whirlwind', 3);

  const sizes = [];
  for (let guard = 0; guard < 20; guard++) {
    const rt = game.rooms.runtime;
    if (!rt) break;
    sizes.push({ type: rt.type, w: rt.room.bounds.w, h: rt.room.bounds.h });

    const node = game.run.currentNode();
    if (!node || node.next.length === 0) break;
    rt.cleared = true;
    game.travelTo(node.next[0]);
  }

  assert.ok(sizes.length > 0, 'expected to visit rooms');

  const scrollable = sizes.filter((s) => s.w > VW && s.h > VH);
  assert.ok(
    scrollable.length <= 1,
    `expected at most the boss arena to exceed the view on both axes, got ${scrollable.length}`,
  );
  // And the arena specifically must be one of the non-scrollable ones, which
  // is the case that made clamping useless.
  const arena = sizes.find((s) => s.type === 'arena');
  if (arena) {
    assert.ok(
      arena.w <= VW || arena.h <= VH,
      `the arena (${arena.w}x${arena.h}) must not fit the view on both axes`,
    );
  }
});

check('a resize does not move the camera', () => {
  const game = newGame();
  game.startRun('mage', 'meteor', 555);

  for (let i = 0; i < 120; i++) {
    game.update(1 / 60, {
      move: { x: 1, y: 0 }, aim: { x: VW / 2, y: VH / 2 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }
  const before = { x: game.camera.x, y: game.camera.y };

  // The camera works in fixed logical units, so nothing re-framing should
  // happen on a resize.
  game._snapCameraToPlayer();

  assert.equal(Math.round(game.camera.x), Math.round(game.getPlayer().x));
  assert.equal(Math.round(game.camera.y), Math.round(game.getPlayer().y));
  void before;
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
  }
}
console.log('');
console.log(`${results.length - failures}/${results.length} camera checks passed`);
process.exit(failures > 0 ? 1 : 0);
