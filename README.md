# Nine Lives

A cute pixel-art platformer in the Mario mold. Play as one of eight cats, collect kibble, stomp Roombas, and reach the apartment door where Glen and Em are waiting.

Everything is generated in code: sprites are index-art strings in `sprites.js`, levels are string arrays in `levels.js`, and sound effects are synthesized with WebAudio. There is no build step and no asset pipeline.

## Play locally

Any static file server works. From this folder:

```
python -m http.server 8000
```

Then open http://localhost:8000/ in a browser.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | Arrow keys or WASD | Left / right buttons |
| Jump (hold for height) | Space | A |
| Run (hold) / dash or item (tap) | Shift | B |
| Crouch / climb curtains | Down / Up | - |
| Pause | Esc or P | Corner button |
| Mute | M | - |

Debug: backtick toggles the physics readout, F2 shows hitboxes.

## The cats

| Cat | Passive |
|---|---|
| Scottie | Shadow: stand still to vanish from enemies. Double jump. |
| Delia | Float: hold jump to fall slowly. The only cat who sees ghost mice. |
| Marmalade | Bonk: dash through bricks. |
| Mochi | Yowl: the action button stuns every enemy on screen. |
| Pickle | Slide: 1.5x speed on kitchen tiles. |
| Biscuit | Chaos: a random passive every level. |
| Deli | Stocked: starts every level with a powerup. |
| Clover | Roll: crouch-roll under one-tile gaps. |

Collect every ghost mouse in a world as Delia to unlock the bonus level.

## Deploy

The game is a single static folder. Deploy `index.html`, `game.js`, `sprites.js`, and `levels.js` anywhere that serves static files.

**GitHub Pages:** push this repository to GitHub, then in the repository settings under Pages choose "Deploy from a branch", branch `master` (or `main`), folder `/ (root)`. The `.nojekyll` file is already included so nothing gets preprocessed.

**Vercel:** run `vercel` in this folder, or import the repository in the Vercel dashboard. No framework preset and no build command are needed.

## Files

- `index.html` - page shell, Phaser from CDN, pixel-perfect integer scaling.
- `game.js` - scenes, player controller, enemies, bosses, powerups. Physics tunables live in the `PHYS` table at the top.
- `sprites.js` - `makeSprite` and all the art as data, including the cat rig used by all eight cats.
- `levels.js` - the campaign, one string array per level.
