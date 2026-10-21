// Canvas renderer: tiles, rooms, entities, effects, cursor feedback.

import { T, TILE, W, H, OWNER, ROOMS, isWall, isRoom } from './map.js';
import { FACTION } from './entities.js';

const COLORS = {
  [T.BEDROCK]: '#15131a',
  [T.ROCK]: '#4a4454',
  [T.GOLD]: '#5a5040',
  [T.DIRT]: '#6b5a3e',
  [T.CLAIMED]: '#3a2d4e',
  [T.LAIR]: '#4a2d1e',
  [T.HATCHERY]: '#5c5a22',
  [T.TREASURY]: '#6a5618',
  [T.TRAINING]: '#394060',
  [T.HEART]: '#5a1020',
  [T.PORTAL]: '#1e3f4a',
  [T.GATE]: '#5a1d1d',
};

export class Renderer {
  constructor(canvas, game) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.g = game;
  }

  draw(t) {
    const { ctx, g } = this; const map = g.map;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.c.width, this.c.height);

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const tile = map.tiles[y * W + x];
      const px = x * TILE, py = y * TILE;
      let col = COLORS[tile.type];
      ctx.fillStyle = col; ctx.fillRect(px, py, TILE, TILE);
      // Texture
      if (isWall(tile.type)) {
        ctx.fillStyle = `rgba(0,0,0,${0.08 + tile.shade * 0.18})`;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(px + 2 + ((tile.shade * 9) | 0), py + 3 + ((tile.shade * 7) | 0), 4, 2);
        if (tile.type === T.GOLD) {
          ctx.fillStyle = '#e3b341';
          ctx.fillRect(px + 4, py + 5, 3, 3); ctx.fillRect(px + 12, py + 11, 3, 3); ctx.fillRect(px + 7, py + 14, 2, 2); ctx.fillRect(px + 14, py + 4, 2, 2);
        }
      } else {
        if (tile.owner === OWNER.PLAYER) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
          if (tile.type === T.CLAIMED) { ctx.fillStyle = 'rgba(190,120,255,0.07)'; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8); }
        } else if (tile.type === T.DIRT) {
          ctx.fillStyle = `rgba(0,0,0,${tile.shade * 0.15})`; ctx.fillRect(px, py, TILE, TILE);
        }
        this.drawRoomDetail(tile, px, py, t);
      }
      if (tile.marked) {
        ctx.fillStyle = 'rgba(255,220,60,0.22)'; ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(255,220,60,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
        if (tile.dig > 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(px + 3, py + TILE - 5, (TILE - 6) * Math.min(1, tile.dig / (tile.type === T.GOLD ? 2.2 : 1.4)), 2); }
      }
      if (tile.claim > 0) { ctx.fillStyle = 'rgba(190,120,255,0.5)'; ctx.fillRect(px + 3, py + TILE - 5, (TILE - 6) * Math.min(1, tile.claim / (tile.type === T.PORTAL ? 2.5 : 0.8)), 2); }
    }

    // Heart glow
    const h = map.heart;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3) * (g.heartHp / 1000);
    const grad = ctx.createRadialGradient((h.x + 0.5) * TILE, (h.y + 0.5) * TILE, 4, (h.x + 0.5) * TILE, (h.y + 0.5) * TILE, 48 + pulse * 10);
    grad.addColorStop(0, `rgba(255,60,80,${0.55 + pulse * 0.3})`); grad.addColorStop(1, 'rgba(255,60,80,0)');
    ctx.fillStyle = grad; ctx.fillRect((h.x - 3) * TILE, (h.y - 3) * TILE, 7 * TILE, 7 * TILE);
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc((h.x + 0.5) * TILE, (h.y + 0.5) * TILE, 10 + pulse * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc((h.x + 0.3) * TILE, (h.y + 0.3) * TILE, 3, 0, Math.PI * 2); ctx.fill();

    // Portal swirl
    const p = map.portal; const owned = map.at(p.x, p.y).owner === OWNER.PLAYER;
    ctx.save(); ctx.translate((p.x + 0.5) * TILE, (p.y + 0.5) * TILE); ctx.rotate(t * (owned ? 2 : 0.5));
    ctx.strokeStyle = owned ? '#b388ff' : '#4dd0e1'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 8 + i * 6, i, i + 2.2); ctx.stroke(); }
    ctx.restore();

    // Gate
    const gt = map.gate;
    ctx.fillStyle = '#2a0e0e'; ctx.fillRect((gt.x - 1) * TILE + 4, (gt.y - 1) * TILE + 4, 3 * TILE - 8, 3 * TILE - 8);
    ctx.fillStyle = '#ffab91'; ctx.font = 'bold 20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚔', (gt.x + 0.5) * TILE, (gt.y + 0.5) * TILE);

    // Drag rectangle
    if (g.drag && g.hover) {
      const [ax, bx] = g.drag.x < g.hover.x ? [g.drag.x, g.hover.x] : [g.hover.x, g.drag.x];
      const [ay, by] = g.drag.y < g.hover.y ? [g.drag.y, g.hover.y] : [g.hover.y, g.drag.y];
      ctx.fillStyle = g.tool === 'dig' ? 'rgba(255,220,60,0.2)' : g.tool === 'sell' ? 'rgba(255,80,80,0.2)' : 'rgba(120,255,160,0.2)';
      ctx.fillRect(ax * TILE, ay * TILE, (bx - ax + 1) * TILE, (by - ay + 1) * TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.strokeRect(ax * TILE + 0.5, ay * TILE + 0.5, (bx - ax + 1) * TILE - 1, (by - ay + 1) * TILE - 1);
    } else if (g.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(g.hover.x * TILE + 0.5, g.hover.y * TILE + 0.5, TILE - 1, TILE - 1);
    }

    // Entities
    const ents = g.entities.slice().sort((a, b) => a.y - b.y);
    for (const e of ents) if (!e.held) this.drawEntity(e, t);

    // Effects
    ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of g.effects) {
      ctx.globalAlpha = Math.min(1, f.ttl); ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x * TILE + 1, f.y * TILE - 8 + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x * TILE, f.y * TILE - 8);
    }
    ctx.globalAlpha = 1;

    // Held creature follows the cursor
    if (g.held && g.hover) {
      const e = g.held;
      const ok = map.isOwned(g.hover.x, g.hover.y);
      ctx.globalAlpha = 0.85;
      this.drawEntity(e, t, (g.hover.x + 0.5), (g.hover.y + 0.5) - 0.6);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#69f0ae' : '#ff5252'; ctx.lineWidth = 2;
      ctx.strokeRect(g.hover.x * TILE + 1, g.hover.y * TILE + 1, TILE - 2, TILE - 2);
    }

    if (g.speed === 0 && !g.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, this.c.width, this.c.height);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center'; ctx.fillText('PAUSED', this.c.width / 2, this.c.height / 2);
    }
  }

  drawRoomDetail(tile, px, py, t) {
    const { ctx } = this;
    switch (tile.type) {
      case T.LAIR:
        ctx.strokeStyle = tile.lairOf ? '#b07a52' : '#6d4a36'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px + 10, py + 10, 6, 0, Math.PI * 2); ctx.stroke();
        break;
      case T.HATCHERY:
        ctx.fillStyle = '#e8dcae';
        ctx.beginPath(); ctx.ellipse(px + 7, py + 12, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(px + 13, py + 8, 2.5, 3.5, 0.4, 0, Math.PI * 2); ctx.fill();
        break;
      case T.TREASURY: {
        const fill = Math.min(1, this.g.gold / Math.max(1, this.g.goldCap));
        ctx.fillStyle = '#3f3410'; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        ctx.fillStyle = '#e3b341'; ctx.fillRect(px + 3, py + 3 + (TILE - 6) * (1 - fill), TILE - 6, (TILE - 6) * fill);
        break;
      }
      case T.TRAINING:
        ctx.strokeStyle = '#9fa8da'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + 10, py + 4); ctx.lineTo(px + 10, py + 16); ctx.moveTo(px + 5, py + 8); ctx.lineTo(px + 15, py + 8); ctx.stroke();
        break;
      case T.HEART:
        ctx.fillStyle = 'rgba(255,80,100,0.15)'; ctx.fillRect(px, py, TILE, TILE);
        break;
      case T.PORTAL:
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        break;
    }
  }

  drawEntity(e, t, x = e.x, y = e.y) {
    const { ctx } = this;
    const px = x * TILE, py = y * TILE;
    const r = e.def.boss ? 10 : e.kind === 'brute' ? 8.5 : e.kind === 'imp' ? 5.5 : 7;
    const bob = (e.state === 'sleep') ? 0 : Math.sin(t * 10 + e.id) * (e.path.length ? 1.2 : 0.3);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(px, py + r * 0.7, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = e.flash > 0 ? '#fff' : e.def.color;
    ctx.strokeStyle = e.faction === FACTION.HERO ? '#fff3' : '#0008'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py - bob, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // glyph
    ctx.fillStyle = e.faction === FACTION.HERO ? '#222' : '#fff';
    ctx.font = `bold ${e.def.boss ? 13 : 10}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.def.glyph, px, py - bob + 0.5);
    // carried gold
    if (e.carry > 0) { ctx.fillStyle = '#e3b341'; ctx.fillRect(px + 3, py - bob - 9, 5, 4); }
    // state icon
    if (e.state === 'sleep') { ctx.fillStyle = '#ddd'; ctx.font = '9px system-ui'; ctx.fillText('z', px + r, py - r - 3 + Math.sin(t * 2) * 1.5); }
    if (e.state === 'eat') { ctx.font = '9px system-ui'; ctx.fillText('🍗', px + r, py - r - 3); }
    if (e.anger > 50 && e.faction === FACTION.PLAYER && !e.def.worker) { ctx.fillStyle = '#ff5252'; ctx.font = 'bold 9px system-ui'; ctx.fillText('!', px - r, py - r - 3); }
    // hp bar
    if (e.hp < e.maxHp) {
      ctx.fillStyle = '#000'; ctx.fillRect(px - 8, py - r - 7, 16, 3);
      ctx.fillStyle = e.faction === FACTION.HERO ? '#ff7043' : '#66bb6a'; ctx.fillRect(px - 8, py - r - 7, 16 * (e.hp / e.maxHp), 3);
    }
    // level pips
    if (e.level > 1 && !e.def.worker) {
      ctx.fillStyle = '#ffd54f';
      for (let i = 0; i < Math.min(e.level - 1, 5); i++) ctx.fillRect(px - 6 + i * 3, py + r + 2, 2, 2);
    }
  }
}
