# Roguelike Prototype

A complete 2D roguelike prototype for the browser: **HTML5 Canvas + vanilla JavaScript ES modules**.
No build step, no bundler, no framework, and **not a single external image asset** — every
character, weapon, boss, wall and effect is drawn procedurally with Canvas primitives.

The implementation follows the design document (`диздок.txt`) in this folder.

---

## Performance and presentation

The renderer bakes static room ground, walls, and darkening layers into cached
browser canvases, while retaining an immediate-mode fallback for headless and
limited contexts. Particle creation is capped per fixed simulation step
(`CONFIG.render.particleStepBudget = 140`) as well as by the population ceiling;
floor blood/scorch/chip decals use a bounded 96-mark ring buffer. The debug
counter shows FPS, particles and dropped emissions, projectiles, hazards,
floating text, and decals.

Presentation polish includes animated torch atmosphere and motes, persistent
bounded impact marks, crit/kill hit-stop and feedback, breathing and cloth
motion on characters, melee wind-up poses, and animated screen/transition,
reward, and end-screen UI states.

Verification commands:

```text
npm test                    core, DOM, graphics, balance, and frame-cost budgets
npm run test:survivability  before/after benchmark: can each class live in a late arena?
npm run test:soak          long campaign/resource soak and emission-budget checks
npm run test:arenas        12 arena clearability simulations
npm run test:campaign      all class/ultimate campaigns through 3 bosses
npm run preview            procedural gameplay PNG preview
```

Measured frame-cost probes stay within budget: approximately 6.6x overdraw in
busy arenas and 8.2x in boss rooms, with three cached layer blits per frame.

## Running the game

