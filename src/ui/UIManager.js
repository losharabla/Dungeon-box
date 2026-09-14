/**
 * @fileoverview UI manager: every DOM element outside the canvas.
 *
 * SRP: own the HTML interface — screens, HUD, shop, overlays — and map game
 * state onto it. It reads state through the EventBus and a small query
 * interface; it never mutates gameplay directly, it only raises intents the
 * engine handles.
 *
 * Keeping all DOM work here is what allows the renderer to be pure Canvas
 * and the simulation to be pure data.
 */

import { CLASS_IDS, getClass } from '../data/classes.js';
import { ultimatesForClass, getUltimate } from '../data/ultimates.js';
import { getUpgrade } from '../data/upgrades.js';
import { drawMage, drawGunner, drawWarrior } from '../rendering/characterRenderer.js';
import { fmtInt, percent } from '../core/MathUtils.js';
import { CONFIG } from '../core/Config.js';

/**
 * @typedef {object} UIIntents
 * @property {() => void} startRun
 * @property {() => void} restart
 * @property {() => void} nextFloor
 * @property {() => void} resume
 * @property {() => void} abandonRun
 * @property {() => void} shopLeave
 * @property {() => void} healingLeave
 * @property {() => void} rewardTake
 * @property {(item: any) => void} buy
 * @property {(choice: any) => void} pickReward
 * @property {(classId: string, ultId: string) => void} selectCharacter
 */

export class UIManager {
  /**
   * @param {UIIntents} intents
   */
  constructor(intents) {
    this.intents = intents;
    /** Currently focused screen name, for debugging and tests. */
    this.screen = 'menu';
    /** Selected class on the character-select screen. */
    this.selectedClass = 'warrior';
    this.selectedUlt = ultimatesForClass('warrior')[0].id;

    this.el = {
      screens: /** @type {Record<string, HTMLElement>} */ ({}),
      classGrid: must('class-grid'),
      ultList: must('ult-list'),
      hud: must('hud'),
      hpFill: must('hud-hp-fill'),
      hpText: must('hud-hp-text'),
      goldText: must('hud-gold-text'),
      rooms: must('hud-rooms'),
      weaponName: must('hud-weapon-name'),
      dashFill: must('hud-dash-fill'),
      ultName: must('hud-ult-name'),
      ultFill: must('hud-ult-fill'),
      hint: must('hud-hint'),
      bossBar: must('boss-bar'),
      bossName: must('boss-name'),
      bossFill: must('boss-fill'),
      shop: must('overlay-shop'),
      shopGrid: must('shop-grid'),
      shopGold: must('shop-gold'),
      healing: must('overlay-healing'),
      healingText: must('healing-text'),
      reward: must('overlay-reward'),
      rewardGrid: must('reward-grid'),
      pause: must('overlay-pause'),
      transition: must('overlay-transition'),
      transitionText: must('transition-text'),
      statsGameOver: must('stats-gameover'),
      statsVictory: must('stats-victory'),
      victorySub: must('victory-sub'),
      nextFloorBtn: must('btn-next-floor'),
      errorBox: must('error-box'),
    };

    for (const section of document.querySelectorAll('.screen')) {
      const name = section.getAttribute('data-screen');
      if (name) this.el.screens[name] = /** @type {HTMLElement} */ (section);
    }

    this._buildCharacterSelect();
    this._bindActions();

    /** Cached values so the HUD only touches the DOM when something changed. */
    this._cache = {
      hp: -1, maxHp: -1, gold: -1, ult: -1, dash: -1, weapon: '', hint: '', ultLabel: '',
      rooms: '', bossHp: -1,
    };

    this._transitionTimer = 0;
  }

  /* ============================================================
     Screen management
     ============================================================ */

  /**
   * Show exactly one full-screen section.
   * @param {string} name
   */
  showScreen(name) {
    for (const [key, node] of Object.entries(this.el.screens)) {
      const active = key === name;
      node.hidden = !active;
      if (active) {
        // Restart the entrance animation when returning to a screen.
        node.classList.remove('screen-enter', 'screen-victory', 'screen-game-over');
        void node.offsetWidth;
        node.classList.add('screen-enter');
        if (name === 'victory') node.classList.add('screen-victory');
        if (name === 'game_over') node.classList.add('screen-game-over');
      }
    }
    this.screen = name;
  }

