/**
 * Headless smoke test.
 *
 * SRP: prove that the pure-logic layers (core, data, entities, systems)
 * import cleanly and that a full run can be simulated without a browser.
 *
 * Run with:  node tools/smoke-test.mjs
 *
 * This is a development tool, not part of the shipped game.
 */

import assert from 'node:assert/strict';

/* ---------- DOM shims -------------------------------------------------
   The rendering layer and UI touch browser globals. We only exercise the
   logic layers, but a few modules reference these at import time.        */
globalThis.performance ??= { now: () => Date.now() };

const results = [];
/**
 * @param {string} name
 * @param {() => any} fn
 */
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err });
  }
}

/* ---------- Core ------------------------------------------------------ */
await check('core/MathUtils', async () => {
  const m = await import('../src/core/MathUtils.js');
  assert.equal(m.clamp(5, 0, 3), 3);
  assert.equal(m.clamp(-5, 0, 3), 0);
  assert.equal(m.lerp(0, 10, 0.5), 5);
  assert.equal(Math.round(m.dist(0, 0, 3, 4)), 5);
  assert.equal(m.percent(50, 200), 25);
  assert.equal(m.percent(0, 0), 0);
});

await check('core/Random is deterministic', async () => {
  const { Random } = await import('../src/core/Random.js');
  const a = new Random(12345);
  const b = new Random(12345);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  const r = new Random(1);
  const sample = r.sample([1, 2, 3, 4, 5], 3);
  assert.equal(sample.length, 3);
  assert.equal(new Set(sample).size, 3);
});

await check('core/EventBus pub/sub incl. throwing handler isolation', async () => {
  const { EventBus } = await import('../src/core/EventBus.js');
  const bus = new EventBus();
  let count = 0;
  const off = bus.on('x', () => { count++; });
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', () => { count++; });
  bus.emit('x');
  assert.equal(count, 2, 'a throwing handler must not stop delivery');
  assert.equal(bus.listenerCount('x'), 3, 'a throwing handler stays subscribed');
  off();
  bus.emit('x');
  assert.equal(count, 3);
  assert.equal(bus.listenerCount('x'), 2, 'explicit unsubscribe must take effect');
});

await check('core/EventBus once() and dispatch-time mutation', async () => {
  const { EventBus } = await import('../src/core/EventBus.js');
  const bus = new EventBus();

  // once() must deliver exactly one time and never leak.
  let calls = 0;
  bus.once('a', () => { calls++; });
  bus.emit('a');
  bus.emit('a');
  assert.equal(calls, 1);
  assert.equal(bus.listenerCount('a'), 0, 'once() must detach itself');

  // A throwing once() handler must also detach.
  bus.once('b', () => { throw new Error('boom'); });
  bus.emit('b');
  assert.equal(bus.listenerCount('b'), 0, 'a throwing once() must still detach');

  // Unsubscribing a later handler during dispatch must actually skip it.
  const order = [];
  const second = () => order.push('second');
  bus.on('d', () => { order.push('first'); bus.off('d', second); });
  bus.on('d', second);
  bus.emit('d');
  bus.emit('d');
  assert.deepEqual(order, ['first', 'first'], 'a handler removed mid-dispatch must not run');
});

await check('core/StateMachine rejects illegal transitions', async () => {
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const sm = new StateMachine(new EventBus(), 'menu');
  assert.equal(sm.transition('boss'), false, 'menu -> boss must be illegal');
  assert.equal(sm.transition('character_select'), true);
  assert.equal(sm.transition('playing'), true);
  assert.equal(sm.current, 'playing');
  sm.force('menu');
  assert.equal(sm.current, 'menu');
});

await check('core/Collision primitives', async () => {
  const c = await import('../src/core/Collision.js');
  assert.equal(c.circleVsCircle({ x: 0, y: 0, radius: 10 }, { x: 15, y: 0, radius: 10 }), true);
  assert.equal(c.circleVsCircle({ x: 0, y: 0, radius: 10 }, { x: 25, y: 0, radius: 10 }), false);
  assert.equal(c.circleVsRect({ x: 0, y: 0, radius: 5 }, { x: -10, y: -10, w: 4, h: 4 }), false);
  assert.equal(c.circleVsRect({ x: 0, y: 0, radius: 5 }, { x: 3, y: -10, w: 10, h: 20 }), true);

  // Pushing a circle out of a wall must actually remove the overlap.
  const r = { x: 0, y: 0, w: 100, h: 100 };
  const circle = { x: 50, y: 2, radius: 10 };
  const mtv = c.resolveCircleRect(circle, r);
  assert.ok(mtv, 'expected an overlap to resolve');
  circle.x += mtv.x;
  circle.y += mtv.y;
  // The circle lands exactly tangent to the surface, which is the minimal
  // displacement. It must not still penetrate by any meaningful amount.
  assert.ok(circle.y + circle.radius <= r.y + 1e-9, 'must not remain embedded');
  assert.ok(circle.y + circle.radius > r.y - 0.001, 'should land on the surface, not fly off');
});

await check('core/GameLoop fixed step is frame-rate independent', async () => {
  const { GameLoop } = await import('../src/core/GameLoop.js');
  let steps = 0;
  const loop = new GameLoop({ onFixedUpdate: () => { steps++; }, onRender: () => {} });
  loop.onFixedUpdate(1 / 60);
  loop.onFixedUpdate(1 / 60);
  assert.equal(steps, 2);
});

/* ---------- Data ------------------------------------------------------ */
await check('data integrity: classes, weapons, enemies, bosses, ultimates', async () => {
  const { CLASSES, CLASS_IDS } = await import('../src/data/classes.js');
  const { WEAPONS, normalWeaponIds } = await import('../src/data/weapons.js');
  const { ENEMIES } = await import('../src/data/enemies.js');
  const { BOSSES, BOSS_ORDER } = await import('../src/data/bosses.js');
  const { ULTIMATES, ULTIMATES_BY_CLASS } = await import('../src/data/ultimates.js');

  // Design doc §32 MVP scope numbers.
  assert.equal(CLASS_IDS.length, 3, '3 classes');
  assert.equal(normalWeaponIds().length, 10, '10 normal weapons');
  assert.equal(Object.values(WEAPONS).filter((w) => w.legendary).length, 3, '3 legendary weapons');
  assert.equal(Object.keys(ENEMIES).length, 11, '11 enemy types');
  assert.equal(Object.keys(BOSSES).length, 3, '3 bosses');
  assert.equal(Object.keys(ULTIMATES).length, 9, '9 ultimates');
  assert.equal(BOSS_ORDER.length, 3);

  // Every class must have exactly 3 ultimates and a valid starting weapon.
  for (const id of CLASS_IDS) {
    assert.equal(ULTIMATES_BY_CLASS[id]?.length, 3, `${id} must have 3 ultimates`);
    assert.ok(WEAPONS[CLASSES[id].startingWeapon], `${id} starting weapon must exist`);
  }

  // Every ultimate handler must be reachable from the class lists.
  for (const list of Object.values(ULTIMATES_BY_CLASS)) {
    for (const ultId of list) assert.ok(ULTIMATES[ultId], `${ultId} must be defined`);
  }

  // Each enemy must declare the fields the systems read.
  for (const e of Object.values(ENEMIES)) {
    assert.ok(e.maxHp > 0, `${e.id} needs hp`);
    assert.ok(e.radius > 0, `${e.id} needs a radius`);
    assert.ok(e.speed > 0, `${e.id} needs a speed`);
    assert.ok(['melee', 'ranged'].includes(e.attackType), `${e.id} attack type`);
  }

  // Each boss must define at least one attack with a telegraph.
  for (const b of Object.values(BOSSES)) {
    assert.ok(b.attacks.length > 0, `${b.id} needs attacks`);
    for (const a of b.attacks) {
      assert.ok(a.telegraph >= 0, `${b.id}/${a.id} needs a telegraph (§25)`);
      assert.ok(a.cooldown > 0, `${b.id}/${a.id} needs a cooldown`);
    }
    assert.ok(b.phase2At > 0 && b.phase2At < 1, `${b.id} needs a phase-2 threshold`);
  }
});

/* ---------- Entities -------------------------------------------------- */
await check('Entity damage, healing and death', async () => {
  const { Entity } = await import('../src/entities/Entity.js');
  const e = new Entity({ x: 0, y: 0, radius: 10, maxHp: 100, speed: 10 });
  assert.equal(e.takeDamage(30), 30);
  assert.equal(e.hp, 70);
  assert.equal(e.alive, true);
  assert.equal(e.heal(50), 30, 'healing is capped at maxHp');
  assert.equal(e.hp, 100);
  assert.equal(e.takeDamage(500), 100, 'overkill reports only the applied damage');
  assert.equal(e.alive, false);
  assert.equal(e.takeDamage(10), 0, 'a corpse takes no further damage');
});

await check('StatusEffects: slow, stun, expiry, ticks', async () => {
  const { StatusEffects } = await import('../src/entities/StatusEffects.js');
  const s = new StatusEffects();
  s.apply('slow', 1, 0.5);
  assert.equal(s.speedMultiplier(), 0.5);
  s.apply('stun', 0.5);
  assert.equal(s.speedMultiplier(), 0, 'stun must pin the entity');
  assert.equal(s.canAct(), false);

  s.update(0.6);
  assert.equal(s.has('stun'), false, 'stun should have expired');
  assert.equal(s.has('slow'), true);
  assert.equal(s.speedMultiplier(), 0.5);

  s.update(0.6);
  assert.equal(s.has('slow'), false);

  const ticks = s.consumeTicks('slow', 1, 0.4);
  assert.equal(ticks, 0, 'an expired effect cannot tick');
  s.apply('burn', 5);
  assert.equal(s.consumeTicks('burn', 1.0, 0.4), 2);
});

/* ---------- Systems --------------------------------------------------- */
await check('enemy hit boxes describe the drawn body, not the footprint', async () => {
  const { ENEMIES } = await import('../src/data/enemies.js');
  const { Enemy } = await import('../src/entities/Enemy.js');
  const { Player } = await import('../src/entities/Player.js');

  // The physical footprint is untouched: movement, walls and separation keep
  // using it, so a wide sprite never wedges itself into geometry.
  assert.equal(ENEMIES.orc.radius, 18, 'the orc still occupies an 18px footprint');
  assert.equal(ENEMIES.bat.radius, 11, 'the bat still occupies an 11px footprint');

  // The combat box is the *drawn* body, which stands above the ground point.
  assert.ok(
    ENEMIES.orc.hitUp >= 69,
    `an orc is drawn 70px tall, so its hit box must reach the crown (got ${ENEMIES.orc.hitUp})`,
  );
  assert.ok(ENEMIES.orc.hitWidth >= 43, 'the orc hit box spans its shoulders');
  assert.ok(ENEMIES.bat.hitWidth >= 47, 'the bat hit box spans its wing membrane');
  assert.ok(ENEMIES.goblin.hitUp >= 24, 'a goblin is drawn 27px tall');

  const orc = new Enemy({ typeId: 'orc', x: 0, y: 0 });
  assert.equal(orc.radius, 18, 'Enemy uses the physical radius for movement');
  const volume = orc.getHitVolume();
  assert.equal(volume.width, ENEMIES.orc.hitWidth, 'the volume comes from the data');
  assert.equal(volume.up, ENEMIES.orc.hitUp);
  assert.equal(volume.down, ENEMIES.orc.hitDown);

  // The player is not drawn with the enemy rig and keeps a plain circle, so
  // enemy attacks and hazards stay tested against the feet as before.
  const player = new Player({ classId: 'warrior', x: 0, y: 0, ultimateId: 'whirlwind' });
  assert.equal(player.getHitVolume().radius, player.radius, 'the player keeps a circle');
});

