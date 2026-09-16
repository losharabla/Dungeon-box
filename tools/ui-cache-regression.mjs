import assert from 'node:assert/strict';
import { UIManager } from '../src/ui/UIManager.js';
import { Player } from '../src/entities/Player.js';
import { getWeapon } from '../src/data/weapons.js';
// Run the real method with small DOM leaves; no copy of its cache logic.
const node = () => ({style:{},classList:{toggle(){}},hidden:true});
/** A leaf that counts writes, so "cache hit" is measured rather than assumed. */
const counter = (prop) => {
  const leaf = {style:{},classList:{toggle(){}},hidden:true,_writes:0,_value:''};
  Object.defineProperty(leaf, prop, {
    get() { return this._value; },
    set(v) { this._writes++; this._value = v; },
  });
  return leaf;
};
const ui = Object.create(UIManager.prototype);
ui._cache = {};
ui.el = Object.fromEntries(['hpFill','hpText','goldText','shopGold','ultFill','dashFill','weaponName','bossBar','beam','beamName','beamFill'].map(k=>[k,node()]));
ui.el.weaponStats = counter('textContent');
ui.el.hudStats = counter('innerHTML');
let writes = 0;
ui.el.ultName = {set textContent(v){writes++;this.value=v;}};
const player = new Player({classId:'warrior',x:0,y:0,ultimateId:'whirlwind'});
const run = {plan:null}; const rooms={registry:{enemies:[]}};
for(let i=0;i<100;i++) ui.updateHud(player,run,rooms);
assert.equal(writes,1);
player.ultCharge=100;
ui.updateHud(player,run,rooms);
assert.equal(writes,2);
assert.match(ui.el.ultName.value,/READY/);
ui.updateHud(player,run,rooms);
assert.equal(writes,2);

// The stat readouts are rebuilt only when a number they print moves: a hundred
// idle frames must not touch them at all beyond the first write.
assert.equal(ui.el.hudStats._writes, 1, 'the character row must be written once while nothing changes');
assert.equal(ui.el.weaponStats._writes, 1, 'the weapon line must be written once while nothing changes');

// An upgrade moves the row it changes and leaves the weapon line alone.
player.modifiers.lifeSteal = 0.05;
ui.updateHud(player,run,rooms);
assert.equal(ui.el.hudStats._writes, 2, 'a changed modifier must rewrite the row');
assert.match(ui.el.hudStats._value, /LEECH<span class="v">5%<\/span>/);
assert.ok(ui.el.hudStats._value.includes('stat-chip boosted'), 'a raised stat must be marked');
assert.equal(ui.el.weaponStats._writes, 1, 'lifesteal is not part of the weapon line');
ui.updateHud(player,run,rooms);
assert.equal(ui.el.hudStats._writes, 2, 'an unchanged modifier must not rewrite the row');

// A weapon swap rewrites the weapon line exactly once.
player.equip(getWeapon('bloodthirster'));
ui.updateHud(player,run,rooms);
assert.equal(ui.el.weaponStats._writes, 2, 'a new weapon must rewrite its line');
assert.match(ui.el.weaponStats._value, /46 dmg/);
const weaponWrites = ui.el.weaponStats._writes;
ui.updateHud(player,run,rooms);
assert.equal(ui.el.weaponStats._writes, weaponWrites, 'a held weapon must not rewrite its line');

console.log('8/8 real HUD cache checks passed');
