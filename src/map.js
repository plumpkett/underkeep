// Tile map: terrain types, ownership, generation.

export const T = {
  BEDROCK: 0, ROCK: 1, GOLD: 2,
  DIRT: 3, CLAIMED: 4,
  LAIR: 5, HATCHERY: 6, TREASURY: 7, TRAINING: 8,
  HEART: 9, PORTAL: 10, GATE: 11,
};

export const W = 50;
export const H = 36;
export const TILE = 20;

export const OWNER = { NONE: 0, PLAYER: 1, HERO: 2 };

export const ROOMS = {
  [T.LAIR]:     { name: 'Lair',          cost: 100, key: '2', desc: 'Creatures sleep here. One tile per creature.' },
  [T.HATCHERY]: { name: 'Hatchery',      cost: 100, key: '3', desc: 'Breeds food for your creatures.' },
  [T.TREASURY]: { name: 'Treasury',      cost: 50,  key: '4', desc: 'Stores 500 gold per tile.' },
  [T.TRAINING]: { name: 'Training Room', cost: 150, key: '5', desc: 'Creatures level up here (costs gold).' },
};

export const isWall = t => t <= T.GOLD;
export const isPassable = t => t >= T.DIRT;
export const isRoom = t => t >= T.LAIR && t <= T.TRAINING;

export class GameMap {
  constructor(seed = Date.now()) {
    this.w = W; this.h = H;
    this.rng = mulberry32(seed);
    this.tiles = new Array(W * H);
    for (let i = 0; i < W * H; i++) {
      this.tiles[i] = { type: T.ROCK, owner: OWNER.NONE, marked: false, dig: 0, claim: 0, reservedBy: 0, lairOf: 0, shade: this.rng() };
    }
    this.generate();
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  at(x, y) { return this.inBounds(x, y) ? this.tiles[y * W + x] : null; }
  set(x, y, type, owner = OWNER.NONE) {
    const t = this.at(x, y); if (!t) return;
    t.type = type; t.owner = owner; t.marked = false; t.dig = 0; t.claim = 0; t.reservedBy = 0; t.lairOf = 0;
  }
  isOwned(x, y) { const t = this.at(x, y); return !!t && t.owner === OWNER.PLAYER && isPassable(t.type); }

  neighbors4(x, y) {
    const out = [];
    if (x > 0) out.push([x - 1, y]);
    if (x < W - 1) out.push([x + 1, y]);
    if (y > 0) out.push([x, y - 1]);
    if (y < H - 1) out.push([x, y + 1]);
    return out;
  }
  adjacentOwned(x, y) {
    return this.neighbors4(x, y).some(([nx, ny]) => this.isOwned(nx, ny));
  }
  count(type, owner = OWNER.PLAYER) {
    let n = 0;
    for (const t of this.tiles) if (t.type === type && t.owner === owner) n++;
    return n;
  }
  tilesOf(type, owner = OWNER.PLAYER) {
    const out = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.type === type && t.owner === owner) out.push({ x: i % W, y: (i / W) | 0, t });
    }
    return out;
  }

  generate() {
    const r = this.rng;
    // Bedrock border
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) this.set(x, y, T.BEDROCK);
    }
    // Dungeon heart on the left-centre
    this.heart = { x: 11, y: 18 };
    const hx = this.heart.x, hy = this.heart.y;
    for (let y = hy - 3; y <= hy + 3; y++) for (let x = hx - 3; x <= hx + 3; x++) this.set(x, y, T.CLAIMED, OWNER.PLAYER);
    for (let y = hy - 1; y <= hy + 1; y++) for (let x = hx - 1; x <= hx + 1; x++) this.set(x, y, T.HEART, OWNER.PLAYER);

    // Gold veins via random walks; the first few are guaranteed near the heart
    for (let v = 0; v < 36; v++) {
      let x, y;
      if (v < 4) { const a = r() * Math.PI * 2; x = Math.round(hx + Math.cos(a) * 6); y = Math.round(hy + Math.sin(a) * 6); }
      else { x = 4 + ((r() * (W - 8)) | 0); y = 4 + ((r() * (H - 8)) | 0); }
      const len = 5 + ((r() * 10) | 0);
      for (let i = 0; i < len; i++) {
        const t = this.at(x, y);
        if (t && t.type === T.ROCK && Math.hypot(x - hx, y - hy) > 4) t.type = T.GOLD;
        const d = (r() * 4) | 0;
        x += d === 0 ? 1 : d === 1 ? -1 : 0; y += d === 2 ? 1 : d === 3 ? -1 : 0;
        x = Math.max(2, Math.min(W - 3, x)); y = Math.max(2, Math.min(H - 3, y));
      }
    }
    // Bedrock blobs (impassable even for tunnellers)
    for (let b = 0; b < 10; b++) {
      let x = 4 + ((r() * (W - 8)) | 0), y = 4 + ((r() * (H - 8)) | 0);
      if (Math.hypot(x - hx, y - hy) < 9) continue;
      const len = 4 + ((r() * 8) | 0);
      for (let i = 0; i < len; i++) {
        const t = this.at(x, y);
        if (t && isWall(t.type)) t.type = T.BEDROCK;
        x += ((r() * 3) | 0) - 1; y += ((r() * 3) | 0) - 1;
      }
    }
    // Portal: 3x3 neutral room, sealed in rock, somewhere mid-map
    let px, py;
    do { px = 18 + ((r() * 14) | 0); py = 5 + ((r() * (H - 10)) | 0); } while (Math.hypot(px - hx, py - hy) < 10);
    this.portal = { x: px, y: py };
    for (let y = py - 1; y <= py + 1; y++) for (let x = px - 1; x <= px + 1; x++) this.set(x, y, T.PORTAL, OWNER.NONE);
    for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
      const t = this.at(x, y); if (t.type === T.BEDROCK) t.type = T.ROCK;
    }
    // Hero gate on the far right with an entry corridor
    const gy = 6 + ((r() * (H - 12)) | 0);
    this.gate = { x: W - 5, y: gy };
    for (let y = gy - 1; y <= gy + 1; y++) for (let x = W - 6; x <= W - 4; x++) this.set(x, y, T.GATE, OWNER.HERO);
    for (let x = W - 14; x < W - 6; x++) { this.set(x, gy, T.DIRT); if (x % 3 === 0) this.set(x, gy + (r() < 0.5 ? 1 : -1), T.DIRT); }
    // Make sure the heart surroundings are plain rock (diggable)
    for (let y = hy - 5; y <= hy + 5; y++) for (let x = hx - 5; x <= hx + 5; x++) {
      const t = this.at(x, y); if (t && t.type === T.BEDROCK && x >= 2 && y >= 2 && x < W - 2 && y < H - 2) t.type = T.ROCK;
    }
  }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
