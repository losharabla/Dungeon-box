/**
 * DOM integration test.
 *
 * SRP: exercise the layers a pure-logic test cannot reach — index.html id
 * contracts, UIManager wiring, and main.js boot — against a minimal DOM
 * stub. This catches the most common class of "works headlessly, blank
 * screen in the browser" bug: a missing element id or a bad import path.
 *
 * Run with:  node tools/dom-test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ============================================================
   Minimal DOM implementation
   ============================================================ */

/** @type {Map<string, any>} */
const byId = new Map();

class ClassList {
  /** @param {any} el */
  constructor(el) {
    this.el = el;
    /** @type {Set<string>} */
    this.set = new Set();
  }
  add(...names) { for (const n of names) this.set.add(n); this._sync(); }
  remove(...names) { for (const n of names) this.set.delete(n); this._sync(); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const on = force === undefined ? !this.set.has(n) : force;
    if (on) this.set.add(n); else this.set.delete(n);
    this._sync();
    return on;
  }
  _sync() { this.el._className = [...this.set].join(' '); }
  get value() { return [...this.set].join(' '); }
}

class Element {
  /** @param {string} tag */
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    /** @type {any} */
    this.parent = null;
    this.style = {};
    this.dataset = {};
    this._attrs = new Map();
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this._className = '';
    this.classList = new ClassList(this);
    this.hidden = false;
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.disabled = false;
    this.width = 0;
    this.height = 0;
  }

  /**
   * Assigning innerHTML clears existing children, as it does in a browser.
   * UIManager relies on this to rebuild grids.
   */
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    for (const c of this.children) c.parent = null;
    this.children = [];
  }

  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }

  setAttribute(k, v) {
    this._attrs.set(k, String(v));
    if (k === 'class') this.className = String(v);
  }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this._attrs.has(k); }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    return child;
  }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    /** @type {any[]} */
    const out = [];
    // Collect only from the top level when this node is a container, so a
    // nested match is not counted twice by an outer walk.
    for (const c of this.children) {
      if (c.classList && c.classList.contains(cls)) out.push(c);
      else out.push(...c.querySelectorAll(sel));
    }
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)?.add(fn);
  }
  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); }

  /** @param {string} type @param {any} [event] */
  dispatch(type, event = {}) {
    const e = { type, target: this, preventDefault() {}, ...event };
    for (const fn of this._listeners.get(type) ?? []) fn(e);
    return e;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 };
  }
  getContext() { return makeContext(); }
}

/**
 * A no-op 2D context, matching what the renderers call.
 */
function makeContext() {
  const grad = { addColorStop() {} };
  return {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000',
    lineWidth: 1, lineCap: 'butt', lineDashOffset: 0,
    font: '', textAlign: 'left', textBaseline: 'top',
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    setLineDash() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    ellipse() {}, quadraticCurveTo() {}, rect() {}, fill() {}, stroke() {},
    fillRect() {}, strokeRect() {}, clearRect() {}, fillText() {}, strokeText() {},
    clip() {}, setTransform() {}, measureText: () => ({ width: 0 }),
  };
}

/**
 * Parse index.html and register every element carrying an id, plus the
 * `.screen[data-screen]` sections and the `.help-block` node.
 */
function buildDocumentFromHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // Register every id="..." as an element.
  const idRe = /id="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(html)) !== null) {
    const el = new Element(m[1] === 'game-canvas' ? 'canvas' : 'div');
    el.setAttribute('id', m[1]);
    byId.set(m[1], el);
  }

  // Screens: <section class="screen" data-screen="name" ...>
  const screenRe = /<section[^>]*class="[^"]*\bscreen\b[^"]*"[^>]*data-screen="([^"]+)"[^>]*>/g;
  /** @type {any[]} */
  const screens = [];
  while ((m = screenRe.exec(html)) !== null) {
    const el = new Element('section');
    el.className = 'screen';
    el.setAttribute('data-screen', m[1]);
    screens.push(el);
  }

  const help = new Element('div');
  help.className = 'help-block';

  const doc = {
    listeners: new Map(),
    getElementById: (id) => byId.get(id) ?? null,
    querySelectorAll: (sel) => (sel === '.screen' ? screens : []),
    querySelector: (sel) => (sel === '.help-block' ? help : null),
    createElement: (tag) => new Element(tag),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    },
    /** @param {any} target @param {string} type */
    bubbleClick(target, type = 'click') {
      const e = { type, target, preventDefault() {} };
      for (const fn of this.listeners.get(type) ?? []) fn(e);
    },
  };
  return doc;
}

