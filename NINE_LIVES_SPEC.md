# NINE LIVES — Build Spec for Claude Code

A cute 2D pixel-art platformer in the Mario mold. Play as a cat, collect kibble, stomp Roombas, reach the apartment door where Glen and Em are waiting.

Hand this whole file to Claude Code. Build in the order under **Build Order**. Do not skip Phase 0.

---

## 0. Stack & constraints

- **Engine:** Phaser 3 (CDN, `phaser@3.80+`). Arcade physics. No build step.
- **Files:** `index.html`, `game.js`, `sprites.js` (procedural spritesheets), `levels.js` (tilemaps as string arrays). Single deployable folder.
- **Canvas:** 320×180 internal, scaled ×4 with `pixelArt: true`, `roundPixels: true`. Nearest-neighbor only.
- **Tiles:** 16×16. **Character sprites:** 32×32 frames (cat occupies ~24×20 inside, leaves room for tail/ears).
- **Sprites are generated in code**, not loaded from images. Each sprite = 2D array of palette indices → drawn to a canvas → registered as a Phaser texture. This keeps the art editable as data and avoids asset pipelines.
- **Input:** Arrow keys / WASD + Space (jump) + Shift (dash/action). On-screen touch buttons on mobile (left, right, jump, action). Must be playable on a phone.
- **Deploy:** GitHub Pages or Vercel static. One URL, no login.
- **No licensed characters, no copyrighted sprites.** Everything original.

---

## 1. Cast (character select)

Each cat: same hitbox (20×18), same base physics. One passive ability each. Distinct silhouette + 4-color palette.

| # | Cat | Look | Passive |
|---|-----|------|---------|
| 1 | **Scottie** | All-black, sleek, big ears, long tail, gold eyes | **Shadow** — invisible to enemies while standing still ≥0.5s (sprite goes 50% alpha with eye glint) |
| 2 | **Delia** | White with slate-gray cap/saddle/tail, sage-green collar, pale green eyes | **Float** — hold jump to fall at 40% gravity. Only cat who can see & collect hidden **ghost mice** ✦ |
| 3 | Marmalade | Chunky orange tabby, stripes, white chin | **Bonk** — dash breaks cracked-brick blocks |
| 4 | Mochi | Cream/seal-point Siamese, blue eyes | **Yowl** — action = stun all enemies on screen 1.5s (8s cooldown) |
| 5 | Pickle | Hairless sphynx, pink-beige, wrinkles | **Slide** — 1.5× speed on tile/kitchen floors; takes 2× knockback from water |
| 6 | Biscuit | Calico (white/orange/black patches) | **Chaos** — random other passive each level |
| 7 | Deli | Bodega tabby, gray mackerel, notched ear | **Stocked** — start every level with a random powerup |
| 8 | Clover | Gray Scottish Fold, folded ears, round face | **Roll** — can crouch-roll under 1-tile gaps |

Character select screen: 8 portraits (48×48) on a windowsill. Delia's portrait has a slow 3-star sparkle cycling around it. Selecting her plays a soft chime instead of a meow.

### 1.1 Scottie sprite spec (from photos)

- **Build:** lean, athletic, slightly long body. Long tail — animate it constantly, it's her silhouette.
- **Ears:** large, tall, pointed, set high. Inner ear slightly lighter.
- **Eyes:** gold-yellow, almond, vertical dark pupil. This is the only non-black detail — make the eyes 2px wide, bright.
- **Fur:** short, glossy. Use highlight color on top of head, shoulders, tail ridge to sell "shiny black."
- **Collar:** white/cream band with thin pink stitched edges top and bottom, small dark-gray side-release buckle at the front. On a black cat this is the highest-contrast feature after the eyes — make it 2px tall: 1px cream center, pink edge pixels above/below, 1 dark pixel for the buckle.
- **Palette:**
  - `S0` outline/deep: `#0b0b10`
  - `S1` body: `#1c1c24`
  - `S2` highlight: `#3a3a48`
  - `S3` eye: `#e8c53a`
  - `S4` eye pupil / nose: `#000000`
  - `S5` inner ear: `#2e2630`
  - `S6` collar cream: `#f2efe6`
  - `S7` collar pink trim: `#f0a6c0`
  - `S8` collar buckle: `#3c3c44`