await check('REGRESSION: a projectile hits a humanoid upper body', async () => {
  // Reported bug: sprites are drawn standing above their ground point while
  // the hit test used a circle on the feet. An orc is drawn 70px tall, so a
  // shot at its chest or head could not register at all — only the bottom 3%
  // of the silhouette was hittable.
  const { Game } = await import('../src/game/Game.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const bus = new EventBus();
  const game = new Game({
    bus, state: new StateMachine(bus, 'menu'),
    callbacks: { onStateChange() {}, onRoomCleared() {}, onBossSpawned() {}, onPlayerDeath() {}, onNotice() {} },
  });
  game.startRun('gunner', 'bullet_storm', 909);
  const player = game.getPlayer();

  // Chest height: 30px above the feet, far outside an 18px circle.
  const orc = game.spawner.spawnEnemy('orc', player.x + 200, player.y);
  const bullet = game.projectiles.spawn({
    x: orc.x, y: orc.y - 30, vx: 0, vy: -60, faction: 'player', damage: 5, radius: 4, life: 1,
  });
  const before = orc.hp;
  game.projectiles.update(1 / 60);
  assert.equal(bullet.alive, false, 'the shot must connect with the body');
  assert.ok(orc.hp < before, 'a shot into an orc chest must deal damage');
});

await check('melee reaches the visible edge of an oversized enemy', async () => {
  const { Game } = await import('../src/game/Game.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const game = new Game({
    bus: new EventBus(),
    state: new StateMachine(new EventBus(), 'menu'),
    callbacks: { onStateChange() {}, onRoomCleared() {}, onBossSpawned() {}, onPlayerDeath() {}, onNotice() {} },
  });
  game.startRun('warrior', 'whirlwind', 777);
  const player = game.getPlayer();
  player.facing = 0;
  player.visualFacing = 0;
  const bat = game.spawner.spawnEnemy('bat', player.x + player.weapon.range + 16, player.y);
  const before = bat.hp;
  game.coordinator.performMeleeAttack(player);
  assert.ok(bat.hp < before, 'a sword must hit the bat at its visible inner wing edge');
});

await check('melee connects with a body that stands above the ground point', async () => {
  // A sprite is drawn upward from its feet, so for an enemy below the player
  // the *head* is the nearest part of it. The old circle-on-the-feet test
  // measured to the feet and called this a miss.
  const { Game } = await import('../src/game/Game.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const game = new Game({
    bus: new EventBus(),
    state: new StateMachine(new EventBus(), 'menu'),
    callbacks: { onStateChange() {}, onRoomCleared() {}, onBossSpawned() {}, onPlayerDeath() {}, onNotice() {} },
  });
  game.startRun('warrior', 'whirlwind', 4242);
  const player = game.getPlayer();
  player.facing = Math.PI / 2;   // straight down the screen
  player.visualFacing = Math.PI / 2;

  const reach = player.weapon.range;
  const orc = game.spawner.spawnEnemy('orc', player.x, player.y + reach + 30);
  assert.ok(
    Math.hypot(orc.x - player.x, orc.y - player.y) > reach + orc.radius,
    'the test needs the orc feet to be out of reach',
  );

  const before = orc.hp;
  game.coordinator.performMeleeAttack(player);
  assert.ok(orc.hp < before, 'the blade must reach the orc body inside the swing');
});

await check('area damage uses the visible target edge, not only its centre', async () => {
  const { Game } = await import('../src/game/Game.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const bus = new EventBus();
  const game = new Game({
    bus, state: new StateMachine(bus, 'menu'),
    callbacks: { onStateChange() {}, onRoomCleared() {}, onBossSpawned() {}, onPlayerDeath() {}, onNotice() {} },
  });
  game.startRun('warrior', 'whirlwind', 778);
  const player = game.getPlayer();
  const slime = game.spawner.spawnEnemy('slime', player.x + 34, player.y);
  const before = slime.hp;
  game.combat.applyAreaHit(player.x, player.y, 20, { damage: 7, source: 'hitbox-test' }, player, { faction: 'enemy' });
  assert.ok(slime.hp < before, 'an AoE must hit a slime whose visible gel overlaps its edge');
});

await check('Dungeon generation honours §19 rules', async () => {
  const { createFloor, rollOffers, MIN_CHOICES, MAX_CHOICES } =
    await import('../src/systems/DungeonGenerator.js');

  for (let floor = 0; floor < 3; floor++) {
    for (let i = 0; i < 40; i++) {
      const plan = createFloor(floor, 1000 + i * 13);

      assert.equal(plan.kinds[0], 'start', 'a floor starts at the entrance');
      assert.equal(plan.kinds[plan.kinds.length - 1], 'boss', 'a floor ends at the boss');
      assert.equal(plan.bossDepth, plan.layers - 1);
      assert.equal(plan.bossId, plan.bossDepth * 10, 'the boss id encodes its depth');

      // §19: Start -> 2-4 Arena -> Shop or Healing -> 2-4 Arena -> Boss.
      const arenas = plan.kinds.filter((k) => k.startsWith('arena')).length;
      assert.ok(
        arenas >= 4 && arenas <= 8,
        `floor ${floor} has ${arenas} arena steps (§19 wants 2-4 plus 2-4)`,
      );
      assert.ok(plan.kinds.includes('support'), 'a floor must offer a support room');
      assert.ok(
        plan.layers >= 7 && plan.layers <= 12,
        `floor ${floor} is ${plan.layers} rooms long, outside the §19 shape`,
      );

      // Every step of the path is a choice of 2-3 rooms, the boss step
      // included: it offers the normal encounter and the harder variant.
      for (let depth = 1; depth < plan.layers; depth++) {
        const offers = rollOffers(plan, depth);
        assert.ok(
          offers.length >= MIN_CHOICES && offers.length <= MAX_CHOICES,
          `depth ${depth} offers ${offers.length} rooms, expected ${MIN_CHOICES}-${MAX_CHOICES}`,
        );
        assert.equal(
          new Set(offers.map((o) => o.id)).size,
          offers.length,
          `depth ${depth} reuses a room id`,
        );
        if (depth === plan.bossDepth) {
          assert.deepEqual(
            offers.map((o) => o.type),
            ['boss', 'boss'],
            'the boss step offers the normal boss and the elite variant',
          );
          assert.equal(offers[0].id, plan.bossId, 'the normal boss keeps the reserved id');
          assert.equal(offers[0].elite, false);
          assert.equal(offers[1].elite, true, 'the second boss variant must be elite');
          continue;
        }
        if (plan.kinds[depth] === 'support') {
          assert.deepEqual(
            offers.map((o) => o.type).sort(),
            ['healing', 'shop'],
            'a support step lets the player pick which support they want',
          );
        } else {
          assert.equal(offers[0].type, 'arena', 'an arena step always offers a fight');
        }
      }

      // Nothing exists past the boss.
      assert.equal(rollOffers(plan, plan.layers).length, 0);
    }
  }
});

await check('Loot: rewards always offer a choice, shops are affordable-ish', async () => {
  const { LootSystem } = await import('../src/systems/LootSystem.js');
  const loot = new LootSystem();
  for (const classId of ['warrior', 'mage', 'gunner']) {
    for (let i = 0; i < 40; i++) {
      const reward = loot.rollArenaReward(classId, 0, false);
      assert.ok(reward.length >= 2, 'a reward must always offer something');
      const stock = loot.buildShopStock(classId, 0);
      assert.ok(stock.length >= 4, 'the shop must have stock (§17)');
      for (const item of stock) {
        assert.ok(item.price >= 0, 'stock needs a price');
        assert.ok(item.name && item.desc, 'stock needs a label');
      }
      // Weapon rewards must belong to the requesting class.
      const weapons = LootSystem.weaponsFor(classId);
      for (const r of reward) {
        if (r.kind === 'weapon') {
          assert.ok(
            weapons.normal.includes(r.id) || weapons.legendary.includes(r.id),
            `${r.id} is not a ${classId} weapon`,
          );
        }
      }
    }
  }
});

await check('Boss loot: a legendary is a chance, never a guarantee', async () => {
  // The prototype handed every boss a guaranteed legendary, which meant any
  // finished campaign ended fully kitted out and the rarest tier stopped
  // being rare (§10 asks legendaries to form a build, not to be the default).
  const { LootSystem } = await import('../src/systems/LootSystem.js');
  const { rng } = await import('../src/core/Random.js');
  const { CONFIG } = await import('../src/core/Config.js');
  const loot = new LootSystem();

  rng.seed = 20240607;
  rng.reset();

  const rolls = 600;
  let legendary = 0;
  for (const classId of ['warrior', 'mage', 'gunner']) {
    const weapons = LootSystem.weaponsFor(classId);
    for (let i = 0; i < rolls; i++) {
      const reward = loot.rollBossReward(classId);
      const weapon = reward.find((r) => r.kind === 'weapon');
      assert.ok(weapon, 'a boss reward must offer a weapon');
      assert.ok(reward.some((r) => r.kind === 'gold'), 'a boss reward must pay gold');
      assert.ok(
        weapons.normal.includes(weapon.id) || weapons.legendary.includes(weapon.id),
        `${weapon.id} is not a ${classId} weapon`,
      );
      if (weapon.legendary) legendary++;
    }
  }

  assert.ok(legendary > 0, `bosses must still be able to drop a legendary, got ${legendary}`);
  assert.ok(legendary < rolls * 3, 'a boss legendary must not be guaranteed');
  const rate = legendary / (rolls * 3);
  assert.ok(
    rate > 0.15 && rate < 0.6,
    `boss legendary rate should hover near ${CONFIG.loot.bossLegendaryChance}, measured ${rate.toFixed(2)}`,
  );
});

await check('Shield strain: a heavy shot must eventually break a guard', async () => {
  // The Sniper Rifle used to be unable to break a shieldbearer's guard at
  // all: a blocked hit cost a flat 12 stamina, and the bearer regenerated
  // more than that during the rifle's 1.35s cooldown, so the shield healed
  // back after every round, forever. Blocking now strains by the weight of
  // the blow, so heavy weapons batter a guard down.
  const { Enemy } = await import('../src/entities/Enemy.js');
  const { CombatSystem } = await import('../src/systems/CombatSystem.js');
  const { EntityRegistry } = await import('../src/entities/EntityRegistry.js');
  const { ParticleSystem } = await import('../src/rendering/particleSystem.js');
  const { FloatingTextSystem } = await import('../src/rendering/textEffects.js');
  const { EventBus } = await import('../src/core/EventBus.js');

  const fight = (damage, cooldownSeconds) => {
    const registry = new EntityRegistry();
    const combat = new CombatSystem({
      bus: new EventBus(),
      registry,
      particles: new ParticleSystem(50),
      floatingText: new FloatingTextSystem(50),
      random: () => 1,
    });
    const bearer = new Enemy({ typeId: 'shieldbearer', x: 100, y: 100 });
    registry.addEnemy(bearer);
    const attacker = {
      x: 400, y: 100, faction: 'player',
      modifiers: { armor: 0, lifeSteal: 0, critChance: 0 },
      weapon: {}, stats: { kills: 0, damageDealt: 0, damageTaken: 0 },
      addUltCharge: () => false,
    };

    for (let shot = 0; shot < 200; shot++) {
      // The worst case for the player: the guard always faces the shot.
      bearer.facing = Math.atan2(attacker.y - bearer.y, attacker.x - bearer.x);
      const before = bearer.hp;
      combat.applyHit(bearer, { damage, source: 'test' }, attacker);
      if (bearer.hp < before) return shot + 1;
      for (let f = 0; f < cooldownSeconds * 60; f++) combat.updateShields(1 / 60);
    }
    return Infinity;
  };

  const sniper = fight(78, 1.35);
  assert.ok(
    Number.isFinite(sniper) && sniper <= 12,
    `a Sniper Rifle must break a shield in a few rounds, took ${sniper}`,
  );
  // Light shots still need sustained pressure rather than one hit.
  assert.ok(fight(13, 0.2) > sniper, 'heavy rounds must break a guard faster than light ones');
});

await check('Muzzle shake scales with shot weight, not rarity', async () => {
  // Hellstorm asked for a 3.0 impulse on every round *because* it is
  // legendary, and at 24 rounds a second the camera sat around 10 pixels of
  // permanent jitter. Shake now follows the recoil the shot already computes.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { EVENTS } = await import('../src/core/EventBus.js');
  const { CONFIG } = await import('../src/core/Config.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const { getWeapon } = await import('../src/data/weapons.js');

  const sustainedShake = (weaponId) => {
    const bus = new EventBus();
    const game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
        onPlayerDeath: () => {}, onNotice: () => {},
      },
    });
    game.startRun('gunner', 'ricochet', 1234);
    const player = game.getPlayer();
    player.equip(getWeapon(weaponId));

    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      game.update(1 / 60, {
        move: { x: 0, y: 0 },
        aim: { x: player.x + 400, y: player.y },
        attackHeld: true, attackPressed: i === 0, ultPressed: false,
      });
      peak = Math.max(peak, game.camera.shake);
    }
    return peak;
  };

  /** The shake a single fired shot asks for. */
  const singleShotShake = (weaponId) => {
    const bus = new EventBus();
    const game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
        onPlayerDeath: () => {}, onNotice: () => {},
      },
    });
    game.startRun('gunner', 'ricochet', 1);
    const player = game.getPlayer();
    player.equip(getWeapon(weaponId));
    let asked = 0;
    const off = bus.on(EVENTS.SHAKE_REQUESTED, (v) => { if (!asked) asked = v; });
    game.projectiles.fireWeapon({ player, angle: 0 });
    off();
    return asked;
  };

  const hellstorm = sustainedShake('hellstorm');
  assert.ok(
    hellstorm < CONFIG.camera.maxShake * 0.25,
    `sustained Hellstorm fire must stay a whisper of jitter, peaked at ${hellstorm.toFixed(1)}px`,
  );
  assert.ok(hellstorm > 0.5, 'rapid fire must still carry some muzzle feedback');

  // A shot's weight must still read as weight: the Sniper's single round
  // asks for more shake than a Pistol's, even though the Pistol's fire
  // rate multiplies out to a similar sustained level.
  const sniperShot = singleShotShake('sniper_rifle');
  const pistolShot = singleShotShake('pistol');
  assert.ok(
    sniperShot > pistolShot,
    `a heavy round must shake more per shot than a light one (${sniperShot} vs ${pistolShot})`,
  );
});

