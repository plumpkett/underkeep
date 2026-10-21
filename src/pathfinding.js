// Dijkstra search on the tile grid with a pluggable cost function and goal test.

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(d, i) {
    const a = this.a; a.push([d, i]);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p][0] <= a[k][0]) break;
      [a[p], a[k]] = [a[k], a[p]]; k = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; k = m;
      }
    }
    return top;
  }
}

/**
 * findPath(map, sx, sy, isGoal(x, y, tile), cost(tile, x, y))
 * cost returns the price of entering a tile, or Infinity if impassable.
 * Returns an array of {x, y} steps excluding the start, or null if no goal is reachable.
 * If the start tile itself is a goal, returns [].
 */
export function findPath(map, sx, sy, isGoal, cost, maxNodes = 6000) {
  const W = map.w, H = map.h, tiles = map.tiles;
  const start = sy * W + sx;
  if (isGoal(sx, sy, tiles[start])) return [];
  const dist = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const heap = new MinHeap();
  dist[start] = 0; heap.push(0, start);
  let visited = 0;
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    if (++visited > maxNodes) break;
    const x = i % W, y = (i / W) | 0;
    if (i !== start && isGoal(x, y, tiles[i])) {
      const path = [];
      for (let c = i; c !== start; c = prev[c]) path.push({ x: c % W, y: (c / W) | 0 });
      return path.reverse();
    }
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const c = cost(tiles[j], nx, ny);
      if (!(c < Infinity)) continue;
      const nd = d + c;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
    }
  }
  return null;
}
