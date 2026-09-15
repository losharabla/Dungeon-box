# Roguelike Prototype

*This is the English translation of the original Russian design document.*

## Game Design & Technical Design Document

## 1. Project Goal

Create a small, self-contained 2D roguelike prototype in JavaScript that runs directly in the browser.

The main goal of the first version is to obtain a fully playable game loop:

**character selection → random rooms → combat → getting weapons/resources → shop/healing → boss → victory or death → new run.**

The project must be simple to extend further.

---

## 2. Technologies

Use:

- HTML5
- JavaScript
- CSS
- HTML5 Canvas 2D API

Do not use at the prototype stage:

- React
- Vue
- Phaser
- Three.js
- external game engines
- external graphic assets

### Visual Principle

**No PNG/JPG sprites for game entities.**

All game objects must be drawn procedurally using Canvas:

- characters;
- enemies;
- bosses;
- weapons;
- bullets;
- magic projectiles;
- effects;
- particles;
- walls;
- decorative elements.

Allowed:

- `fillRect`
- `arc`
- `line`
- `polygon/path`
- `stroke`
- gradients
- transparency
- rotation
- scaling
- particles
- simple procedural textures

Using CSS/SVG for interface elements is permitted, but the game world must be rendered with Canvas.

---

## 3. Visual Style

Style:

**dark fantasy / stylized 2D**

The playfield must look like a full-fledged 2D game, and not like ASCII graphics or a set of simple squares.

Even if the characters are made of geometric primitives, they must have:

- a recognizable silhouette;
- a head;
- a body;
- limbs;
- a weapon;
- animation;
- a shadow under their feet;
- visual attack effects.

Approximate visual approach:

- dark rooms;
- contrasting characters;
- bright attack effects;
- particles;
- flashes;
- small screen shake effects;
- glow through semi-transparent layers;
- distinct visual silhouettes of enemies.

Photorealism is not required.

The main thing is **readability and the feeling of a real 2D game**.

---

## 4. Gameplay

The prototype uses real-time combat.

The player:

- moves with WASD;
- aims with the mouse;
- attacks with LMB;
- uses the ultimate with Q;
- picks up weapons;
- collects gold;
- visits the shop;
- restores health;
- progresses through rooms;
- fights the boss.

---

## 5. Main Game Loop

```text
Main Menu
     ↓
Character Select
     ↓
Run Start
     ↓
Room
     ↓
Combat / Shop / Healing
     ↓
Reward
     ↓
Next Room
     ↓
Boss Arena
     ↓
Victory
     ↓
Next Floor / Prototype Completion
```

On death:

```text
Game Over
   ↓
Run Statistics
   ↓
Restart
```

---

## 6. Characters

3 classes in total.

### 6.1 Warrior

Role: melee bruiser.

Stats:

```text
HP: 150
Damage: 15
Movement Speed: 3
Attack Range: short
```

Features:

- high health pool;
- strong attacks;
- good survivability;
- melee combat;
- strong knockback.

#### Ultimates

##### Whirlwind

The Warrior spins and deals damage to all enemies around him.

- large radius;
- high AoE damage;
- duration of about 2 seconds;
- the character can keep moving a little.

##### Invulnerability

The Warrior becomes invulnerable for a short time.

- duration: about 3 seconds;
- a visual effect around the character.

##### Berserker Strike

A powerful area attack in front of the character.

- very high damage;
- large knockback;
- a pronounced wind-up animation;
- screen shake on hit.

---

## 7. Mage

Role: ranged AoE / control.

```text
HP: 80
Damage: 20
Movement Speed: 4
Attack Range: long
```

Features:

- low HP;
- high damage;
- ranged combat;
- space control;
- AoE.

### Ultimates

#### Meteor

The player selects an area.

After a short delay a meteor falls there.

- huge AoE;
- high damage;
- a strong flash;
- particles;
- screen shake.

#### Chain Lightning

Lightning strikes one enemy and jumps to the nearest ones.

- maximum of 5 targets;
- damage decreases with each jump;
- a bright visual effect of a chain of lightning.

#### Time Stop

Stops all enemies for a few seconds.

- enemies stop moving and attacking;
- the player keeps moving;
- a visual effect of time slowing/stopping.

---

## 8. Gunner

Role: ranged DPS / mobility.

This is a **gunner**, not an archer.

Uses firearms.

```text
HP: 100
Damage: 12
Movement Speed: 5
Attack Range: long
```

Features:

- high speed;
- ranged combat;
- high rate of fire;
- strong dependence on the chosen weapon.

### Ultimates

#### Bullet Storm

Fires a large number of bullets for a short time.

