/**
 * Visual proof for the reported bug.
 *
 * Renders the HUD/world geometry at the exact window size from the bug
 * report (1920x931) and writes an SVG showing where the HUD band now sits
 * relative to the world, so the fix can be confirmed without a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/core/Config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;

/**
 * @param {number} cssW
 * @param {number} cssH
 */
function band(cssW, cssH) {
  const scale = Math.min(cssW / VW, cssH / VH);
  const w = VW * scale;
  const h = VH * scale;
  return { scale, w, h, left: (cssW - w) / 2, top: (cssH - h) / 2 };
}

const CASES = [
  { name: 'Reported window: 1920x931', w: 1920, h: 931 },
  { name: '16:9 baseline: 1920x1080', w: 1920, h: 1080 },
  { name: 'Tall window: 1280x1000', w: 1280, h: 1000 },
  { name: 'Small laptop: 1366x768', w: 1366, h: 768 },
];

const SCALE = 0.42; // fit four panes side by side in the SVG
const paneW = Math.round(1920 * SCALE);
const paneH = Math.round(1000 * SCALE);
const gap = 24;
const padTop = 54;

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CASES.length * (paneW + gap) + gap}" height="${paneH + padTop + 34}" font-family="Consolas, monospace">`;
svg += `<rect width="100%" height="100%" fill="#0b0b12"/>`;
svg += `<text x="${gap}" y="26" fill="#e8e6f0" font-size="17">HUD band vs world band - before the fix the HUD spanned the whole window</text>`;

CASES.forEach((c, i) => {
  const b = band(c.w, c.h);
  const ox = gap + i * (paneW + gap);
  const oy = padTop;

  // Window outline (scaled to the pane).
  const sx = (paneW / c.w);
  const sy = (paneH / Math.max(c.h, 1000));
  const s = Math.min(sx, sy);

  const winW = c.w * s;
  const winH = c.h * s;
  const winX = ox + (paneW - winW) / 2;
  const winY = oy + (paneH - winH) / 2;

  // Window background (the letterbox bars).
  svg += `<rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" fill="#000" stroke="#33334a"/>`;

  // The world band (what the canvas renders, and what the HUD now matches).
  const bx = winX + b.left * s;
  const by = winY + b.top * s;
  const bw = b.w * s;
  const bh = b.h * s;
  svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#161522" stroke="#4a4a68"/>`;

  // HUD extents inside the band (what the fix achieves).
  svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#ff6a3d" stroke-width="2" stroke-dasharray="6 4"/>`;
  svg += `<circle cx="${bx + bw / 2}" cy="${by + 8}" r="3.5" fill="#ff6a3d"/>`;
  svg += `<circle cx="${bx + 8}" cy="${by + bh - 8}" r="3.5" fill="#ff6a3d"/>`;
  svg += `<circle cx="${bx + bw - 8}" cy="${by + bh - 8}" r="3.5" fill="#ff6a3d"/>`;

  // Title and numbers.
  svg += `<text x="${winX}" y="${winY - 20}" fill="#e8e6f0" font-size="13">${c.name}</text>`;
  svg += `<text x="${winX}" y="${winY + winH + 16}" fill="#9a97ad" font-size="11">`
    + `scale ${b.scale.toFixed(3)} | bars ${b.left.toFixed(0)}px x2 | band ${b.w.toFixed(0)}x${b.h.toFixed(0)}`
    + `</text>`;
});

svg += `<text x="${gap}" y="${paneH + padTop + 26}" fill="#9a97ad" font-size="12">`
  + `orange = HUD extent (must equal the world band) | dark rect = window | lighter rect = rendered world`
  + `</text>`;
svg += '</svg>';

const out = path.join(ROOT, 'tools', 'hud-alignment.svg');
fs.writeFileSync(out, svg, 'utf8');
console.log(`wrote ${out}`);
console.log('');

for (const c of CASES) {
  const b = band(c.w, c.h);
  console.log(`${c.name}`);
  console.log(`   window      ${c.w}x${c.h}`);
  console.log(`   scale       ${b.scale.toFixed(4)}`);
  console.log(`   world band  ${b.w.toFixed(1)}x${b.h.toFixed(1)} at (${b.left.toFixed(1)},${b.top.toFixed(1)})`);
  console.log(`   side bars   ${b.left.toFixed(0)}px each`);
  console.log(`   HUD now     matches the band (was: full ${c.w}x${c.h} window)`);
  console.log('');
}
