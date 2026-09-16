/**
 * HUD/world alignment test.
 *
 * The canvas letterboxes a fixed logical view into the window. The HUD is
 * DOM and sits above the canvas, so if it spans the whole window instead of
 * the letterboxed band, its centre and corners drift away from the world
 * they label — which is the bug this guards against.
 *
 * Run with:  node tools/align-test.mjs
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';

/* ---------- DOM shim sufficient for RenderSystem ---------------------- */

/**
 * @param {number} width CSS width of the canvas box
 * @param {number} height CSS height of the canvas box
 */
function makeCanvas(width, height) {
  /** @type {Record<string, string>} */
  const parentProps = {};
  const parent = {
    style: {
      setProperty: (/** @type {string} */ k, /** @type {string} */ v) => { parentProps[k] = v; },
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    parentElement: parent,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    getContext: () => makeContext(),
  };
  return { canvas, parentProps };
}

function makeContext() {
  const grad = { addColorStop() {} };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '', textAlign: '', textBaseline: '',
    lineCap: '', lineDashOffset: 0,
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    setLineDash() {}, save() {}, restore() {},
    beginPath() {}, rect() {}, clip() {}, fillRect() {}, fill() {}, stroke() {},
    setTransform() {}, translate() {}, scale() {}, rotate() {},
  };
}

globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.performance ??= { now: () => Date.now() };

const { RenderSystem, Camera } = await import('../src/rendering/RenderSystem.js');

const checks = [];
/** @param {string} name @param {() => any} fn */
function check(name, fn) {
  checks.push((async () => {
    try {
      await fn();
      return { name, ok: true };
    } catch (err) {
      return { name, ok: false, error: err };
    }
  })());
}

/**
 * @param {number} cssW
 * @param {number} cssH
 */
function build(cssW, cssH) {
  const { canvas, parentProps } = makeCanvas(cssW, cssH);
  const camera = new Camera();
  const render = new RenderSystem(/** @type {any} */ (canvas), camera);
  render.resize();
  return { render, parentProps };
}

/**
 * Read the real stylesheet, so the CSS contract checks below inspect the
 * file the browser actually loads.
 * @returns {Promise<string>}
 */
async function readCss() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return fs.readFileSync(path.join(root, 'style.css'), 'utf8');
}

/* ---------- Checks ---------------------------------------------------- */

check('a 16:9 window fills exactly, with no bars', () => {
  const { render, parentProps } = build(1920, 1080);
  assert.equal(Math.round(render.viewWidth), 1920);
  assert.equal(Math.round(render.viewHeight), 1080);
  assert.equal(Math.round(render.viewLeft), 0);
  assert.equal(Math.round(render.viewTop), 0);
  assert.equal(parentProps['--view-left'], '0px');
  assert.equal(parentProps['--view-width'], '1920px');
});

check('the reported 1920x931 window produces symmetric side bars', () => {
  // This is the exact geometry from the bug report.
  const { render, parentProps } = build(1920, 931);
  const expectedScale = Math.min(1920 / CONFIG.view.width, 931 / CONFIG.view.height);

  assert.equal(render.scale, expectedScale);
  // Height is the constraining axis, so there are no vertical bars.
  assert.ok(Math.abs(render.viewTop) < 0.001, 'no vertical bars expected');
  assert.ok(Math.abs(render.viewHeight - 931) < 0.001, 'the band spans the full height');

  // Side bars must be symmetric and non-zero.
  assert.ok(render.viewLeft > 100, `expected wide side bars, got ${render.viewLeft}`);
  assert.ok(
    Math.abs(1920 - (render.viewLeft * 2 + render.viewWidth)) < 0.001,
    'bars plus band must equal the window width',
  );

  // And they must be published to CSS for the HUD to consume.
  assert.equal(parentProps['--view-left'], `${render.viewLeft}px`);
  assert.equal(parentProps['--view-top'], `${render.viewTop}px`);
  assert.equal(parentProps['--view-width'], `${render.viewWidth}px`);
  assert.equal(parentProps['--view-height'], `${render.viewHeight}px`);
});

check('a tall window produces symmetric top/bottom bars', () => {
  // Height is the constraining axis; the band is narrower than the window.
  const { render } = build(1280, 1000);
  assert.ok(Math.abs(render.viewLeft) < 0.001, 'no side bars when the window is tall');
  assert.ok(render.viewTop > 0, 'expected vertical bars');
  assert.ok(
    Math.abs(1000 - (render.viewTop * 2 + render.viewHeight)) < 0.001,
    'bars plus band must equal the window height',
  );
});

check('an over-wide window produces side bars', () => {
  // Width is the constraining axis here, so the bars are horizontal.
  const { render } = build(2560, 720);
  assert.ok(Math.abs(render.viewTop) < 0.001, 'no vertical bars when the window is wide');
  assert.ok(render.viewLeft > 0, 'expected side bars');
  assert.ok(
    Math.abs(2560 - (render.viewLeft * 2 + render.viewWidth)) < 0.001,
    'bars plus band must equal the window width',
  );
});

