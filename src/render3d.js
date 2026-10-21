// Three.js renderer: extruded rock blocks, lit floors and rooms, low-poly creatures, camera controls.

import * as THREE from 'three';
import { T, W, H, OWNER, isWall } from './map.js';
import { FACTION } from './entities.js';
import { HEART_MAX } from './game.js';

const WALL_H = 1.0;
const COLORS = {
  [T.BEDROCK]: 0x17151d, [T.ROCK]: 0x6b6274, [T.GOLD]: 0x7a6a44,
  [T.DIRT]: 0x6b5a3e, [T.CLAIMED]: 0x4a3a64,
  [T.LAIR]: 0x5a3a26, [T.HATCHERY]: 0x6a6a2a, [T.TREASURY]: 0x6a5618, [T.TRAINING]: 0x3f4a78,
  [T.HEART]: 0x6a1428, [T.PORTAL]: 0x1e4a58, [T.GATE]: 0x5a1d1d,
};
const tileKey = t => t.type * 32 + t.owner * 8 + (t.marked ? 4 : 0) + (t.lairOf ? 2 : 0);

export class Renderer3D {
  constructor(canvas, game) {
    this.g = game;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05040a);
    this.scene.fog = new THREE.Fog(0x05040a, 28, 70);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.cam = { x: game.map.heart.x + 0.5, z: game.map.heart.y + 0.5, yaw: 0, pitch: 0.95, dist: 22 };
    this.raycaster = new THREE.Raycaster();
    this.entityViews = new Map();
    this.effectViews = new Map();
    this.textureCache = new Map();
    this.keys = new Map();
    this.buildStatic();
    this.buildLights();
    this.rebuildTiles(true);
  }

  // ---------- scene setup ----------
  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8070b0, 0x1a0c0c, 0.55));
    const sun = new THREE.DirectionalLight(0xffe8d0, 1.1);
    sun.position.set(W * 0.5 - 12, 30, H * 0.5 + 18);
    sun.target.position.set(W * 0.5, 0, H * 0.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target);
    const hp = this.g.map.heart, pp = this.g.map.portal;
    this.heartLight = new THREE.PointLight(0xff3050, 6, 12, 1.5);
    this.heartLight.position.set(hp.x + 0.5, 1.4, hp.y + 0.5);
    this.portalLight = new THREE.PointLight(0x40e0ff, 4, 9, 1.5);
    this.portalLight.position.set(pp.x + 0.5, 1.2, pp.y + 0.5);
    this.scene.add(this.heartLight, this.portalLight);
  }

  buildStatic() {
    const maxN = W * H;
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    // Walls
    this.walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_H, 1), white, maxN);
    this.walls.castShadow = true; this.walls.receiveShadow = true;
    this.wallTiles = new Int32Array(maxN); this.wallIndexOfTile = new Int32Array(maxN).fill(-1);
    // Floors
    this.floors = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), white.clone(), maxN);
    this.floors.receiveShadow = true;
    this.floorTiles = new Int32Array(maxN);
    // Gold flecks on gold veins
    this.flecks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshLambertMaterial({ color: 0xffd04a, emissive: 0x6a4a00 }), maxN * 2);
    // Marked-for-digging overlay
    this.marks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.06, 1.02), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.55 }), maxN);
    // Room decorations
    const decoMat = c => new THREE.MeshLambertMaterial({ color: c });
    this.lairRings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.3, 0.07, 6, 14), decoMat(0xa07a56), maxN);
    this.eggs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), decoMat(0xf0e6c0), maxN);
    this.coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 10), new THREE.MeshLambertMaterial({ color: 0xf0c040, emissive: 0x3a2a00 }), maxN);
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), decoMat(0xb0b8d8), maxN);
    for (const m of [this.walls, this.floors, this.flecks, this.marks, this.lairRings, this.eggs, this.coins, this.posts]) {
      m.frustumCulled = false; this.scene.add(m);
    }
    this.lairRings.castShadow = this.posts.castShadow = this.coins.castShadow = true;
    this.coinTiles = [];

    // Heart
    const hp = this.g.map.heart;
    this.heart = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 18), new THREE.MeshStandardMaterial({ color: 0xb01030, emissive: 0xff2040, emissiveIntensity: 0.8, roughness: 0.35 }));
    this.heart.position.set(hp.x + 0.5, 0.9, hp.y + 0.5); this.heart.castShadow = true;
    this.scene.add(this.heart);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.25, 24), new THREE.MeshLambertMaterial({ color: 0x2a1020 }));
    plinth.position.set(hp.x + 0.5, 0.17, hp.y + 0.5); plinth.receiveShadow = true;
    this.scene.add(plinth);
    // Portal
    const pp = this.g.map.portal;
    this.portal = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.14, 10, 32), new THREE.MeshStandardMaterial({ color: 0x40c0ff, emissive: 0x2090c0, emissiveIntensity: 1 }));
    this.portal.rotation.x = Math.PI / 2; this.portal.position.set(pp.x + 0.5, 0.25, pp.y + 0.5);
    this.scene.add(this.portal);
    this.portalCore = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x103040, transparent: true, opacity: 0.85 }));
    this.portalCore.rotation.x = -Math.PI / 2; this.portalCore.position.set(pp.x + 0.5, 0.12, pp.y + 0.5);
    this.scene.add(this.portalCore);
    // Hero gate: an arch
    const gp = this.g.map.gate;
    const stone = new THREE.MeshLambertMaterial({ color: 0x3a2a2a });
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.5), stone), r = l.clone(), top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 0.5), stone);
    l.position.set(gp.x - 0.5, 0.9, gp.y + 0.5); r.position.set(gp.x + 1.5, 0.9, gp.y + 0.5); top.position.set(gp.x + 0.5, 1.9, gp.y + 0.5);
    for (const m of [l, r, top]) { m.castShadow = true; this.scene.add(m); }
    const gateLight = new THREE.PointLight(0xff8040, 3, 7); gateLight.position.set(gp.x + 0.5, 1.3, gp.y + 0.5); this.scene.add(gateLight);

    // Hover / drag helpers
    this.hoverBox = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.05, 1.04), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    this.dragBox = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: 0x80ff80, transparent: true, opacity: 0.3, depthTest: false }));
    this.hoverBox.visible = this.dragBox.visible = false;
    this.scene.add(this.hoverBox, this.dragBox);
  }

  // ---------- tiles ----------
  rebuildTiles(force = false) {
    const map = this.g.map, tiles = map.tiles;
    if (!this.tileKeys) this.tileKeys = new Int32Array(W * H).fill(-1);
    let changed = force;
    for (let i = 0; i < tiles.length; i++) { const k = tileKey(tiles[i]); if (this.tileKeys[i] !== k) { this.tileKeys[i] = k; changed = true; } }
    if (!changed) return;
    const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let nw = 0, nf = 0, nk = 0, nm = 0, nl = 0, ne = 0, nc = 0, np = 0;
    this.wallIndexOfTile.fill(-1); this.coinTiles = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i], x = i % W, y = (i / W) | 0;
      if (isWall(t.type)) {
        const h = t.type === T.BEDROCK ? WALL_H * 1.25 : WALL_H;
        m.compose(p.set(x + 0.5, h / 2, y + 0.5), q, s.set(1, h, 1));
        this.walls.setMatrixAt(nw, m);
        c.setHex(COLORS[t.type]).offsetHSL(0, 0, (t.shade - 0.5) * 0.12);
        this.walls.setColorAt(nw, c);
        this.wallTiles[nw] = i; this.wallIndexOfTile[i] = nw; nw++;
        if (t.type === T.GOLD) {
          m.compose(p.set(x + 0.25 + t.shade * 0.5, h + 0.08, y + 0.3), q, s.set(1, 1, 1)); this.flecks.setMatrixAt(nk++, m);
          m.compose(p.set(x + 0.7 - t.shade * 0.4, h + 0.08, y + 0.72), q, s.set(1, 1, 1)); this.flecks.setMatrixAt(nk++, m);
        }
        if (t.marked) { m.compose(p.set(x + 0.5, h + 0.03, y + 0.5), q, s.set(1, 1, 1)); this.marks.setMatrixAt(nm++, m); }
      } else {
        m.compose(p.set(x + 0.5, 0.05, y + 0.5), q, s.set(1, 1, 1));
        this.floors.setMatrixAt(nf, m);
        c.setHex(COLORS[t.type]);
        if (t.owner === OWNER.PLAYER && t.type === T.CLAIMED) c.offsetHSL(0, 0, ((x + y) % 2) * 0.03);
        if (t.type === T.PORTAL && t.owner === OWNER.PLAYER) c.setHex(0x3a2a6a);
        if (t.type === T.DIRT) c.offsetHSL(0, 0, (t.shade - 0.5) * 0.1);
        this.floors.setColorAt(nf, c);
        this.floorTiles[nf] = i; nf++;
        switch (t.type) {
          case T.LAIR: m.compose(p.set(x + 0.5, 0.14, y + 0.5), q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), s.set(1, 1, 1)); this.lairRings.setMatrixAt(nl++, m); q.identity(); break;
          case T.HATCHERY:
            m.compose(p.set(x + 0.35, 0.22, y + 0.6), q, s.set(1, 1.3, 1)); this.eggs.setMatrixAt(ne++, m);
            m.compose(p.set(x + 0.7, 0.2, y + 0.3), q, s.set(0.8, 1.1, 0.8)); this.eggs.setMatrixAt(ne++, m);
            break;
          case T.TREASURY: this.coinTiles.push({ idx: nc, x, y }); m.compose(p.set(x + 0.5, 0.1, y + 0.5), q, s.set(1, 0.02, 1)); this.coins.setMatrixAt(nc++, m); break;
          case T.TRAINING: m.compose(p.set(x + 0.5, 0.55, y + 0.5), q, s.set(1, 1, 1)); this.posts.setMatrixAt(np++, m); break;
        }
      }
    }
    const set = (mesh, n, color = true) => { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (color && mesh.instanceColor) mesh.instanceColor.needsUpdate = true; };
    set(this.walls, nw); set(this.floors, nf); set(this.flecks, nk, false); set(this.marks, nm, false);
    set(this.lairRings, nl, false); set(this.eggs, ne, false); set(this.coins, nc, false); set(this.posts, np, false);
  }

  updateDynamicTiles() {
    // Dig progress: sink the block as it is chipped away
    const map = this.g.map, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let any = false;
    for (let i = 0; i < map.tiles.length; i++) {
      const t = map.tiles[i]; if (!t.marked || t.dig <= 0) continue;
      const wi = this.wallIndexOfTile[i]; if (wi < 0) continue;
      const need = t.type === T.GOLD ? 2.2 : 1.4; const h = WALL_H * (1 - 0.7 * Math.min(1, t.dig / need));
      m.compose(p.set(i % W + 0.5, h / 2, ((i / W) | 0) + 0.5), q, s.set(1, h, 1)); this.walls.setMatrixAt(wi, m); any = true;
    }
    if (any) this.walls.instanceMatrix.needsUpdate = true;
    // Treasury fill
    const fill = Math.max(0.02, Math.min(1, this.g.gold / Math.max(1, this.g.goldCap))) * 0.45;
    for (const ct of this.coinTiles) { m.compose(p.set(ct.x + 0.5, 0.1 + fill / 2, ct.y + 0.5), q, s.set(1, fill, 1)); this.coins.setMatrixAt(ct.idx, m); }
    if (this.coinTiles.length) this.coins.instanceMatrix.needsUpdate = true;
  }

  // ---------- entities ----------
  textTexture(text, color, size = 64) {
    const key = text + '|' + color + '|' + size;
    if (this.textureCache.has(key)) return this.textureCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.font = `bold ${size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color; ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.textureCache.set(key, tex);
    return tex;
  }
  makeEntityView(e) {
    const g = new THREE.Group();
    const hero = e.faction === FACTION.HERO;
    const r = e.def.boss ? 0.42 : e.kind === 'brute' ? 0.36 : e.kind === 'imp' ? 0.2 : 0.27;
    const mat = new THREE.MeshLambertMaterial({ color: e.def.color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, r * 1.4, 4, 10), mat);
    body.position.y = r * 1.7; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 10, 8), new THREE.MeshLambertMaterial({ color: hero ? 0xf0d0b0 : 0x202020 }));
    head.position.y = r * 1.7 + r * 1.5; head.castShadow = true; g.add(head);
    if (hero) { const helm = new THREE.Mesh(new THREE.ConeGeometry(r * 0.75, r * 0.9, 8), new THREE.MeshLambertMaterial({ color: e.def.boss ? 0xffd54f : 0x9aa4b0 })); helm.position.y = head.position.y + r * 0.7; g.add(helm); }
    else { for (const sx of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.2, r * 0.6, 5), new THREE.MeshLambertMaterial({ color: 0xe0d0b0 })); horn.position.set(sx * r * 0.45, head.position.y + r * 0.6, 0); horn.rotation.z = -sx * 0.4; g.add(horn); } }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textTexture(e.def.glyph, hero ? '#ffe9c0' : '#ffffff', 72), depthTest: false }));
    label.scale.set(0.9, 0.45, 1); label.position.y = head.position.y + r * 1.9; g.add(label);
    const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, depthTest: false })); hpBg.scale.set(0.9, 0.1, 1); hpBg.position.y = label.position.y + 0.3;
    const hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: hero ? 0xff7043 : 0x66bb6a, depthTest: false })); hpFg.scale.set(0.9, 0.1, 1); hpFg.position.y = hpBg.position.y;
    g.add(hpBg, hpFg);
    const gold = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), new THREE.MeshLambertMaterial({ color: 0xffd04a, emissive: 0x4a3000 }));
    gold.position.set(r * 1.1, r * 1.7, 0); gold.visible = false; g.add(gold);
    const zz = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textTexture('z', '#dddddd', 60), depthTest: false })); zz.scale.set(0.5, 0.25, 1); zz.position.set(r, head.position.y + r, 0); zz.visible = false; g.add(zz);
    const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textTexture('!', '#ff5252', 72), depthTest: false })); bang.scale.set(0.4, 0.3, 1); bang.position.set(-r, head.position.y + r, 0); bang.visible = false; g.add(bang);
    this.scene.add(g);
    return { g, body, mat, hpBg, hpFg, gold, zz, bang, r };
  }
  updateEntities(t) {
    const live = new Set();
    for (const e of this.g.entities) {
      if (!e.alive) continue;
      live.add(e.id);
      let v = this.entityViews.get(e.id);
      if (!v) { v = this.makeEntityView(e); this.entityViews.set(e.id, v); }
      let x = e.x, z = e.y, y = 0.1;
      if (e.held) { if (!this.g.hover) { v.g.visible = false; continue; } x = this.g.hover.x + 0.5; z = this.g.hover.y + 0.5; y = 1.4; }
      v.g.visible = true;
      const moving = e.path.length > 0 && !e.held;
      const bob = e.state === 'sleep' ? 0 : moving ? Math.abs(Math.sin(t * 9 + e.id)) * 0.12 : Math.sin(t * 2 + e.id) * 0.02;
      v.g.position.set(x, y + bob, z);
      if (moving && e.path[0]) v.g.rotation.y = Math.atan2(e.path[0].x + 0.5 - e.x, e.path[0].y + 0.5 - e.y);
      v.body.rotation.z = e.state === 'sleep' ? 1.2 : 0;
      v.mat.color.set(e.flash > 0 ? 0xffffff : e.def.color);
      v.mat.emissive.setHex(e.slap > 0 ? 0x402000 : 0x000000);
      const frac = Math.max(0, e.hp / e.maxHp);
      v.hpBg.visible = v.hpFg.visible = frac < 1;
      v.hpFg.scale.x = 0.9 * frac; v.hpFg.position.x = -0.45 + 0.45 * frac;
      v.gold.visible = e.carry > 0;
      v.zz.visible = e.state === 'sleep';
      v.bang.visible = e.anger > 50 && e.faction === FACTION.PLAYER && !e.def.worker;
      const lv = 1 + Math.min(0.3, (e.level - 1) * 0.04); v.g.scale.set(lv, lv, lv);
    }
    for (const [id, v] of this.entityViews) if (!live.has(id)) { this.scene.remove(v.g); this.entityViews.delete(id); }
  }
  updateEffects() {
    const live = new Set();
    for (const f of this.g.effects) {
      live.add(f);
      let s = this.effectViews.get(f);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textTexture(f.text, f.color, 56), transparent: true, depthTest: false }));
        s.scale.set(1.6, 0.8, 1); this.scene.add(s); this.effectViews.set(f, s);
      }
      s.position.set(f.x, 1.2 + (1.2 - f.ttl) * 1.2, f.y);
      s.material.opacity = Math.min(1, f.ttl);
    }
    for (const [f, s] of this.effectViews) if (!live.has(f)) { this.scene.remove(s); s.material.dispose(); this.effectViews.delete(f); }
  }

  // ---------- camera & picking ----------
  updateCamera(dt) {
    const c = this.cam, k = this.keys;
    const spd = 14 * dt * (c.dist / 22);
    let dx = 0, dz = 0;
    if (k.get('w') || k.get('ArrowUp')) dz -= 1;
    if (k.get('s') || k.get('ArrowDown')) dz += 1;
    if (k.get('a') || k.get('ArrowLeft')) dx -= 1;
    if (k.get('d') || k.get('ArrowRight')) dx += 1;
    if (k.get('q')) c.yaw += dt * 1.5;
    if (k.get('e')) c.yaw -= dt * 1.5;
    if (dx || dz) {
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      c.x += (dx * cy + dz * sy) * spd; c.z += (dz * cy - dx * sy) * spd;
      c.x = Math.max(0, Math.min(W, c.x)); c.z = Math.max(0, Math.min(H, c.z));
    }
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * c.dist * cp, c.dist * sp, c.z + Math.cos(c.yaw) * c.dist * cp);
    this.camera.lookAt(c.x, 0, c.z);
  }
  zoom(delta) { this.cam.dist = Math.max(8, Math.min(45, this.cam.dist * (delta > 0 ? 1.1 : 0.9))); }
  pan(dx, dy) {
    const c = this.cam, k = c.dist / 600, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    c.x -= (dx * cy + dy * sy) * k; c.z -= (dy * cy - dx * sy) * k;
  }
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height * 2 - 1));
    this.raycaster.setFromCamera(nd, this.camera);
    const hits = this.raycaster.intersectObjects([this.walls, this.floors], false);
    if (!hits.length) return null;
    const h = hits[0];
    const i = h.object === this.walls ? this.wallTiles[h.instanceId] : this.floorTiles[h.instanceId];
    return { x: i % W, y: (i / W) | 0, fx: h.point.x, fy: h.point.z };
  }

  resize() {
    const el = this.renderer.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  draw(t, dt) {
    const g = this.g, map = g.map;
    this.rebuildTiles();
    this.updateDynamicTiles();
    this.updateEntities(t);
    this.updateEffects();
    this.updateCamera(dt);
    // Heart & portal life
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const hs = 1 + pulse * 0.08 * (g.heartHp / HEART_MAX); this.heart.scale.set(hs, hs, hs);
    this.heart.material.emissiveIntensity = 0.4 + pulse * 0.6 * Math.max(0.2, g.heartHp / HEART_MAX);
    this.heartLight.intensity = 4 + pulse * 3;
    const owned = map.at(map.portal.x, map.portal.y).owner === OWNER.PLAYER;
    this.portal.rotation.z = t * (owned ? 1.5 : 0.4);
    this.portal.material.color.setHex(owned ? 0xb080ff : 0x40c0ff); this.portal.material.emissive.setHex(owned ? 0x7040c0 : 0x2090c0);
    this.portalLight.color.setHex(owned ? 0xb080ff : 0x40e0ff);
    // Hover / drag
    if (g.hover) {
      const ht = map.at(g.hover.x, g.hover.y);
      const hy = isWall(ht.type) ? (ht.type === T.BEDROCK ? WALL_H * 1.25 : WALL_H) + 0.04 : 0.13;
      this.hoverBox.visible = true; this.hoverBox.position.set(g.hover.x + 0.5, hy, g.hover.y + 0.5);
      this.hoverBox.material.color.setHex(g.held ? (map.isOwned(g.hover.x, g.hover.y) ? 0x69f0ae : 0xff5252) : 0xffffff);
    } else this.hoverBox.visible = false;
    if (g.drag && g.hover) {
      const [ax, bx] = g.drag.x < g.hover.x ? [g.drag.x, g.hover.x] : [g.hover.x, g.drag.x];
      const [ay, by] = g.drag.y < g.hover.y ? [g.drag.y, g.hover.y] : [g.hover.y, g.drag.y];
      this.dragBox.visible = true;
      this.dragBox.position.set((ax + bx + 1) / 2, WALL_H + 0.08, (ay + by + 1) / 2);
      this.dragBox.scale.set(bx - ax + 1, 1, by - ay + 1);
      this.dragBox.material.color.setHex(g.tool === 'dig' ? 0xffd040 : g.tool === 'sell' ? 0xff5050 : 0x80ff80);
    } else this.dragBox.visible = false;
    this.renderer.render(this.scene, this.camera);
  }
}