  /**
   * Show or hide one of the in-game overlays.
   * @param {'shop'|'healing'|'reward'|'pause'|'transition'} name
   * @param {boolean} visible
   */
  setOverlay(name, visible) {
    const node = /** @type {HTMLElement|undefined} */ (this.el[name]);
    if (!node) return;
    node.hidden = !visible;
    if (visible) {
      // Rewind the overlay entrance animation for repeated room visits.
      node.classList.remove('overlay-enter');
      void node.offsetWidth;
      node.classList.add('overlay-enter');
    }
  }

  /** Hide every in-game overlay. */
  hideOverlays() {
    this.setOverlay('shop', false);
    this.setOverlay('healing', false);
    this.setOverlay('reward', false);
    this.setOverlay('pause', false);
    this.setOverlay('transition', false);
  }

  /**
   * Show a large centred announcement for a moment.
   * @param {string} text
   */
  showTransition(text) {
    this.el.transitionText.textContent = text;
    this.setOverlay('transition', true);
    this.el.transition.classList.remove('transition-wipe');
    void this.el.transition.offsetWidth;
    this.el.transition.classList.add('transition-wipe');
  }

  /** Explicitly hide the announcement. */
  hideTransition() {
    this.setOverlay('transition', false);
    this.el.transition.classList.remove('transition-wipe');
  }

  /* ============================================================
     HUD
     ============================================================ */

  /**
   * Push live player state into the HUD. Only changed fields touch the DOM.
   * @param {import('../entities/Player.js').Player|null} player
   * @param {import('./RunState.js').RunState} run
   * @param {import('./RoomController.js').RoomController} rooms
   */
  updateHud(player, run, rooms) {
    if (!player) return;
    const c = this._cache;

    const hp = Math.max(0, Math.round(player.hp));
    const maxHp = Math.round(player.maxHp);
    if (hp !== c.hp || maxHp !== c.maxHp) {
      c.hp = hp;
      c.maxHp = maxHp;
      this.el.hpFill.style.width = `${percent(player.hp, player.maxHp)}%`;
      this.el.hpText.textContent = `${fmtInt(hp)} / ${fmtInt(maxHp)}`;
    }

    const gold = Math.round(player.gold);
    if (gold !== c.gold) {
      c.gold = gold;
      this.el.goldText.textContent = fmtInt(gold);
      this.el.shopGold.textContent = fmtInt(gold);
    }

    const ult = Math.round(player.ultCharge);
    if (ult !== c.ult) {
      c.ult = ult;
      this.el.ultFill.style.width = `${ult}%`;
    }

    // Dash readiness recharges continuously, so it is quantized to keep the
    // DOM write off the hot path when nothing visibly changes.
    const dashLeft = player.dashCooldown ?? 0;
    const dash = Math.round(percent(CONFIG.dash.cooldown - dashLeft, CONFIG.dash.cooldown));
    if (dash !== c.dash) {
      c.dash = dash;
      this.el.dashFill.style.width = `${dash}%`;
      this.el.dashFill.classList.toggle('ready', dash >= 100);
    }

    const weaponName = player.weapon.name;
    if (weaponName !== c.weapon) {
      c.weapon = weaponName;
      this.el.weaponName.textContent = weaponName;
      this.el.weaponName.classList.toggle('legendary', player.weapon.legendary === true);
    }

    // Ultimate label reflects readiness, which doubles as the "ULT READY"
    // indicator the design document asks for (§21).
    const ultLabel = player.ultReady
      ? `${getUltimate(player.ultimateId).name} — ГОТОВО`
      : getUltimate(player.ultimateId).name;
    if (ultLabel !== c.ultLabel) {
      c.ultLabel = ultLabel;
      this.el.ultName.textContent = ultLabel;
    }

    // Boss health bar (§31) appears only during a boss fight.
    const boss = rooms.registry.enemies.find((e) => e.kind === 'boss' && e.alive);
    if (boss) {
      if (this.el.bossBar.hidden) this.el.bossBar.hidden = false;
      const bhp = Math.round(percent(boss.hp, boss.maxHp));
      if (bhp !== c.bossHp) {
        c.bossHp = bhp;
        this.el.bossFill.style.width = `${bhp}%`;
        this.el.bossName.textContent = boss.bossDef.name;
      }
    } else if (!this.el.bossBar.hidden) {
      this.el.bossBar.hidden = true;
      c.bossHp = -1;
    }

    this._updateRoomMap(run);
  }