const document = buildDocumentFromHtml();

globalThis.document = document;
globalThis.performance ??= { now: () => Date.now() };
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.KeyboardEvent = class {};

/* ============================================================
   Checks
   ============================================================ */

const results = [];
/** @param {string} name @param {() => any} fn */
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

await check('index.html declares every id UIManager requires', async () => {
  const { UIManager } = await import('../src/ui/UIManager.js');

  const intents = {
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  };

  // UIManager's constructor resolves every element by id and throws on a
  // missing one, so constructing it validates the whole HTML contract.
  const ui = new UIManager(intents);
  assert.ok(ui, 'UIManager must construct against index.html');

  // The screens the design document requires (§31) must all exist.
  for (const screen of ['menu', 'character_select', 'playing', 'game_over', 'victory']) {
    assert.ok(ui.el.screens[screen], `#${screen} screen is missing from index.html`);
  }
});

await check('UIManager builds class and ultimate cards', async () => {
  const { UIManager } = await import('../src/ui/UIManager.js');
  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  const cards = ui.el.classGrid.querySelectorAll('.class-card');
  assert.equal(cards.length, 3, 'three class cards must be built');

  const ults = ui.el.ultList.querySelectorAll('.ult-card');
  assert.equal(ults.length, 3, 'three ultimate cards must be built for the selected class');

  // Selecting another class must rebuild the ultimate list.
  ui.selectClass('mage');
  assert.equal(ui.el.ultList.querySelectorAll('.ult-card').length, 3);
  assert.equal(ui.selectedClass, 'mage');
});

await check('UIManager screen switching hides the others', async () => {
  const { UIManager } = await import('../src/ui/UIManager.js');
  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  ui.showScreen('character_select');
  assert.equal(ui.el.screens.character_select.hidden, false);
  assert.equal(ui.el.screens.menu.hidden, true, 'the menu must hide');
  assert.equal(ui.screen, 'character_select');

  ui.showScreen('playing');
  assert.equal(ui.el.screens.playing.hidden, false);
  assert.equal(ui.el.screens.character_select.hidden, true);
});

