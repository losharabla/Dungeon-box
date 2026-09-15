/**
 * @fileoverview Scene composition: draw the whole world in the right order.
 *
 * SRP: sequencing. It knows *what order* things are painted in and nothing
 * about how each thing looks — every entity delegates to a renderer module.
 * Keeping the ordering here means depth-sorting bugs have exactly one place
 * to live.
 */

import { drawEnemies, drawPlayer } from './entityRenderer.js';
import { RoomRenderer } from './roomRenderer.js';
import { RoomBaker, blit } from './roomBake.js';
import { drawHazards, drawUltimateVisuals, drawExitMarkers, drawRoomInteractables, drawAtmosphere } from './effectsRenderer.js';
import { drawProjectile } from './projectileRenderer.js';
import { drawDebugOverlay } from './projectileRenderer.js';
import { drawBeam } from './beamRenderer.js';
import { drawReticle } from './playerRenderer.js';
import { CONFIG } from '../core/Config.js';

export class SceneRenderer {
  /**
   * @param {import('./RenderSystem.js').RenderSystem} render
   */
  constructor(render) {
    this.render = render;
    this.roomRenderer = new RoomRenderer();
    /** Static room layers, baked to offscreen canvases in a browser. */
    this.baker = new RoomBaker();
    /** Rolling animation clock, advanced by the render step. */
    this.time = 0;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    this.time += dt;
  }

