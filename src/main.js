// Entry point: wires input, UI panel and the frame loop to the Game.

import { Game } from './game.js';
import { Renderer } from './render.js';
import { TILE, W, H, ROOMS, T, isWall } from './map.js';

const canvas = document.getElementById('game');
const game = new Game();
const renderer = new Renderer(canvas, game);
window.game = game; // handy for poking at from the console

// ---- layout: scale the canvas to fit the stage ----
function fit() {
  const stage = document.getElementById('stage');
  const s = Math.min(1, (stage.clientWidth - 24) / canvas.width, (stage.clientHeight - 24) / canvas.height);
  canvas.style.width = `${canvas.width * s}px`; canvas.style.height = `${canvas.height * s}px`;
}
window.addEventListener('resize', fit); fit();

// ---- input ----
function tileFromEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const fx = (ev.clientX - r.left) / r.width * W, fy = (ev.clientY - r.top) / r.height * H;
  return { x: Math.max(0, Math.min(W - 1, Math.floor(fx))), y: Math.max(0, Math.min(H - 1, Math.floor(fy))), fx, fy };
}
canvas.addEventListener('contextmenu', ev => ev.preventDefault());
canvas.addEventListener('mousemove', ev => { game.hover = tileFromEvent(ev); });
canvas.addEventListener('mouseleave', () => { game.hover = null; });
canvas.addEventListener('mousedown', ev => {
  if (game.over) return;
  const p = tileFromEvent(ev);
  if (ev.button === 2) {
    if (game.held) { game.drop(game.held.tx, game.held.ty); game.held = null; return; }
    const e = game.entityAt(p.fx, p.fy);
    if (e) game.slap(e); else setTool('dig');
    return;
  }
  if (ev.button !== 0) return;
  if (game.held) { if (!game.drop(p.x, p.y)) game.say('Drop it on your own floor.'); return; }
  const e = game.entityAt(p.fx, p.fy);
  if (e && e.faction === 1) { game.pickUp(e); return; }
  const tile = game.map.at(p.x, p.y);
  game.drag = { x: p.x, y: p.y, mark: game.tool === 'dig' ? !(tile && tile.marked) : undefined };
});
window.addEventListener('mouseup', ev => {
  if (!game.drag) return;
  const end = game.hover || game.drag;
  game.applyRect(game.drag.x, game.drag.y, end.x, end.y, game.tool);
  game.drag = null;
});
window.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') return;
  const k = ev.key;
  if (k === '1') setTool('dig');
  else if (k === '2') setTool(String(T.LAIR));
  else if (k === '3') setTool(String(T.HATCHERY));
  else if (k === '4') setTool(String(T.TREASURY));
  else if (k === '5') setTool(String(T.TRAINING));
  else if (k === '6') setTool('sell');
  else if (k === ' ') { ev.preventDefault(); setSpeed(game.speed === 0 ? (lastSpeed || 1) : 0); }
  else if (k === 'Escape') { if (game.held) { game.drop(game.held.tx, game.held.ty); game.held = null; } setTool('dig'); }
  else if (k === 'i') game.summonImp();
});

// ---- panel ----
const $ = id => document.getElementById(id);
let lastSpeed = 1;
function setTool(tool) {
  game.tool = tool;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
}
function setSpeed(s) {
  if (s > 0) lastSpeed = s;
  game.speed = s;
  document.querySelectorAll('.speed button').forEach(b => b.classList.toggle('active', +b.dataset.speed === s));
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.speed button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('summon-imp').addEventListener('click', () => game.summonImp());
$('restart').addEventListener('click', () => { game.reset(); setTool('dig'); setSpeed(1); $('overlay').classList.add('hidden'); });

let lastLog = null;
function updatePanel() {
  $('gold').textContent = `${Math.floor(game.gold)} / ${game.goldCap}`;
  $('creatures').textContent = `${game.creatures.length} / ${game.lairCap}  ·  ${game.imps.length} imps`;
  $('wave').textContent = game.wave;
  $('next-wave').textContent = game.nextWave === Infinity ? 'final' : `${Math.ceil(game.nextWave)}s`;
  const hp = Math.max(0, game.heartHp);
  $('heart-bar').style.width = `${hp / 10}%`;
  $('heart-text').textContent = `Heart ${Math.ceil(hp)} / 1000`;
  $('imp-cost').textContent = `(${game.impCost}g)`;
  $('summon-imp').disabled = game.gold < game.impCost;
  const first = game.messages[0];
  if (first !== lastLog) {
    lastLog = first;
    $('log').innerHTML = game.messages.map(m => `<li>${m.text}</li>`).join('');
  }
  if (game.over) {
    const ov = $('overlay');
    if (ov.classList.contains('hidden')) {
      ov.classList.remove('hidden');
      $('overlay-title').textContent = game.over === 'win' ? 'DOMINION' : 'HEART SHATTERED';
      $('overlay-text').textContent = game.over === 'win'
        ? `The Lord of the Land lies dead at your feet. The realm above is yours to corrupt. Survived ${game.wave} raids in ${Math.floor(game.time)}s.`
        : `The heroes have breached your Dungeon Heart after ${game.wave} raids. The dark remembers; try again.`;
    }
  }
  // cursor hint
  canvas.style.cursor = game.held ? 'grabbing' : 'crosshair';
}

// ---- loop ----
let last = performance.now(), acc = 0;
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  acc += real * game.speed;
  const step = 1 / 60;
  let n = 0;
  while (acc >= step && n++ < 12) { game.update(step); acc -= step; }
  if (n >= 12) acc = 0;
  renderer.draw(now / 1000);
  updatePanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
