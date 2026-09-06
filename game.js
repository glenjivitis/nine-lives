// game.js — Nine Lives
// Phase 0: skeleton. Pixel-perfect canvas, procedural texture proof, one flat
// level, and a placeholder cat whose *movement* is final even though its art
// is not. Tune everything under PHYS.

const W = 320;
const H = 180;
const TILE = 16;
const MAX_ZOOM = 4;            // spec: 320x180 scaled x4 (shrinks to fit small screens)

// ---------------------------------------------------------------------------
// Physics (spec §3). All values are px, px/s, px/s², seconds.
// Editable live from the browser console, e.g.  PHYS.jumpVel = -400
// ---------------------------------------------------------------------------
const PHYS = {
  gravity: 1400,
  walkMax: 110,
  runMax: 170,             // hold Shift
  accel: 900,
  decel: 1300,
  jumpVel: -380,
  doubleJumpVel: -320,     // Scottie / Catnip (phase 1+)
  floatGravity: 0.4,       // Delia holding jump (phase 3)
  dashSpeed: 260,
  dashTime: 0.18,
  dashCooldown: 0.6,
  stompBounce: -250,
  stompBounceHold: -340,
  knockback: 180,

  coyoteTime: 0.100,       // may still jump this long after leaving a ledge
  jumpBuffer: 0.120,       // a jump press this long before landing still counts
  jumpCutMul: 0.5,         // release jump while rising -> vy *= this
  runAnimThreshold: 0.7,   // run anim above 70% of runMax

  // Not in the spec, but needed for a sane feel:
  maxFall: 450,            // terminal velocity
  airControl: 1.0,         // accel/decel multiplier while airborne
};

const HITBOX = { w: 20, h: 18 };   // spec §1: all cats share this

// Phase 0 test level: flat ground, reference pillars.
const LEVEL_W_TILES = 100;
const GROUND_ROW = 7;              // ground top = row 7 (y = 112), same as level 1-1

function approach(value, target, step) {
  if (value < target) return Math.min(value + step, target);
  if (value > target) return Math.max(value - step, target);
  return value;
}

// ---------------------------------------------------------------------------
// Placeholder textures (all built through Sprites.makeSprite to prove the pipeline)
// ---------------------------------------------------------------------------
function buildTextures() {
  // 16x16 bevelled tile. 0 = shadow edge, 1 = speckle, 2 = fill, 3 = lit edge
  const TILE_ART = [
    '3333333333333330',
    '3222222222222220',
    '3222222222222220',
    '3222212222222220',
    '3222222222222220',
    '3222222222221220',
    '3222222222222220',
    '3221222222222220',
    '3222222222222220',
    '3222222222222220',
    '3222222212222220',
    '3222222222222220',
    '3222222222222220',
    '3212222222222220',
    '3222222222222220',
    '0000000000000000',
  ];
  Sprites.makeSprite('tile-ground', [TILE_ART], ['#2a1d14', '#4d3626', '#6b4c33', '#8a6a48']);
  Sprites.makeSprite('tile-block',  [TILE_ART], ['#1f2230', '#3a4058', '#5a6280', '#8b93b4']);

  // The spec's "16x16 test square": bordered box with an X, two frames that
  // swap fill/bright so a blink proves multi-frame + animation work.
  const TEST0 = [
    '0000000000000000',
    '0111111111111110',
    '0121111111111210',
    '0112111111112110',
    '0111211111121110',
    '0111121111211110',
    '0111112112111110',
    '0111111331111110',
    '0111111331111110',
    '0111112112111110',
    '0111121111211110',
    '0111211111121110',
    '0112111111112110',
    '0121111111111210',
    '0111111111111110',
    '0000000000000000',
  ];
  const TEST1 = TEST0.map(r => r.replace(/[13]/g, ch => (ch === '1' ? '3' : '1')));
  Sprites.makeSprite('test-square', [TEST0, TEST1], ['#000000', '#ffffff', '#ff004d', '#29adff']);

  // Placeholder cat: 24x20 rounded slab with ears and one gold eye (faces right).
  // The 20x18 hitbox sits inside it, bottom-centred.
  const CAT = [
    '........................',
    '....00..........00......',
    '....010........010......',
    '....0110......0110......',
    '....01110....01110......',
    '...0111110000111110.....',
    '...011111111111111110...',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '..01111111111111112210..',
    '..01111111111111112210..',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '..01111111111111111110..',
    '...011111111111111110...',
    '....0000000000000000....',
  ];
  Sprites.makeSprite('cat-placeholder', [CAT], ['#0b0b10', '#3a3a48', '#e8c53a']);
}