await check('CollisionWorld: wall sliding and containment', async () => {
  const { CollisionWorld } = await import('../src/entities/Room.js');
  const world = new CollisionWorld();
  world.setRects([{ x: 0, y: 0, w: 200, h: 20 }]);

  // Moving into the wall from below must be blocked in Y but free in X.
  const moved = world.moveCircle(100, 40, 30, -30, 10);
  assert.equal(moved.x, 130, 'X movement must still succeed (wall sliding)');
  assert.ok(moved.y > 20 + 10 - 0.01, 'Y must be blocked by the wall');
  assert.equal(world.overlapsAny({ x: moved.x, y: moved.y, radius: 10 }), false);
});

await check('Room: door carving removes wall material', async () => {
  const { Room } = await import('../src/entities/Room.js');
  const room = new Room({ id: 'r1', type: 'arena', roomWidth: 800, roomHeight: 600 });
  const before = room.walls.length;
  assert.equal(before, 4);

  room.addDoor('north', 0.5);
  // The door cut must split the north wall into two pieces.
  assert.ok(room.walls.length > before, 'carving a door should split a wall');

  room.seal();
  const closedRects = room.getCollisionRects();
  assert.ok(closedRects.length > room.walls.length, 'a sealed door adds collision');
  room.unseal();
  assert.equal(room.getCollisionRects().length, room.walls.length);
});

/* ---------- Regression tests for bugs found by simulation ------------ */

await check('REGRESSION: arena waves advance past the first wave', async () => {
  // Bug: `spawnTimer` was set to Infinity after spawning, and the
  // "wait for the room to empty" branch was unreachable, so wave 2 and the
  // elite wave never spawned and arenas could never be cleared.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  const bus = new EventBus();
  const waves = [];
  bus.on('room:waveStarted', (p) => waves.push(p.label));

  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('warrior', 'whirlwind', 4242);

  // Enter the first arena and step time forward without fighting.
  const node = game.run.currentNode();
  game.travelTo(node.next[0]);
  const rt = game.rooms.runtime;
  assert.equal(rt.type, 'arena');

  // Kill everything as it spawns, so the wave cycle must advance.
  for (let step = 0; step < 60 * 60; step++) {
    for (const e of game.registry.enemies) {
      if (e.alive) e.takeDamage(e.maxHp + 1);
    }
    game.rooms.update(1 / 60, game.getPlayer());
    if (rt.cleared) break;
  }

  assert.equal(waves.length, 3, `expected 3 waves, got ${waves.length}: ${waves.join(', ')}`);
  assert.ok(rt.cleared, 'an arena must be clearable after all waves');
});

await check('REGRESSION: boss rooms spawn without throwing', async () => {
  // Bug: `Boss extends Enemy` passed a synthetic type id ("__boss__") that
  // did not exist in the enemy data, so entering a boss room threw
  // "Unknown enemy __boss__".
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const { BOSS_ORDER } = await import('../src/data/bosses.js');

  const bus = new EventBus();
  const spawned = [];
  bus.on('room:bossSpawned', (p) => spawned.push(p.boss.bossId));

  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });

  game.startRun('mage', 'meteor', 99);

  // Walk the graph to the boss room, clearing as we go.
  for (let guard = 0; guard < 40; guard++) {
    const rt = game.rooms.runtime;
    if (rt.type === 'boss') break;
    rt.cleared = true;
    const node = game.run.currentNode();
    if (!node || node.next.length === 0) break;
    game.travelTo(node.next[0]);
  }

  assert.equal(game.rooms.runtime.type, 'boss', 'must reach a boss room');
  assert.equal(spawned.length, 1, 'exactly one boss must spawn');
  assert.equal(spawned[0], BOSS_ORDER[0], 'floor 1 must field the first boss');

  const boss = game.registry.enemies.find((e) => e.kind === 'boss');
  assert.ok(boss, 'the boss must exist in the registry');
  assert.ok(boss.maxHp > 400, 'bosses must be substantially tougher than enemies');
  assert.ok(boss.radius > 30, 'bosses must be visually much larger (design doc §12)');
  assert.ok(boss.bossDef.attacks.length > 0, 'the boss must have a scripted attack list');
});

await check('REGRESSION: shieldbearer is damageable from behind', async () => {
  // Bug: shields rotated to face the player instantly, so 100% of damage
  // was blocked with no counterplay, making runs unwinnable.
  const { Enemy } = await import('../src/entities/Enemy.js');
  const { CombatSystem } = await import('../src/systems/CombatSystem.js');
  const { EntityRegistry } = await import('../src/entities/EntityRegistry.js');
  const { ParticleSystem } = await import('../src/rendering/particleSystem.js');
  const { FloatingTextSystem } = await import('../src/rendering/textEffects.js');
  const { EventBus } = await import('../src/core/EventBus.js');

  const bus = new EventBus();
  const registry = new EntityRegistry();
  const combat = new CombatSystem({
    bus,
    registry,
    particles: new ParticleSystem(10),
    floatingText: new FloatingTextSystem(10),
    random: () => 1,
  });

  /**
   * Minimal player-shaped attacker: CombatSystem reads `faction`, `stats`
   * and `addUltCharge` when crediting damage.
   * @param {number} x
   * @param {number} y
   */
  const makeAttacker = (x, y) => ({
    x,
    y,
    faction: 'player',
    modifiers: { armor: 0, lifeSteal: 0, critChance: 0, damageMul: 1, speedMul: 1 },
    weapon: {},
    stats: { kills: 0, damageDealt: 0, damageTaken: 0 },
    addUltCharge: () => false,
  });

  // The shield covers the arc the bearer faces. With facing = 0 the bearer
  // looks toward +x, so an attacker at +x is in front...
  const front = new Enemy({ typeId: 'shieldbearer', x: 100, y: 100 });
  front.facing = 0;
  const attackerFront = makeAttacker(160, 100);
  const beforeFront = front.hp;
  const frontResult = combat.applyHit(front, { damage: 20, source: 'test' }, attackerFront);
  assert.equal(frontResult.blocked, true, 'a frontal hit must be blocked');
  assert.equal(front.hp, beforeFront, 'a blocked hit deals no damage');

  // ...and an attacker at -x is directly behind it.
  const behind = new Enemy({ typeId: 'shieldbearer', x: 100, y: 100 });
  behind.facing = 0;
  const behindResult = combat.applyHit(behind, { damage: 20, source: 'test' }, makeAttacker(40, 100));
  assert.equal(behindResult.blocked, false, 'a hit from behind must NOT be blocked');
  assert.ok(behind.hp < behind.maxHp, 'flanking must deal damage');

  // Stepping around to the side must also defeat the shield, since the
  // block arc is narrower than a half-circle.
  const side = new Enemy({ typeId: 'shieldbearer', x: 100, y: 100 });
  side.facing = 0;
  const sideResult = combat.applyHit(side, { damage: 20, source: 'test' }, makeAttacker(100, 160));
  assert.equal(sideResult.blocked, false, 'a flank hit must NOT be blocked');

  // Area damage ignores the shield entirely, so explosions always work.
  const aoe = new Enemy({ typeId: 'shieldbearer', x: 100, y: 100 });
  aoe.facing = 0;
  registry.addEnemy(aoe);
  combat.applyAreaHit(130, 100, 80, { damage: 15, source: 'explosion' }, makeAttacker(160, 100), { faction: 'enemy' });
  assert.ok(aoe.hp < aoe.maxHp, 'explosions must bypass a directional shield');
});

await check('REGRESSION: an entity wedged in a corner can escape', async () => {
  // Bug: `moveCircle` refused every step when the start position already
  // overlapped geometry, and `resolve` could land exactly on a corner
  // tangent point. The player became permanently welded into the corner,
  // which deadlocked any cleared room they could not walk out of.
  const { Room, CollisionWorld } = await import('../src/entities/Room.js');

  const room = new Room({ id: 'r', type: 'arena', roomWidth: 1120, roomHeight: 760 });
  const world = new CollisionWorld();
  world.setRects(room.getCollisionRects());

  const radius = 15;
  // Start deep inside the wall band at the corner.
  let x = 14;
  let y = 746;
  assert.equal(world.overlapsAny({ x, y, radius }), true, 'the start must be embedded');

  // Resolving must produce a position that is genuinely free.
  const freed = world.resolve({ x, y, radius });
  assert.equal(
    world.overlapsAny({ x: freed.x, y: freed.y, radius }),
    false,
    'resolve() must return a non-overlapping position',
  );

  // Repeatedly moving up-and-right must actually make progress.
  for (let i = 0; i < 60; i++) {
    const next = world.moveCircle(x, y, 1.8, -2.5, radius);
    x = next.x;
    y = next.y;
  }
  assert.ok(x > 40, `entity must escape the corner (x=${x.toFixed(1)})`);
  assert.ok(y < 720, `entity must escape the corner (y=${y.toFixed(1)})`);
  assert.equal(world.overlapsAny({ x, y, radius }), false, 'it must not end up inside a wall');
});

