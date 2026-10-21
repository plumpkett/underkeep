// Creature and hero definitions plus the shared Entity class (movement along paths).

import { isWall, OWNER } from './map.js';

export const FACTION = { PLAYER: 1, HERO: 2 };

export const KINDS = {
  // Keeper's creatures
  imp:      { name: 'Imp',      faction: FACTION.PLAYER, hp: 30,  dmg: 2,  range: 1, speed: 3.6, rate: 1.0, color: '#d98a3a', glyph: 'i', worker: true },
  goblin:   { name: 'Goblin',   faction: FACTION.PLAYER, hp: 90,  dmg: 9,  range: 1, speed: 2.6, rate: 1.1, color: '#4caf50', glyph: 'G' },
  warlock:  { name: 'Warlock',  faction: FACTION.PLAYER, hp: 65,  dmg: 14, range: 4, speed: 2.2, rate: 0.8, color: '#9c5bd6', glyph: 'W' },
  brute:    { name: 'Brute',    faction: FACTION.PLAYER, hp: 240, dmg: 18, range: 1, speed: 1.7, rate: 0.7, color: '#b84d4d', glyph: 'B' },
  // Heroes
  knight:    { name: 'Knight',    faction: FACTION.HERO, hp: 130, dmg: 10, range: 1, speed: 2.0, rate: 1.0, color: '#cfd8e3', glyph: 'K', loot: 60 },
  archer:    { name: 'Archer',    faction: FACTION.HERO, hp: 70,  dmg: 9,  range: 4, speed: 2.4, rate: 1.0, color: '#8fbf6a', glyph: 'A', loot: 40 },
  tunneller: { name: 'Tunneller', faction: FACTION.HERO, hp: 90,  dmg: 6,  range: 1, speed: 2.0, rate: 1.0, color: '#c9a86a', glyph: 'T', loot: 30, digger: true },
  lord:      { name: 'Lord of the Land', faction: FACTION.HERO, hp: 700, dmg: 26, range: 1, speed: 1.8, rate: 0.9, color: '#ffd54f', glyph: 'L', loot: 600, boss: true },
};

let nextId = 1;

export class Entity {
  constructor(kind, x, y) {
    const k = KINDS[kind];
    this.id = nextId++;
    this.kind = kind; this.def = k;
    this.faction = k.faction;
    this.x = x + 0.5; this.y = y + 0.5;
    this.maxHp = k.hp; this.hp = k.hp; this.dmg = k.dmg;
    this.range = k.range; this.speed = k.speed; this.rate = k.rate;
    this.level = 1; this.xp = 0;
    this.hunger = 100; this.sleep = 100; this.anger = 0;
    this.state = 'idle'; this.path = []; this.target = null; this.job = null;
    this.cooldown = 0; this.repath = 0; this.wait = 0;
    this.carry = 0; this.lair = null; this.held = false; this.dead = false;
    this.slap = 0; this.flash = 0;
  }
  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }
  get alive() { return !this.dead && this.hp > 0; }
  distTo(o) { return Math.hypot(o.x - this.x, o.y - this.y); }
  distToTile(x, y) { return Math.hypot(x + 0.5 - this.x, y + 0.5 - this.y); }

  xpToNext() { return Math.round(100 * Math.pow(this.level, 1.4)); }
  gainXp(n) {
    this.xp += n;
    while (this.xp >= this.xpToNext() && this.level < 10) {
      this.xp -= this.xpToNext(); this.level++;
      this.maxHp = Math.round(this.maxHp * 1.18); this.hp = this.maxHp;
      this.dmg = Math.round(this.dmg * 1.15 * 10) / 10;
    }
  }

  /** Advance along this.path. Returns 'arrived' | 'moving' | 'blocked' | 'digging'. */
  step(map, dt) {
    if (!this.path.length) return 'arrived';
    const n = this.path[0];
    const tile = map.at(n.x, n.y);
    if (!tile) { this.path = []; return 'arrived'; }
    if (isWall(tile.type)) {
      if (this.def.digger) {
        tile.dig += dt * 0.6;
        const need = tile.type === 2 ? 2.5 : 1.5;
        if (tile.dig >= need) { tile.type = 3; tile.owner = OWNER.NONE; tile.marked = false; tile.dig = 0; tile.reservedBy = 0; }
        return 'digging';
      }
      return 'blocked';
    }
    const cx = n.x + 0.5, cy = n.y + 0.5;
    const dx = cx - this.x, dy = cy - this.y;
    const d = Math.hypot(dx, dy);
    const spd = this.speed * (this.slap > 0 ? 1.6 : 1) * dt;
    if (d <= spd) { this.x = cx; this.y = cy; this.path.shift(); return this.path.length ? 'moving' : 'arrived'; }
    this.x += dx / d * spd; this.y += dy / d * spd;
    return 'moving';
  }
}