  /**
   * Paint one frame.
   *
   * Draw order, back to front:
   *   floor -> props -> hazards/telegraphs -> interactables -> walls ->
   *   doors -> projectiles -> particles -> enemies -> player -> text -> HUD
   *
   * @param {object} scene
   * @param {import('../entities/Room.js').Room|null} scene.room
   * @param {any} scene.runtime
   * @param {import('../entities/EntityRegistry.js').EntityRegistry} scene.registry
   * @param {import('../systems/ProjectileSystem.js').ProjectileSystem} scene.projectiles
   * @param {import('../systems/BeamSystem.js').BeamSystem} [scene.beam]
   * @param {import('../rendering/particleSystem.js').ParticleSystem} scene.particles
   * @param {import('../rendering/textEffects.js').FloatingTextSystem} scene.floatingText
   * @param {import('./decals.js').DecalLayer} [scene.decals]
   * @param {Array<any>} scene.hazards
   * @param {Array<any>} scene.ultimateVisuals
   * @param {import('../core/GameLoop.js').GameLoop} [scene.loop]
   * @param {import('../audio/AudioSystem.js').AudioSystem} [scene.audio]
   * @param {import('../rendering/textEffects.js').ScreenFlashSystem} scene.screenFlash
   * @param {{x: number, y: number}} scene.aimWorld
   * @param {boolean} scene.showReticle
   */
  draw(scene) {
    const ctx = this.render.ctx;
    const time = this.time;

    this.render.beginFrame();

    if (!scene.room) {
      this.render.releaseCamera();
      return;
    }

    this.render.applyCamera();

    // The room's static layers are baked into offscreen canvases by the
    // browser and reduced to a few full-quad blits; environments without
    // compositing (the headless recording tools) keep the per-frame path.
    // See roomBake.js. Hazards and interactables are interleaved between the
    // layers exactly as the live order does it.
    const bake = this.baker.ensure(scene.room, this.render, this.roomRenderer);
    const rr = this.roomRenderer;

    if (bake) {
      const view = this.render.getViewRect();
      // Bedrock base first: the camera follows the player without room
      // clamping, so the viewport extends past the walls and the overscan
      // must read as solid rock rather than void. The baked ground layer
      // carries the world-anchored edge glow on top of it.
      rr.drawBedrockBase(ctx, scene.room, this.render);
      blit(ctx, bake.ground, view);

      drawHazards(ctx, scene.hazards, time, this.render);
      drawUltimateVisuals(ctx, scene.ultimateVisuals, time, this.render);
      drawRoomInteractables(ctx, scene.room, scene.runtime, time);

      blit(ctx, bake.walls, view);
      rr.drawDoors(ctx, scene.room, time);
      rr.drawRoomSigil(ctx, scene.room);
      blit(ctx, bake.darkening, view);

      // Marks and torch light live above the baked structure but below the
      // actors: a pool reads as being on the floor, while a torch's warm haze
      // is meant to wash over the whole room including the darkening pass.
      if (scene.decals) scene.decals.draw(ctx, this.render);
      drawAtmosphere(ctx, scene.room, time, this.render);
    } else {
      // --- Ground layer ----------------------------------------------------
      // Bedrock first: the camera follows the player without room clamping, so
      // the viewport always extends past the walls and that overscan must read
      // as solid rock rather than void.
      rr.drawBedrock(ctx, scene.room, this.render, time);
      rr.drawFloor(ctx, scene.room, this.render, time);
      rr.drawProps(ctx, scene.room);

      // --- World-space effect layers (below walls so they read as floor) ----
      drawHazards(ctx, scene.hazards, time, this.render);
      drawUltimateVisuals(ctx, scene.ultimateVisuals, time, this.render);
      drawRoomInteractables(ctx, scene.room, scene.runtime, time);

      // --- Structure -------------------------------------------------------
      rr.drawWalls(ctx, scene.room, this.render);
      rr.drawDoors(ctx, scene.room, time);
      rr.drawVignette(ctx, scene.room, this.render);

      if (scene.decals) scene.decals.draw(ctx, this.render);
      drawAtmosphere(ctx, scene.room, time, this.render);
    }

    const canExit = scene.runtime?.cleared ?? scene.room.type === 'start';
    drawExitMarkers(ctx, scene.room, canExit, time);

    // --- Projectiles (under characters so bodies stay readable) ----------
    for (const p of scene.projectiles.projectiles) {
      if (!this.render.isVisible(p.x, p.y, p.radius + 40)) continue;
      drawProjectile(ctx, p, time);
    }

    // --- The held beam ---------------------------------------------------
    // Beside the projectiles rather than above the actors: it is the same
    // layer of the picture, and a beam that covered the bodies it is burning
    // would hide exactly what the player is aiming at.
    if (scene.beam) drawBeam(ctx, scene.beam.last, time);

    // --- Particles -------------------------------------------------------
    scene.particles.draw(ctx, this.render);

    // --- Actors ----------------------------------------------------------
    drawEnemies(ctx, scene.registry, time, this.render);

    const player = scene.registry.player;
    if (player) {
      drawPlayer(ctx, player, time, Math.min(1, Math.hypot(player.vx, player.vy) / 140));
    }

    // --- Floating text is world-anchored, so it stays inside the camera ---
    scene.floatingText.draw(ctx);

    // The reticle marks a world-space point (the cursor projected into the
    // world), so it must be drawn inside the camera transform. Drawing it
    // after releaseCamera() would place it at raw screen coordinates and it
    // would drift away from the cursor as soon as the camera moved.
    if (scene.showReticle && player && player.alive) {
      drawReticle(ctx, scene.aimWorld.x, scene.aimWorld.y, time);
    }

    if (this.render.showDebug) {
      drawDebugOverlay(ctx, scene.registry, this.render);
    }

    this.render.releaseCamera();

    // --- Screen-space layers ---------------------------------------------
    scene.screenFlash.draw(ctx, CONFIG.view.width, CONFIG.view.height);

    if (this.render.showDebug) {
      this._drawDebugText(ctx, scene);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} scene
   */
  _drawDebugText(ctx, scene) {
    ctx.save();
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = 'rgba(180,255,200,0.9)';
    const particles = scene.particles?.count ?? 0;
    const dropped = scene.particles?.dropped ?? 0;
    const projectiles = scene.projectiles?.projectiles?.length ?? 0;
    const hazards = scene.hazards?.length ?? 0;
    const texts = scene.floatingText?.texts?.length ?? 0;
    const decals = scene.decals?.count ?? 0;
    const droppedSimulationTime = scene.loop?.droppedSimulationTime ?? 0;
    // Audio is reported as live voices against the dropped count: if voices
    // sits at the ceiling and dropped climbs, the mixer is the thing under
    // pressure and that is visible here rather than guessed at. `M` is the
    // music state, so a track that failed to load is visible too.
    const audio = scene.audio;
    const music = audio?.music;
    const musicText = music
      ? `M ${music.playing ? 'on' : 'off'}${music.stats?.errors ? `!${music.stats.errors}` : ''}  `
      : '';
    const audioText = audio
      ? `A ${audio.stats?.voices ?? 0} (-${audio.stats?.dropped ?? 0})  ${musicText}`
      : '';
    ctx.fillText(
      `FPS ${this.render.fps.toFixed(0)}  P ${particles} (-${dropped})  ` +
      `X ${projectiles}  H ${hazards}  T ${texts}  D ${decals}  ` +
      `${audioText}SIM-DROP ${droppedSimulationTime.toFixed(2)}s`,
      10, CONFIG.view.height - 12,
    );
    ctx.restore();
  }
}