await check('REGRESSION: BossController teleport has collision access', async () => {
  // Bug: the third boss's teleport attack referenced `this.collisionWorld`,
  // which was never injected, crashing the game mid-fight.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('gunner', 'ricochet', 7);

  assert.ok(game.bossController.collisionWorld, 'BossController needs a CollisionWorld');

  // Drive the executioner's teleport handler directly.
  const { Boss } = await import('../src/entities/Boss.js');
  const boss = new Boss({ bossId: 'executioner', x: 200, y: 200 });
  game.registry.clear();
  game.registry.addEnemy(boss);
  game.registry.setPlayer(game.getPlayer());
  game.bossController.attach(boss);

  const teleport = boss.bossDef.attacks.find((a) => a.kind === 'teleport');
  assert.ok(teleport, 'the executioner must have a teleport attack');

  boss.beginAttack(teleport, { x: 400, y: 300 });
  boss.pending.timer = 0;
  const pending = boss.resolveAttack();
  game.bossController.execute(pending);
  assert.ok(boss.alive, 'teleport must not crash or kill the boss');
  assert.equal(
    game.collisionWorld.overlapsAny({ x: boss.x, y: boss.y, radius: boss.radius }),
    false,
    'a teleport must not place the boss inside a wall',
  );
});

await check('REGRESSION: a blink lands inside the room, not merely clear of walls', async () => {
  // Reported problem: the final boss's blink attack was broken - it put the
  // Executioner somewhere strange instead of beside the player.
  //
  // The placement check asked `overlapsAny`, which answers "does this circle
  // touch a wall". The walls stand just *outside* the floor, so a point beyond
  // one touches nothing and passed every time. Measured before the fix: 18% of
  // blinks from open ground and 49% from beside a wall landed outside the
  // arena, where the per-frame safety clamp then dragged the boss back onto the
  // masonry. The attack read as "the boss teleports to the wall", not "to you".
  //
  // The test drives the real attack and then a real frame, so the clamp and the
  // movement pass both see the result.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const { Boss } = await import('../src/entities/Boss.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun('warrior', 'whirlwind', 1234);
  game.run.enterNode(game.run.plan.bossId, game.getPlayer());

  const room = game.rooms.runtime.room;
  const player = game.getPlayer();
  const boss = new Boss({ bossId: 'executioner', x: room.bounds.w / 2, y: room.bounds.h / 2 });
  game.registry.clear();
  game.registry.addEnemy(boss);
  game.registry.setPlayer(player);
  game.bossController.attach(boss);

  // The trap, stated as a fact about the world: past the outer wall there is no
  // solid geometry to collide with, and that is exactly why the old check
  // accepted it.
  const beyond = { x: room.bounds.x - 120, y: room.bounds.h / 2, radius: boss.radius };
  assert.equal(
    game.collisionWorld.overlapsAny(beyond), false,
    'the premise: beyond the wall there is nothing to overlap',
  );
  assert.equal(
    game.collisionWorld.containsCircle(beyond), false,
    'but a point beyond the wall is still outside the room',
  );
  assert.equal(
    game.collisionWorld.isFreeSpot(beyond), false,
    'so it must never be accepted as a place to stand',
  );

  const teleport = boss.bossDef.attacks.find((a) => a.kind === 'teleport');
  assert.ok(teleport, 'the executioner must have a teleport attack');

  // Player positions: random interior points, then hugging every wall, which
  // is where the old check failed most often.
  const spots = [];
  for (let i = 0; i < 200; i++) {
    spots.push({
      x: room.bounds.x + boss.radius + Math.random() * (room.bounds.w - boss.radius * 2),
      y: room.bounds.y + boss.radius + Math.random() * (room.bounds.h - boss.radius * 2),
    });
  }
  const inset = (player.radius || 16) + 2;
  spots.push(
    { x: room.bounds.x + inset, y: room.bounds.y + room.bounds.h / 2 },
    { x: room.bounds.x + room.bounds.w - inset, y: room.bounds.y + room.bounds.h / 2 },
    { x: room.bounds.x + room.bounds.w / 2, y: room.bounds.y + inset },
    { x: room.bounds.x + room.bounds.w / 2, y: room.bounds.y + room.bounds.h - inset },
    { x: room.bounds.x + inset, y: room.bounds.y + inset },
    { x: room.bounds.x + room.bounds.w - inset, y: room.bounds.y + room.bounds.h - inset },
  );

  let escapes = 0;
  let stranded = 0;
  const distances = [];
  for (const spot of spots) {
    player.x = spot.x;
    player.y = spot.y;
    player.hp = player.maxHp;
    boss.x = room.bounds.w / 2;
    boss.y = room.bounds.h / 2;
    boss.hp = boss.maxHp;
    boss.alive = true;
    boss.globalCooldown = 99; // no other attack may move it inside the frame

    boss.beginAttack(teleport, { x: player.x, y: player.y });
    boss.pending.timer = 0;
    game.bossController.execute(boss.resolveAttack());
    game.update(1 / 60, {
      move: { x: 0, y: 0 }, aim: { x: player.x + 10, y: player.y }, attackHeld: false,
    });

    if (!game.collisionWorld.isFreeSpot({ x: boss.x, y: boss.y, radius: boss.radius })) escapes++;
    const d = Math.hypot(boss.x - player.x, boss.y - player.y);
    distances.push(d);
    if (d > 260) stranded++;
  }

  assert.equal(escapes, 0, `${escapes} of ${spots.length} blinks ended outside the room or in a wall`);
  assert.equal(stranded, 0, `${stranded} blinks put the boss further than 260px from the player`);
  distances.sort((a, b) => a - b);
  assert.ok(
    distances[0] > 40,
    `a blink must not land on top of the player (closest was ${distances[0].toFixed(0)}px)`,
  );
});

/* ============================================================
   Magic weapons: bolts on one button, a beam on the other
   ============================================================ */

/**
 * A mage in a cleared arena with room to aim.
 *
 * The arena matters twice over: the starting room is small enough that a
 * target beyond a beam's range cannot be placed inside it, and the wave
 * spawner has to be switched off or extra bodies walk into the ray while the
 * measurement is running.
 */
async function beamRig(weaponId) {
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const { getWeapon } = await import('../src/data/weapons.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun('mage', 'meteor', 1234);
  const player = game.getPlayer();
  player.equip(getWeapon(weaponId));

  for (let i = 0; i < 20; i++) {
    const rt = game.rooms.runtime;
    if (rt && rt.type === 'arena') break;
    rt.cleared = true;
    const node = game.run.currentNode();
    if (!node || node.next.length === 0) break;
    game.travelTo(node.next[0]);
  }
  game.rooms.runtime.cleared = true;
  for (const e of game.registry.enemies) e.kill();
  game.registry.reap();

  player.x = 260;
  player.y = 300;
  game.camera.follow(player.x, player.y, true);
  return { game, player };
}

/** A target that will not walk out of the measurement. */
function beamDummy(game, x, y) {
  const dummy = game.spawner.spawnEnemy('slime', x, y);
  dummy.maxHp = 100000;
  dummy.hp = 100000;
  dummy.status.apply('timestop', 120, 1);
  return dummy;
}

/** Hold (or release) the beam for `seconds`, aimed at `target`. */
async function holdBeam(game, player, target, seconds, firing = true) {
  const { CONFIG } = await import('../src/core/Config.js');
  const aim = {
    x: target.x - game.camera.x + CONFIG.view.width / 2,
    y: target.y - game.camera.y + CONFIG.view.height / 2,
  };
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 },
      aim,
      attackHeld: false,
      attackPressed: false,
      beamHeld: firing,
      ultPressed: false,
      dashPressed: false,
    });
  }
}

await check('REGRESSION: a staff fires bolts on one button and a beam on the other', async () => {
  // The rework: every staff gained a second firing mode on the right button,
  // and the four of them are one mechanic with four sets of numbers.
  const dps = { fire_staff: 30, ice_staff: 20, staff_of_the_void: 34 };

  for (const [id, rate] of Object.entries(dps)) {
    const { game, player } = await beamRig(id);
    const beam = player.weapon.beam;
    assert.ok(beam, `${id} must have a beam`);
    const dummy = beamDummy(game, player.x + 200, player.y);

    await holdBeam(game, player, dummy, 1.0);
    const dealt = 100000 - dummy.hp;
    // The lower bound is the configured rate; the upper one allows for the
    // weapon's own damage-over-time on top of it (a burning target takes the
    // beam *and* the burn).
    const ceiling = (rate + (beam.burnDamage ?? 0)) * 1.1;
    assert.ok(
      dealt >= rate * 0.9 && dealt <= ceiling,
      `${id}: 1s of beam dealt ${dealt.toFixed(1)}, expected ${rate}..${ceiling.toFixed(1)}`,
    );
  }

  // The lightning staff is the one whose rate moves: it has to land above its
  // starting figure and below its ceiling.
  {
    const { game, player } = await beamRig('lightning_staff');
    const beam = player.weapon.beam;
    const dummy = beamDummy(game, player.x + 200, player.y);
    await holdBeam(game, player, dummy, 1.0);
    const dealt = 100000 - dummy.hp;
    assert.ok(
      dealt > beam.damage * 1.05 && dealt < beam.damageMax,
      `the lightning beam must ramp: 1s dealt ${dealt.toFixed(1)}, between ${beam.damage} and ${beam.damageMax}`,
    );
  }

  // A weapon without a beam must ignore the beam button entirely.
  {
    const { game, player } = await beamRig('sword');
    assert.equal(player.weapon.beam, undefined, 'a sword has no beam');
    const dummy = beamDummy(game, player.x + 60, player.y);
    await holdBeam(game, player, dummy, 0.5);
    assert.equal(dummy.hp, 100000, 'the right button must do nothing without a staff');
    assert.equal(game.beam.last, null, 'and nothing may be drawn');
  }

  // A beam stops at the first body; the void staff is the one that does not.
  for (const [id, expected] of [['fire_staff', 1], ['staff_of_the_void', 2]]) {
    const { game, player } = await beamRig(id);
    const first = beamDummy(game, player.x + 150, player.y);
    const second = beamDummy(game, player.x + 260, player.y);

    let most = 0;
    for (let i = 0; i < 30; i++) {
      await holdBeam(game, player, first, 1 / 60);
      if (game.beam.last) most = Math.max(most, game.beam.last.targets);
    }
    assert.equal(most, expected, `${id} must hit ${expected} of the two bodies in line`);
    assert.ok(first.hp < 100000, `${id} must damage the first body`);
    if (expected === 1) {
      assert.equal(second.hp, 100000, `${id} must not reach past the first body`);
    } else {
      assert.ok(second.hp < 100000, `${id} must damage the body behind the first`);
    }
  }

  // Range is a hard limit, and it is the trade for not being able to miss.
  {
    const { game, player } = await beamRig('fire_staff');
    const range = player.weapon.beam.range;
    const beyond = beamDummy(game, player.x + range + 120, player.y);
    await holdBeam(game, player, beyond, 1.0);
    assert.equal(beyond.hp, 100000, `a body ${range + 120}px away is out of a ${range}px beam`);
    assert.equal(game.beam.last.targets, 0, 'and the beam reports nothing hit');
  }
});

