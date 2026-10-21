# Underkeep

A browser dungeon-management game in the spirit of *Dungeon Keeper 2*. Dig for gold, build rooms, lure creatures through the Portal, and defend your Dungeon Heart against raids of heroes.

Rendered in 3D with [Three.js](https://threejs.org/) (loaded from a CDN via an import map) — plain HTML, CSS and JavaScript ES modules, no build step.

**Play it:** <https://plumpkett.github.io/underkeep/>

## Run locally

```bash
python3 serve.py
```

Then visit <http://localhost:8765/>. (`serve.py` is a static server with caching disabled so edits show on reload; any static server works.)

## How to play

- **Left-drag on rock** to mark it for digging. Imps dig it, claim the exposed floor, and carry gold veins back to your Treasury.
- **Rooms** (keys 2–5) are built by dragging over claimed floor: Lair (creatures sleep), Hatchery (food), Treasury (gold storage), Training Room (level up, costs gold). **Sell** (6) refunds half.
- **Claim the Portal** (the cyan swirl) to attract creatures. They only come if you have a Lair and a Hatchery; a Training Room attracts Warlocks, a big Hatchery attracts Brutes.
- **Click** one of your creatures to pick it up with the Hand of Evil and click your floor to drop it — the fastest way to rally defenders. **Right-click** slaps a creature (faster for a while, a little angrier).
- Heroes arrive from the gate on the right. Tunnellers dig straight toward your Heart; Knights and Archers follow. Survive ten raids and kill the Lord of the Land to win.
- Space pauses; `i` summons an imp.
- **Camera:** WASD / arrow keys pan, Q / E rotate, mouse wheel zooms, middle-drag pans, `h` recentres on the Heart.

## Layout

```
index.html        page shell and side panel
style.css
src/main.js       input, UI panel, frame loop
src/game.js       simulation: economy, imp jobs, creature needs, hero raids
src/map.js        tile types, map generation
src/entities.js   creature/hero stats and movement
src/pathfinding.js Dijkstra on the tile grid
src/render3d.js   Three.js scene: terrain, rooms, creatures, camera, picking
serve.py          no-cache static server for development
```
