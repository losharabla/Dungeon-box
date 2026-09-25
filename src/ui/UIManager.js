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
import { UPGRADES, getUpgrade } from '../data/upgrades.js';
import { WEAPONS } from '../data/weapons.js';
import { STAT_CHIPS, characterStatChips, upgradeDeltaLine, weaponStatLine } from './statDisplay.js';
import { drawMage, drawGunner, drawWarrior } from '../rendering/characterRenderer.js';
import { fmtInt, percent } from '../core/MathUtils.js';
import { CONFIG } from '../core/Config.js';
import { NULL_AUDIO_CONTROLS, UI_BACK, UI_CLICK } from '../audio/audioControls.js';

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
 * @property {() => void} [openDebug]
 * @property {() => void} [debugClose]
 */

/** Mixer rows, in the order they appear in both menus. */
const AUDIO_ROWS = /** @type {const} */ ([
  { key: 'master', label: 'Master volume' },
  { key: 'music', label: 'Music' },
  { key: 'effects', label: 'Effects' },
]);

export class UIManager {
  /**
   * @param {UIIntents} intents
   * @param {object} [options]
   * @param {import('../audio/audioControls.js').AudioControls} [options.audio]
   *   mixer adapter; omitted in tests and headless runs, which then play nothing
   */
  constructor(intents, options = {}) {
    this.intents = intents;
    /** Mixer surface. Narrow by design: four members, not the whole engine. */
    this.audio = options.audio ?? NULL_AUDIO_CONTROLS;
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
      weaponStats: must('hud-weapon-stats'),
      hudStats: must('hud-stats'),
      dashFill: must('hud-dash-fill'),
      beam: must('hud-beam'),
      beamName: must('hud-beam-name'),
      beamFill: must('hud-beam-fill'),
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
      debug: must('overlay-debug'),
      debugGrid: must('debug-grid'),
      transition: must('overlay-transition'),
      transitionText: must('transition-text'),
      statsGameOver: must('stats-gameover'),
      statsVictory: must('stats-victory'),
      victorySub: must('victory-sub'),
      nextFloorBtn: must('btn-next-floor'),
      errorBox: must('error-box'),
      settingsMenu: must('settings-menu'),
      settingsPause: must('settings-pause'),
    };

    for (const section of document.querySelectorAll('.screen')) {
      const name = section.getAttribute('data-screen');
      if (name) this.el.screens[name] = /** @type {HTMLElement} */ (section);
    }

    this._buildCharacterSelect();
    this._buildAudioControls();
    this._bindActions();