check('the HUD band is identical to the drawn world band', () => {
  // The CSS band and the canvas transform must never disagree, so compare
  // what resize() published with what beginFrame() actually applies.
  const { render, parentProps } = build(1920, 931);

  /** @type {number[]} */
  const applied = [];
  // Replace the context with a recording stub for the duration of the call.
  const original = render.ctx;
  render.ctx = /** @type {any} */ ({
    ...makeContext(),
    setTransform: (...args) => { applied.push(...args); },
  });

  render.beginFrame();
  render.ctx = original;

  // beginFrame resets the transform first, then applies the view transform,
  // so the offset we care about is the last call.
  assert.ok(applied.length >= 6, 'beginFrame must set a transform');
  const last = applied.slice(-6);

  // setTransform(scale, 0, 0, scale, offsetX, offsetY)
  assert.equal(last[1], 0);
  assert.equal(last[2], 0);
  const s = last[0];
  const offsetX = last[4];
  const offsetY = last[5];
  const dpr = render._dpr;
  assert.ok(Math.abs(s - render.scale * dpr) < 0.001, 'scale must match');
  assert.ok(
    Math.abs(offsetX - render.viewLeft * dpr) < 0.001,
    'the canvas offset must equal the published CSS band offset',
  );
  assert.ok(Math.abs(offsetY - render.viewTop * dpr) < 0.001, 'vertical offset must match');
  assert.equal(parentProps['--view-left'], `${render.viewLeft}px`);
});

check('the world band stays centred at every aspect ratio', () => {
  const sizes = [
    [1280, 720], [1920, 1080], [1920, 931], [1440, 900],
    [2560, 1080], [1024, 768], [800, 600], [3840, 2160],
  ];
  for (const [w, h] of sizes) {
    const { render } = build(w, h);
    // Centred: the band plus twice its offset must reconstruct the window.
    assert.ok(
      Math.abs(w - (render.viewLeft * 2 + render.viewWidth)) < 0.01,
      `horizontal centring failed at ${w}x${h}`,
    );
    assert.ok(
      Math.abs(h - (render.viewTop * 2 + render.viewHeight)) < 0.01,
      `vertical centring failed at ${w}x${h}`,
    );
    // The band must never exceed the window.
    assert.ok(render.viewWidth <= w + 0.01, `band wider than window at ${w}x${h}`);
    assert.ok(render.viewHeight <= h + 0.01, `band taller than window at ${w}x${h}`);
    // Aspect ratio must be preserved exactly (that is the point of the bars).
    const bandAspect = render.viewWidth / render.viewHeight;
    const viewAspect = CONFIG.view.width / CONFIG.view.height;
    assert.ok(Math.abs(bandAspect - viewAspect) < 1e-9, `aspect ratio drifted at ${w}x${h}`);
  }
});

check('the HUD stylesheet consumes the published band', async () => {
  // Guard the CSS contract: if `.hud` ever goes back to `inset: 0`, the HUD
  // silently misaligns again at non-16:9 windows.
  const css = await readCss();

  for (const cls of ['.hud {', '.overlay {']) {
    const start = css.indexOf(cls);
    assert.ok(start >= 0, `${cls} must exist in style.css`);
    const block = css.slice(start, css.indexOf('}', start));
    assert.ok(
      block.includes('--view-width'),
      `${cls} must size itself from the published letterbox band`,
    );
    assert.ok(
      !/inset:\s*0/.test(block),
      `${cls} must not span the full window (that is the misalignment bug)`,
    );
  }
});

check('the room strip hugs the top instead of the middle of the screen', async () => {
  // Regression guard: `.hud` is a flex column whose second child is the room
  // strip. With `justify-content: space-between` the free space was spread
  // across the rows, which parked that strip in the exact vertical centre of
  // the screen. The top rows must stack, and exactly one row — the bottom
  // group — must consume the leftover space.
  const css = await readCss();
  const blockOf = (/** @type {string} */ sel) => {
    const source = css.replace(/\/\\*[\\s\\S]*?\\*\//g, '');
    const start = source.indexOf(sel);
    assert.ok(start >= 0, `${sel} must exist in style.css`);
    const open = source.indexOf('{', start);
    const close = source.indexOf('}', open);
    assert.ok(open >= 0 && close >= 0, `${sel} must have a complete CSS block`);
    return source.slice(open + 1, close);
  };

  const hud = blockOf('.hud {');
  assert.ok(
    !/justify-content:\s*space-between/.test(hud),
    'the HUD column must not distribute rows across the screen height',
  );
  assert.ok(
    /justify-content:\s*flex-start/.test(hud),
    'the HUD rows must stack from the top',
  );

  const rooms = blockOf('.hud-rooms {');
  assert.ok(
    !/position:\s*absolute/.test(rooms),
    'the room strip belongs in the top flow, not floating over the world',
  );

  const bottom = blockOf('.hud-bottom {');
  assert.ok(
    /margin-top:\s*auto/.test(bottom),
    'the bottom row must consume the leftover space to stay pinned down',
  );
});

check('the loadout rows stay in the HUD flow', async () => {
  // The weapon stat line and the character chips are new HUD rows. They belong
  // to the bottom column's flow like every other row: floating them over the
  // world would put a second, invisible layout on top of the game.
  const css = await readCss();
  const blockOf = (/** @type {string} */ sel) => {
    const start = css.indexOf(sel);
    assert.ok(start >= 0, `${sel} must exist in style.css`);
    return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };
  for (const sel of ['.hud-build {', '.hud-weapon-stats {', '.hud-stats {']) {
    assert.ok(
      !/position:\s*absolute/.test(blockOf(sel)),
      `${sel} must stay in the HUD flow, not float over the world`,
    );
  }
  assert.ok(
    /flex-direction:\s*column/.test(blockOf('.hud-build {')),
    'the loadout column must stack the weapon over the character stats',
  );
});

/* ---------- Report ---------------------------------------------------- */

let failures = 0;
const results = await Promise.all(checks);
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
console.log(`${results.length - failures}/${results.length} alignment checks passed`);
process.exit(failures > 0 ? 1 : 0);