The bullets are directed at the cursor or in a fan around the player.

#### Ricochet

For a few seconds bullets start ricocheting off walls.

#### Combat Stim

Restores part of the HP and temporarily increases movement speed.

---

## 9. Weapons

In total:

**10 common weapons + 3 legendary ones.**

A weapon must substantially change the play style.

### Common Weapons

#### Warrior

1. Sword

- medium damage;
- medium attack speed;
- basic weapon.

2. Battle Axe

- high damage;
- slow attack;
- small AoE.

3. War Hammer

- very high damage;
- very slow attack;
- strong knockback;
- chance to stun.

#### Mage

4. Fire Staff

- fire projectiles;
- they leave a small burning effect.

5. Ice Staff

- lower damage;
- slows enemies down.

6. Lightning Staff

- fast projectiles;
- chance of an additional chain lightning.

#### Gunner

7. Pistol

- high accuracy;
- high attack speed;
- small damage.

8. Shotgun

- several pellets;
- high damage at close range;
- short range.

9. Assault Rifle

- high rate of fire;
- small damage per bullet.

10. Sniper Rifle

- very high damage;
- low rate of fire;
- pierces enemies.

---

## 10. Legendary Weapons

A legendary weapon must be significantly stronger than a common one and must shape the optimal build of a specific class.

### Warrior — Bloodthirster

Special feature:

**Killing an enemy restores HP.**

Additionally:

- high damage;
- good attack speed;
- healing on kill.

Idea:

> The more aggressively the player plays, the more they restore.

---

### Mage — Staff of the Void

Special feature:

Projectiles pass through enemies.

On hit there is a chance to create a small explosion.

```text
Enemy → Enemy → Enemy
          ↓
         EXPLOSION
```

The weapon is especially effective against groups of enemies.

---

### Gunner — Hellstorm

Special feature:

**The longer the player fires continuously, the higher the rate of fire.**

After firing stops, the bonus gradually decreases.

This weapon encourages constant fire and movement.

---

## 11. Enemies

10 common types in total.

### 1. Slime

- slow;
- walks straight at the player;
- low HP;
- basic enemy.

### 2. Goblin

- fast melee enemy;
- low HP;
- attacks the player at close range.

### 3. Skeleton

- ranged enemy;
- fires simple projectiles;
- tries to keep its distance.

### 4. Orc

- slow;
- high HP;
- high melee damage.

### 5. Bat

- high speed;
- periodically makes a dash at the player.

### 6. Mage

- ranged;
- uses AoE attacks;
- tries to keep its distance.

### 7. Shieldbearer

- has a shield;
- blocks attacks from the front;
- vulnerable from behind.

### 8. Assassin

- disappears;
- teleports next to the player;
- attacks quickly;
- has low HP.

### 9. Berserker

- strong melee enemy;
- at low HP gains increased speed and damage.

### 10. Necromancer

- weak on its own;
- periodically summons a Skeleton;
- must be a priority target.

---

## 12. Bosses

3 bosses in total.

### Boss 1 — Stone Golem

A large melee boss.

Attacks:

- a regular strike;
- a ground slam;
- stone projectiles;
- summoning small golems.

Phase 2:

```text
HP < 50%
↓
speed increase
↓
more frequent attacks
↓
more AoE
```

Visually it must be significantly larger than the player.

---

## 13. Boss 2 — Fire Lord

Ranged/AoE boss.

Attacks:

- fireballs;
- fire rain;
- walls of fire;
- summoning fire mobs.

Core mechanic:

**the player must constantly move and avoid danger zones.**

Phase 2:

- more fire zones;
- faster attacks;
- shorter gaps between attacks.

---

## 14. Boss 3 — Executioner

The final boss.

A large melee/mobile enemy.

Attacks:

- dash;
- a series of strikes;
- a circular attack;
- teleportation;
- summoning spears.

Phase 2:

```text
HP < 50%
↓
increased speed
↓
attack combos
↓
more danger zones
```

---

## 15. Room Types

4 types in total.

### Arena

The main combat room.

On entry the doors close.

```text
Wave 1
↓
Wave 2
↓
Elite Wave
↓
Victory
```

After victory:

- the doors open;
- the player receives a reward;
- the option to continue appears.

Rewards may include:

- a weapon;
- gold;
- a random upgrade.

---

## 16. Healing Room

A room without enemies.

On visit:

- restores 30% of maximum HP.

It may also contain one small random bonus:

- +10% max HP;
- +10% damage;
- +10% movement speed.

---

## 17. Shop

A room without enemies.

A single currency is used — Gold.

Example of the assortment:

| Item | Price |
| --- | --- |
| Sword | 50 Gold |
| Potion | 30 Gold |
| +10% Damage | 80 Gold |
| +10% Speed | 80 Gold |

After purchase the item disappears from the shop.

---

## 18. Boss Arena

A special large room.

On entry:

- the doors close;
- the boss appears;
- the boss fight begins.

After victory:

- the doors open;
- the victory screen is shown;
- for further expansion it is possible to move on to the next floor.

---

## 19. Dungeon Generation

Complex procedural dungeon generation is not required.

Use a graph of rooms.

Example:

```text
        SHOP
          |
START — FIGHT — FIGHT
          |
         HEAL
          |
        FIGHT
          |
         BOSS
```

Each run may have a different arrangement of rooms.

Minimum rules:

```text
START
 ↓
2–4 FIGHT
 ↓
SHOP or HEAL
 ↓
2–4 FIGHT
 ↓
BOSS
```

In the future the system can be expanded.

---

## 20. Progression

At the prototype stage do not use a full character level system.

The player's power increases through:

#### Weapons

The main source of changing the combat style.

#### Temporary upgrades

Examples:

- +10% damage;
- +20 max HP;
- +15% movement speed;
- +10% critical chance;
- +20% attack speed.

All bonuses apply only during the current run.

---

## 21. Ultimate System

Each class has 3 ultimates.

The player chooses one ultimate before the run starts.

The ultimate charges during combat.

The charge can increase for:

- kills;
- dealing damage;
- taking damage — optional.

When the charge reaches 100%:

```text
ULT READY
```

Pressing `Q` activates the ability.

---

## 22. Controls

```text
W / A / S / D
    ↓
Movement

Mouse
    ↓
Aim

Left Mouse Button
    ↓
Attack

Q
    ↓
Ultimate

ESC
    ↓
Pause
```

---

## 23. Visual Rendering

Every entity must have its own drawing function.

Example architecture:

```js
drawPlayer(ctx, player)
drawWarrior(ctx, player)
drawMage(ctx, player)
drawGunner(ctx, player)

drawEnemy(ctx, enemy)
drawBoss(ctx, boss)

drawWeapon(ctx, weapon)
drawProjectile(ctx, projectile)

drawParticles(ctx)
drawEffects(ctx)
drawRoom(ctx)
```

Do not use one universal rectangle for all entities.

Each type must have its own silhouette.

---

## 24. Animations

Simple procedural animations are required.

### Player

- idle;
- walking;
- attack;
- hurt;
- death;
- ultimate.

### Enemy

At minimum:

- idle/movement;
- attack;
- hurt;
- death.

### Weapon

The weapon must:

- follow the hand;
- rotate in the direction of the cursor;
- have recoil;
- have its own muzzle flash for firearms.

---

## 25. VFX

Use procedural Canvas effects.

Required effects:

#### Hit effect

On hit:

- a small flash;
- particles;
- a short knockback;
- optional screen shake.

#### Death effect

When an enemy dies:

- particles;
- a small flash;
- disappearance.

#### Gun muzzle flash

For the Gunner's weapons:

- a short flash;
- particles;
- recoil.

#### Melee slash

For swords:

- an attack arc;
- a short trail;
- particles.

#### Magic projectile

For the Mage:

- glow;
- trail;
- impact effect.

#### Boss attacks

They must have a visual warning before a dangerous attack.

---

## 26. Particles

Create a simple particle system.

Each particle must have:

```js
{
    x,
    y,
    velocityX,
    velocityY,
    life,
    maxLife,
    size,
    type
}
```

Support:

- spawn;
- update;
- render;
- destroy.

Use the system for:

- hits;
- death;
- fire;
- magic;
- gunshots;
- explosions;
- bosses.

---

## 27. Collision

A simple collision system is needed.

At minimum:

- circle-vs-circle;
- circle-vs-rectangle;
- projectile-vs-enemy;
- player-vs-wall;
- enemy-vs-wall.

Complex physics is not needed.

---

## 28. Game State

The main game state:

```js
game.state =
    "menu" |
    "character_select" |
    "playing" |
    "shop" |
    "healing" |
    "boss" |
    "game_over" |
    "victory" |
    "pause";
```

---

## 29. Recommended Project Structure