- **Signature idle:** lying "loaf" with front paws stretched forward (photo 4 pose). Blink every 3–4s.

### 1.2 Delia sprite spec (from photos)

- **Build:** sturdy, rounded, shorter body than Scottie. Medium-short fur, slightly fluffy chest.
- **Markings (important — these read as "her"):**
  - Gray **cap** covering top of head and both ears, with a **white blaze** down the center of the forehead to the nose.
  - White face, chest, belly, all four legs and paws.
  - One large gray **saddle patch** on the back/shoulders (ovalish, sits behind the shoulders, doesn't reach the belly).
  - **Gray tail**, full length.
- **Ears:** medium, slightly rounded tips, gray.
- **Eyes:** pale green, round-ish. **Nose:** pink.
- **Collar:** sage/mint green with a tiny cream tag (1–2px).
- **Palette:**
  - `D0` outline: `#3b3d48`
  - `D1` white: `#f4f2ee`
  - `D2` white shade: `#d9d6d0`
  - `D3` gray: `#7a7d86`
  - `D4` gray shade: `#5c5f69`
  - `D5` eye: `#a8c9a0`
  - `D6` nose: `#e3a0b0`
  - `D7` collar: `#9ec4a6`
- **Signature idle:** sitting upright, looking over her shoulder (photo 1 pose), tail curled around front paws.

### 1.3 Other cats

Original designs from breed references (orange tabby, Siamese, sphynx, calico, mackerel tabby, Scottish Fold). No real-world named cats. Keep each to ≤6 colors.

### 1.4 Glen & Em (end-of-level NPCs)

- 32×48 humans, same pixel style. Glen: taller, short dark hair, t-shirt. Em: shorter, longer hair, hoodie. Simple, friendly, no attempt at likeness beyond that.
- Animations: `idle-wave` (2 frames), `crouch-pet` (3 frames), `hug-cat` (2 frames, cat sprite overlaid).

---

## 2. Animation states (all cats share the state machine)

| State | Frames | FPS | Notes |
|-------|--------|-----|-------|
| `idle` | 4 | 4 | breathing, tail sway, blink on frame 3 every ~4s |
| `walk` | 6 | 10 | |
| `run` | 6 | 14 | triggers at >70% max speed; ears back |
| `jump` | 2 | — | stretch (up), tuck (apex) |
| `fall` | 2 | — | limbs spread, tail up |
| `land` | 2 | 12 | squash 1.2× wide / 0.8× tall for 2 frames |
| `crouch` | 1 | — | butt wiggle loop (3 frames) if held >1s |
| `dash` | 3 | 16 | motion-blur ghost trail |
| `hurt` | 2 | 8 | puffed up, knockback, 1s invuln blink |
| `sit-loaf` | 3 | 2 | plays after 6s idle |
| `stomp` | 1 | — | shown 4 frames after enemy bounce |
| `super` (tuna) | +25% scale variant of all above | | |
| `box` | 1 | — | cardboard box with ears poking out |

**Juice (non-negotiable):**
- Squash & stretch on every jump/land.
- Coyote time 100ms, jump buffer 120ms, variable jump height (release = cut velocity ×0.5).
- Dust puffs on land and direction change.
- Tail is a separate 3-frame overlay that always animates, even in `idle`.

---

## 3. Physics (tune to feel like classic Mario)

```
gravity           1400 px/s²
walk max          110 px/s
run max           170 px/s (hold Shift)
accel             900 px/s²
decel             1300 px/s²
jump velocity     -380 px/s
double jump       -320 px/s (Scottie only, or via Catnip)
float gravity     0.4× (Delia holding jump)
dash              260 px/s for 0.18s, 0.6s cooldown
stomp bounce      -250 px/s (hold jump for -340)
knockback         180 px/s away from source
```

---

## 4. Powerups

| Powerup | Sprite | Effect | Duration |
|---------|--------|--------|----------|
| **Kibble** | brown pellet | +1 score. 100 = extra life (purr sound) | — |
| **Tuna can** | silver can, blue label | Super Cat: +25% size, +1 hit point | until hit |
| **Catnip** | green leaf sprig | Speed ×1.4, jump ×1.2, screen gentle sine wobble, rainbow tail trail | 8s |
| **Cardboard box** | tan box | Hold action to hide: invulnerable, enemies path through you, can't move | until released |
| **Laser pointer** | red dot projectile | Action fires dot; nearest enemy chases it for 3s (walks off ledges) | 3 charges |
| **Yarn ball** | red ball | Throwable, bounces 3× off walls, damages enemies, leaves string trail | 5 charges |
| **Bell collar** | gold bell | Kibble within 48px magnetizes to player | rest of level |
| **Fish** | blue fish | +1 life | — |
| **Ghost mouse** ✦ | translucent white mouse | Delia only. 3 per level. Collect all in a world → unlock bonus level | — |

Powerups spawn from **bonk blocks** (yellow "?" replaced with a **paw-print block**). Hit from below.

---

## 5. Enemies

| Enemy | Behavior | Defeat |
|-------|----------|--------|
| **Roomba** | Patrols, turns at edges/walls. Basic goomba. | Stomp (flips over, wheels spin) |
| **Cucumber** | Static. Spawns behind player when they walk past a trigger. Touch = launched backward 2 tiles + comedic yelp, no damage. | Can't. Jump over. |
| **Squirrel** | Sits in tree/on shelf, throws acorns in an arc every 2s. | Stomp or yarn ball |
| **Sprinkler** | Timed water arc, 2s on / 2s off. Water = damage. | Environmental, avoid |
| **Spray bottle** | Turret. Fires water blob toward player every 1.5s when in range. | Stomp from above |
| **Vacuum** (mini-boss) | Suction pulls player toward it; hide behind furniture blocks to break pull. Hit its cord plug 3× to stop it. | 3 stomps on plug |
| **Dog** | Chase sequence. Can't be killed. Screen auto-scrolls, dog gains if you stop. Ends at cat flap. | Outrun |
| **Bath** (final boss) | Bathtub fills over 60s. Pull 4 plugs (stomp) while rubber ducks bounce around. Water level = rising death zone. | 4 plugs |

All enemies have 2-frame idle + hurt frame. Stomped enemies squash then pop off-screen.

---

## 6. Worlds & tiles

**Tile types:** `ground`, `platform` (one-way), `brick` (breakable w/ Bonk or Super), `paw-block` (powerup), `spike` (thumbtacks), `water`, `ladder` (curtain/scratching post), `door` (level end), `checkpoint` (food bowl).

| World | Levels | Theme tiles | New enemy |
|-------|--------|-------------|-----------|
| 1 Apartment | 1-1 → 1-4 | couch, shelf, curtain (climbable), lamp, rug | Roomba, Cucumber |
| 2 Backyard | 2-1 → 2-4 | fence, birdbath, flowerpot, tree branch | Squirrel, Sprinkler |
| 3 Alley (night) | 3-1 → 3-4 | dumpster, fire escape, neon sign, bodega awning | Spray bottle, Dog chase (3-3) |
| 4 Vet clinic | 4-1 → 4-4 | steel table, cone-of-shame platforms, x-ray light box | Vacuum boss (4-4) |
| 5 Rooftop café | 5-1 → 5-2 + bonus | café tables, string lights, chimney | Bath boss (5-2) |

Parallax: 2 background layers per world. World 1 = window with tree outside + wall.

**Level end:** apartment door tile. Glen & Em stand in the doorway (`idle-wave`). On player contact: input locks, cat walks in, rubs legs (2s), they `crouch-pet`, door closes, score tally over closed door. Final level: all 8 cats visible inside, Delia on the windowsill.

---

## 7. Level 1-1 layout

Legend: `#` ground, `=` one-way platform, `B` brick, `?` paw-block, `K` kibble, `R` roomba, `C` cucumber trigger, `^` thumbtack, `S` start, `D` door, `|` curtain (climb), `.` air

Width 120 tiles, height 11. Camera follows player, dead-zone 40px. Rows top→bottom:

```
........................................................................................................................
........................................................................................................................
..................................KKK.......................===.........................................................
.............?.......B?B..........===....................=======.....|.................KKK....?..........................
.....................................................|...............|..............=====................................
........KKK...............R..........................|...............|.......R......................KK.................D
.......=====..........R...........R.C................|........R......|..........................=====....R.R...........#
###############...#############....############.....#####...####################....##############.....################
###############...#############....############.....#####...####################....##############.....################
###############...#############....############.....#####...####################....################...################
###############...#############....############.....#####...####################....################...################
```

Teach order: run → jump gap → kibble line → paw-block (tuna) → first Roomba → cucumber gag → curtain climb → double Roomba → door.

---

## 8. UI / HUD

- Top-left: lives (cat-head icons), kibble count (icon + number), powerup slot.
- Top-right: ghost mice ✦ 0/3 (Delia only).
- Font: bitmap 5×7 pixel font, generated in code.
- Pause: press Esc / tap corner. Menu shows character portrait doing `sit-loaf`.
- Title screen: "NINE LIVES" in chunky pixel letters, cats walk across the bottom, press any key.

---

## 9. Audio

Use jsfxr-style procedural SFX (no audio files): jump (short rising blip), land (thud), kibble (tick), 100-kibble purr (low rumble), stomp (pop), hurt (yowl-ish square wave), door (creak + chime). Music: optional, 4-channel chiptune loop per world via simple oscillator sequencer; ship without music first.

---

## 10. Build Order (Claude Code — do these in sequence, commit after each)

**Phase 0 — Skeleton (30 min)**
- `index.html` + Phaser CDN, 320×180 scaled canvas, pixel-perfect.
- `sprites.js`: helper `makeSprite(name, frames[], palette)` that turns index arrays into textures. Prove it with a 16×16 test square.
- One flat ground level, a placeholder rectangle that moves and jumps with the physics in §3. **Get the jump feel right here before drawing anything.** Coyote time, buffer, variable height.

**Phase 1 — Scottie playable (2 hr)**
- Draw Scottie: idle(4), walk(6), jump(2), fall(2), land(2). Separate tail overlay(3).
- Tilemap loader for the string format in §7. Collision, one-way platforms.
- Kibble, HUD, camera.

**Phase 2 — Level 1-1 complete (2 hr)**
- Roomba, Cucumber, paw-block, tuna/Super state, hurt/knockback, lives, death/respawn, checkpoint.
- Door + Glen/Em ending sequence.
- Touch controls.

**Phase 3 — Delia + character select (1.5 hr)**
- Draw Delia per §1.2. Float passive. Ghost mice.
- Character select screen with 2 cats. Sparkle on Delia's portrait.

**Phase 4 — Roster + World 1 (3 hr)**
- Remaining 6 cats + passives. Levels 1-2 to 1-4.

**Phase 5 — Worlds 2–5, bosses, polish, deploy.**

Ship after Phase 3. That's already a complete, giftable game.

---

## 11. Acceptance checklist

- [ ] Jump feels good blindfolded (no art) at end of Phase 0
- [ ] Scottie is recognizable as a black cat with gold eyes and big ears at 4× zoom
- [ ] Delia's gray cap + white blaze + saddle + gray tail all read at 4× zoom
- [ ] 60fps on a mid-range phone
- [ ] Level 1-1 beatable with touch controls
- [ ] Door ending plays with no input
- [ ] No text in the game references anything except the cats, Glen, and Em
