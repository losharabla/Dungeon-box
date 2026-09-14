import assert from 'node:assert/strict';
import { ProjectileSystem } from '../src/systems/ProjectileSystem.js';
const player = { x: 0, y: 0, radius: 16, alive: true, isSwinging: true, swingAngle: 0,
  weapon: {kind:'melee',range:74,arc:1.45}, status:{canAct:()=>true} };
let hits, explosions, wall;
function system() {
  hits=0; explosions=0; wall=false;
  const s=new ProjectileSystem({registry:{player,enemies:[]},collisionWorld:{
    raycast:()=>wall ? {x:45,y:0,normal:{x:1,y:0}}:null,
    hasLineOfSight:()=>!wall
  },combat:{applyHit:()=>hits++,applyAreaHit:()=>explosions++},particles:{cone(){},burst(){}},bus:{emit(){}}});
  return s;
}
for (const [x,v] of [[30,-520],[200,-18000]]) {
  const s=system(); const p=s.spawn({x,y:0,vx:v,vy:0,radius:9,life:2,explosionRadius:60});
  s.update(1/60); assert.equal(hits,0);assert.equal(explosions,0);assert.equal(p.alive,false);
}
for (const spec of [{x:-30,vx:520},{x:30,vx:-520,parryable:false}]) {
  const s=system();s.spawn({...spec,y:0,vy:0,radius:9,life:2});s.update(1/60);assert.equal(hits,1);
}
{
  const s=system(); const p=s.spawn({x:40,y:100,vx:0,vy:-12000,life:2});
  s.update(1/60);assert.equal(p.alive,false,'side entry crosses sector');assert.equal(hits,0);
}
{
  const s=system();wall=true;const p=s.spawn({x:60,y:0,vx:0,vy:0,life:2});
  assert.equal(s.parrySwing(player),0);assert.equal(p.alive,true);
}
console.log('6/6 parry regression checks passed');
