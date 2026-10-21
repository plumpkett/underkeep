// Core simulation: economy, imp jobs, creature needs, hero raids, player actions.

import { GameMap, T, OWNER, ROOMS, isWall, isPassable, isRoom, W, H } from './map.js';
import { Entity, KINDS, FACTION } from './entities.js';
import { findPath } from './pathfinding.js';

const GOLD_PER_VEIN = 250;
const IMP_CARRY_MAX = 500;
const HEART_MAX = 1000;
const WAVES_TO_WIN = 10;

const walkCost = t => (isPassable(t.type) ? 1 : Infinity);
const ownedWalkCost = t => (isPassable(t.type) && t.owner !== OWNER.HERO ? 1 : Infinity);
// Heroes may path "through" rock: tunnellers dig it, the rest queue up behind them.
const heroCost = t => (isPassable(t.type) ? 1 : t.type === T.BEDROCK ? Infinity : t.type === T.GOLD ? 14 : 9);

export class Game {
  constructor() { this.reset(); }

  reset() {
    this.map = new GameMap();
    this.entities = [];
    this.gold = 600;
    this.heartHp = HEART_MAX;
    this.food = 0;
    this.time = 0;
    this.wave = 0;
    this.nextWave = 150;
    this.waveAlive = 0;
    this.attractTimer = 15;
    this.messages = [];
    this.effects = [];
    this.over = null; // 'win' | 'lose'
    this.tool = 'dig';
    this.held = null;
    this.speed = 1;
    this.hover = null;
    this.drag = null;
    const h = this.map.heart;
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) this.spawn('imp', h.x + dx, h.y + dy);
    this.say('Your Dungeon Heart beats in the dark. Dig for gold, Keeper.');
    this.say('Find and claim the Portal to attract creatures.');
  }

  // ---------- helpers ----------
  say(text) { this.messages.unshift({ text, t: this.time }); if (this.messages.length > 8) this.messages.pop(); }
  fx(x, y, text, color = '#fff') { this.effects.push({ x, y, text, color, ttl: 1.2 }); }
  spawn(kind, x, y) { const e = new Entity(kind, x, y); this.entities.push(e); return e; }
  get imps() { return this.entities.filter(e => e.kind === 'imp' && e.alive); }
  get creatures() { return this.entities.filter(e => e.faction === FACTION.PLAYER && !e.def.worker && e.alive); }
  get heroes() { return this.entities.filter(e => e.faction === FACTION.HERO && e.alive); }
  get impCost() { return 150 + 50 * this.imps.length; }
  get goldCap() { return 1000 + 500 * this.map.count(T.TREASURY); }
  get lairCap() { return this.map.count(T.LAIR); }
  get portalOwned() { return this.map.at(this.map.portal.x, this.map.portal.y).owner === OWNER.PLAYER; }

  addGold(n, x, y) {
    const before = this.gold;
    this.gold = Math.max(this.gold, Math.min(this.goldCap, this.gold + n));
    if (x !== undefined) this.fx(x, y, `+${Math.round(this.gold - before)}`, '#e3b341');
    if (this.gold - before < n - 1 && this.time - (this.lastFullWarn || -99) > 20) {
      this.lastFullWarn = this.time; this.say('Your treasury is full! Build more Treasury tiles.');
    }
  }

  nearestEnemy(e, radius) {
    let best = null, bd = radius;
    for (const o of this.entities) {
      if (!o.alive || o.held || o.faction === e.faction) continue;
      const d = e.distTo(o);
      // Heroes only bother with imps that get underfoot; real creatures draw them from afar.
      if (o.def.worker && d > 1.6) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  pathTo(e, isGoal, cost = walkCost) {
    const p = findPath(this.map, e.tx, e.ty, isGoal, cost);
    if (p) e.path = p;
    else { e.path = []; e.repath = Math.max(e.repath, 1); } // don't hammer the pathfinder on unreachable goals
    return p;
  }

  // ---------- player actions ----------
  markDig(x, y, mark) {
    const t = this.map.at(x, y);
    if (!t || !isWall(t.type) || t.type === T.BEDROCK) return;
    t.marked = mark;
    if (!mark && t.reservedBy) t.reservedBy = 0;
  }
  buildRoom(x, y, type) {
    const t = this.map.at(x, y);
    const info = ROOMS[type];
    if (!t || !info || t.type !== T.CLAIMED || t.owner !== OWNER.PLAYER) return false;
    if (this.gold < info.cost) return false;
    this.gold -= info.cost;
    t.type = type;
    return true;
  }
  sellRoom(x, y) {
    const t = this.map.at(x, y);
    if (!t || !isRoom(t.type) || t.owner !== OWNER.PLAYER) return;
    const refund = Math.floor(ROOMS[t.type].cost / 2);
    if (t.lairOf) { const c = this.entities.find(e => e.id === t.lairOf); if (c) c.lair = null; t.lairOf = 0; }
    t.type = T.CLAIMED;
    this.gold = Math.min(this.goldCap, this.gold + refund);
    this.fx(x, y, `+${refund}`, '#e3b341');
  }
  applyRect(x0, y0, x1, y1, mode) {
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
    let built = 0, failed = false;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      if (mode === 'dig') this.markDig(x, y, this.drag.mark);
      else if (mode === 'sell') this.sellRoom(x, y);
      else {
        const type = +mode;
        const t = this.map.at(x, y);
        if (t && t.type === T.CLAIMED && t.owner === OWNER.PLAYER) {
          if (this.buildRoom(x, y, type)) built++; else failed = true;
        }
      }
    }
    if (failed && !built) this.say('Not enough gold.');
    if (built && +mode === T.LAIR && !this.portalOwned) this.say('A Lair. Now creatures need a way in: claim the Portal.');
  }
  summonImp() {
    if (this.over || this.gold < this.impCost) { this.say('Not enough gold for an imp.'); return; }
    this.gold -= this.impCost;
    const h = this.map.heart;
    const e = this.spawn('imp', h.x + (Math.random() < 0.5 ? -2 : 2), h.y + (Math.random() < 0.5 ? -2 : 2));
    this.fx(e.x, e.y, 'Imp!', '#d98a3a');
  }
  pickUp(e) {
    if (!e || e.faction !== FACTION.PLAYER || !e.alive) return false;
    if (e.job?.tile) e.job.tile.reservedBy = 0;
    e.held = true; e.path = []; e.job = null; e.state = 'held';
    this.held = e;
    return true;
  }
  drop(x, y) {
    const e = this.held; if (!e) return false;
    const t = this.map.at(x, y);
    if (!t || !isPassable(t.type) || t.owner !== OWNER.PLAYER) return false;
    e.x = x + 0.5; e.y = y + 0.5; e.held = false; e.state = 'idle'; e.path = []; e.repath = 0;
    this.held = null;
    return true;
  }
  slap(e) {
    if (!e || e.faction !== FACTION.PLAYER || !e.alive) return;
    e.slap = 6; e.hp = Math.max(1, e.hp - 3); e.anger = Math.min(100, e.anger + 6);
    this.fx(e.x, e.y, 'SLAP', '#ff6b6b');
  }
  entityAt(x, y) {
    let best = null, bd = 0.7;
    for (const e of this.entities) {
      if (!e.alive || e.held) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- simulation ----------
  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.updateEconomy(dt);
    this.updateWaves(dt);
    for (const e of this.entities) {
      if (!e.alive || e.held) continue;
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.slap = Math.max(0, e.slap - dt);
      e.flash = Math.max(0, e.flash - dt);
      e.repath -= dt;
      if (e.def.worker) this.updateImp(e, dt);
      else if (e.faction === FACTION.PLAYER) this.updateCreature(e, dt);
      else this.updateHero(e, dt);
    }
    // Deaths
    for (const e of this.entities) {
      if (e.dead || e.hp > 0) continue;
      e.dead = true;
      if (e.job?.tile) e.job.tile.reservedBy = 0;
      if (e.lair) { const lt = this.map.at(e.lair.x, e.lair.y); if (lt && lt.lairOf === e.id) lt.lairOf = 0; }
      if (e.faction === FACTION.HERO) { this.addGold(e.def.loot, e.x, e.y); this.waveAlive--; }
      else this.say(`${e.def.name} has fallen.`);
      if (this.held === e) this.held = null;
    }
    this.entities = this.entities.filter(e => !e.dead);
    for (const f of this.effects) { f.ttl -= dt; f.y -= dt * 0.8; }
    this.effects = this.effects.filter(f => f.ttl > 0);

    if (this.heartHp <= 0) { this.over = 'lose'; this.say('The Dungeon Heart is destroyed.'); }
    else if (this.wave >= WAVES_TO_WIN && this.waveAlive <= 0 && this.nextWave === Infinity) { this.over = 'win'; }
  }

  updateEconomy(dt) {
    const hatch = this.map.count(T.HATCHERY);
    this.food = Math.min(hatch * 4, this.food + hatch * 0.35 * dt);
    if (!this.heroes.some(h => this.map.heart && Math.hypot(h.x - this.map.heart.x, h.y - this.map.heart.y) < 6)) {
      this.heartHp = Math.min(HEART_MAX, this.heartHp + 1.5 * dt);
    }
    // Attraction through the portal
    this.attractTimer -= dt;
    if (this.attractTimer <= 0) {
      this.attractTimer = 12;
      if (this.portalOwned) this.tryAttract();
    }
  }

  tryAttract() {
    const lairs = this.lairCap, hatch = this.map.count(T.HATCHERY), train = this.map.count(T.TRAINING);
    if (this.creatures.length >= lairs) { if (lairs === 0) this.say('Creatures peer through the Portal, but you have no Lair.'); return; }
    if (hatch === 0) { this.say('A creature sniffs the Portal... no Hatchery, no deal.'); return; }
    const pool = ['goblin', 'goblin'];
    if (train >= 4) pool.push('warlock', 'warlock');
    if (hatch >= 9) pool.push('brute');
    const kind = pool[(Math.random() * pool.length) | 0];
    const p = this.map.portal;
    const e = this.spawn(kind, p.x, p.y);
    e.hunger = 70; e.sleep = 70;
    this.say(`A ${e.def.name} has joined your dungeon.`);
    this.fx(e.x, e.y, e.def.name, e.def.color);
  }

  updateWaves(dt) {
    if (this.nextWave === Infinity) return;
    this.nextWave -= dt;
    if (this.nextWave > 0) return;
    this.wave++;
    const n = this.wave;
    const roster = [];
    for (let i = 0; i < 1 + Math.floor(n / 3); i++) roster.push('knight');
    for (let i = 0; i < Math.floor((n + 1) / 3); i++) roster.push('archer');
    roster.push('tunneller');
    if (n >= 6) roster.push('tunneller');
    if (n === WAVES_TO_WIN) roster.push('lord');
    const g = this.map.gate;
    roster.forEach((k, i) => {
      const e = this.spawn(k, g.x - 1 + (i % 3), g.y - 1 + ((i / 3) | 0) % 3);
      e.level = Math.min(10, 1 + Math.floor(n / 4));
      for (let l = 1; l < e.level; l++) { e.maxHp = Math.round(e.maxHp * 1.18); e.dmg = Math.round(e.dmg * 1.15 * 10) / 10; }
      e.hp = e.maxHp;
    });
    this.waveAlive = roster.length;
    this.nextWave = n >= WAVES_TO_WIN ? Infinity : Math.max(55, 110 - n * 5);
    this.say(n === WAVES_TO_WIN ? 'The Lord of the Land rides against you!' : `Raid ${n}: ${roster.length} heroes march from the gate.`);
  }

  // ---------- imps ----------
  updateImp(e, dt) {
    const map = this.map;
    const enemy = this.nearestEnemy(e, 4);
    if (enemy) {
      if (e.state !== 'flee' || e.repath <= 0) {
        e.state = 'flee'; e.repath = 1;
        if (e.job?.tile) e.job.tile.reservedBy = 0;
        e.job = null;
        const far = this.pathTo(e, (x, y, t) => t.owner === OWNER.PLAYER && enemy.distToTile(x, y) > 6, ownedWalkCost);
        if (!far) {
          // Nowhere safe to run: just back away from the enemy.
          let best = null, bd = -1;
          for (const [nx, ny] of map.neighbors4(e.tx, e.ty)) {
            if (!isPassable(map.at(nx, ny).type)) continue;
            const d = enemy.distToTile(nx, ny);
            if (d > bd) { bd = d; best = { x: nx, y: ny }; }
          }
          e.path = best ? [best] : [];
        }
      }
      e.step(map, dt);
      return;
    }
    if (e.state === 'flee') { e.state = 'idle'; e.job = null; }

    // Validate current job
    if (e.job) {
      const j = e.job;
      if (j.type === 'dig' && (!j.tile.marked || !isWall(j.tile.type))) { j.tile.reservedBy = 0; e.job = null; }
      else if (j.type === 'claim' && (j.tile.owner === OWNER.PLAYER || !isPassable(j.tile.type))) { j.tile.reservedBy = 0; e.job = null; }
      else if (j.type === 'deliver' && j.tile.owner !== OWNER.PLAYER) e.job = null;
    }
    if (!e.job) this.chooseImpJob(e);
    if (!e.job) {
      // Idle: wander a little near the heart
      if (!e.path.length && e.repath <= 0) {
        e.repath = 2 + Math.random() * 2;
        const h = map.heart;
        const gx = h.x + ((Math.random() * 7) | 0) - 3, gy = h.y + ((Math.random() * 7) | 0) - 3;
        if (map.isOwned(gx, gy)) this.pathTo(e, (x, y) => x === gx && y === gy, ownedWalkCost);
      }
      e.step(map, dt);
      return;
    }

    const j = e.job;
    const status = e.step(map, dt);
    if (status !== 'arrived') { if (status === 'blocked') e.job = null; return; }
    if (j.type === 'dig') {
      if (e.distToTile(j.tile.x, j.tile.y) > 1.3) { e.job = null; j.tile.reservedBy = 0; return; }
      j.tile.dig += dt * (e.slap > 0 ? 1.5 : 1);
      const need = j.tile.type === T.GOLD ? 2.2 : 1.4;
      if (j.tile.dig >= need) {
        if (j.tile.type === T.GOLD) { e.carry += GOLD_PER_VEIN; this.fx(j.tile.x, j.tile.y, 'gold!', '#e3b341'); }
        j.tile.type = T.DIRT; j.tile.owner = OWNER.NONE; j.tile.marked = false; j.tile.dig = 0; j.tile.reservedBy = 0;
        e.job = null; e.gainXp(5);
      }
    } else if (j.type === 'claim') {
      if (e.tx !== j.tile.x || e.ty !== j.tile.y) { e.job = null; j.tile.reservedBy = 0; return; }
      j.tile.claim += dt * (e.slap > 0 ? 1.5 : 1);
      if (j.tile.claim >= (j.tile.type === T.PORTAL ? 2.5 : 0.8)) {
        j.tile.claim = 0; j.tile.reservedBy = 0;
        if (j.tile.type === T.PORTAL) {
          const p = map.portal;
          for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) map.at(x, y).owner = OWNER.PLAYER;
          this.say('The Portal is yours! Creatures will come if you offer Lair and Hatchery.');
          this.attractTimer = Math.min(this.attractTimer, 4);
        } else { j.tile.type = T.CLAIMED; j.tile.owner = OWNER.PLAYER; }
        e.job = null;
      }
    } else if (j.type === 'deliver') {
      this.addGold(e.carry, e.x, e.y); e.carry = 0; e.job = null;
    }
  }

  chooseImpJob(e) {
    const map = this.map;
    const myId = e.id;
    const markedAdj = (x, y) => map.neighbors4(x, y).find(([nx, ny]) => { const t = map.at(nx, ny); return t.marked && isWall(t.type) && (t.reservedBy === 0 || t.reservedBy === myId); });
    const claimable = (x, y, t) => isPassable(t.type) && t.owner === OWNER.NONE && (t.type === T.DIRT || t.type === T.PORTAL) && (t.reservedBy === 0 || t.reservedBy === myId) && map.adjacentOwned(x, y);
    const treasure = (x, y, t) => t.owner === OWNER.PLAYER && (t.type === T.TREASURY || t.type === T.HEART);

    if (e.carry >= IMP_CARRY_MAX * 0.8) return this.assignDeliver(e, treasure);

    const digPath = findPath(map, e.tx, e.ty, (x, y, t) => isPassable(t.type) && t.owner !== OWNER.HERO && !!markedAdj(x, y), walkCost);
    const claimPath = findPath(map, e.tx, e.ty, claimable, walkCost);
    const dLen = digPath ? digPath.length : Infinity, cLen = claimPath ? claimPath.length : Infinity;
    if (dLen === Infinity && cLen === Infinity) {
      if (e.carry > 0) return this.assignDeliver(e, treasure);
      return;
    }
    if (cLen <= dLen) {
      const end = claimPath.length ? claimPath[claimPath.length - 1] : { x: e.tx, y: e.ty };
      const tile = map.at(end.x, end.y); tile.reservedBy = myId; tile.x = end.x; tile.y = end.y;
      e.job = { type: 'claim', tile }; e.path = claimPath; e.state = 'claim';
    } else {
      const end = digPath.length ? digPath[digPath.length - 1] : { x: e.tx, y: e.ty };
      const [mx, my] = markedAdj(end.x, end.y);
      const tile = map.at(mx, my); tile.reservedBy = myId; tile.x = mx; tile.y = my;
      e.job = { type: 'dig', tile }; e.path = digPath; e.state = 'dig';
    }
  }
  assignDeliver(e, treasure) {
    const p = findPath(this.map, e.tx, e.ty, treasure, walkCost);
    if (!p) return;
    const end = p.length ? p[p.length - 1] : { x: e.tx, y: e.ty };
    e.job = { type: 'deliver', tile: this.map.at(end.x, end.y) }; e.path = p; e.state = 'deliver';
  }

  // ---------- creatures ----------
  updateCreature(e, dt) {
    const map = this.map;
    e.hunger = Math.max(0, e.hunger - 1.3 * dt);
    e.sleep = Math.max(0, e.sleep - 1.0 * dt);

    if (e.state === 'leave') {
      const st = e.step(map, dt);
      if (st === 'arrived' && Math.hypot(e.x - map.portal.x - 0.5, e.y - map.portal.y - 0.5) < 1.5) { e.hp = 0; e.dead = true; this.say(`${e.def.name} left your dungeon in disgust.`); }
      else if (st === 'arrived' || st === 'blocked') this.pathTo(e, (x, y) => x === map.portal.x && y === map.portal.y, ownedWalkCost);
      return;
    }

    // Creatures rally to intruders from across the dungeon (unless fast asleep).
    const enemy = this.nearestEnemy(e, e.state === 'sleep' ? 5 : 12);
    if (enemy) { this.fight(e, enemy, dt, ownedWalkCost); return; }

    // Needs
    let unmet = false;
    const needSleep = e.sleep < 25 || (e.state === 'sleep' && e.sleep < 100);
    const needFood = e.hunger < 25 || (e.state === 'eat' && e.hunger < 100);
    if (needSleep) {
      if (!e.lair || map.at(e.lair.x, e.lair.y).type !== T.LAIR) {
        e.lair = null;
        const free = map.tilesOf(T.LAIR).find(l => l.t.lairOf === 0);
        if (free) { e.lair = { x: free.x, y: free.y }; free.t.lairOf = e.id; }
      }
      if (e.lair) {
        if (e.tx === e.lair.x && e.ty === e.lair.y) { e.state = 'sleep'; e.path = []; e.sleep = Math.min(100, e.sleep + 8 * dt); e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.03 * dt); }
        else { if (e.state !== 'gosleep' || e.repath <= 0) { e.state = 'gosleep'; e.repath = 2; this.pathTo(e, (x, y) => x === e.lair.x && y === e.lair.y, ownedWalkCost); } e.step(map, dt); }
      } else unmet = true;
    } else if (needFood) {
      const onHatch = map.at(e.tx, e.ty).type === T.HATCHERY;
      if (onHatch && this.food >= 0.5) { e.state = 'eat'; e.path = []; this.food -= 0.5 * dt; e.hunger = Math.min(100, e.hunger + 12 * dt); }
      else if (map.count(T.HATCHERY) > 0 && this.food >= 0.5) {
        if (e.state !== 'goeat' || e.repath <= 0) { e.state = 'goeat'; e.repath = 2; this.pathTo(e, (x, y, t) => t.type === T.HATCHERY && t.owner === OWNER.PLAYER, ownedWalkCost); }
        e.step(map, dt);
      } else unmet = true;
    } else if (map.count(T.TRAINING) > 0 && this.gold >= 1 && e.level < 10) {
      const onTrain = map.at(e.tx, e.ty).type === T.TRAINING;
      if (onTrain) { e.state = 'train'; e.path = []; e.gainXp(4 * dt); this.gold -= 0.8 * dt; if (Math.random() < dt * 0.5) this.fx(e.x, e.y, '⚔', '#bbb'); }
      else { if (e.state !== 'gotrain' || e.repath <= 0) { e.state = 'gotrain'; e.repath = 2; this.pathTo(e, (x, y, t) => t.type === T.TRAINING && t.owner === OWNER.PLAYER, ownedWalkCost); } e.step(map, dt); }
    } else {
      e.state = 'idle';
      if (!e.path.length && e.repath <= 0) {
        e.repath = 2 + Math.random() * 3;
        const gx = e.tx + ((Math.random() * 9) | 0) - 4, gy = e.ty + ((Math.random() * 9) | 0) - 4;
        if (map.isOwned(gx, gy)) this.pathTo(e, (x, y) => x === gx && y === gy, ownedWalkCost);
      }
      e.step(map, dt);
    }

    if (unmet) { e.anger = Math.min(100, e.anger + 4 * dt); if (e.anger > 50 && Math.random() < dt * 0.1) this.say(`${e.def.name} is unhappy: it needs ${needSleep ? 'a Lair' : 'food'}.`); }
    else e.anger = Math.max(0, e.anger - 1.5 * dt);
    if (e.anger >= 100 && this.portalOwned) { e.state = 'leave'; e.path = []; if (e.lair) { map.at(e.lair.x, e.lair.y).lairOf = 0; e.lair = null; } }
  }

  fight(e, enemy, dt, cost) {
    const d = e.distTo(enemy);
    if (d <= e.range + 0.35) {
      e.state = 'fight'; e.path = [];
      if (e.cooldown <= 0) {
        e.cooldown = 1 / e.rate;
        enemy.hp -= e.dmg; enemy.flash = 0.15;
        this.fx(enemy.x, enemy.y, `-${Math.round(e.dmg)}`, e.faction === FACTION.HERO ? '#ff8a80' : '#fff');
        if (enemy.hp <= 0) e.gainXp(25);
      }
      return;
    }
    if (e.state !== 'fight' || e.repath <= 0) {
      e.state = 'fight'; e.repath = 0.7;
      const ex = enemy.tx, ey = enemy.ty, r = Math.max(0, e.range - 0.5);
      this.pathTo(e, (x, y) => Math.hypot(x - ex, y - ey) <= Math.max(1, r), cost);
    }
    e.step(this.map, dt);
  }

  // ---------- heroes ----------
  updateHero(e, dt) {
    const map = this.map, h = map.heart;
    const enemy = this.nearestEnemy(e, 6);
    if (enemy) { this.fight(e, enemy, dt, heroCost); return; }
    const nearHeart = Math.abs(e.tx - h.x) <= 2 && Math.abs(e.ty - h.y) <= 2;
    if (nearHeart) {
      e.state = 'siege'; e.path = [];
      if (e.cooldown <= 0) { e.cooldown = 1 / e.rate; this.heartHp -= e.dmg; this.fx(h.x + 0.5, h.y + 0.5, `-${Math.round(e.dmg)}`, '#ff5252'); }
      return;
    }
    if (e.state !== 'march' || e.repath <= 0) {
      e.state = 'march'; e.repath = 2.5;
      this.pathTo(e, (x, y, t) => t.type === T.HEART, heroCost);
    }
    const st = e.step(map, dt);
    if (st === 'blocked') e.wait += dt; // waiting for a tunneller
  }
}
