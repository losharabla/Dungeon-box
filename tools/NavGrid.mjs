/**
 * Navigation helper for the simulation harness.
 *
 * SRP: give a synthetic player a reliable route to a world point around
 * static geometry. The bot brains in the other tools use simple
 * attract/repel steering, which is enough for open arenas but can stall on
 * walls; that would make a test measure the bot instead of the game.
 *
 * This is a development tool, not part of the shipped game.
 */

/**
 * A uniform grid over a room, marking cells a circle of `radius` may occupy.
 */
export class NavGrid {
  /**
   * @param {{x: number, y: number, w: number, h: number}} bounds
   * @param {import('../src/entities/Room.js').CollisionWorld} collisionWorld
   * @param {number} radius body radius tested against geometry
   * @param {number} [cell] grid resolution in pixels
   */
  constructor(bounds, collisionWorld, radius, cell = 24) {
    this.bounds = bounds;
    this.collisionWorld = collisionWorld;
    this.radius = radius;
    this.cell = cell;
    this.cols = Math.ceil(bounds.w / cell);
    this.rows = Math.ceil(bounds.h / cell);
    /** @type {Uint8Array} 1 = blocked */
    this.blocked = new Uint8Array(this.cols * this.rows);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = bounds.x + c * cell + cell / 2;
        const y = bounds.y + r * cell + cell / 2;
        const solid = collisionWorld.overlapsAny({ x, y, radius });
        this.blocked[r * this.cols + c] = solid ? 1 : 0;
      }
    }
  }

  /**
   * @param {number} x @param {number} y
   * @returns {number} cell index, or -1 when outside the grid
   */
  indexAt(x, y) {
    const c = Math.floor((x - this.bounds.x) / this.cell);
    const r = Math.floor((y - this.bounds.y) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /**
   * Nearest free cell to a point, searching outward.
   * @param {number} x @param {number} y
   * @returns {number} cell index, or -1 when none found
   */
  nearestFree(x, y) {
    const start = this.indexAt(x, y);
    if (start >= 0 && !this.blocked[start]) return start;

    const sc = Math.floor((x - this.bounds.x) / this.cell);
    const sr = Math.floor((y - this.bounds.y) / this.cell);
    for (let ring = 1; ring <= Math.max(this.cols, this.rows); ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
          const c = sc + dc;
          const r = sr + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (!this.blocked[i]) return i;
        }
      }
    }
    return -1;
  }

  /**
   * @param {number} index
   * @returns {{x: number, y: number}} world centre of the cell
   */
  centerOf(index) {
    const c = index % this.cols;
    const r = Math.floor(index / this.cols);
    return {
      x: this.bounds.x + c * this.cell + this.cell / 2,
      y: this.bounds.y + r * this.cell + this.cell / 2,
    };
  }

  /**
   * Breadth-first path between two world points.
   *
   * BFS on a uniform grid is more than sufficient here: rooms are at most
   * ~55x38 cells, so a full search is trivial and always finds the shortest
   * route when one exists. A* would be premature.
   *
   * @param {number} fromX @param {number} fromY
   * @param {number} toX @param {number} toY
   * @returns {Array<{x: number, y: number}>} waypoints, empty when unreachable
   */
  findPath(fromX, fromY, toX, toY) {
    const start = this.nearestFree(fromX, fromY);
    const goal = this.nearestFree(toX, toY);
    if (start < 0 || goal < 0) return [];
    if (start === goal) return [{ x: toX, y: toY }];

    const total = this.cols * this.rows;
    const cameFrom = new Int32Array(total).fill(-1);
    const seen = new Uint8Array(total);
    seen[start] = 1;

    const queue = [start];
    let head = 0;
    let found = false;

    while (head < queue.length) {
      const cur = queue[head++];
      if (cur === goal) { found = true; break; }

      const c = cur % this.cols;
      const r = Math.floor(cur / this.cols);

      // 8-connected so paths can move diagonally through open space.
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const ni = nr * this.cols + nc;
          if (seen[ni] || this.blocked[ni]) continue;
          // Do not cut corners diagonally between two solid cells.
          if (dc !== 0 && dr !== 0) {
            const sideA = r * this.cols + nc;
            const sideB = nr * this.cols + c;
            if (this.blocked[sideA] || this.blocked[sideB]) continue;
          }
          seen[ni] = 1;
          cameFrom[ni] = cur;
          queue.push(ni);
        }
      }
    }

    if (!found) return [];

    /** @type {Array<{x: number, y: number}>} */
    const cells = [];
    let node = goal;
    while (node !== -1 && node !== start) {
      cells.push(this.centerOf(node));
      node = cameFrom[node];
    }
    cells.reverse();

    // Replace the final waypoint with the exact requested target so the
    // caller can land precisely on a door.
    if (cells.length > 0) cells[cells.length - 1] = { x: toX, y: toY };
    else cells.push({ x: toX, y: toY });

    return cells;
  }
}