// ---------------------------------------------------------------------------
// Player controller. Physics lives on an invisible hitbox; the drawn sprite
// follows it and can squash/stretch without touching collision.
// ---------------------------------------------------------------------------
class Player {
  constructor(scene, x, groundY) {
    this.scene = scene;
    this.spawn = { x, y: groundY - HITBOX.h / 2 };

    this.box = scene.add.rectangle(this.spawn.x, this.spawn.y, HITBOX.w, HITBOX.h);
    scene.physics.add.existing(this.box);
    this.body = this.box.body;
    this.body.setMaxVelocityY(PHYS.maxFall);
    this.body.setCollideWorldBounds(true);

    this.sprite = scene.add.image(x, groundY, 'cat-placeholder').setOrigin(0.5, 1);

    this.facing = 1;
    this.coyote = 0;
    this.buffer = 0;
    this.jumping = false;
    this.jumpCut = false;
    this.wasGrounded = true;
    this.lastVy = 0;
    this.dashTime = 0;
    this.dashCooldown = 0;
    this.dashDir = 1;
    this.landTimer = 0;
    this.idleTime = 0;
    this.state = 'idle';
    this.jumpSource = '-';
    this.jumpFlash = 0;
  }

  respawn() {
    this.body.reset(this.spawn.x, this.spawn.y);
    this.coyote = this.buffer = this.dashTime = this.dashCooldown = 0;
    this.jumping = this.jumpCut = false;
    this.wasGrounded = true;
    this.lastVy = 0;
    this.facing = 1;
  }

  update(inp, dt) {
    const b = this.body;
    const grounded = b.blocked.down;
    const justLanded = grounded && !this.wasGrounded;
    this.wasGrounded = grounded;

    // --- timers -----------------------------------------------------------
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.jumpFlash = Math.max(0, this.jumpFlash - dt);
    this.coyote = grounded ? PHYS.coyoteTime : Math.max(0, this.coyote - dt);
    this.buffer = inp.jumpPressed ? PHYS.jumpBuffer : Math.max(0, this.buffer - dt);

    // Arcade needs a real overlap before it reports contact, so a freshly
    // spawned body registers one airborne frame; only count a landing when it
    // was actually falling.
    if (justLanded && this.lastVy > 50) this.onLand();
    if (grounded) { this.jumping = false; this.jumpCut = false; }

    // --- facing / crouch / dash --------------------------------------------
    const crouching = grounded && inp.down && this.dashTime <= 0;
    const dir = crouching ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir !== 0 && this.dashTime <= 0) this.facing = dir;

    if (inp.actionPressed && this.dashCooldown <= 0 && this.dashTime <= 0) {
      this.dashTime = PHYS.dashTime;
      this.dashCooldown = PHYS.dashCooldown;
      this.dashDir = this.facing;
    }