await check('UIManager HUD renders player state', async () => {
  const { UIManager } = await import('../src/ui/UIManager.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { Player } = await import('../src/entities/Player.js');

  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  const player = new Player({ classId: 'warrior', x: 0, y: 0, ultimateId: 'whirlwind' });
  player.hp = 90;
  player.gold = 250;
  player.ultCharge = 80;

  const rooms = {
    registry: { enemies: [] },
  };
  const run = { plan: null, currentNodeId: -1, clearedNodes: new Set(), floorIndex: 0 };

  ui.updateHud(player, run, rooms);

  assert.equal(ui.el.hpText.textContent, '90 / 150');
  assert.equal(ui.el.goldText.textContent, '250');
  assert.equal(ui.el.hpFill.style.width, '60%', 'HP bar must reflect 90/150');
  assert.equal(ui.el.ultFill.style.width, '80%');
  assert.equal(ui.el.weaponName.textContent, 'Sword');

  // A legendary weapon must be marked for styling.
  const { getWeapon } = await import('../src/data/weapons.js');
  player.equip(getWeapon('bloodthirster'));
  ui.updateHud(player, run, rooms);
  assert.equal(ui.el.weaponName.textContent, 'Bloodthirster');
  assert.ok(
    ui.el.weaponName.classList.contains('legendary'),
    'legendary weapons must carry the legendary class',
  );
  void EventBus;
});

await check('UIManager shows the boss bar only during a boss fight', async () => {
  const { UIManager } = await import('../src/ui/UIManager.js');
  const { Player } = await import('../src/entities/Player.js');
  const { Boss } = await import('../src/entities/Boss.js');

  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  const player = new Player({ classId: 'gunner', x: 0, y: 0, ultimateId: 'ricochet' });
  const run = { plan: null, currentNodeId: -1, clearedNodes: new Set(), floorIndex: 0 };

  // No boss: the bar stays hidden.
  ui.updateHud(player, run, { registry: { enemies: [] } });
  assert.equal(ui.el.bossBar.hidden, true, 'the boss bar must be hidden without a boss');

  // Boss present: the bar appears and is named.
  const boss = new Boss({ bossId: 'stone_golem', x: 0, y: 0 });
  boss.hp = boss.maxHp / 2;
  ui.updateHud(player, run, { registry: { enemies: [boss] } });
  assert.equal(ui.el.bossBar.hidden, false, 'the boss bar must appear');
  assert.equal(ui.el.bossName.textContent, 'STONE GOLEM');
  assert.equal(ui.el.bossFill.style.width, '50%');
});

await check('UIManager renders shop stock and disables unaffordable items', async () => {
  const { UIManager } = await import('../src/ui/UIManager.js');
  const { Player } = await import('../src/entities/Player.js');

  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  const player = new Player({ classId: 'gunner', x: 0, y: 0, ultimateId: 'ricochet' });
  player.gold = 60;

  const stock = [
    { kind: 'weapon', id: 'pistol', name: 'Pistol', desc: 'd', price: 50 },
    { kind: 'potion', id: 'potion', name: 'Potion', desc: 'd', price: 30 },
    { kind: 'weapon', id: 'sniper_rifle', name: 'Sniper Rifle', desc: 'd', price: 260, legendary: true },
  ];

  ui.openShop(stock, player);
  const items = ui.el.shopGrid.querySelectorAll('.shop-item');
  assert.equal(items.length, 3, 'every stock entry must render');

  const buttons = [];
  for (const item of items) {
    for (const child of item.children) {
      if (child.tagName === 'BUTTON') buttons.push(child);
    }
  }
  assert.equal(buttons.length, 3, 'each item needs a buy button');
  assert.equal(buttons[0].disabled, false, '50 gold with 60 held is affordable');
  assert.equal(buttons[1].disabled, false, '30 gold is affordable');
  assert.equal(buttons[2].disabled, true, '260 gold is not affordable');
});

await check('the HUD shows the weapon line and the run\'s stacked stats', async () => {
  // Reported problem: the HUD named the weapon and nothing else, so the
  // numbers behind it — the damage multiplier, the attack-speed stack, the
  // crit chance, the lifesteal that "was not sure to stack" — were invisible.
  const { UIManager } = await import('../src/ui/UIManager.js');
  const { Player } = await import('../src/entities/Player.js');
  const { UPGRADES } = await import('../src/data/upgrades.js');

  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  const player = new Player({ classId: 'warrior', x: 0, y: 0, ultimateId: 'whirlwind' });
  const run = { plan: null, currentNodeId: -1, clearedNodes: new Set(), floorIndex: 0 };
  const rooms = { registry: { enemies: [] } };

  ui.updateHud(player, run, rooms);
  assert.match(ui.el.weaponStats.textContent, /22 dmg/, 'the weapon line must carry its damage');
  assert.match(ui.el.weaponStats.textContent, /55 dps/, 'the weapon line must carry its dps');
  assert.match(ui.el.hudStats.innerHTML, /LEECH<span class="v">0%<\/span>/,
    'the character row must show every stacked stat, even at zero');
  assert.ok(!/boosted/.test(ui.el.hudStats.innerHTML), 'a fresh run has nothing boosted yet');

  // Two copies of Vampiric Edge: the chip is the running total, which is the
  // number the player could not see before.
  UPGRADES.life_steal.apply(player);
  UPGRADES.life_steal.apply(player);
  ui.updateHud(player, run, rooms);
  assert.match(ui.el.hudStats.innerHTML, /LEECH<span class="v">10%<\/span>/,
    'the chip must show the stacked total');
  assert.match(ui.el.hudStats.innerHTML, /stat-chip boosted/, 'a raised stat must be highlighted');

  // A staff must advertise the mode the mage actually plays.
  const { getWeapon } = await import('../src/data/weapons.js');
  player.equip(getWeapon('fire_staff'));
  ui.updateHud(player, run, rooms);
  assert.match(ui.el.weaponStats.textContent, /beam 30\/s/, 'the staff line must carry its beam');
  assert.match(ui.el.weaponStats.textContent, /burn 6\/s/, 'the staff line must carry its burn');
});

await check('shop and reward cards say what the totals become', async () => {
  // "It is unclear whether it adds to what I already have" — the card has to
  // answer that, and it can only do so by reading the player's current value.
  const { UIManager } = await import('../src/ui/UIManager.js');
  const { Player } = await import('../src/entities/Player.js');

  const ui = new UIManager({
    startRun() {}, restart() {}, nextFloor() {}, resume() {}, abandonRun() {},
    shopLeave() {}, healingLeave() {}, rewardTake() {}, buy() {}, pickReward() {},
    selectCharacter() {},
  });

  const player = new Player({ classId: 'warrior', x: 0, y: 0, ultimateId: 'whirlwind' });
  player.modifiers.lifeSteal = 0.05; // already owns one Vampiric Edge
  player.gold = 500;

  const stock = [
    { kind: 'upgrade', id: 'life_steal', name: 'Vampiric Edge', desc: 'd', price: 140 },
    { kind: 'weapon', id: 'battle_axe', name: 'Battle Axe', desc: 'd', price: 50 },
    { kind: 'potion', id: 'potion', name: 'Potion', desc: 'd', price: 30 },
  ];
  ui.openShop(stock, player);

  const cards = ui.el.shopGrid.querySelectorAll('.shop-item');
  assert.equal(cards.length, 3, 'every stock entry must render');
  const deltaOf = (card) => card.querySelectorAll('.si-delta')[0]?.textContent ?? '';
  assert.equal(
    deltaOf(cards[0]),
    'Life steal 5% → 10%',
    'a second copy must be shown as an addition to the first',
  );
  assert.match(deltaOf(cards[1]), /37 dmg/, 'a weapon offer must carry its own stats');
  assert.equal(deltaOf(cards[2]), '', 'a potion has nothing to compare');

  // The reward overlay renders the same line through the same helper.
  ui.openReward([
    { kind: 'upgrade', id: 'life_steal', name: 'Vampiric Edge', desc: 'd', price: 0 },
    { kind: 'gold', id: 'gold_pile', name: 'Gold', desc: 'd', price: 0 },
  ], player);
  const rewardCards = ui.el.rewardGrid.querySelectorAll('.reward-item');
  assert.equal(rewardCards.length, 2, 'both reward choices must render');
  assert.equal(
    rewardCards[0].querySelectorAll('.si-delta')[0]?.textContent,
    'Life steal 5% → 10%',
  );
  assert.equal(
    rewardCards[1].querySelectorAll('.si-delta').length,
    0,
    'gold needs no comparison line',
  );
});

await check('main.js boots and wires the loop without throwing', async () => {
  // The strongest available end-to-end check: import the real entry point.
  await import('../src/main.js');
  // main.js publishes its handle on `window`, exactly as the browser would.
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  assert.ok(handle, 'main.js must expose __roguelike for diagnostics');
  assert.ok(handle.game, 'a Game must be constructed');
  assert.ok(handle.loop, 'the loop must be constructed');
  assert.ok(handle.ui, 'the UI manager must be constructed');
  assert.equal(handle.state.current, 'menu', 'the game must boot on the main menu');
});

await check('the mixer is wired, and degrades silently with no Web Audio', async () => {
  // This stub has no `AudioContext`, which is exactly the situation the audio
  // layer must survive: the boot and the whole feature set stay usable, and
  // nothing throws. The synth itself is measured in `audio-test.mjs`.
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  const { audio, ui } = handle;
  assert.ok(audio, 'main.js must expose the mixer');
  assert.equal(audio.supported, false, 'this stub provides no AudioContext');
  assert.equal(await audio.unlock(), false, 'unlock must report failure, not throw');
  assert.equal(audio.play('hit_flesh'), null, 'play must be a silent no-op');
  assert.equal(audio.ctx, null, 'no graph may exist without a context');

  // The mixer controls must still render and be operable: the UI adapter is
  // the null object, so driving it changes nothing and throws nothing.
  const container = ui.el.settingsPause;
  const rows = container.querySelectorAll('.setting-range');
  assert.equal(rows.length, 3, 'the pause screen must offer three levels');

  const ranges = Object.fromEntries(
    rows.map((r) => [r.getAttribute('data-setting'), r]),
  );
  for (const key of ['master', 'music', 'effects']) {
    assert.ok(ranges[key], `#settings-pause must hold the ${key} slider`);
    assert.equal(ranges[key].getAttribute('min'), '0', `${key} must start at 0`);
    assert.equal(ranges[key].getAttribute('max'), '100', `${key} must end at 100`);
  }
  assert.equal(
    ui.el.settingsMenu.querySelectorAll('.setting-range').length,
    3,
    'the main menu must offer the same three levels',
  );
  assert.ok(
    ui.el.settingsMenu.querySelectorAll('.setting-mute').length === 1
    && ui.el.settingsPause.querySelectorAll('.setting-mute').length === 1,
    'both panels must offer the mute toggle',
  );

  ranges.master.value = '40';
  ranges.master.dispatch('input');
  assert.equal(ui.el.settingsMenu.querySelectorAll('.setting-value')[0].textContent, '40%',
    'moving one slider must update both readouts');

  audio.setQuality(0.5);
  audio.update();
  audio.destroy();
});

await check('a full run survives UI-driven start and a frame step', async () => {
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  assert.ok(handle, 'the boot handle must exist');
  const { game } = handle;

  game.startRun('mage', 'meteor', 1234);
  assert.ok(game.getPlayer(), 'a player must exist after startRun');
  assert.equal(game.getPlayer().classId, 'mage');
  assert.equal(game.getPlayer().ultimateId, 'meteor');

  // Step the simulation a few seconds with neutral input.
  for (let i = 0; i < 60 * 3; i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 },
      aim: { x: 640, y: 360 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }
  assert.ok(game.getPlayer().alive, 'the player must survive three idle seconds');

  // And the room must be a real one with geometry.
  const rt = game.rooms.runtime;
  assert.ok(rt, 'a room runtime must exist');
  assert.ok(rt.room.walls.length > 0, 'the room must have walls');
});

await check('the floor panel reveals no rooms, only progress', async () => {
  // Reported problem: the whole floor was generated up front and the HUD
  // listed every room on it, so the player could see — and skip — what was
  // coming. The panel must show how far along the path they are and nothing
  // about which rooms exist.
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  const { game, ui } = handle;

  game.startRun('warrior', 'whirlwind', 777);
  ui.updateHud(game.getPlayer(), game.run, game.rooms);

  const html = ui.el.rooms.innerHTML;
  assert.match(html, /FLOOR/, 'the panel must name the floor');
  assert.match(html, /ROOM/, 'the panel must show progress along the path');

  // No room may be described anywhere in the panel: no list, no names, no
  // per-room markers.
  for (const label of ['FIGHT', 'SHOP', 'HEAL', 'BOSS', 'arena', 'shop', 'healing', 'boss']) {
    assert.ok(
      !html.includes(label),
      `the floor panel must not name rooms (found "${label}")`,
    );
  }
  assert.ok(!/class="[^"]*\bnode\b/.test(html), 'the panel must not draw per-room nodes');

  // It tracks progress instead, and updates as the player advances.
  assert.match(html, /ROOM 1 \/ \d+/, 'the entrance is room 1');
  const before = html;
  game.rooms.runtime.cleared = true;
  game.run.markCleared();
  game.travelTo(game.run.currentNode().next[0]);
  ui.updateHud(game.getPlayer(), game.run, game.rooms);
  assert.match(ui.el.rooms.innerHTML, /ROOM 2 \/ \d+/, 'the counter must advance');
  assert.notEqual(ui.el.rooms.innerHTML, before, 'the panel must refresh on a new room');
});