```text
/
├── index.html
├── style.css
│
└── src/
    ├── main.js
    │
    ├── game/
    │   ├── Game.js
    │   ├── Player.js
    │   ├── Enemy.js
    │   ├── Boss.js
    │   ├── Weapon.js
    │   ├── Projectile.js
    │   └── Room.js
    │
    ├── systems/
    │   ├── combat.js
    │   ├── collision.js
    │   ├── particles.js
    │   ├── dungeon.js
    │   ├── loot.js
    │   └── progression.js
    │
    ├── rendering/
    │   ├── renderer.js
    │   ├── playerRenderer.js
    │   ├── enemyRenderer.js
    │   ├── weaponRenderer.js
    │   ├── effectsRenderer.js
    │   └── roomRenderer.js
    │
    └── data/
        ├── classes.js
        ├── weapons.js
        ├── enemies.js
        ├── bosses.js
        └── upgrades.js
```

---

## 30. Data-driven design

Game stats must not be hardcoded inside the systems.

For example:

```js
const classes = {
    warrior: {
        hp: 150,
        speed: 3,
        damage: 15
    },

    mage: {
        hp: 80,
        speed: 4,
        damage: 20
    },

    gunner: {
        hp: 100,
        speed: 5,
        damage: 12
    }
};
```

Weapons likewise:

```js
const weapons = {
    sword: {
        type: "melee",
        damage: 15,
        attackSpeed: 1
    },

    pistol: {
        type: "gun",
        damage: 12,
        fireRate: 5
    }
};
```

Adding new content should, as far as possible, require changing only data files.

---

## 31. UI

Minimal HUD:

```text
┌──────────────────────────────────────┐
│ HP  125 / 150       GOLD 120         │
│                                      │
│                                      │
│             GAME WORLD               │
│                                      │
│                                      │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ Weapon: Bloodthirster                │
│ Ultimate: ████████░░ 80%       [Q]  │
└──────────────────────────────────────┘
```

Required screens:

- Main Menu;
- Character Select;
- HUD;
- Shop;
- Game Over;
- Victory;
- Pause.

---

## 32. MVP Scope

The first version is considered ready when the following are present:

- 3 fully playable classes;
- 10 types of common enemies;
- 3 bosses;
- 10 common weapons;
- 3 legendary weapons;
- 9 ultimates;
- 4 room types;
- procedural route generation;
- combat;
- collision;
- projectiles;
- particles;
- animations;
- shop;
- healing;
- gold;
- temporary upgrades;
- boss fights;
- death;
- victory;
- restart.

---

## 33. What NOT to Implement in the MVP

Do not add without an explicit need:

- story;
- NPCs;
- dialogue;
- quests;
- crafting;
- a full skill tree;
- permanent meta-progression;
- saves;
- multiplayer;
- online features;
- accounts;
- complex physics;
- complex procedural generation;
- dozens of additional items;
- external sprites;
- external asset packs.

---

## 34. Development Priority

Develop in the following order:

#### Phase 1 — Core

1. Canvas setup.
2. Game loop.
3. Player movement.
4. Mouse aiming.
5. Basic collision.
6. Basic room.

#### Phase 2 — Combat

7. Player attack.
8. Projectile system.
9. Enemy system.
10. Enemy AI.
11. Damage/HP.
12. Death.
13. Particles.

#### Phase 3 — Content

14. 3 player classes.
15. 10 enemies.
16. 10 weapons.
17. 9 ultimates.
18. 3 bosses.

#### Phase 4 — Roguelike

19. Room generation.
20. Arena rooms.
21. Healing rooms.
22. Shop.
23. Gold.
24. Loot.
25. Temporary upgrades.

#### Phase 5 — Polish

26. Animations.
27. Weapon recoil.
28. Hit effects.
29. Boss telegraphs.
30. Screen shake.
31. UI.
32. Menu.
33. Victory/Game Over.
34. Balance pass.

---

## 35. Main Technical Principle

**First make the game functional, then make it beautiful.**

But the visual system must be designed for procedural 2D graphics from the very beginning.

Do not create a temporary architecture based on ASCII or coloured squares that will later have to be completely rewritten.

Even the first enemy must immediately have its own rendering function and its own silhouette.

Goal:

> To get a small but visually cohesive 2D game that works fully without a single external game sprite.

If a complex drawing is required for some visual element, first look for a solution through Canvas primitives, paths, gradients, particles and procedural animation, rather than adding an image asset.

---

## 36. Definition of Done

The prototype is considered working if a new user can:

1. open the game;
2. choose Warrior/Mage/Gunner;
3. start a run;
4. move around the room;
5. aim with the mouse;
6. attack;
7. kill enemies;
8. receive gold/rewards;
9. pick up a weapon;
10. use the ultimate;
11. visit the Shop;
12. buy an item;
13. restore HP;
14. get through several random rooms;
15. reach the Boss Arena;
16. defeat the boss;
17. see Victory;
18. or die and see Game Over;
19. start a new run.

After this list has been completed, **do not expand the MVP automatically**. First check the game loop and only then add new content.