await check('REGRESSION: the beam overheats, and a held staff never cools', async () => {
  const { CONFIG } = await import('../src/core/Config.js');
  const { game, player } = await beamRig('ice_staff');
  const dummy = beamDummy(game, player.x + 200, player.y);

  // Fill the gauge.
  let lockedAt = null;
  for (let i = 0; i < 60 * 8 && lockedAt === null; i++) {
    await holdBeam(game, player, dummy, 1 / 60);
    if (player.beam.locked) lockedAt = (i + 1) / 60;
  }
  assert.ok(lockedAt !== null, 'the gauge must fill and lock the staff');
  assert.ok(
    Math.abs(lockedAt - CONFIG.beam.heatUpTime) < 0.25,
    `it must lock at heatUpTime: locked at ${lockedAt?.toFixed(2)}s, expected ${CONFIG.beam.heatUpTime}s`,
  );

  // Holding through the lock-out must not fire, and must not cool either:
  // letting go is the cost of the overheat.
  const hpBefore = dummy.hp;
  await holdBeam(game, player, dummy, 1.5);
  assert.equal(dummy.hp, hpBefore, 'a locked staff must stop dealing damage');
  assert.ok(player.beam.locked, 'and it must stay locked while the button is held');
  assert.ok(
    player.beam.heat >= 1 - 1e-6,
    `a held staff must not cool itself (heat ${player.beam.heat.toFixed(2)})`,
  );

  // Releasing lets it shed heat, and it must reach the release threshold
  // before it will fire again.
  await holdBeam(game, player, dummy, 0.6, false);
  assert.ok(
    player.beam.heat > CONFIG.beam.releaseAt,
    `0.6s of cooling is not enough (heat ${player.beam.heat.toFixed(2)})`,
  );
  await holdBeam(game, player, dummy, 2.0, false);
  assert.equal(player.beam.locked, false, 'it must unlock once the gauge has fallen far enough');
  assert.ok(player.beam.heat <= CONFIG.beam.releaseAt, 'and only then');

  // And it fires again.
  const hpRecovered = dummy.hp;
  await holdBeam(game, player, dummy, 0.5);
  assert.ok(dummy.hp < hpRecovered, 'the staff must fire again after cooling');
});

await check('REGRESSION: burning deals the dps the weapon data declares', async () => {
  // Bug: `burnDamage` is documented as damage per second, but the burn tick
  // applied it *flat* once per 0.4s — so a 6 dps burn dealt 15 dps, and the
  // Fire Staff's burn outdamaged the projectile that applied it.
  const { game, player } = await beamRig('ice_staff');
  void player;
  const dummy = beamDummy(game, 300, 300);
  dummy.burnDamage = 10;
  dummy.status.apply('burn', 2.0, 1);

  const before = dummy.hp;
  for (let i = 0; i < 60 * 2; i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 },
      aim: { x: 0, y: 0 },
      attackHeld: false,
      attackPressed: false,
      beamHeld: false,
      ultPressed: false,
      dashPressed: false,
    });
  }
  const dealt = before - dummy.hp;
  // Two seconds of a 10 dps burn is 20, and the ticks are 0.4s apart, so the
  // last one may land just outside the window.
  assert.ok(
    dealt >= 16 && dealt <= 21,
    `2s of a 10 dps burn dealt ${dealt.toFixed(1)}, expected ~20`,
  );
});

await check('REGRESSION: shields break under sustained fire', async () => {
  // Bug: two adjacent shieldbearers always face the player, so each covered
  // the other's flank and NO reachable position could damage either — an
  // accidental immunity that made runs unwinnable. Shields now have
  // stamina: sustained blocking breaks the shield and opens the bearer.
  const { Enemy } = await import('../src/entities/Enemy.js');
  const { CombatSystem } = await import('../src/systems/CombatSystem.js');
  const { EntityRegistry } = await import('../src/entities/EntityRegistry.js');
  const { ParticleSystem } = await import('../src/rendering/particleSystem.js');
  const { FloatingTextSystem } = await import('../src/rendering/textEffects.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { CONFIG } = await import('../src/core/Config.js');

  const bus = new EventBus();
  const registry = new EntityRegistry();
  const combat = new CombatSystem({
    bus,
    registry,
    particles: new ParticleSystem(50),
    floatingText: new FloatingTextSystem(50),
    random: () => 1,
  });

  const a = new Enemy({ typeId: 'shieldbearer', x: 100, y: 100 });
  const b = new Enemy({ typeId: 'shieldbearer', x: 130, y: 100 });
  registry.addEnemy(a);
  registry.addEnemy(b);

  const attacker = {
    x: 400,
    y: 100,
    faction: 'player',
    modifiers: { armor: 0, lifeSteal: 0, critChance: 0, damageMul: 1, speedMul: 1 },
    weapon: {},
    stats: { kills: 0, damageDealt: 0, damageTaken: 0 },
    addUltCharge: () => false,
  };

  const dt = CONFIG.loop.fixedStep;
  let landed = 0;

  for (let i = 0; i < 60 * 60; i++) {
    // The AI faces the player continuously: the documented worst case.
    for (const sb of [a, b]) {
      sb.facing = Math.atan2(attacker.y - sb.y, attacker.x - sb.x);
    }
    const before = a.hp;
    combat.applyHit(a, { damage: 13, source: 'test' }, attacker);
    if (a.hp < before) landed++;
    combat.updateShields(dt);
    if (!a.alive) break;
  }

  assert.ok(landed > 0, 'sustained fire must eventually break through a shield');
  assert.equal(a.alive, false, 'a shieldbearer pair must be defeatable, not immune');
});

await check('REGRESSION: summoners cannot flood the arena', async () => {
  // Bug: the boss summon attack had no cap at all, so a long fight spawned
  // 38+ minions, which walled the boss off and threatened the frame budget.
  const { CONFIG } = await import('../src/core/Config.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const { Boss } = await import('../src/entities/Boss.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('mage', 'meteor', 3);

  game.registry.clear();
  const boss = new Boss({ bossId: 'stone_golem', x: 400, y: 400 });
  game.registry.addEnemy(boss);
  game.bossController.attach(boss);

  const summon = boss.bossDef.attacks.find((atk) => atk.kind === 'summon');
  assert.ok(summon, 'the stone golem must have a summon attack');

  // Trigger the summon many times over; the cap must hold.
  for (let i = 0; i < 40; i++) {
    boss.attackCooldowns.set(summon.id, 0);
    boss.globalCooldown = 0;
    boss.beginAttack(summon, { x: 500, y: 500 });
    boss.pending.timer = 0;
    game.bossController.execute(boss.resolveAttack());
  }

  const minions = game.registry.enemies.filter((e) => e.alive && e.kind !== 'boss').length;
  assert.ok(
    minions <= CONFIG.combat.maxMinions,
    `summons must respect the cap (${minions} > ${CONFIG.combat.maxMinions})`,
  );
  assert.ok(minions > 0, 'the summon must still produce minions below the cap');
});

await check('REGRESSION: a hazard burns for its real dps, not for one point a tick', async () => {
  // Reported problem: hazard damage-per-second went through `applyHit`, which
  // models a *blow*. Two of its rules then broke the burn:
  //   * the flat armour floor `Math.max(1, damage - armor)` turned a 0.175 HP
  //     per-frame slice into exactly 1 damage, and
  //   * every accepted tick opened the player's 0.4 s mercy window, so two
  //     thirds of the burn was refused as "MISS" and — far worse — the window
  //     never closed, making the player *invulnerable to everything else*
  //     while standing in fire.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun('warrior', 'whirlwind', 4242);
  game.rooms.runtime.cleared = true;
  for (const e of game.registry.enemies) e.kill();

  const player = game.getPlayer();
  player.hp = player.maxHp;

  const dps = 10.5;
  game.bossController.hazards.push({
    kind: 'fire', x: player.x, y: player.y, radius: 60,
    life: 3, maxLife: 3, damage: dps, color: '#ff4d1a',
    telegraphOnly: true, damagePerSecond: true,
    damageApplied: false, expired: false, onExpire: null, owner: null,
  });

  const before = player.hp;
  for (let i = 0; i < 60 * 3; i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 }, aim: { x: 640, y: 360 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }

  // The hazard is emitted only in the last 35% of its life.
  const expected = dps * 3 * 0.35;
  const lost = before - player.hp;
  assert.ok(
    Math.abs(lost - expected) < expected * 0.15,
    `a fire wall must deal roughly its configured damage (${lost.toFixed(2)} vs ${expected.toFixed(2)})`,
  );
  assert.ok(lost > 5, `the burn must not be swallowed by the mercy window (${lost.toFixed(2)})`);
  assert.equal(
    game.floatingText.texts.filter((t) => t.text === 'MISS').length,
    0,
    'a burn must not be reported as a blocked hit',
  );

  // And it must not hand out free invulnerability: a boss slam still lands.
  player.hp = player.maxHp;
  player.status.clear();
  game.bossController.hazards.length = 0;
  game.bossController.hazards.push({
    kind: 'fire', x: player.x, y: player.y, radius: 60,
    life: 3, maxLife: 3, damage: dps, color: '#ff4d1a',
    telegraphOnly: true, damagePerSecond: true,
    damageApplied: false, expired: false, onExpire: null, owner: null,
  });
  for (let i = 0; i < 60 * 2.2; i++) {
    game.update(1 / 60, {
      move: { x: 0, y: 0 }, aim: { x: 640, y: 360 },
      attackHeld: false, attackPressed: false, ultPressed: false,
    });
  }
  const hpBeforeSlam = player.hp;
  game.combat.applyHit(player, { damage: 40, source: 'boss_slam' }, null);
  assert.ok(
    hpBeforeSlam - player.hp >= 40,
    `standing in fire must not make the player immune (slam took ${(hpBeforeSlam - player.hp).toFixed(1)} of 40)`,
  );
});

await check('REGRESSION: the shop never sells the weapon you are holding', async () => {
  // Reported problem: the stock and reward pools were "every weapon this class
  // may use", which includes the one already equipped. The shop charged 50 gold
  // for a weapon the player owns and the reward consumed itself for one, and
  // neither screen said so — measured at ~29% of shop offers and ~12% of arena
  // weapon offers before the fix.
  const { LootSystem } = await import('../src/systems/LootSystem.js');
  const { CLASS_IDS, getClass } = await import('../src/data/classes.js');
  const loot = new LootSystem();
  const rounds = 300;

  for (const classId of CLASS_IDS) {
    const equipped = getClass(classId).startingWeapon;
    for (let i = 0; i < rounds; i++) {
      const stock = loot.buildShopStock(classId, 1, equipped);
      const shopOffer = stock.find((s) => s.kind === 'weapon');
      assert.ok(shopOffer, `${classId}: the shop must always stock a weapon`);
      assert.notEqual(shopOffer.id, equipped, `${classId}: the shop offered the equipped weapon`);

      const reward = loot.rollArenaReward(classId, 1, false, equipped);
      const rewardOffer = reward.find((c) => c.kind === 'weapon');
      if (rewardOffer) {
        assert.notEqual(rewardOffer.id, equipped, `${classId}: a reward offered the equipped weapon`);
      }

      const bossReward = loot.rollBossReward(classId, false, equipped);
      const bossOffer = bossReward.find((c) => c.kind === 'weapon');
      assert.ok(bossOffer, `${classId}: a boss must always drop a weapon offer`);
      assert.notEqual(bossOffer.id, equipped, `${classId}: a boss offered the equipped weapon`);
    }
  }

  // A class whose only weapon is the one it starts with still gets an offer.
  const fallback = LootSystem.withoutEquipped(['only'], 'only');
  assert.deepEqual(fallback, ['only'], 'the filter must not empty a pool of one');
  assert.deepEqual(LootSystem.withoutEquipped(['a', 'b'], null), ['a', 'b'], 'no filter without an id');
});

await check('REGRESSION: the altar blessing comes from the upgrade data', async () => {
  // The healing room used to hardcode its three blessings, duplicating the
  // `source: 'reward'` entries in the upgrade data and leaving the exported
  // REWARD_UPGRADE_IDS unused. Adding a fourth blessing therefore meant editing
  // RoomController — exactly the drift the data file exists to prevent.
  const { REWARD_UPGRADE_IDS, getUpgrade } = await import('../src/data/upgrades.js');
  assert.ok(REWARD_UPGRADE_IDS.length >= 3, 'there must be altar blessings to hand out');
  for (const id of REWARD_UPGRADE_IDS) {
    assert.ok(getUpgrade(id), `${id} must exist in the upgrade table`);
  }

  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  let found = null;
  for (let seed = 1; seed < 120 && !found; seed++) {
    const bus = new EventBus();
    const game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
        onPlayerDeath() {}, onNotice() {},
      },
    });
    game.startRun('warrior', 'whirlwind', seed);
    const offer = game.run.exits().find((o) => o.type === 'healing');
    if (!offer) continue;
    game.travelTo(offer.id);
    found = game.rooms.runtime.healingBonusId;
  }
  assert.ok(found, 'a seeded floor must offer a healing room');
  assert.ok(
    REWARD_UPGRADE_IDS.includes(found),
    `the altar granted "${found}", which is not a reward upgrade`,
  );
});