    // --- horizontal ----------------------------------------------------------
    let vx = b.velocity.x;
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      vx = this.dashDir * PHYS.dashSpeed;
    } else {
      const ctrl = grounded ? 1 : PHYS.airControl;
      const accel = PHYS.accel * ctrl * dt;
      const decel = PHYS.decel * ctrl * dt;
      const max = inp.run ? PHYS.runMax : PHYS.walkMax;
      if (dir !== 0) {
        if (vx * dir < 0)            vx = approach(vx, 0, decel);          // skid: turning around
        else if (Math.abs(vx) > max) vx = approach(vx, dir * max, decel);  // bleed off excess (let go of run, post-dash)
        else                         vx = approach(vx, dir * max, accel);
      } else {
        vx = approach(vx, 0, decel);
      }
    }

    // --- vertical ------------------------------------------------------------
    let vy = b.velocity.y;
    if (this.buffer > 0 && this.coyote > 0) {
      this.jumpSource = !grounded ? 'COYOTE' : (inp.jumpPressed ? 'normal' : 'BUFFERED');
      this.jumpFlash = 0.8;
      vy = PHYS.jumpVel;
      this.buffer = 0;
      this.coyote = 0;
      this.jumping = true;
      this.jumpCut = false;
      this.onJump();
    }
    if (this.jumping && !this.jumpCut && !inp.jump && vy < 0) {   // variable height
      vy *= PHYS.jumpCutMul;
      this.jumpCut = true;
    }

    b.setVelocity(vx, vy);

    // --- animation state (phase 1 maps these to real frames) -----------------
    let state;
    if (this.dashTime > 0)                      state = 'dash';
    else if (this.jumping && vy < 0)            state = 'jump';
    else if (!grounded)                         state = vy < 0 ? 'jump' : 'fall';
    else if (this.landTimer > 0)                state = 'land';
    else if (crouching)                         state = 'crouch';
    else if (Math.abs(vx) > PHYS.runMax * PHYS.runAnimThreshold) state = 'run';
    else if (Math.abs(vx) > 2)                  state = 'walk';
    else                                        state = this.idleTime > 6 ? 'sit-loaf' : 'idle';
    this.idleTime = (state === 'idle' || state === 'sit-loaf') ? this.idleTime + dt : 0;
    this.state = state;
    this.grounded = grounded;

    // --- visual follows hitbox -----------------------------------------------
    this.sprite.x = b.x + b.halfWidth;
    this.sprite.y = b.y + b.height;
    this.sprite.setFlipX(this.facing < 0);
  }

  onJump() {
    this.squash(0.8, 1.25, 140);          // stretch
  }

  onLand() {
    this.landTimer = 2 / 12;              // spec: 2 frames @ 12fps
    this.squash(1.2, 0.8, 170);           // squash
  }

  squash(sx, sy, ms) {
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.sprite, scaleX: 1, scaleY: 1, duration: ms, ease: 'Quad.easeOut' });
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  create() {
    Sprites.setTextureManager(this.textures);
    buildTextures();

    const worldW = LEVEL_W_TILES * TILE;
    const worldH = H;
    const groundTop = GROUND_ROW * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor('#2a2d3e');

    // --- level: flat floor + reference pillars ------------------------------
    this.solids = this.physics.add.staticGroup();
    this.addSolid(0, groundTop, worldW, worldH - groundTop, 'tile-ground');
    // Single pillars 1..4 tiles tall (full jump apex is ~3.2 tiles: 3 should be
    // reachable, 4 should not). Then a 1-2-3 staircase, then two 2-tall pillars
    // 5 tiles apart for a running-jump test.
    const pillars = [[20, 1], [26, 2], [32, 3], [38, 4], [50, 1], [51, 2], [52, 3], [64, 2], [70, 2], [82, 3], [90, 3]];
    for (const [tx, h] of pillars) this.addSolid(tx * TILE, groundTop - h * TILE, TILE, h * TILE, 'tile-block');

    // --- makeSprite proof: the animated test square ---------------------------
    Sprites.addAnim(this, 'test-blink', 'test-square', 0, 1, 4);
    this.add.sprite(8 * TILE, groundTop - 3 * TILE, 'test-square').play('test-blink');

    // --- player ----------------------------------------------------------------
    this.player = new Player(this, 3 * TILE, groundTop);
    this.physics.add.collider(this.player.box, this.solids);

    // --- camera (spec §7: follow, dead-zone 40px) ------------------------------
    const cam = this.cameras.main;
    cam.startFollow(this.player.box, true, 1, 1);
    cam.setDeadzone(40, 40);

    // --- input --------------------------------------------------------------------
    const kb = this.input.keyboard;
    this.cursors = kb.createCursorKeys();               // arrows, space, shift
    this.wasd = kb.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
    this.keyReset = kb.addKey('R');
    this.keyDebugText = kb.addKey('BACKTICK');
    this.keyDebugBodies = kb.addKey('F2');

    // --- debug overlay -------------------------------------------------------------
    this.debugOn = true;
    this.debugText = this.add.text(2, 2, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setScrollFactor(0).setDepth(1000);
  }

  addSolid(x, y, w, h, textureKey) {
    const ts = this.add.tileSprite(x, y, w, h, textureKey).setOrigin(0, 0);
    this.solids.add(ts);
    return ts;
  }

  readInput() {
    const c = this.cursors, w = this.wasd;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    return {
      left: c.left.isDown || w.left.isDown,
      right: c.right.isDown || w.right.isDown,
      up: c.up.isDown || w.up.isDown,
      down: c.down.isDown || w.down.isDown,
      jump: c.space.isDown,
      jumpPressed: JustDown(c.space),
      run: c.shift.isDown,
      actionPressed: JustDown(c.shift),
    };
  }

  toggleBodyDebug() {
    const world = this.physics.world;
    if (!world.debugGraphic) world.createDebugGraphic();
    world.drawDebug = !world.drawDebug;
    world.debugGraphic.setVisible(world.drawDebug);
    if (!world.drawDebug) world.debugGraphic.clear();
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000;   // clamp so a stalled tab can't launch the cat
    const inp = this.readInput();
    const JustDown = Phaser.Input.Keyboard.JustDown;

    if (JustDown(this.keyReset)) this.player.respawn();
    if (JustDown(this.keyDebugText)) { this.debugOn = !this.debugOn; this.debugText.setVisible(this.debugOn); }
    if (JustDown(this.keyDebugBodies)) this.toggleBodyDebug();

    this.player.update(inp, dt);

    if (this.debugOn) {
      const p = this.player, b = p.body;
      const ms = s => String(Math.round(s * 1000)).padStart(3) + 'ms';
      this.debugText.setText([
        `${p.state.padEnd(8)} vx ${String(Math.round(b.velocity.x)).padStart(4)}  vy ${String(Math.round(b.velocity.y)).padStart(4)}  ${p.grounded ? 'GROUND' : 'AIR'}`,
        `coyote ${ms(p.coyote)}  buffer ${ms(p.buffer)}  dash cd ${p.dashCooldown.toFixed(2)}`,
        `last jump: ${p.jumpFlash > 0 ? '>> ' + p.jumpSource + ' <<' : p.jumpSource}   fps ${Math.round(this.game.loop.actualFps)}`,
        `arrows/WASD move  SPACE jump  SHIFT run (tap=dash)`,
        `R reset   \` hud   F2 hitboxes`,
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Boot: integer zoom so every game pixel is an exact NxN block of screen pixels.
// ---------------------------------------------------------------------------
function computeZoom() {
  const z = Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H));
  return Math.max(1, Math.min(MAX_ZOOM, z));
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#2a2d3e',
  pixelArt: true,
  roundPixels: true,
  render: { pixelArt: true, roundPixels: true, antialias: false },
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: computeZoom(),
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: PHYS.gravity }, fps: 60, fixedStep: true, debug: false },
  },
  scene: [PlayScene],
});

window.addEventListener('resize', () => {
  const z = computeZoom();
  if (game.scale.zoom !== z) game.scale.setZoom(z);
});