await check('the renderer and the simulation share one camera instance', async () => {
  // Regression guard: Game used to construct its own Camera while main.js
  // handed a different one to RenderSystem. Both looked correct in
  // isolation, but the renderer read a camera nobody ever moved, so the
  // world was drawn from a fixed origin at the room's corner.
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  const { game, render } = handle;
  assert.equal(render.camera, game.camera,
    'RenderSystem.camera must be the same object Game updates');

  // End to end: what the player sees must actually track the player.
  const player = game.getPlayer();
  const beforeX = render.camera.x;
  const startX = player.x;

  for (let i = 0; i < 60 * 2; i++) {
    game.update(1 / 60, {
      move: { x: 1, y: 0 },
      aim: { x: 640, y: 360 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }

  assert.ok(player.x - startX > 20, 'the player must actually walk');
  assert.ok(render.camera.x - beforeX > 20, 'the rendered view must move with the player');

  // While walking, the eased camera trails the player by design. Held still,
  // it must converge onto the player.
  for (let i = 0; i < 60 * 2; i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 },
      aim: { x: 640, y: 360 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }
  assert.ok(Math.abs(render.camera.x - player.x) < 2,
    `the rendered view must settle on the player (camera ${render.camera.x}, player ${player.x})`);
  assert.ok(Math.abs(render.camera.y - player.y) < 2,
    `the rendered view must settle on the player (camera ${render.camera.y}, player ${player.y})`);
});

await check('a boss victory advances to the next floor through the real UI', async () => {
  // Regression guard: the middle bosses cleared but never opened the victory
  // screen, so "Next Floor" was unreachable and the run dead-ended after
  // the first boss. The campaign test called game.nextFloor() directly and
  // could not see the broken flow, so this walks the exact click path.
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  const { game, ui, state } = handle;

  game.startRun('warrior', 'whirlwind', 4242);

  /** Kill the boss of the floor we are on and drain the simulation. */
  const defeatBoss = () => {
    game.run.enterNode(game.run.plan.bossId, game.getPlayer());
    const boss = game.registry.enemies.find((e) => e.kind === 'boss');
    assert.ok(boss, 'the boss room must spawn a boss');
    game.combat.applyHit(boss, { damage: 999999 }, game.getPlayer());
    for (let i = 0; i < 60 * 2; i++) {
      game.update(1 / 60, {
        move: { x: 0, y: 0 },
        aim: { x: 640, y: 360 },
        attackHeld: false, attackPressed: false, ultPressed: false,
      });
    }
    assert.equal(game.rooms.runtime.cleared, true, 'the boss room must be cleared');
  };

  /** Click the real delegated action on a real element. */
  const click = (el) => document.bubbleClick(el);

  // --- Floor 1 of 3: victory screen must appear with a working button ----
  defeatBoss();
  assert.equal(ui.el.reward.hidden, false, 'the boss reward must be offered first');
  const takeCard = ui.el.rewardGrid.children[0]?.children?.find?.((c) => c.tagName === 'BUTTON');
  assert.ok(takeCard, 'the reward overlay must render a take button');
  takeCard.dispatch('click');

  assert.equal(state.current, 'victory', 'closing the reward must reveal the victory screen');
  assert.equal(ui.el.screens.victory.hidden, false, 'the victory screen must be visible');
  assert.equal(ui.el.nextFloorBtn.hidden, false, 'a non-final floor must offer the next floor');

  ui.el.nextFloorBtn.setAttribute('data-action', 'next-floor');
  click(ui.el.nextFloorBtn);

  assert.equal(game.run.floorIndex, 1, 'the button must descend to floor 2');
  assert.equal(state.current, 'playing', 'play must resume after descending');
  assert.equal(ui.el.screens.playing.hidden, false, 'the playing screen must return');
  assert.ok(game.getPlayer().alive, 'the player must carry over to the next floor');
  assert.ok(game.getPlayer().stats.damageDealt > 0, 'run statistics must survive the descent');

  // --- Floor 2: same flow -------------------------------------------------
  defeatBoss();
  ui.el.rewardGrid.children[0]?.children?.find?.((c) => c.tagName === 'BUTTON')?.dispatch('click');
  assert.equal(state.current, 'victory');
  click(ui.el.nextFloorBtn);
  assert.equal(game.run.floorIndex, 2, 'the second descent must reach the final floor');

  // --- Floor 3: final boss ends the run and hides the dead-end button -----
  defeatBoss();
  ui.el.rewardGrid.children[0]?.children?.find?.((c) => c.tagName === 'BUTTON')?.dispatch('click');
  assert.equal(state.current, 'victory', 'the final boss must also show the victory screen');
  assert.equal(ui.el.nextFloorBtn.hidden, true, 'the final floor must not offer a 4th floor');
  assert.equal(game.run.active, false, 'the run must be over after the final boss');
});

await check('a used shop reopens, and ESC backs out of its screen', async () => {
  // The reported problem, driven through the real keyboard path: walk to the
  // stall, press E, press ESC, press E again. The shop used to be consumed by
  // its own screen, so the second press did nothing.
  const handle = /** @type {any} */ (globalThis.window).__roguelike;
  assert.ok(handle?.interact && handle?.togglePause, 'the debug handle must expose the keyboard path');
  const { game, ui, state } = handle;
  state.force('playing');

  let found = false;
  for (let seed = 1; seed < 200 && !found; seed++) {
    game.startRun('warrior', 'whirlwind', seed);
    const offer = game.run.exits().find((o) => o.type === 'shop');
    if (!offer) continue;
    game.travelTo(offer.id);
    found = true;
  }
  assert.ok(found, 'a seeded floor must offer a shop');

  // Entering a room leaves the player at its centre, which is where the stall
  // is, so no walking is needed to be in range of the merchant.
  const centre = game.rooms.runtime.room.center;
  const player = game.getPlayer();
  player.x = centre.x;
  player.y = centre.y;

  handle.interact();
  assert.equal(ui.el.shop.hidden, false, 'E must open the shop screen');
  assert.equal(game.rooms.runtime.cleared, true, 'the visit consumes the room');

  handle.togglePause();
  assert.equal(ui.el.shop.hidden, true, 'ESC must close the shop screen');
  assert.equal(state.current, 'playing', 'ESC must not stack the pause screen on top of it');

  handle.interact();
  assert.equal(ui.el.shop.hidden, false, 'the same shop must open again');
  assert.equal(game.getInteraction()?.kind, 'shop', 'the stall must stay usable');
  handle.togglePause();
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
console.log(`${results.length - failures}/${results.length} DOM checks passed`);
process.exit(failures > 0 ? 1 : 0);
