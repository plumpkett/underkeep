// Entry point: wires input, UI panel and the frame loop to the Game and the 3D renderer.

import { Game, HEART_MAX } from './game.js';
import { Renderer3D } from './render3d.js';
import { T } from './map.js';

const canvas = document.getElementById('game');
const game = new Game();
const renderer = new Renderer3D(canvas, game);
window.game = game; // handy for poking at from the console

window.addEventListener('resize', () => renderer.resize());
renderer.resize();

// ---- mouse ----
let panning = null;
canvas.addEventListener('contextmenu', ev => ev.preventDefault());
canvas.addEventListener('mousemove', ev => {
  if (panning) { renderer.pan(ev.clientX - panning.x, ev.clientY - panning.y); panning = { x: ev.clientX, y: ev.clientY }; return; }
  game.hover = renderer.pick(ev.clientX, ev.clientY);
});
canvas.addEventListener('mouseleave', () => { game.hover = null; panning = null; });
canvas.addEventListener('wheel', ev => { ev.preventDefault(); renderer.zoom(ev.deltaY); }, { passive: false });
canvas.addEventListener('mousedown', ev => {
  if (ev.button === 1) { ev.preventDefault(); panning = { x: ev.clientX, y: ev.clientY }; return; }
  if (game.over) return;
  const p = renderer.pick(ev.clientX, ev.clientY);
  if (!p) return;
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
  if (ev.button === 1) { panning = null; return; }
  if (!game.drag) return;
  const end = game.hover || game.drag;
  game.applyRect(game.drag.x, game.drag.y, end.x, end.y, game.tool);
  game.drag = null;
});

// ---- keyboard ----
window.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') return;
  const k = ev.key;
  renderer.keys.set(k.length === 1 ? k.toLowerCase() : k, true);
  if (k === '1') setTool('dig');
  else if (k === '2') setTool(String(T.LAIR));
  else if (k === '3') setTool(String(T.HATCHERY));
  else if (k === '4') setTool(String(T.TREASURY));
  else if (k === '5') setTool(String(T.TRAINING));
  else if (k === '6') setTool('sell');
  else if (k === ' ') { ev.preventDefault(); setSpeed(game.speed === 0 ? (lastSpeed || 1) : 0); }
  else if (k === 'Escape') { if (game.held) { game.drop(game.held.tx, game.held.ty); game.held = null; } setTool('dig'); }
  else if (k === 'i') game.summonImp();
  else if (k === 'h') { renderer.cam.x = game.map.heart.x + 0.5; renderer.cam.z = game.map.heart.y + 0.5; }
  if (k.startsWith('Arrow')) ev.preventDefault();
});
window.addEventListener('keyup', ev => { const k = ev.key; renderer.keys.set(k.length === 1 ? k.toLowerCase() : k, false); });
window.addEventListener('blur', () => renderer.keys.clear());

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
  $('paused').classList.toggle('hidden', s !== 0);
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.speed button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('summon-imp').addEventListener('click', () => game.summonImp());
$('restart').addEventListener('click', () => { location.reload(); });

let lastLog = null;
function updatePanel() {
  $('gold').textContent = `${Math.floor(game.gold)} / ${game.goldCap}`;
  $('creatures').textContent = `${game.creatures.length} / ${game.lairCap}  ·  ${game.imps.length} imps`;
  $('wave').textContent = game.wave;
  $('next-wave').textContent = game.nextWave === Infinity ? 'final' : `${Math.ceil(game.nextWave)}s`;
  const hp = Math.max(0, game.heartHp);
  $('heart-bar').style.width = `${hp / HEART_MAX * 100}%`;
  $('heart-text').textContent = `Heart ${Math.ceil(hp)} / ${HEART_MAX}`;
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
  canvas.style.cursor = game.held ? 'grabbing' : panning ? 'move' : 'crosshair';
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
  renderer.draw(now / 1000, real);
  updatePanel();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