await check('every boss attack in the data actually does something', async () => {
  // `BossController.execute` ends in `default: break`. A data row naming a kind
  // the controller does not handle would therefore be a *silent* dead attack:
  // the boss would telegraph, spend the cooldown and do nothing at all. This
  // drives every declared attack of every boss through the real controller and
  // requires an observable effect.
  const { BOSSES } = await import('../src/data/bosses.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  let checked = 0;
  for (const [bossId, def] of Object.entries(BOSSES)) {
    const bus = new EventBus();
    const game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
        onPlayerDeath() {}, onNotice() {},
      },
    });
    game.startRun('warrior', 'whirlwind', 4242);
    game.run.enterNode(game.run.plan.bossId, game.getPlayer());

    const boss = game.registry.enemies.find((e) => e.kind === 'boss');
    assert.ok(boss, `${bossId} must spawn`);

    for (const attack of def.attacks) {
      const player = game.getPlayer();
      player.alive = true;
      player.hp = player.maxHp;
      player.status.clear();

      // Put the player in reach so range-gated attacks still fire, and clear
      // the cooldowns so each attack is evaluated on its own.
      player.x = boss.x + boss.radius + 20;
      player.y = boss.y;
      boss.alive = true;
      boss.hp = boss.maxHp;
      boss.globalCooldown = 0;
      boss.staggerTimer = 0;
      boss.attackLock = 0;

      const snapshot = () => ({
        projectiles: game.projectiles.count,
        hazards: game.bossController.hazards.length,
        enemies: game.registry.enemies.length,
        hp: player.hp,
        bx: Math.round(boss.x),
        by: Math.round(boss.y),
      });
      const before = snapshot();

      game.bossController.execute({
        def: attack,
        timer: 0,
        total: attack.telegraph,
        aimPoint: { x: player.x, y: player.y },
        aimAngle: Math.atan2(player.y - boss.y, player.x - boss.x),
      });

      const after = snapshot();
      const changed = Object.keys(before).some((k) => before[k] !== after[k]);
      assert.ok(
        changed,
        `${bossId}.${attack.id} (kind "${attack.kind}") had no observable effect`,
      );
      checked++;
    }
    game.bossController.clear();
  }
  assert.ok(checked >= 12, `every declared attack must be covered (checked ${checked})`);
});

await check('REGRESSION: damage labels aggregate instead of stacking', async () => {
  // Reported problem: a piercing explosive weapon (Staff of the Void) landed
  // ~78 hits/s into a pack, and one label per hit put ~120 live labels on
  // screen. Each label costs a font switch plus a stroked and a filled glyph
  // run, which made labels the largest per-frame drawing cost in the game.
  // Consecutive hits on the same body must fold into one rising number.
  const { FloatingTextSystem } = await import('../src/rendering/textEffects.js');
  const { CONFIG } = await import('../src/core/Config.js');
  const text = new FloatingTextSystem(20);

  for (let i = 0; i < 8; i++) text.addDamage(100, 100, 10);
  assert.equal(text.texts.length, 1, 'a burst on one body must produce one label');
  assert.equal(text.texts[0].text, '80', 'and the label must show the running total');
  assert.equal(text.merged, 7, 'the folded hits must be counted');

  // A crit is bigger and a different colour: it must not be swallowed.
  text.addDamage(100, 100, 50, { color: '#ff5a5a', size: 22 });
  assert.equal(text.texts.length, 2, 'a critical hit needs its own label');
  assert.equal(text.texts[1].text, '50');

  // A hit somewhere else is a different event.
  text.addDamage(600, 100, 10);
  assert.equal(text.texts.length, 3, 'a far-away hit must not merge');

  // Once the window has passed, the same body starts counting again.
  const { mergeWindow } = CONFIG.render.damageNumber;
  for (const t of text.texts) t.life -= mergeWindow + 0.05;
  text.addDamage(100, 100, 10);
  assert.equal(text.texts.length, 4, 'an expired label must not absorb a new hit');

  // Merging refreshes the label rather than growing the stack, and the refresh
  // must not then hide that label from a later scan.
  text.addDamage(100, 100, 5);
  text.addDamage(100, 100, 5);
  assert.equal(text.texts.length, 4, 'merging must never add a label');
  assert.equal(text.texts[3].text, '20', 'the total keeps counting');

  // Non-damage messages are one-offs and never merge.
  const before = text.texts.length;
  text.add(0, 0, '+5', { color: '#e8b955' });
  text.add(0, 0, '+5', { color: '#e8b955' });
  assert.equal(text.texts.length, before + 2, 'gold must stay its own label');

  // Damage that is not damage produces nothing at all.
  text.addDamage(0, 0, 0);
  text.addDamage(0, 0, NaN);
  text.addDamage(0, 0, -5);
  assert.equal(text.texts.length, before + 2, 'zero and NaN damage must not label');
});

await check('REGRESSION: healing altar applies its bonus once and opens doors', async () => {
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  let game = null;
  let healingOffer = null;
  // Find a deterministic floor whose first choice includes an altar.
  for (let seed = 1; seed < 100 && !healingOffer; seed++) {
    const bus = new EventBus();
    game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
        onPlayerDeath: () => {}, onNotice: () => {},
      },
    });
    game.startRun('warrior', 'whirlwind', seed);
    healingOffer = game.run.exits().find((offer) => offer.type === 'healing') ?? null;
  }
  assert.ok(game && healingOffer, 'a seeded floor must offer a healing room');

  const player = game.getPlayer();
  player.hp = player.maxHp - 50;
  const hpBefore = player.hp;
  const damageBefore = player.modifiers.damageMul;
  game.travelTo(healingOffer.id);

  // Healing is granted on entry; the altar bonus is granted by E interaction.
  assert.ok(player.hp > hpBefore, 'entering the altar room must heal the player');
  const result = game.interact();
  assert.equal(result?.kind, 'healing', 'the altar must be interactable at room center');
  assert.equal(game.rooms.runtime.reward.length, 0, 'the altar bonus must be consumed');
  assert.equal(game.rooms.runtime.cleared, true, 'using the altar must clear the room');
  assert.equal(game.rooms.runtime.room.doors.every((door) => door.open), true, 'altar doors must open after use');

  const bonusId = result.payload.bonusId;
  if (bonusId === 'heal_damage_10') {
    assert.equal(player.modifiers.damageMul, damageBefore + 0.10, 'damage altar bonus must apply once');
  }
  const second = game.interact();
  assert.equal(second, null, 'the altar must not be usable twice');
});

await check('REGRESSION: a cleared room always has an open door', async () => {
  // Bug: `Game.interact()` set `rt.cleared = true` directly for shop and
  // healing rooms, bypassing `Room.unseal()`. If such a room had been
  // sealed, its doors stayed shut and the player was trapped forever.
  // Separately, `Room.update()` treated an `Infinity` lock as "still
  // locked" and skipped it, so a timed door could never reopen a room.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('gunner', 'ricochet', 55);

  // Walk the whole graph, clearing every room through the real APIs, and
  // assert that a cleared room always offers a way onward.
  let checked = 0;
  for (let guard = 0; guard < 40; guard++) {
    const rt = game.rooms.runtime;
    const node = game.run.currentNode();
    if (!rt || !node) break;

    if (node.next.length > 0) {
      // Seal the room first: the worst case for the bug.
      rt.room.seal();
      game.rooms.markConsumed(rt);

      const openDoors = rt.room.doors.filter((d) => d.open);
      assert.ok(
        openDoors.length > 0,
        `room ${node.id} (${rt.type}) is cleared but has no open door`,
      );

      // And the door must actually lead to a graph neighbour.
      const reachable = openDoors.some(
        (d) => d.targetRoomId !== undefined && node.next.includes(Number(d.targetRoomId)),
      );
      assert.ok(reachable, `room ${node.id} has no open door to a neighbour`);

      checked++;
      game.travelTo(node.next[0]);
    } else {
      break;
    }
  }
  assert.ok(checked >= 4, `expected to traverse several rooms, checked ${checked}`);
});

/**
 * A game already standing in a room of the given type, or null.
 *
 * The floor is dealt one step at a time, so a shop only exists if a seed
 * offers one; this walks seeds until it finds that first step.
 * @param {string} type
 * @param {string} [classId]
 * @param {string} [ultimateId]
 * @returns {Promise<any|null>}
 */
async function gameInRoomOfType(type, classId = 'warrior', ultimateId = 'whirlwind') {
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  for (let seed = 1; seed < 200; seed++) {
    const bus = new EventBus();
    const game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
        onPlayerDeath() {}, onNotice() {},
      },
    });
    game.startRun(classId, ultimateId, seed);
    const offer = game.run.exits().find((o) => o.type === type);
    if (!offer) continue;
    game.travelTo(offer.id);
    return game;
  }
  return null;
}

/** Put the player in the middle of a doorway. @param {any} game @param {any} door */
function standInDoorway(game, door) {
  const player = game.getPlayer();
  player.x = door.rect.x + door.rect.w / 2;
  player.y = door.rect.y + door.rect.h / 2;
}