    /** Cached values so the HUD only touches the DOM when something changed. */
    this._cache = {
      hp: -1, maxHp: -1, gold: -1, ult: -1, dash: -1, weapon: '', hint: '', ultLabel: '',
      rooms: '', bossHp: -1, weaponStats: '', stats: '',
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
   * @param {'shop'|'healing'|'reward'|'pause'|'transition'|'debug'} name
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
    this.setOverlay('debug', false);
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

    // Weapon stats. The line depends only on the weapon and the two permanent
    // modifiers it prints — never on a transient like the heat ramp — so the
    // signature keeps the DOM write off every frame where nothing moved.
    const weaponSignature = `${player.weaponId}|${player.modifiers.damageMul}|${player.modifiers.attackSpeedMul}`;
    if (weaponSignature !== c.weaponStats) {
      c.weaponStats = weaponSignature;
      this.el.weaponStats.textContent = weaponStatLine(player.weapon, player);
    }

    // Character stats: every modifier this run has stacked, with the totals
    // the player actually fights with. Six chips rebuilt as one string, and
    // only when one of the six values moves.
    const statSignature = STAT_CHIPS
      .map((row) => player.modifiers[row.key] ?? row.base)
      .join('|');
    if (statSignature !== c.stats) {
      c.stats = statSignature;
      this.el.hudStats.innerHTML = characterStatChips(player)
        .map((chip) => `<span class="stat-chip${chip.boosted ? ' boosted' : ''}">`
          + `${chip.label}<span class="v">${chip.text}</span></span>`)
        .join('');
    }

    // Beam heat. Only magic weapons have one, so the whole block comes and
    // goes with the weapon, and the gauge is quantised exactly like the dash
    // bar: it moves every frame while the beam is held, and a DOM write the
    // player cannot see is wasted work on the render path.
    const hasBeam = Boolean(player.weapon.beam && player.weapon.kind === 'magic');
    if (hasBeam !== c.beamShown) {
      c.beamShown = hasBeam;
      this.el.beam.hidden = !hasBeam;
    }
    if (hasBeam) {
      const heat = Math.round((player.beam?.heat ?? 0) * 100);
      const locked = player.beam?.locked === true;
      if (heat !== c.beamHeat || locked !== c.beamLocked) {
        c.beamHeat = heat;
        c.beamLocked = locked;
        this.el.beamFill.style.width = `${heat}%`;
        this.el.beamFill.classList.toggle('overheated', locked);
        this.el.beamName.textContent = locked ? 'Beam — overheated' : 'Beam';
      }
    }

    // Ultimate label reflects readiness, which doubles as the "ULT READY"
    // indicator the design document asks for (§21).
    const ultLabel = player.ultReady
      ? `${getUltimate(player.ultimateId).name} — READY`
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
      `<span>FLOOR ${floorIndex + 1}</span>`
      + `<span class="step">ROOM ${depth + 1} / ${layers}</span>`;
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
     Mixer controls
     ============================================================ */

  /**
   * Build the mixer rows into both settings containers.
   *
   * The markup is generated instead of written twice in `index.html`, so the
   * start menu and the pause screen cannot drift apart — the failure mode a
   * hand-maintained second copy always eventually produces.
   */
  _buildAudioControls() {
    for (const container of [this.el.settingsMenu, this.el.settingsPause]) {
      if (!container) continue;
      this._buildAudioControlsInto(container);
    }
    this.syncAudioControls();
  }

  /**
   * @param {HTMLElement} container
   */
  _buildAudioControlsInto(container) {
    container.innerHTML = '';

    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'btn btn-small setting-mute';
    mute.setAttribute('data-setting', 'mute');
    mute.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.settings.muted);
      this.syncAudioControls();
      if (!this.audio.settings.muted) this.playUiSound(UI_CLICK);
    });
    container.appendChild(mute);

    for (const row of AUDIO_ROWS) {
      const line = document.createElement('div');
      line.className = 'setting-row';

      const label = document.createElement('span');
      label.className = 'setting-label';
      label.textContent = row.label;

      const value = document.createElement('span');
      value.className = 'setting-value';
      value.setAttribute('data-setting', row.key);

      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'setting-range';
      range.setAttribute('data-setting', row.key);
      setRangeBounds(range);
      range.addEventListener('input', () => {
        this.audio.set(row.key, Number(range.value) / 100);
        this.syncAudioControls();
        // Audition the level on the slider the player is dragging, so the
        // change is audible while it is being made.
        if (row.key === 'effects') this.playUiSound(UI_CLICK);
      });

      line.appendChild(label);
      line.appendChild(value);
      line.appendChild(range);
      container.appendChild(line);
    }
  }

  /**
   * Push the current mixer values into both control sets. Called after any
   * change from either place, which is what keeps the two sliders in sync.
   */
  syncAudioControls() {
    const settings = this.audio.settings;
    for (const container of [this.el.settingsMenu, this.el.settingsPause]) {
      if (!container) continue;
      for (const range of container.querySelectorAll('.setting-range')) {
        const key = /** @type {'master'|'music'|'effects'} */ (
          range.getAttribute('data-setting')
        );
        const level = Number(settings[key] ?? 1);
        range.value = String(Math.round(level * 100));
      }
      for (const value of container.querySelectorAll('.setting-value')) {
        const key = /** @type {'master'|'music'|'effects'} */ (
          value.getAttribute('data-setting')
        );
        value.textContent = `${Math.round(Number(settings[key] ?? 1) * 100)}%`;
      }
      for (const mute of container.querySelectorAll('.setting-mute')) {
        const muted = settings.muted === true;
        mute.textContent = muted ? 'Sound: off' : 'Sound: on';
        mute.classList.toggle('muted', muted);
      }
    }
  }

  /**
   * Menu feedback. Silent before the first gesture and in a headless run,
   * where the mixer adapter is the null object.
   * @param {string} id
   */
  playUiSound(id) {
    this.audio.play(id, { gain: 0.9 });
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
        <div>Range<span>${def.attackRange === 'short' ? 'melee' : 'ranged'}</span></div>
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

      const delta = this._offerDelta(item, player);
      if (delta) {
        const line = document.createElement('div');
        line.className = 'si-delta';
        line.textContent = delta;
        card.appendChild(line);
      }

      const buy = document.createElement('button');
      buy.className = 'si-buy';
      buy.textContent = item.sold ? 'Sold' : `${item.price} gold`;
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
   * The "what this does to your totals" line for an offer, or ''.
   *
   * An upgrade describes its effect through its own `stat` descriptor, which
   * is what turns "5% of the damage you deal is returned as health" into
   * "Life steal 5% → 10%" for a player who already owns one. A weapon offer
   * is worth comparing against what is in hand, so it gets the same line.
   * Gold and potions have nothing to compare.
   * @param {any} item a LootEntry
   * @param {import('../entities/Player.js').Player} player
   * @returns {string}
   */
  _offerDelta(item, player) {
    if (!item || !player) return '';
    if (item.kind === 'upgrade') {
      const def = UPGRADES[item.id];
      return def ? upgradeDeltaLine(def, player) ?? '' : '';
    }
    if (item.kind === 'weapon') {
      const def = WEAPONS[item.id];
      return def ? weaponStatLine(def, player) : '';
    }
    return '';
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
      `Restored <b>${fmtInt(healed)}</b> HP (30% of maximum).<br>` +
      `Altar gift: <b>${bonus.name}</b> — ${bonus.desc}`;
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

      const delta = this._offerDelta(choice, player);
      if (delta) {
        const line = document.createElement('div');
        line.className = 'si-delta';
        line.textContent = delta;
        card.appendChild(line);
      }

      const take = document.createElement('button');
      take.className = 'si-buy';
      take.textContent = 'Take';
      take.addEventListener('click', () => this.intents.pickReward(choice));
      card.appendChild(take);

      this.el.rewardGrid.appendChild(card);
    }
    void player;
  }

  /**
   * Populate and display the weapon debug selection overlay.
   * @param {import('../entities/Player.js').Player} player
   * @param {(weaponId: string) => void} [onSelect]
   * @param {{onHeal?: () => void, onAddGold?: (amount?: number) => void, onMaxUlt?: () => void}} [actions]
   */
  openDebugMenu(player, onSelect, actions) {
    if (onSelect) this._debugOnSelect = onSelect;
    if (actions) this._debugActions = actions;
    const currentWeaponId = player?.weaponId ?? player?.weapon?.id;
    this.el.debugGrid.innerHTML = '';

    const categories = [
      { id: 'melee', title: 'Warrior / Melee', icon: '⚔️', weapons: ['sword', 'battle_axe', 'war_hammer', 'bloodthirster'] },
      { id: 'magic', title: 'Mage / Staves', icon: '🔮', weapons: ['fire_staff', 'ice_staff', 'lightning_staff', 'staff_of_the_void'] },
      { id: 'gun', title: 'Gunner / Firearms', icon: '🔫', weapons: ['pistol', 'shotgun', 'assault_rifle', 'sniper_rifle', 'hellstorm'] },
    ];

    for (const cat of categories) {
      const section = document.createElement('div');
      section.className = 'debug-category';

      const heading = document.createElement('div');
      heading.className = 'debug-cat-header';
      heading.innerHTML = `<span>${cat.icon}</span> ${cat.title}`;
      section.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'debug-cat-list';

      for (const wId of cat.weapons) {
        const def = WEAPONS[wId];
        if (!def) continue;

        const isEquipped = wId === currentWeaponId;
        const card = document.createElement('div');
        card.className = `debug-item${def.legendary ? ' legendary' : ''}${isEquipped ? ' is-equipped' : ''}`;
        card.dataset.weaponId = wId;

        const head = document.createElement('div');
        head.className = 'debug-item-head';

        const name = document.createElement('div');
        name.className = `debug-item-name${def.legendary ? ' legendary' : ''}`;
        name.textContent = def.name;
        if (def.legendary) {
          const badge = document.createElement('span');
          badge.className = 'badge-legendary';
          badge.textContent = '★ Legendary';
          name.appendChild(badge);
        }
        head.appendChild(name);

        if (isEquipped) {
          const badge = document.createElement('span');
          badge.className = 'debug-badge-equipped';
          badge.textContent = '✓ In Hand';
          head.appendChild(badge);
        }

        card.appendChild(head);

        const stats = document.createElement('div');
        stats.className = 'debug-item-stats';
        stats.textContent = weaponStatLine(def, player);
        card.appendChild(stats);

        const desc = document.createElement('div');
        desc.className = 'debug-item-desc';
        desc.textContent = def.desc;
        card.appendChild(desc);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn-small debug-btn-equip${isEquipped ? ' btn-equipped' : ' btn-primary'}`;
        btn.textContent = isEquipped ? 'Equipped' : 'Equip';
        btn.disabled = isEquipped;

        const equipAction = () => {
          if (this._debugOnSelect) {
            this.playUiSound(UI_CLICK);
            this._debugOnSelect(wId);
          }
        };

        btn.addEventListener('click', (e) => {
          e.stopPropagation?.();
          equipAction();
        });
        card.addEventListener('click', () => {
          if (!isEquipped) equipAction();
        });

        card.appendChild(btn);
        list.appendChild(card);
      }

      section.appendChild(list);
      this.el.debugGrid.appendChild(section);
    }
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
      ['Class', getClass(player.classId).name],
      ['Weapon', player.weapon.name],
      ['Floor', String(run.floorIndex + 1)],
      ['Kills', fmtInt(s.kills)],
      ['Damage dealt', fmtInt(s.damageDealt)],
      ['Damage taken', fmtInt(s.damageTaken)],
      ['Gold earned', fmtInt(s.goldEarned)],
      ['Rooms cleared', fmtInt(s.roomsCleared)],
      ['Time', `${minutes}:${String(seconds).padStart(2, '0')}`],
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

      // Every menu action clicks. Controls that go *backwards* — leaving the
      // run, returning to the main menu — get the lower cue instead, so the
      // two directions are audibly different without a second sound system.
      const destination = target.getAttribute('data-target');
      const goingBack = action === 'abandon-run' || (action === 'goto' && destination === 'menu');
      this.playUiSound(goingBack ? UI_BACK : UI_CLICK);

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
        case 'toggle-settings': {
          // The data attribute names the DOM id, so the same action works for
          // any future settings panel without a second code path.
          const name = target.getAttribute('data-target');
          const panel = name ? document.getElementById(name) : null;
          if (panel) panel.hidden = !panel.hidden;
          if (panel && !panel.hidden) this.syncAudioControls();
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
        case 'open-debug': this.intents.openDebug?.(); break;
        case 'debug-close': this.intents.debugClose?.(); break;
        case 'debug-heal': this._debugActions?.onHeal?.(); break;
        case 'debug-gold': this._debugActions?.onAddGold?.(); break;
        case 'debug-ult': this._debugActions?.onMaxUlt?.(); break;
        default: break;
      }
    });
  }
}

/**
 * Set the numeric bounds on a range input.
 *
 * Written through `setAttribute` rather than the properties so the same code
 * path works against the minimal DOM the tests provide.
 * @param {HTMLElement} range
 */
function setRangeBounds(range) {
  range.setAttribute('min', '0');
  range.setAttribute('max', '100');
  range.setAttribute('step', '1');
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