  /**
   * Floor progress along the straight path to the boss (design doc §19).
   *
   * The panel deliberately lists **no rooms**. The floor's rooms are dealt
   * one step at a time and the ones not chosen are destroyed immediately, so
   * a list would both spoil the choice and describe rooms that no longer
   * exist. What the player needs here is how far along the path they are;
   * what lies behind each door is written on the door itself.
   * @param {import('./RunState.js').RunState} run
   */
  _updateRoomMap(run) {
    const layers = run.layers ?? 0;
    if (layers <= 0) return;
    const depth = Math.min(run.depth ?? 0, layers - 1);
    const floorIndex = run.floorIndex ?? 0;

    const signature = `${floorIndex}:${depth}:${layers}`;
    if (signature === this._cache.rooms) return;
    this._cache.rooms = signature;

    this.el.rooms.innerHTML =
      `<span>ЭТАЖ ${floorIndex + 1}</span>`
      + `<span class="step">КОМНАТА ${depth + 1} / ${layers}</span>`;
  }

  /**
   * Contextual prompt shown near the bottom of the screen.
   * @param {string} text empty hides the hint
   */
  setHint(text) {
    if (text === this._cache.hint) return;
    this._cache.hint = text;
    this.el.hint.textContent = text;
    this.el.hint.hidden = !text;
  }

  /* ============================================================
     Screens
     ============================================================ */

  _buildCharacterSelect() {
    // Class cards with a small canvas preview drawn procedurally.
    this.el.classGrid.innerHTML = '';
    for (const id of CLASS_IDS) {
      const def = getClass(id);
      const card = document.createElement('div');
      card.className = 'class-card';
      card.dataset.classId = id;

      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 130;
      card.appendChild(canvas);

      const name = document.createElement('div');
      name.className = 'cc-name';
      name.textContent = def.name;
      card.appendChild(name);

      const role = document.createElement('div');
      role.className = 'cc-role';
      role.textContent = def.role;
      card.appendChild(role);

      const stats = document.createElement('div');
      stats.className = 'cc-stats';
      stats.innerHTML = `
        <div>HP<span>${def.hp}</span></div>
        <div>Damage<span>${def.damage}</span></div>
        <div>Speed<span>${def.speed}</span></div>
        <div>Range<span>${def.attackRange === 'short' ? 'ближний' : 'дальний'}</span></div>
      `;
      card.appendChild(stats);

      const desc = document.createElement('div');
      desc.className = 'cc-desc';
      desc.textContent = def.desc;
      card.appendChild(desc);

      card.addEventListener('click', () => this.selectClass(id));
      this.el.classGrid.appendChild(card);

      this._drawClassPreview(canvas, id);
    }
    this.selectClass(this.selectedClass);
  }

  /**
   * Draw a small idle preview of the class on its selection card.
   *
   * This reuses the same procedural character rig as the game, so the menu
   * art can never drift from the in-game silhouette.
   * @param {HTMLCanvasElement} canvas
   * @param {string} classId
   */
  _drawClassPreview(canvas, classId) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t = performance.now() / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(0, 0);

    // A minimal stand-in entity so the renderer receives the same shape it
    // would in-game.
    const stub = {
      x: 60, y: 108, radius: 15, facing: 0, hurtFlash: 0,
      attack: { recoil: 0, muzzleFlash: 0, swingTime: 0, swingTotal: 0 },
      isSwinging: false, visualFacing: 0, weaponId: classId === 'mage' ? 'fire_staff'
        : classId === 'gunner' ? 'pistol' : 'sword', age: t,
    };