await check('REGRESSION: a shop or an altar can be left without using it', async () => {
  // Reported problem: the shop and the altar handed out their overlay only when
  // the player pressed E at the room centre, and until they did, nothing else
  // in the room was interactable — `getInteraction()` returned null everywhere
  // in it and the auto-travel gate refused to fire. The only way out of a shop
  // was therefore to open the shop.
  const game = await gameInRoomOfType('shop');
  assert.ok(game, 'a seeded floor must offer a shop');

  const rt = game.rooms.runtime;
  assert.equal(rt.cleared, false, 'the shop has not been used yet');
  assert.ok(
    rt.room.doors.every((d) => d.open),
    'a support room starts with its doors open',
  );

  const door = rt.room.doors[0];
  standInDoorway(game, door);
  const interaction = game.getInteraction();
  assert.equal(interaction?.kind, 'door', 'the doorway of an unused shop must be usable');
  assert.equal(interaction?.door, door, 'the interaction must name the door being stood in');
  assert.equal(game.doorAtPlayer(34), door, 'walking into the doorway must be enough to travel');

  const from = game.run.currentNodeId;
  const result = game.interact();
  assert.equal(result?.kind, 'travel', 'the doorway must take the player onward');
  assert.notEqual(game.run.currentNodeId, from, 'the player must have left the shop');

  // The room that fights for its content still refuses to be walked out of: a
  // sealed doorway is not an exit, so a fight can never be skipped.
  const arena = await gameInRoomOfType('arena');
  assert.ok(arena, 'a seeded floor must offer an arena');
  const arenaDoor = arena.rooms.runtime.room.doors[0];
  assert.equal(arenaDoor.open, false, 'an arena seals its doors on entry');
  standInDoorway(arena, arenaDoor);
  assert.equal(arena.doorAtPlayer(34), null, 'a sealed doorway must not report as a door');
  assert.equal(arena.getInteraction(), null, 'a sealed arena must offer no exit');
});

await check('the shop stays open for business after the first visit', async () => {
  // The other half of the reported problem: once the shop screen had been
  // opened the room was marked consumed, `getInteraction()` stopped reporting
  // the stall, and the player could not spend the rest of their gold on the
  // stock that was still sitting there.
  const game = await gameInRoomOfType('shop');
  assert.ok(game, 'a seeded floor must offer a shop');

  const rt = game.rooms.runtime;
  const player = game.getPlayer();
  const centre = rt.room.center;
  player.x = centre.x;
  player.y = centre.y;

  const first = game.interact();
  assert.equal(first?.kind, 'shop', 'the stall must open on E');
  assert.ok(first.payload.stock.length > 0, 'the shop must have stock');
  assert.equal(rt.cleared, true, "opening the shop consumes the room's offer");

  // Step away and return: the stall is still there, with the same stock.
  player.x = centre.x + 200;
  assert.equal(game.getInteraction(), null, 'the prompt only appears near the stall');
  player.x = centre.x;
  const second = game.interact();
  assert.equal(second?.kind, 'shop', 'a used shop must still be usable');
  assert.equal(second.payload.stock, first.payload.stock, 'the same stock array comes back');

  // Buying from the reopened screen works, and the sold flag sticks.
  player.addGold(2000);
  const buyable = second.payload.stock.find((item) => player.canAfford(item.price));
  assert.ok(buyable, 'a 2000-gold purse must afford something in the stock');
  assert.equal(game.buy(buyable), true, 'the purchase must go through');
  assert.equal(buyable.sold, true, 'a bought entry must be marked sold');
  const third = game.interact();
  assert.equal(third?.kind, 'shop', 'the shop must still open after a purchase');
  assert.equal(third.payload.stock.find((item) => item === buyable).sold, true,
    'a sold entry must stay sold in the reopened stock');
});

await check('REGRESSION: lifesteal returns health from the beam and from burning', async () => {
  // Reported problem: Vampiric Edge healed on bolts and melee but not on the
  // staff's held beam or on the burn the fire staff applies — the two damage
  // paths that never go through `applyHit`, which is where lifesteal lived. A
  // mage who took it saw no healing at all while beaming, i.e. in the weapon's
  // headline mode, so the upgrade read as broken.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun('mage', 'meteor', 4);

  const player = game.getPlayer();
  // A punching bag: lifesteal has to be measured against damage that lands,
  // and the target must survive the burn to tick at all.
  const bag = game.spawner.spawnEnemy('goblin', player.x + 60, player.y);
  bag.maxHp = 5000;
  bag.hp = 5000;

  player.modifiers.lifeSteal = 0.2;

  // The beam is continuous: per-frame slices through applyDamageOverTime.
  player.hp = 40;
  const beamBefore = player.hp;
  for (let i = 0; i < 30; i++) game.combat.applyDamageOverTime(bag, 60, 1 / 60, player);
  assert.ok(
    player.hp > beamBefore,
    `a held beam must return health (${beamBefore} -> ${player.hp})`,
  );

  // Burning ticks from the status, carrying no source of its own.
  player.hp = 40;
  const burnBefore = player.hp;
  game.combat.applyStatus(bag, { burnChance: 1, burnDuration: 3, burnDamage: 20 }, player);
  assert.equal(bag.burnSource, player, 'the burn must remember who lit it');
  for (let i = 0; i < 120; i++) game.combat.updateStatusDamage(1 / 60, [bag]);
  assert.ok(
    player.hp > burnBefore,
    `burning must return health (${burnBefore} -> ${player.hp})`,
  );

  // Without the upgrade nothing is returned: this is a ratio, not a heal.
  player.modifiers.lifeSteal = 0;
  bag.hp = bag.maxHp;
  player.hp = 40;
  game.combat.applyDamageOverTime(bag, 60, 1 / 60, player);
  assert.equal(player.hp, 40, 'without lifesteal nothing may be healed');
});

await check('Vampiric Edge stacks additively, and the offer says what the total becomes', async () => {
  // The complaint behind this: taking a second copy of an upgrade the player
  // already owns looked exactly like taking the first one, because the card
  // only ever printed the static description. The card now has to answer
  // "does it stack?" — and the answer has to be the truth.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const { UPGRADES, getUpgrade } = await import('../src/data/upgrades.js');
  const { getWeapon } = await import('../src/data/weapons.js');
  const { characterStatChips, upgradeDeltaLine, weaponStatLine } = await import('../src/ui/statDisplay.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange() {}, onRoomCleared() {}, onBossSpawned() {},
      onPlayerDeath() {}, onNotice() {},
    },
  });
  game.startRun('warrior', 'whirlwind', 7);
  const player = game.getPlayer();

  const def = getUpgrade('life_steal');
  assert.match(upgradeDeltaLine(def, player), /Life steal 0% → 5%/);
  def.apply(player);
  assert.equal(player.modifiers.lifeSteal, 0.05);
  assert.match(
    upgradeDeltaLine(def, player),
    /Life steal 5% → 10%/,
    'a second copy must read as an addition to the first, not as a fresh 5%',
  );
  def.apply(player);
  assert.equal(player.modifiers.lifeSteal, 0.10, 'two copies must stack additively');

  // The HUD chip is the same total, marked as boosted.
  const leech = characterStatChips(player).find((chip) => chip.label === 'LEECH');
  assert.equal(leech.text, '10%');
  assert.equal(leech.boosted, true, 'a raised stat must be marked for the HUD');

  // The percentage-of-health blessing has to describe itself in health, and
  // the amount it promises must be the amount `apply` grants.
  const hp = getUpgrade('heal_max_hp_10');
  const maxBefore = player.maxHp;
  const expected = Math.round(maxBefore * 0.10);
  assert.equal(
    upgradeDeltaLine(hp, player),
    `Max HP ${maxBefore} → ${maxBefore + expected}`,
  );
  hp.apply(player);
  assert.equal(player.maxHp, maxBefore + expected, 'the line must match what apply does');

  // Every upgrade in the table is describable: a missing `stat` would silently
  // drop the delta line off its card.
  for (const up of Object.values(UPGRADES)) {
    assert.ok(upgradeDeltaLine(up, player), `${up.id} needs a stat line for its card`);
  }

  // Weapon stats are the numbers combat actually uses.
  const sword = weaponStatLine(getWeapon('sword'), player);
  assert.match(sword, /22 dmg/, `the sword line must carry its damage (${sword})`);
  assert.match(sword, /0\.40s/, `the sword line must carry its cadence (${sword})`);
  assert.match(sword, /55 dps/, `the sword line must carry its dps (${sword})`);
  const shotgun = weaponStatLine(getWeapon('shotgun'), player);
  assert.match(shotgun, /12×7 dmg/, `pellets must be shown per shot (${shotgun})`);
  const staff = weaponStatLine(getWeapon('fire_staff'), player);
  assert.match(staff, /staff/, 'the staff line must name its kind');
  assert.match(staff, /burn 6\/s/, 'the staff line must carry its burn');
  assert.match(staff, /beam 30\/s/, 'the staff line must carry its held beam');
  const voidStaff = weaponStatLine(getWeapon('staff_of_the_void'), player);
  assert.match(voidStaff, /pierce all/, `a full pierce must read as such (${voidStaff})`);

  // Attack speed is a permanent modifier, so it is part of the printed dps.
  player.modifiers.attackSpeedMul = 2;
  assert.match(weaponStatLine(getWeapon('sword'), player), /110 dps/,
    'a doubled attack rate must double the printed dps');
});

await check('REGRESSION: a timed door seal releases on schedule', async () => {
  // A finite seal must expire on its own, and an infinite one must not.
  const { Room } = await import('../src/entities/Room.js');

  const room = new Room({ id: 'r', type: 'arena', roomWidth: 800, roomHeight: 600 });
  room.addDoor('north', 0.5, '1');

  room.seal(0.5);
  assert.equal(room.doors[0].open, false, 'a timed seal starts closed');
  room.update(0.6);
  assert.equal(room.doors[0].open, true, 'a timed seal must release on schedule');
  assert.equal(room.sealed, false, 'the room unseals when no door is shut');

  room.seal();
  for (let i = 0; i < 600; i++) room.update(1 / 60);
  assert.equal(room.doors[0].open, false, 'an infinite seal must hold until unseal()');
  assert.equal(room.sealed, true);

  room.unseal();
  assert.equal(room.doors[0].open, true);
  assert.equal(room.sealed, false);
});

await check('Boss phases trigger at the documented HP threshold', async () => {
  const { Boss } = await import('../src/entities/Boss.js');
  const { BOSSES } = await import('../src/data/bosses.js');

  for (const def of Object.values(BOSSES)) {
    const boss = new Boss({ bossId: def.id, x: 0, y: 0 });
    let phaseChanged = false;
    boss.onPhaseChange = () => { phaseChanged = true; };

    assert.equal(boss.phase, 1);
    boss.hp = boss.maxHp * (def.phase2At + 0.02);
    boss.update(1 / 60);
    assert.equal(boss.phase, 1, `${def.id} must stay in phase 1 above the threshold`);

    boss.hp = boss.maxHp * (def.phase2At - 0.02);
    boss.update(1 / 60);
    assert.equal(boss.phase, 2, `${def.id} must enter phase 2 below the threshold`);
    assert.ok(phaseChanged, `${def.id} must announce its phase change`);
  }
});

await check('particle step budget caps one step but not direct spawning', async () => {
  const { ParticleSystem } = await import('../src/rendering/particleSystem.js');
  const { CONFIG } = await import('../src/core/Config.js');
  const budget = CONFIG.render.particleStepBudget;

  const ps = new ParticleSystem(5000, budget);
  // Without beginStep the cap is a pure runtime valve: unit callers are not
  // throttled, so an effect that legitimately wants 500 motes still gets them.
  for (let i = 0; i < budget + 200; i++) ps.spawn('spark', 0, 0, 1, 1);
  assert.ok(ps.count >= budget + 200, `direct spawn must not be capped, got ${ps.count}`);
  assert.equal(ps.dropped, 0, 'no throttling happens outside an open step');

  // Inside an open step, the budget is the hard per-step limit.
  const open = new ParticleSystem(5000, budget);
  open.beginStep();
  let accepted = 0;
  for (let i = 0; i < budget * 4; i++) if (open.spawn('spark', 0, 0, 1, 1)) accepted++;
  assert.equal(accepted, budget, `an opened step must accept exactly ${budget} spawns, got ${accepted}`);
  assert.equal(open.dropped, budget * 3, 'the tail of the pile must be counted as dropped');

  // A fresh step refills the allowance.
  open.beginStep();
  assert.equal(open.dropped, 0, 'dropped count resets each step');
  assert.equal(open.peakDropped, budget * 3, 'peak is reported for the perf tools');
  assert.ok(open.spawn('spark', 0, 0, 1, 1), 'the next step must accept particles again');

  // A burst that overflows the budget must not corrupt the list.
  const b = new ParticleSystem(5000, 50);
  b.beginStep();
  b.burst('blood', 0, 0, 400, { speed: 200 });
  assert.equal(b.count, 50, 'a 400-particle burst must be trimmed to the 50 budget');
});

