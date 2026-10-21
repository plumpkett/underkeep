# Underkeep

A browser dungeon-management game in the spirit of *Dungeon Keeper 2*. Dig for gold, build rooms, lure creatures through the Portal, and defend your Dungeon Heart against raids of heroes.

Plain HTML, CSS and JavaScript (ES modules) on a `<canvas>` — no build step, no dependencies.

## Play

Serve the folder with any static server and open it in a browser:

```bash
python3 -m http.server 8765
```

Then visit <http://localhost:8765/>.

## How to play

- **Left-drag on rock** to mark it for digging. Imps dig it, claim the exposed floor, and carry gold veins back to your Treasury.
- **Rooms** (keys 2–5) are built by dragging over claimed floor: Lair (creatures sleep), Hatchery (food), Treasury (gold storage), Training Room (level up, costs gold). **Sell** (6) refunds half.
- **Claim the Portal** (the cyan swirl) to attract creatures. They only come if you have a Lair and a Hatchery; a Training Room attracts Warlocks, a big Hatchery attracts Brutes.
- **Click** one of your creatures to pick it up with the Hand of Evil and click your floor to drop it — the fastest way to rally defenders. **Right-click** slaps a creature (faster for a while, a little angrier).
- Heroes arrive from the gate on the right. Tunnellers dig straight toward your Heart; Knights and Archers follow. Survive ten raids and kill the Lord of the Land to win.
- Space pauses; `i` summons an imp.

## Layout

```
index.html        page shell and side panel
style.css
src/main.js       input, UI panel, frame loop
src/game.js       simulation: economy, imp jobs, creature needs, hero raids
src/map.js        tile types, map generation
src/entities.js   creature/hero stats and movement
src/pathfinding.js Dijkstra on the tile grid
src/render.js     canvas drawing
```