    const drawers = PREVIEW_DRAWERS;
    const draw = drawers[classId];
    if (draw) draw(ctx, stub, t, 0);
    ctx.restore();
  }

  /**
   * Repaint every class preview (called while the menu is visible, so the
   * characters breathe instead of looking like static images).
   * @param {number} time
   */
  animatePreviews(time) {
    if (this.screen !== 'character_select') return;
    const canvases = this.el.classGrid.querySelectorAll('canvas');
    canvases.forEach((canvas, index) => {
      const id = CLASS_IDS[index];
      if (id) this._drawClassPreview(/** @type {HTMLCanvasElement} */ (canvas), id);
    });
    void time;
  }

  /**
   * @param {string} classId
   */
  selectClass(classId) {
    this.selectedClass = classId;
    for (const card of this.el.classGrid.querySelectorAll('.class-card')) {
      card.classList.toggle('selected', card.getAttribute('data-class-id') === classId);
    }
    this._buildUltList(classId);
  }

  /**
   * @param {string} classId
   */
  _buildUltList(classId) {
    const ults = ultimatesForClass(classId);
    this.selectedUlt = ults[0].id;
    this.el.ultList.innerHTML = '';

    for (const ult of ults) {
      const card = document.createElement('div');
      card.className = 'ult-card';
      card.dataset.ultId = ult.id;
      card.innerHTML = `<div class="uc-name">${ult.name}</div><div class="uc-desc">${ult.desc}</div>`;
      card.addEventListener('click', () => {
        this.selectedUlt = ult.id;
        for (const node of this.el.ultList.querySelectorAll('.ult-card')) {
          node.classList.toggle('selected', node.getAttribute('data-ult-id') === ult.id);
        }
      });
      this.el.ultList.appendChild(card);
    }
    const first = this.el.ultList.querySelector('.ult-card');
    if (first) first.classList.add('selected');
  }

  /**
   * Populate and show the shop (design doc §17).
   * @param {any[]} stock
   * @param {import('../entities/Player.js').Player} player
   */
  openShop(stock, player) {
    this.el.shopGrid.innerHTML = '';
    this.el.shopGold.textContent = fmtInt(player.gold);

    for (const item of stock) {
      const card = document.createElement('div');
      card.className = 'shop-item';
      if (item.sold) card.classList.add('sold');
      else if (player.canAfford(item.price)) card.classList.add('affordable');

      const name = document.createElement('div');
      name.className = `si-name${item.legendary ? ' legendary' : ''}`;
      name.textContent = item.name;
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'si-desc';
      desc.textContent = item.desc;
      card.appendChild(desc);

      const buy = document.createElement('button');
      buy.className = 'si-buy';
      buy.textContent = item.sold ? 'Продано' : `${item.price} золота`;
      buy.disabled = item.sold || !player.canAfford(item.price);
      buy.addEventListener('click', () => {
        this.intents.buy(item);
        this.refreshShop(stock, player);
      });
      card.appendChild(buy);

      this.el.shopGrid.appendChild(card);
    }
  }

  /**
   * Re-render affordability and sold state without rebuilding the overlay.
   * @param {any[]} stock
   * @param {import('../entities/Player.js').Player} player
   */
  refreshShop(stock, player) {
    this.openShop(stock, player);
  }

  /**
   * Show the healing room result (design doc §16).
   * @param {number} healed
   * @param {string} bonusId
   * @param {import('../entities/Player.js').Player} player
   */
  openHealing(healed, bonusId, player) {
    const bonus = getUpgrade(bonusId);
    this.el.healingText.innerHTML =
      `Восстановлено <b>${fmtInt(healed)}</b> HP (30% от максимума).<br>` +
      `Дар алтаря: <b>${bonus.name}</b> — ${bonus.desc}`;
    void player;
  }

  /**
   * Show the reward choice (design doc §15).
   * @param {any[]} choices
   * @param {import('../entities/Player.js').Player} player
   */
  openReward(choices, player) {
    this.el.rewardGrid.innerHTML = '';

    for (const choice of choices) {
      const card = document.createElement('div');
      card.className = 'shop-item reward-item affordable';
      if (card.style && typeof card.style.setProperty === 'function') {
        card.style.setProperty('--reward-index', String(this.el.rewardGrid.children.length));
      }

      const name = document.createElement('div');
      name.className = `si-name${choice.legendary ? ' legendary' : ''}`;
      name.textContent = choice.name;
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'si-desc';
      desc.textContent = choice.desc;
      card.appendChild(desc);

      const take = document.createElement('button');
      take.className = 'si-buy';
      take.textContent = 'Забрать';
      take.addEventListener('click', () => this.intents.pickReward(choice));
      card.appendChild(take);

      this.el.rewardGrid.appendChild(card);
    }
    void player;
  }

  /**
   * End-of-run statistics (design doc §"Game Over").
   * @param {HTMLElement} target
   * @param {import('../entities/Player.js').Player} player
   * @param {import('./RunState.js').RunState} run
   */
  renderStats(target, player, run) {
    const s = player.stats;
    const minutes = Math.floor(run.elapsed / 60);
    const seconds = Math.floor(run.elapsed % 60);
    const rows = [
      ['Класс', getClass(player.classId).name],
      ['Оружие', player.weapon.name],
      ['Этаж', String(run.floorIndex + 1)],
      ['Убийств', fmtInt(s.kills)],
      ['Нанесено урона', fmtInt(s.damageDealt)],
      ['Получено урона', fmtInt(s.damageTaken)],
      ['Собрано золота', fmtInt(s.goldEarned)],
      ['Комнат пройдено', fmtInt(s.roomsCleared)],
      ['Время', `${minutes}:${String(seconds).padStart(2, '0')}`],
    ];
    target.innerHTML = rows
      .map(([label, value]) => `<div class="st-label">${label}</div><div class="st-value">${value}</div>`)
      .join('');
  }

  /**
   * @param {string} text
   */
  setVictorySubtitle(text) {
    this.el.victorySub.textContent = text;
  }

  /**
   * The campaign is finite: on the last floor there is no floor to advance
   * to, so the button must not sit there pretending to work.
   * @param {boolean} visible
   */
  setNextFloorVisible(visible) {
    this.el.nextFloorBtn.hidden = !visible;
  }

  /**
   * Surface a runtime error instead of leaving a black screen.
   * @param {string} message
   */
  showError(message) {
    this.el.errorBox.hidden = false;
    this.el.errorBox.textContent = message;
  }

  /** Hide the error box. */
  clearError() {
    this.el.errorBox.hidden = true;
  }

  /* ============================================================
     Wiring
     ============================================================ */

  _bindActions() {
    document.addEventListener('click', (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      const action = target.getAttribute?.('data-action');
      if (!action) return;

      switch (action) {
        case 'goto': {
          const dest = target.getAttribute('data-target');
          if (dest) this.showScreen(dest);
          break;
        }
        case 'show-help': {
          const help = document.querySelector('.help-block');
          if (help) /** @type {HTMLElement} */ (help).hidden = !/** @type {HTMLElement} */ (help).hidden;
          break;
        }
        case 'start-run': {
          this.intents.selectCharacter(this.selectedClass, this.selectedUlt);
          this.intents.startRun();
          break;
        }
        case 'restart': this.intents.restart(); break;
        case 'next-floor': this.intents.nextFloor(); break;
        case 'resume': this.intents.resume(); break;
        case 'abandon-run': this.intents.abandonRun(); break;
        case 'shop-leave': this.intents.shopLeave(); break;
        case 'healing-leave': this.intents.healingLeave(); break;
        case 'reward-take': this.intents.rewardTake(); break;
        default: break;
      }
    });
  }
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function must(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`UI element #${id} is missing from index.html`);
  return el;
}

/**
 * Preview drawing functions per class, reusing the in-game character rig so
 * the menu can never drift from the real silhouette.
 * @type {Record<string, (ctx: CanvasRenderingContext2D, entity: any, time: number, move: number) => void>}
 */
const PREVIEW_DRAWERS = {
  warrior: drawWarrior,
  mage: drawMage,
  gunner: drawGunner,
};