await check('particle budget does not starve a normal fight', async () => {
  // The regression we are guarding against: the cap must be high enough that
  // the busiest measured arena never drops a particle at full density.
  const { CONFIG } = await import('../src/core/Config.js');
  assert.ok(CONFIG.render.particleStepBudget >= 120, 'budget must stay above the measured arena peak');
});

/* ---------- Room graph: the choice model ------------------------------- */

await check('a floor is a straight run of choices: one room per step', async () => {
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  for (const seed of [3, 8, 55, 4242, 90210]) {
    const bus = new EventBus();
    const game = new Game({
      bus,
      state: new StateMachine(bus, 'menu'),
      callbacks: {
        onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
        onPlayerDeath: () => {}, onNotice: () => {},
      },
    });
    game.startRun('warrior', 'whirlwind', seed);

    /** @type {number[]} */
    const entered = [];
    for (let guard = 0; guard < 40; guard++) {
      const node = game.run.currentNode();
      const rt = game.rooms.runtime;
      assert.ok(node && rt, 'a run must always be in a room');
      entered.push(node.id);

      const doors = rt.room.doors.filter((d) => d.targetRoomId !== undefined);
      if (node.type === 'boss') {
        assert.equal(doors.length, 0, 'the boss arena is the end of the path');
        break;
      }

      // Every step is a choice of 2-3 rooms, and every offered room has a
      // door: the doors ARE the choice.
      assert.ok(
        doors.length >= 2 && doors.length <= 3,
        `room ${node.id} built ${doors.length} doors, expected 2-3`,
      );
      assert.equal(doors.length, node.next.length, 'every offered room must have a door');

      rt.cleared = true;
      game.run.markCleared();
      game.travelTo(node.next[0]);
    }

    // A run visits exactly one room per step — it cannot skip ahead, and the
    // extra doors never lengthen the floor.
    assert.equal(
      entered.length,
      game.run.layers,
      `seed ${seed}: walked ${entered.length} rooms, floor is ${game.run.layers} long`,
    );
    assert.equal(new Set(entered).size, entered.length, 'a room must never be entered twice');
  }
});

await check('every exit names the room it leads to, in a distinct colour', async () => {
  const { offerById } = await import('../src/systems/DungeonGenerator.js');
  const { roomTypeColor, roomTypeLabel, ROOM_TYPE_COLORS } = await import('../src/data/roomTypes.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  // The player reads the destination from the colour, so no two room types
  // may share one.
  const types = ['start', 'arena', 'shop', 'healing', 'boss'];
  const colors = types.map((t) => roomTypeColor(t));
  assert.equal(new Set(colors).size, types.length, 'room types must not share a colour');
  for (const t of types) {
    assert.ok(roomTypeColor(t).startsWith('#'), `${t} needs a hex colour`);
    assert.ok(roomTypeLabel(t).length > 0, `${t} needs a label`);
  }
  assert.ok(ROOM_TYPE_COLORS.default, 'an unknown room type still needs a colour');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('warrior', 'whirlwind', 4242);

  // Walk the route and check the built geometry, not just the plan.
  for (let guard = 0; guard < 12; guard++) {
    const rt = game.rooms.runtime;
    const node = game.run.currentNode();
    if (!rt || !node) break;

    const openDoors = rt.room.doors;
    if (node.type === 'boss') {
      // The boss arena is entered once and seals; it has no doors at all.
      assert.equal(openDoors.length, 0, 'the boss arena must have no doors');
      break;
    }
    assert.ok(
      openDoors.length >= 2 && openDoors.length <= 3,
      `room ${node.id} (${rt.type}) built ${openDoors.length} doors`,
    );

    const expected = node.next;
    for (const door of openDoors) {
      const targetId = Number(door.targetRoomId);
      assert.ok(
        expected.includes(targetId),
        `room ${node.id} has a door to ${targetId}, which is not one of its offered rooms`,
      );
      const offer = offerById(game.run.plan, targetId);
      assert.ok(offer, `the door to ${targetId} must lead to a room that exists`);
      assert.equal(
        door.targetType,
        offer.type,
        `the door to room ${targetId} must be labelled "${offer.type}"`,
      );
      assert.equal(
        door.elite,
        offer.elite === true,
        `the door to room ${targetId} must carry the elite flag of its offer`,
      );
      assert.equal(roomTypeColor(door.targetType), roomTypeColor(offer.type));
    }

    if (node.next.length === 0) break;
    rt.cleared = true;
    game.run.markCleared();
    game.travelTo(node.next[0]);
  }
});

await check('REGRESSION: the doors not taken are gone, and there is no way back', async () => {
  // The complaint this replaces: the whole floor was generated up front, so
  // its rooms could be seen and several could be skipped. Now a door leads to
  // the next room on a straight path, and taking it destroys the alternatives
  // — and the room left behind — for good.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');

  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('warrior', 'whirlwind', 77);

  const start = game.run.currentNode();
  const offered = start.next.slice();
  assert.ok(offered.length >= 2, 'the entrance must offer a choice');

  const taken = offered[0];
  const leftBehind = offered.slice(1);
  game.travelTo(taken);

  const current = game.run.currentNode();
  assert.equal(current.depth, start.depth + 1, 'a door advances exactly one step');
  assert.equal(game.run.depth, 1, 'the run is one step in');

  // The rooms behind the other doors are no longer part of the floor at all.
  for (const id of leftBehind) {
    assert.equal(
      game.run.plan.offers.has(id),
      false,
      `room ${id} was not chosen and must be gone, not merely unreachable`,
    );
  }

  // There is no door back: neither the room passed by nor the entrance.
  const before = game.run.currentNodeId;
  game.travelTo(leftBehind[0]);
  assert.equal(game.run.currentNodeId, before, 'a discarded room must not be enterable');
  game.travelTo(start.id);
  assert.equal(game.run.currentNodeId, before, 'the room behind must not be a door');

  // Nor can the player jump ahead to a room that has not been offered.
  const farId = (current.depth + 2) * 10;
  game.travelTo(farId);
  assert.equal(game.run.currentNodeId, before, 'a room off the path must not be enterable');

  // The rooms the player CAN enter are exactly the doors in front of them.
  const doors = game.rooms.runtime.room.doors
    .filter((d) => d.targetRoomId !== undefined)
    .map((d) => Number(d.targetRoomId));
  assert.deepEqual(doors.slice().sort(), current.next.slice().sort());
  for (const id of doors) {
    assert.ok(game.run.plan.offers.has(id), `offered room ${id} must exist`);
  }
});

await check('the elite variant is a harder fight for a better reward', async () => {
  // The last door of a floor offers a normal boss and an elite one. That
  // choice is only real if the louder door pays: an elite boss must be a
  // harder fight AND roll its legendary at a higher rate.
  const { CONFIG } = await import('../src/core/Config.js');
  const { LootSystem } = await import('../src/systems/LootSystem.js');
  const { Random, rng } = await import('../src/core/Random.js');
  const { roomTypeColor, roomTypeLabel } = await import('../src/data/roomTypes.js');

  const base = CONFIG.loot.bossLegendaryChance;
  const elite = Math.min(1, base + CONFIG.loot.bossEliteLegendaryBonus);
  assert.ok(elite > base, 'the elite boss must beat the normal legendary rate');
  assert.ok(elite < 1, 'the elite boss must still not guarantee a legendary');

  // The elite variant must be visually distinct, or the choice is invisible.
  assert.notEqual(
    roomTypeColor('boss', { elite: true }),
    roomTypeColor('boss'),
    'the elite boss needs its own colour',
  );
  assert.notEqual(roomTypeLabel('boss', { elite: true }), roomTypeLabel('boss'));

  // Deterministic proof that the bonus is really applied: the legendary roll
  // is the first draw of the reward, so a seed whose first draw falls between
  // the two rates must upgrade at the elite rate and not at the base one.
  let seed = 0;
  for (let i = 1; i < 20000; i++) {
    const draw = new Random(i).next();
    if (draw > base + 0.02 && draw < elite - 0.02) { seed = i; break; }
  }
  assert.ok(seed > 0, 'expected a seed whose first draw sits between the two rates');

  const loot = new LootSystem();
  const first = (isElite) => {
    rng.seed = seed;
    rng.reset();
    return loot.rollBossReward('warrior', isElite)[0];
  };
  assert.equal(first(false).legendary, false, 'the base rate must not upgrade this roll');
  assert.equal(first(true).legendary, true, 'the elite rate must upgrade the same roll');

  // And the harder fight really is harder: the elite boss is entered with an
  // elite guard, and the arena seals behind the player like any boss room.
  const { EventBus } = await import('../src/core/EventBus.js');
  const { StateMachine } = await import('../src/core/StateMachine.js');
  const { Game } = await import('../src/game/Game.js');
  const bus = new EventBus();
  const game = new Game({
    bus,
    state: new StateMachine(bus, 'menu'),
    callbacks: {
      onStateChange: () => {}, onRoomCleared: () => {}, onBossSpawned: () => {},
      onPlayerDeath: () => {}, onNotice: () => {},
    },
  });
  game.startRun('warrior', 'whirlwind', 1234);

  // Walk to the room before the boss and take its louder door.
  for (let guard = 0; guard < 40; guard++) {
    const node = game.run.currentNode();
    if (node.depth === game.run.layers - 2) break;
    game.rooms.runtime.cleared = true;
    game.run.markCleared();
    game.travelTo(node.next[0]);
  }
  const lastRoom = game.run.currentNode();
  assert.equal(lastRoom.depth, game.run.layers - 2, 'must reach the room before the boss');

  const doors = game.rooms.runtime.room.doors.filter((d) => d.targetRoomId !== undefined);
  assert.equal(doors.length, 2, 'the room before the boss must offer both boss variants');
  const eliteDoor = doors.find((d) => d.elite === true);
  const normalDoor = doors.find((d) => d.elite !== true);
  assert.ok(eliteDoor && normalDoor, 'both a normal and an elite boss door are required');

  game.travelTo(Number(eliteDoor.targetRoomId));
  const rt = game.rooms.runtime;
  assert.equal(rt.type, 'boss', 'the elite door must lead to the boss arena');
  assert.equal(rt.eliteBoss, true, 'the elite boss must be flagged for its reward roll');
  assert.equal(rt.room.sealed, true, 'the boss arena must seal behind the player');

  const boss = game.registry.enemies.find((e) => e.kind === 'boss');
  assert.ok(boss, 'the elite boss arena must still spawn the boss');
  const guards = game.registry.enemies.filter((e) => e.alive && e.kind !== 'boss').length;
  assert.ok(guards >= 3, `the elite boss must come with a guard, got ${guards}`);
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
console.log(`${results.length - failures}/${results.length} checks passed`);
process.exit(failures > 0 ? 1 : 0);