**Double-click `ЗАПУСТИТЬ.bat`.** It opens a console, starts the local server and opens the
game in the browser. Closing that console window stops the server. Node.js must be installed
([nodejs.org](https://nodejs.org/)); the launcher says so instead of vanishing if it is missing.

ES modules cannot be loaded from `file://`, so the game needs *a* static server, and the same
zero-dependency server can be run by hand:

```bash
node tools/serve.mjs                  # local only, first free port
node tools/serve.mjs 3000             # a specific port
node tools/serve.mjs --open           # open the browser as well
node tools/serve.mjs --host 0.0.0.0   # allow other devices on the network
node tools/serve.mjs --help           # usage
```

The server binds `127.0.0.1` (local only) and prints the address it *actually* uses. If the
requested port is reserved by Windows (`EACCES`) or already taken (`EADDRINUSE`), it moves to
the next candidate automatically and opens the browser at the right address. That is not
theoretical: Hyper-V, WSL and Docker reserve blocks of the Windows port range and re-roll them
on reboot (`winnat` restart), which is why binding `8080` can work one day and fail the next.

Any other static server works equally well (e.g. `python -m http.server`).

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Aim |
| Left mouse button | Attack — a melee swing also destroys enemy projectiles in its arc |
| `Space` | Dash — a short burst of speed in the movement direction |
| `Q` | Ultimate (once charged to 100%) |
| `E` | Interact — shop, healing altar, doors |
| `ESC` | Pause |
| Walking into an open door | Travel to the room that door leads to |

---

## Architecture

The codebase is organised as a dependency-injected set of single-purpose modules. Nothing
imports a global `game` object; every system receives what it needs through its constructor.

```
/
├── index.html          Screens + HUD markup (DOM interface lives outside the canvas)
├── style.css           All UI styling
├── jsconfig.json       Optional: enables JSDoc-based type checking in an editor
├── package.json        Scripts only — the game itself has zero dependencies
├── диздок.txt          The Russian design document this implements
├── ЗАПУСТИТЬ.bat       Double-click launcher: server + browser, stops with the window
├── LICENSE             MIT
│
├── src/
│   ├── main.js             Composition root: builds the object graph, boots the loop
│   │
│   ├── core/               Engine primitives
│   │   ├── Config.js           All shared tuning constants
│   │   ├── MathUtils.js        Pure math helpers
│   │   ├── Random.js           Seeded PRNG (runs are reproducible)
│   │   ├── EventBus.js         Pub/sub + canonical event names
│   │   ├── StateMachine.js     Screen/state transitions (§28)
│   │   ├── InputService.js     Keyboard + mouse capture
│   │   ├── GameLoop.js         Fixed-timestep loop with interpolation
│   │   ├── Collision.js        Geometry primitives + entity hit shapes
│   │   └── Services.js         Service container + canonical service names
│   │
│   ├── data/               Content definitions — pure data, zero behaviour (§30)
│   │   ├── classes.js          3 playable classes
│   │   ├── weapons.js          10 normal + 3 legendary weapons
│   │   ├── enemies.js          10 enemy types + their AI archetypes
│   │   ├── bosses.js           3 bosses with attack scripts and phase thresholds
│   │   ├── ultimates.js        9 ultimates (3 per class)
│   │   ├── upgrades.js         Temporary run-scoped upgrades
│   │   └── roomTypes.js        Room type → colour + label (doors, HUD, markers)
│   │
│   ├── game/
│   │   └── Game.js             One run: update order, interaction, run lifecycle
│   │
│   ├── entities/           World objects and their own state
│   │   ├── Entity.js           Base: position, health, facing, timers
│   │   ├── StatusEffects.js    Burn / slow / stun / invulnerability / post-hit window
│   │   ├── Player.js           Player stats, weapon, ultimate charge
│   │   ├── Enemy.js            Data-driven enemy instance
│   │   ├── Boss.js             Boss with phases and attack scheduling
│   │   ├── Room.js             Room geometry + CollisionWorld
│   │   └── EntityRegistry.js   The live entity collections
│   │
│   ├── systems/            The rules that operate on entities
│   │   ├── CombatSystem.js       Damage, crits, blocks, status, death, rewards
│   │   ├── CombatCoordinator.js  Player attack cadence + ultimates
│   │   ├── ProjectileSystem.js   Projectiles: pierce, ricochet, explosions
│   │   ├── MovementSystem.js     Movement, wall sliding, separation
│   │   ├── AISystem.js           One behaviour function per enemy archetype
│   │   ├── BossController.js     Boss attack execution + hazards
│   │   ├── Spawner.js            Wave composition and spawning
│   │   ├── RoomController.js     Room lifecycle (§15–§18)
│   │   ├── DungeonGenerator.js   Floor shape: the straight run of choices (§19)
│   │   ├── RunState.js           Floor progression and route
│   │   ├── LootSystem.js         Rewards and shop stock
│   │   └── UltimateSystem.js     The 9 ultimate abilities
│   │
│   ├── rendering/          Procedural Canvas drawing (§23–§25)
│   │   ├── RenderSystem.js       Canvas ownership, scaling, camera, shake
│   │   ├── SceneRenderer.js      Draw ordering for the whole scene
│   │   ├── drawUtils.js          Reusable Canvas primitives
│   │   ├── characterRenderer.js  Humanoid rig + every enemy silhouette
│   │   ├── playerRenderer.js     Class dispatch, ultimate auras, reticle
│   │   ├── bossRenderer.js       The 3 boss silhouettes + telegraphs
│   │   ├── weaponRenderer.js     Held weapons, recoil, muzzle flash
│   │   ├── projectileRenderer.js Projectile archetypes, chain lightning
│   │   ├── particleSystem.js     The particle system (§26)
│   │   ├── effectsRenderer.js    Hazards, ultimate visuals, altars, exits
│   │   ├── textEffects.js        Floating numbers + screen flash
│   │   ├── roomRenderer.js       Floors, walls, doors (colour + plate), props
│   │   ├── roomBake.js           Bakes static room layers into cached canvases
│   │   ├── meleePose.js          One swing timeline for body, blade and slash
│   │   ├── decals.js             Bounded floor marks (blood, scorch, chips)
│   │   └── entityRenderer.js     Enemy kind → draw function dispatch
│   │
│   └── ui/
│       └── UIManager.js    Every DOM element outside the canvas
│
└── tools/                  Development tooling (not shipped with the game)
    ├── serve.mjs              Zero-dependency static server (+ port auto-pick)
    ├── NavGrid.mjs            Grid pathfinder used by the simulation bots
    ├── smoke-test.mjs         Unit + regression tests
    ├── dom-test.mjs           DOM/boot integration tests
    ├── align-test.mjs         HUD band vs letterboxed world band
    ├── camera-test.mjs        Camera follow behaviour and framing
    ├── graphics-test.mjs      Renders real frames against a recording context
    ├── balance-test.mjs       Kiters, parry, ultimate charge, whirlwind, dash
    ├── hitbox-audit.mjs       Measures drawn silhouettes against their hit boxes
    ├── survivability-test.mjs Late-arena survival benchmark (no invincibility cheat)
    ├── soak-test.mjs          Long campaign + resource-leak soak
    ├── frame-cost.mjs         Per-frame gradient and overdraw budgets
    ├── parry-regression.mjs   Melee parry through the real swing window
    ├── input-regression.mjs   Letterboxed input coordinate mapping
    ├── ui-cache-regression.mjs  HUD element caching
    ├── render-frame.mjs       Software rasteriser: writes a frame to a PNG
    ├── render-alignment.mjs   Writes hud-alignment.svg (visual proof of the band)
    ├── verify-arenas.mjs      Proves every arena is clearable
    ├── simulate-run.mjs       Headless full-run simulator
    └── simulate-floors.mjs    Multi-floor campaign test
```

### The frame pipeline

A single fixed-step update per frame runs systems in a deliberate order, so that each
system sees a consistent world:

```
input → player intent & attacks → enemy AI → boss scheduling → projectiles
      → movement & collision → status damage → ultimates → room rules
      → particles/text/camera → render
```

Rendering is a separate pass with explicit back-to-front ordering
(`SceneRenderer`), which keeps depth-sorting bugs in exactly one place.

---

## SOLID mapping

The task explicitly required strict SOLID separation into isolated services. This is how
each principle is realised, with the file that demonstrates it.

### Single Responsibility

Each module answers exactly one question. The five services named in the task:

| Service | File | Responsibility |
| --- | --- | --- |
| **CoreEngine** | `core/GameLoop.js`, `game/Game.js` | Own the clock, the update order, and the composition of a run |
| **RenderSystem** | `rendering/RenderSystem.js` | Own the canvas, scaling, camera and screen shake — and nothing about gameplay |
| **CombatSystem** | `systems/CombatSystem.js` | Resolve damage: crits, blocks, status, death, rewards |
| **EventBus** | `core/EventBus.js` | Transport messages, and nothing else |
| **UIManager** | `ui/UIManager.js` | Own the DOM interface outside the canvas |

This separation is enforced by construction, not convention. Examples:

* `Collision.js` only answers geometry questions — it never applies damage or moves anything.
* `CollisionWorld.moveCircle()` moves a circle; `CombatSystem.applyHit()` decides what a hit
  means. Neither knows about the other.
* `ParticleSystem` has no idea *why* a particle exists; combat, movement and bosses all just
  ask for one.
* Renderers read entity data and return nothing. They never mutate state.
* `data/*.js` files contain only content definitions — no behaviour at all (§30).

### Open/Closed

New content extends the game without modifying systems:

* **New enemy** → add a row to `data/enemies.js` + one entry in `entityRenderer.js`'s
  registry. `AISystem`'s update loop is untouched because archetypes are dispatched by
  `def.ai` through a behaviour table.
* **New weapon** → add an object to `data/weapons.js`. `CombatSystem` interprets the
  declarative fields (`burnChance`, `pierce`, `knockback`, …); it has no per-weapon branch.
* **New upgrade** → add an entry to `data/upgrades.js` whose `apply(player)` is the single
  extension point.
* **New ultimate** → add data to `data/ultimates.js` plus one handler in `UltimateSystem`.
* **New particle type** → add a preset to the table in `particleSystem.js`.
* **New boss** → add data to `data/bosses.js`; `BossController` interprets the attack `kind`.

### Liskov Substitution

`Enemy` and `Boss` both extend `Entity` and are interchangeable everywhere the engine treats
things generically — `CombatSystem`, `MovementSystem`, `EntityRegistry` and the renderers all
work against the `Entity` contract (`takeDamage`, `heal`, `getCircle`, `tickCommon`,
`applyKnockback`).

`Boss` deliberately extends `Entity` rather than `Enemy`: an enemy is a row of data-driven
stats with an AI archetype, while a boss is defined by its attack script. Modelling them as
siblings keeps both honest. `Boss` still exposes the enemy-shaped fields (`def`, `ai`,
`getSpeed()`, `getDamage()`) so shared systems read it uniformly.

### Interface Segregation

Dependencies are narrow. `MovementSystem` needs only a `CollisionWorld` and a registry —
it has no access to combat. `UIManager` receives a small `intents` record of callbacks
instead of the whole `Game`. `ParticleSystem.draw()` takes a `RenderSystem` only to cull
off-screen particles; it cannot reach the camera or the loop.

### Dependency Inversion

Systems depend on abstractions they receive, never on modules they reach for:

* Every system takes its collaborators through its constructor (`CombatSystem`,
  `AISystem`, `BossController`, `ProjectileSystem`, …).
* `EventBus` is the seam that removes direct coupling: `CombatSystem` emits
  `EVENTS.ENTITY_DIED` and does not know that `Game` uses it to detect the player's death.
* The composition happens once, in `main.js` / `Game.js` — the only modules allowed to know
  about all the others.
* `Game.update(dt, input)` accepts a plain input snapshot, so gameplay can be driven by a
  keyboard, a bot, or a test harness without change. This is what makes the headless
  simulation tests possible.

---

## Content (MVP scope, §32)

| Category | Delivered |
| --- | --- |
| Playable classes | 3 — Warrior, Mage, Gunner |
| Normal enemies | 10 — Slime, Goblin, Skeleton, Orc, Bat, Mage, Shieldbearer, Assassin, Berserker, Necromancer |
| Bosses | 3 — Stone Golem, Fire Lord, Executioner (each with a phase-2 transition) |
| Normal weapons | 10 |
| Legendary weapons | 3 — Bloodthirster, Staff of the Void, Hellstorm |
| Ultimates | 9 (3 per class), one chosen before the run |
| Room types | 4 — Start, Arena, Shop, Healing, plus Boss Arena |
| Waves | Wave 1 → Wave 2 → Elite Wave → Victory |
| Progression | Weapons + temporary run-scoped upgrades (no character levels, §20) |
| Screens | Main Menu, Character Select, HUD, Shop, Healing, Reward, Pause, Game Over, Victory |

### Visual presentation

Per §2 and §35 there are **no PNG/JPG sprites anywhere**. Everything is built from
`fillRect`, arcs, paths, gradients, transparency, rotation, particles and procedural
animation:

* Characters share one procedural humanoid rig (shadow, legs, torso, head) with
  per-class proportions, colouring and props — so a Warrior, a Goblin and an Orc are
  recognisably different silhouettes drawn by the same code.
* Every enemy type has its own dedicated draw function and silhouette (§23).
* Weapons follow the hand, rotate toward the cursor, and show recoil and muzzle flash (§24).
* Boss attacks draw a ground telegraph before they land (§25).

---

## Tests

The project ships a headless test suite because the gameplay logic is fully decoupled from
the DOM and the canvas.

```bash
npm test              # core, DOM, alignment, camera, graphics, balance and audit regressions
npm run test:unit     # engine, data integrity and regression checks
npm run test:dom      # DOM contract, UI wiring and a real main.js boot
npm run test:align    # HUD band vs letterboxed world band
npm run test:camera   # camera follow behaviour and framing
npm run test:graphics # real frames rendered against a recording context
npm run test:balance  # kiters, parry, ultimate charging, whirlwind and dash
npm run test:hitboxes # measured coverage of every drawn silhouette
npm run test:survivability # late-arena survival benchmark, no invincibility cheat
npm run test:soak     # long campaign and resource-leak soak
npm run test:arenas   # proves every arena is clearable
npm run test:campaign # all 6 class/ultimate combos through all 3 floors
npm run test:runs     # 9 simulated runs with coverage reporting
npm run test:all      # everything
npm run preview       # render one frame to tools/frame.png
```

Current status (verified locally):

Latest verification also recorded: frame-cost budgets passed (busy arena: 0 radial / 0 linear gradients, 6.8x overdraw, boss room 8.2x) plus baked-layer wall coverage checks; `npm run test:soak` passed 6/6 checks across 8 floors, 48 rooms and 8 boss fights (peak: 386 particles, 17 projectiles); `npm run test:hitboxes` reported 13/13 drawn silhouettes covered; `npm run test:arenas` cleared 12/12 arenas (12.5s average, 16.1s slowest); `npm run test:survivability` passed 7/7 with the melee class ahead of its pre-fix self in every measure; `npm run test:campaign` completed all 6 class/ultimate campaigns.

```
  38/38 unit + regression checks passed
 11/11 DOM and boot checks passed — including the boss → victory → next-floor UI path
 8/8  HUD alignment checks passed
 6/6  camera framing checks passed
13/13 graphics checks passed
 18/18 balance checks passed
 13/13 drawn silhouettes covered by their hit box
  7/7  survivability checks passed (late arena, 3 classes, mercy window on/off)
 6/6  swept parry regression checks passed
 4/4  input letterbox regression checks passed
 2/2  real HUD cache checks passed
 6/6  soak checks passed (8 floors, 48 rooms, 8 boss fights)
 12/12 arenas cleared (typical 12-17s; the bot occasionally stalls on navigation
 — slowest-clear outliers are bot variance, not room design)
 6/6  campaigns completed — every class defeats all three bosses
```

`npm run preview` renders a real frame through the actual `SceneRenderer`
against a small software rasteriser, so the procedural art can be inspected
without a browser. This is what made the visual bugs below findable.

### What the suites cover

* **`smoke-test.mjs`** — engine primitives (loop, bus, state machine, collision, RNG),
  data integrity against the design document's content counts, entity/status behaviour,
  dungeon-graph rules from §19, and **regression tests for every bug found during
  development** (see below).
* **`dom-test.mjs`** — parses the real `index.html`, constructs `UIManager` against a DOM
  stub, and then **imports the real `main.js`** to prove the game actually boots. This
  catches missing element ids, broken import paths, and mis-wired shared objects — the usual
  "works headlessly, blank screen in the browser" failures. It also asserts that the
  renderer and the simulation hold the *same* camera instance and that the rendered view
  tracks the player, which is the wiring bug the isolated camera tests could not see.
* **`balance-test.mjs`** — guards the gameplay problems reported from play. Kiter
  catchability (as a data invariant *and* by measuring the skeleton's real retreat speed on
  open floor); the melee parry, through `Game.update` rather than only in isolation; hybrid
  warrior-only timed charging and combat charging for the other classes; whirlwind being a
  mobility buff; and the dash, including that `Space` reaches it through `Game.update` and
  that its cooldown holds.
* **`verify-arenas.mjs`** — drives a pathfinding player through many arenas and asserts each
  one is clearable. This is what separates "the game is winnable" from "the test bot got
  stuck".
* **`survivability-test.mjs`** — the one probe that plays *without* the invincibility cheat
  every other bot uses. It fights a late arena (the 4/6/elite-3 recipe at floor-2 scaling)
  with the same scripted brain for all three classes and reports time, clears, survival and
  damage taken, then repeats the whole thing with the pre-fix numbers switched back in. A
  seeded `Math.random` and the shared RNG make the two columns comparable blow for blow. Its
  value is that it covers the blind spot the other suites share: an arena is *clearable* by
  every class, and still unsurvivable for a melee one.
* **`hitbox-audit.mjs`** — measures the painted silhouette of every enemy and boss through
  the real renderer against a recording 2D context that tracks the full affine transform, so
  rotated shields, bowed skeletons and spinning blades are measured where they are actually
  drawn. It separates the body from detached props, then fails if the combat box does not
  contain the body. This is the tool that turned "humanoids feel unhittable" into
  "the orc's box covers 3% of its own silhouette".
* **`simulate-floors.mjs`** — plays a three-floor campaign for every class/ultimate pair,
  asserting that all three bosses rotate in and are defeated.
* **`simulate-run.mjs`** — drives complete runs with a synthetic bot and reports coverage
  (kills, damage, rooms, shops, purchases, weapon swaps, bosses).

The synthetic players use a grid pathfinder (`tools/NavGrid.mjs`) rather than naive
steering, so a test measures the *game* rather than the bot's wall-avoidance.

### Bugs found by these tests and fixed

Each of these is now covered by a named regression test:

1. **Arenas could never be cleared.** `RoomController` overloaded one `spawnTimer` field for
   two different phases and set it to `Infinity` after spawning wave 1, which made the
   "wait for the room to empty" branch unreachable. Only the first wave ever spawned.
   Fixed with an explicit two-phase wave state machine.
2. **Entering a boss room crashed the game.** `Boss extends Enemy` passed a synthetic type id
   (`"__boss__"`) that did not exist in the enemy data, so the constructor threw. Fixed by
   making `Boss` extend `Entity` directly.
3. **The third boss's teleport crashed the game.** `BossController` referenced
   `this.collisionWorld`, which was never injected. Fixed by adding the dependency.
4. **Shieldbearers were invincible.** The shield blocked 100% of damage and the bearer
   rotated instantly to face the player, so "vulnerable from behind" (§11.7) was impossible
   to exploit. Worse, two bearers standing together covered each other's flanks, and an
   exhaustive search found **zero** positions from which either could be damaged. Fixed with
   a slow `turnRate`, a narrow `blockArc`, shield stamina that breaks under sustained fire,
   and area damage that bypasses the shield entirely.
5. **The player could be permanently welded into a corner.** `moveCircle()` rejected every
   step when the start position already overlapped geometry, and `resolve()` could land
   exactly on a corner tangent point. A player pinned in a corner of a cleared room could
   never reach the exit, deadlocking the run. Fixed with a resolve-escape step and an
   axis-aligned corner fallback.
6. **Summoners flooded the arena.** The boss summon attack had no cap at all, so a long
   fight produced 38+ minions — enough to wall the boss off from a melee player and to
   threaten the frame budget. Fixed with a shared room-wide minion ceiling.
7. **Cleared rooms could leave the player trapped.** `Game.interact()` set `rt.cleared = true`
   directly for shop and healing rooms, bypassing `Room.unseal()`, so a sealed support room
   stayed sealed forever. Separately, `Room.update()` treated an `Infinity` lock as "still
   locked" and skipped it, so a timed door could never release a room. Fixed by routing room
   completion through `RoomController.markConsumed()` and by deriving the sealed flag from
   the doors' actual state.
8. **`EventBus.once()` leaked its subscription** when the handler threw, growing the listener
   set without bound; and a handler unsubscribed *during* dispatch was still invoked. Both
   fixed in `emit`/`once`.
9. **The HUD did not line up with the world.** The canvas letterboxes a fixed 1280×720
   logical view into the window, but the DOM HUD used `inset: 0` and so spanned the whole
   window. At any aspect ratio other than 16:9 — for example 1920×931, which produces
   132px bars on each side — the room-map strip and the bottom-corner labels drifted away
   from the things they label. Fixed by having `RenderSystem.resize()` publish the
   letterbox band as `--view-*` CSS custom properties, which `.hud` and `.overlay` now
   consume.
10. **The camera did not follow the player.** `_syncCameraBounds` clamped the camera to the
    room, but *every* room in the game is smaller than the 1280×720 logical view (an arena
    is 1120×760), leaving at most 40px of travel — the camera was effectively frozen while
    the player walked off-centre. The follow easing (`followLerp: 7`) added a further
    visible lag. Fixed by removing room clamping entirely: the camera now tracks the player
    directly and `followLerp` is raised to 22. `RoomRenderer.drawBedrock` paints the
    overscan so the space beyond the walls reads as solid rock rather than void.
11. **Rendering a frame could crash the game.** `CombatSystem` built a particle override as
    `{ color: crit ? '#ff7a5a' : undefined }`, and the spread in `ParticleSystem.spawn`
    overwrote the preset colour with `undefined`. The next `hexAlpha()` call threw
    (`Cannot read properties of undefined`), killing the whole frame. Fixed at the call
    site, and hardened both `ParticleSystem.spawn` (fills any `undefined` field from the
    preset) and `hexAlpha` (falls back to opaque white on malformed input).
12. **Vertical walls rendered as a staggered staircase.** `brickPattern` was called with a
    fixed `brickW: 44, brickH: 20` for every wall, but a vertical wall is only 18px thick,
    so 20px courses overflowed it and produced a jagged pile of half-bricks. Fixed by
    deriving the brick grid from the rectangle's own thin axis.
13. **The aim reticle drifted away from the cursor.** `drawReticle` was called *after*
    `releaseCamera()`, so it drew at raw screen coordinates while being handed a
    world-space point. It only lined up when the camera happened to sit at the origin.
    Fixed by drawing it inside the camera transform.
14. **The HUD did not line up with the world.** The canvas letterboxes a fixed 1280×720
    logical view into the window, but the DOM HUD used `inset: 0` and so spanned the whole
    window. At 1920×931 — which produces 132px bars on each side — the room-map strip and
    the bottom-corner labels drifted away from the things they label. Fixed by having
    `RenderSystem.resize()` publish the letterbox band as `--view-*` CSS custom properties,
    which `.hud` and `.overlay` now consume.
15. **The camera never followed the player in the browser.** `main.js` created a `Camera` and
    handed it to `RenderSystem`, while `Game` constructed a *second* `Camera` for itself and
    updated only that one. Every camera test passed, because each inspected `game.camera` in
    isolation — and the offscreen frame renderer happened to inject `game.camera` explicitly,
    so previews looked right too. The browser renderer read a camera that nothing ever moved,
    so the world was always drawn from the origin (the room's corner) and the view stayed
    frozen no matter how far the player walked; the aim cursor was also unprojected through
    that stale transform. Fixed by making the camera an injected constructor dependency of
    `Game`, so the composition root hands `RenderSystem` and `Game` the same instance. The
    boot suite now asserts `render.camera === game.camera` and that the rendered view tracks
    the player end to end.
16. **The room strip hung in the middle of the screen.** `.hud` is a flex column and the room
    strip is its second child. With `justify-content: space-between` the free space was
    distributed between the rows, which parked that strip in the exact vertical centre of the
    view instead of under the top row. Fixed by stacking the top rows (`flex-start`) and
    letting only the bottom group consume the leftover space with `margin-top: auto`; the
    contextual hint was moved out of the flow so its appearance cannot shift the rows.
17. **Distance-keeping enemies could not be caught.** The skeleton and the mage retreated at
    their full movement speed, so against a retreating skeleton the warrior closed the gap at
    28 px/s — about 6% of its own speed. Technically faster, but the fight read as an endless
    chase and was effectively unwinnable for a melee class. Fixed in two places: retreating is
    now a fraction of the enemy's speed (`retreatSpeedMul`, 0.55 skeleton / 0.6 mage) so
    catchability is a property of the AI rather than a lucky number in one enemy's data, and
    the skeleton's base speed and preferred range were trimmed. The gap now closes at 87 px/s
    (was 28 px/s) and a warrior reaches melee range in under 2s. Guarded by a data invariant
    *and* by measuring the skeleton's real retreat speed, because the data can claim a
    multiplier the AI never applies.
18. **The advertised dash did nothing.** The help screen listed "Пробел — рывок" from the
    first build, but nothing was ever bound to `Space`: the key was swallowed by
    `InputService` (to stop the page scrolling) and then ignored. Fixed by implementing the
    ability rather than deleting the line — see the additions below. The readiness bar only
    appeared afterwards, because an ability with a cooldown and no feedback is unusable.
19. **The run dead-ended after the first boss.** Beating a middle boss printed "дверь
    открыта", but a boss node has no doors to the next floor (§19 ends at the boss), and the
    victory screen — the only way forward — was shown for the final boss alone. The fix
    shows the victory screen after *every* boss: the reward overlay closes first (it lives
    inside the playing screen, so opening victory early would hide it), then the screen
    offers "Следующий этаж". The button is hidden on the last floor, and the campaign length
    moved to `CONFIG.run.floors` (the boss order §12-14 defines exactly how long a run is).
    The campaign simulation could not catch this because it called `game.nextFloor()`
    directly, bypassing the UI — the flow is now driven by the real button click in
    `dom-test.mjs` instead.
20. **Hellstorm shook the camera non-stop.** Muzzle shake was keyed to the weapon's
    *rarity* (`legendary ? 3 : 1.6`), so the Hellstorm asked for a 3.0 impulse on every round.
    At 24 rounds a second under full heat the camera never got a chance to decay: measured
    sustained jitter was 10.7px (41% of the 26px cap) versus 3-5px for every one-shot event in
    the game. Shake now scales with the shot's computed recoil, so it tracks the weight of the
    blow: sustained Hellstorm fire peaks at 3.7px, while a single Sniper round still asks for
    more than a single Pistol round.
21. **The Sniper Rifle could never break a shield.** A blocked hit drained a flat 12 stamina,
    and a shieldbearer regenerates 9/s. The rifle's 1.35s cooldown returned 12.15 stamina —
    more than a round had taken — so its 78-damage shots blocked forever, no matter how long
    the player aimed. Blocking now strains by the weight of the blow (a Sniper round costs
    ~25 stamina): the guard drops in 8 shots, while light bullets still need sustained pressure
    and a shotgun pellet spread still threatens it.
22. **Bosses guaranteed a legendary weapon.** `_bossReward` always handed out the first
    legendary of the player's class, so finishing the campaign meant ending fully kitted and
    the rarest tier (§10) stopped being rare. The roll moved to `LootSystem.rollBossReward`
    and is now a 35% chance per boss (`CONFIG.loot.bossLegendaryChance`); three bosses still
    make a boss the best legendary source in the game (~1 in 2 runs) without a certainty.
23. **The player's documented post-hit invulnerability did not exist.**
    `CONFIG.combat.playerHurtIframe` was declared and commented as "invulnerability window
    after the player takes a hit", and `CombatSystem` did honour `status.isInvulnerable()` —
    but nothing ever *applied* that status on being hit: the only source was the
    Invulnerability ultimate. Enemies attack on independent timers, so every chaser standing
    on the player landed its blow on the same frame; four of them dealt ~52 HP/s to a 150 HP
    warrior and ended the run in about two seconds, while a ranged class never entered that
    zone and showed nothing wrong in any existing test. The window is now applied on any hit
    that actually lands (`hurtIframe`, 0.4s), kept distinct from the ultimate's `invulnerable`
    so the ability's ward bubble stays its own visual, deliberately bypassed by damage over
    time, and disabled by a value of 0. The class-by-class before/after is measured by
    `npm run test:survivability`: the warrior goes from clearing 2/5 late arenas at 16% HP to
    4/5 at 36%, and takes 24% less damage.
24. **Humanoids could not be hit above the knees.** Sprites are drawn standing *above* their
    ground point, but every hit test used a circle centred on that point (an 18px radius for
    the orc). An orc is painted 70px tall, so a shot aimed at its chest or head simply flew
    through it — measured coverage of its own silhouette was **3%**. It was worst on the
    tallest silhouettes and invisible on the shortest, which is why it survived so long: the
    slime, whose art fits its circle, covered 100% and looked fine. The fix separates three
    things that were conflated: the physical footprint (walls, separation), the drawn body
    (what attacks test), and detached props (a bow, an orbiting focus, spinning blades) which
    no static shape can track as they rotate. Enemies and bosses now declare a measured
    `hitWidth` / `hitUp` / `hitDown` box; the player keeps a circle, and hostile shots still
    test it, because enemies aim at the player's position rather than at painted art.
    `tools/hitbox-audit.mjs` renders every entity through the real renderer, tracks the full
    affine transform to recover the painted silhouette, separates the body from detached
    props, and fails when the box does not contain the body.

### Combat additions beyond the design document

Four deliberate departures, all driven by play feedback rather than preference. Each is
confined to one system so it can be reverted in isolation.

1. **Melee parry.** The document gives ranged enemies (§3, §6) and their projectiles no
   counterplay for a melee class, which is what made the skeleton encounter feel unfair
   rather than merely hard. A melee swing now destroys hostile projectiles inside its arc
   (§22 "attack" gains a defensive use). It is confined to melee weapons, lasts the whole
   swing animation rather than a single frame, and a projectile may opt out with
   `parryable: false`. Writing that flag surfaced a second bug: `ProjectileSystem.spawn()`
   copied only a fixed list of fields, so `parryable` was silently dropped and every shot was
   parryable regardless of what the caller asked for.
2. **Warrior hybrid ultimate charge.** The warrior alone enables `passiveUltCharge`
   in class data. His clock adds 3 charge per second while alive and the simulation is
   running (~33s from empty). Existing combat sources, including kills, remain active.
   Mage and gunner retain combat-only charging. Pausing freezes the simulation and clock.
3. **Whirlwind is a mobility buff.** §6 asks only that the warrior "can keep moving a little"
   during the spin, which was implemented as a 40% slow — felt like a self-stun on the class
   that already struggles to stay in range. It is now `moveScale: 1.35`, data-driven so the
   spin accelerates him into the enemies it is hitting.
4. **Dash on `Space`.** The help screen has advertised a dash since the first build while
   nothing was bound to the key, and §22 does not list one. Rather than retract the promise,
   the ability now exists: a 0.18s committed burst at 3.6× speed on a 1.5s cooldown, with a
   readiness bar in the HUD. It gives a melee class a way to close the last stretch to a
   ranged enemy, and it deliberately grants no invulnerability frames so it cannot trivialise
   boss patterns.

### Melee balance pass

Play feedback: "the warrior is too hard to play". The benchmark confirmed it was not a
feeling — measured over five late arenas with the same bot, the warrior cleared 2/5 and took
126 damage where the gunner cleared 5/5 and took 32. Three changes, in one place each:

| Change | File | Before → after |
| --- | --- | --- |
| Post-hit mercy window (bug #23) | `CombatSystem` + `Config.js` | none → 0.4s |
| Starting blade | `data/weapons.js` | 18 / 0.44s (40.9 DPS) → 22 / 0.40s (55 DPS) |
| Battle Axe / War Hammer | `data/weapons.js` | 32 (39 DPS) / 52 (45.2) → 37 (45.1) / 62 (53.9) |
| Warrior speed | `data/classes.js` | 3 (138 px/s) → 3.4 (156 px/s) |

The speed change is the one with an argument behind it: at 138 px/s the warrior was slower
than the goblin (3.4) and the assassin (3.2) that hunt him, so committing to a pack was
irreversible — he could not walk back out and re-engage, while both ranged classes outran
everything on the floor. At 3.4 he is still the slowest class in the game, but no longer the
slowest thing in his own fight; `test:survivability` asserts no chaser (dash bursts excepted)
walks faster than he does.

Melee also has to out-damage the classes that do not pay HP for uptime, so the same suite
asserts the blade beats the mage's staff and that the axe and hammer stay above 44 and 52 DPS.

Still open, and reported by the benchmark rather than hidden: the warrior takes ~3.7× the
gunner's damage and needs ~2× the time to clear the same arena. The probe's bot never dashes
and never disengages, so it measures melee at its worst and kiting at its best — but the gap
is real. The next lever is melee sustain (a small `healOnKill` on the warrior's normal
weapons), not more damage.

---

## Deliberate scope choices

* **No character levels** (§20) — power comes from weapons plus temporary upgrades, exactly
  as specified.
* **A straight path of choices, not a floor you can see** (§19) — the route to the boss is
  a fixed number of rooms, and every room offers **2–3 doors**, each leading to a *different*
  next room: a normal arena, a harder (violet `БОЙ+`) arena, a shop or a healing altar.
  Entering one door **destroys the others**: the rooms behind them are dropped from the floor
  and are never built, so nothing can be skipped and there is no way back. A floor's room
  count is unchanged — the choice changes *which* rooms you walk, never how many steps.
* **Nothing is generated ahead of the player.** The floor rolls only its *shape* (how many
  steps, and what kind of step each is). The next step's rooms exist as offers for exactly
  one decision; the HUD therefore shows progress (`ЭТАЖ 2 · КОМНАТА 3 / 9`) and no room
  list, because there is no map to show and the rooms you declined no longer exist.
* **The last door is a choice too: boss or elite boss.** The room before the boss offers the
  normal encounter and the same boss entered with an elite guard. The hard variant rolls its
  legendary weapon at `bossLegendaryChance + bossEliteLegendaryBonus` (0.35 + 0.30), which is
  what makes the louder door worth taking rather than a trap.
* **Doors are colour-coded, and named.** One palette (`src/data/roomTypes.js`) maps a room
  type to a colour and a short label; the door, its plate and the exit chevron all use it:
  blue = бой, violet = бой+, gold = лавка, green = лечение, red = босс, deep red = босс+.
  Walking into a doorway takes the door the player actually entered, not "the next room".
* **Rock-paper-scissors balance was avoided** — later floors scale enemy HP and damage
  modestly (about 1.32×/1.20× per floor) rather than demanding a specific build, so any
  class can finish a run.

---

## Extending the game

Because content is data-driven, most additions touch only `src/data/`:

```js
// src/data/enemies.js — add a new enemy
my_enemy: {
  id: 'my_enemy', name: 'My Enemy', ai: 'melee',
  maxHp: 40, speed: 2.5, damage: 12, radius: 14,
  goldMin: 5, goldMax: 10, xpValue: 1,
  attackCooldown: 0.8, attackRange: 32, attackType: 'melee',
  weight: 5, desc: '…',
},
```

Then add one line to the renderer registry in `src/rendering/entityRenderer.js`. No system
code changes.

For a distance-keeping enemy, also set `preferRange` and `retreatSpeedMul`. The multiplier
must stay clearly below 1: the balance suite fails if a kiter can retreat faster than the
slowest class can advance, because such an enemy can never be reached in melee.

For a new silhouette, run `npm run test:hitboxes` after adding the draw function. It prints
the measured body box for the new enemy and the values to put in `hitWidth` / `hitUp` /
`hitDown`. Skipping this is not harmless: an entity without a box is tested against a circle
on its feet, which is only correct for art that fits inside that circle.

---

## License

MIT — see [`LICENSE`](LICENSE). The game has no runtime dependencies and ships no third-party
assets: every visual is drawn with Canvas primitives at load time.
