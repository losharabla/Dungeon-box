import assert from 'node:assert/strict';
import { InputService } from '../src/core/InputService.js';
import { CONFIG } from '../src/core/Config.js';

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type, event) { this.listeners.get(type)?.(event); }
}

function make(width, height) {
  const canvas = new Target();
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width, height });
  const oldWindow = globalThis.window;
  globalThis.window = new Target();
  const input = new InputService(canvas);
  input.attach();
  return { input, canvas, cleanup: () => { input.destroy(); globalThis.window = oldWindow; } };
}

const cases = [
  ['wide', 1920, 931, 960, 465.5, 640, 360],
  ['tall', 1280, 1000, 640, 500, 640, 360],
  ['16:9', 1920, 1080, 960, 540, 640, 360],
];
for (const [name, width, height, x, y, expectedX, expectedY] of cases) {
  const { input, canvas, cleanup } = make(width, height);
  canvas.dispatch('mousemove', { clientX: 10 + x, clientY: 20 + y });
  assert.ok(Math.abs(input.cursor.x - expectedX) < 1e-9, `${name} x`);
  assert.ok(Math.abs(input.cursor.y - expectedY) < 1e-9, `${name} y`);
  cleanup();
}
const { input, canvas, cleanup } = make(1920, 931);
canvas.dispatch('mousemove', { clientX: 10, clientY: 20 });
assert.ok(input.cursor.x < 0, 'outside left bar remains outside view');
cleanup();
console.log('4/4 input letterbox checks passed');
