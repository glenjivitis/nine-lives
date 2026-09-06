// game.js — Nine Lives
// Phase 1: Scottie playable on level 1-1 (tilemap, one-way shelves, kibble,
// HUD, camera). All feel tunables live under PHYS.

const W = 320;
const H = 180;
const TILE = 16;
const MAX_ZOOM = 4;            // spec: 320x180 scaled x4 (shrinks to fit small screens)

// ---------------------------------------------------------------------------
// Physics (spec §3). px, px/s, px/s², seconds. Live-editable from the console.
// ---------------------------------------------------------------------------
const PHYS = {
  gravity: 1400,
  walkMax: 110,
  runMax: 170,
  accel: 900,
  decel: 1300,
  jumpVel: -380,
  doubleJumpVel: -320,
  floatGravity: 0.4,
  dashSpeed: 260,
  dashTime: 0.18,
  dashCooldown: 0.6,
  stompBounce: -250,
  stompBounceHold: -340,
  knockback: 180,

  coyoteTime: 0.100,
  jumpBuffer: 0.120,
  jumpCutMul: 0.5,
  runAnimThreshold: 0.7,

  maxFall: 450,
  airControl: 1.0,
};

const HITBOX = { w: 20, h: 18 };

// Persistent run state
const GameState = {
  cat: 'scottie',
  lives: 9,
  kibble: 0,
  level: '1-1',
};

function approach(value, target, step) {
  if (value < target) return Math.min(value + step, target);
  if (value > target) return Math.max(value - step, target);
  return value;
}

// ---------------------------------------------------------------------------
// Cat definitions: texture key, frame map, tail textures, palette accents.
// ---------------------------------------------------------------------------
const CATS = {
  scottie: { name: 'SCOTTIE', texture: 'scottie', tail: 'scottie-tail', tailAir: 'scottie-tail-air' },
};

function registerCatAnims(scene, catKey) {
  const cat = CATS[catKey];
  const F = Sprites.FRAMES[cat.texture];
  const A = (name, from, to, fps, repeat) => Sprites.addAnim(scene, cat.texture + '-' + name, cat.texture, F[from], F[to], fps, repeat);
  A('idle', 'idle0', 'idle3', 4, -1);
  A('walk', 'walk0', 'walk5', 10, -1);
  A('run', 'run0', 'run5', 14, -1);
  A('land', 'land0', 'land1', 12, 0);
  Sprites.addAnim(scene, cat.tail + '-sway', cat.tail, 0, 2, 5, -1);
  Sprites.addAnim(scene, 'dust-puff', 'dust', 0, 3, 16, 0);
  Sprites.addAnim(scene, 'kibble-glint', 'kibble', 0, 1, 2, -1);
}

// ---------------------------------------------------------------------------
// Player controller. Physics lives on an invisible hitbox; the drawn sprite
// (body + tail overlay) follows it and can squash/stretch freely.
// ---------------------------------------------------------------------------
class Player {
  constructor(scene, x, groundY, catKey) {
    this.scene = scene;
    this.cat = CATS[catKey];
    this.F = Sprites.FRAMES[this.cat.texture];
    this.spawn = { x, y: groundY - HITBOX.h / 2 };

    this.box = scene.add.rectangle(this.spawn.x, this.spawn.y, HITBOX.w, HITBOX.h);
    scene.physics.add.existing(this.box);
    this.body = this.box.body;
    this.body.setMaxVelocityY(PHYS.maxFall);
    this.body.setCollideWorldBounds(true);

    this.tail = scene.add.sprite(x, groundY, this.cat.tail).setOrigin(0.5, 1).setDepth(10);
    this.sprite = scene.add.sprite(x, groundY, this.cat.texture).setOrigin(0.5, 1).setDepth(11);
    this.tail.play(this.cat.tail + '-sway');

    this.facing = 1;
    this.coyote = 0;
    this.buffer = 0;
    this.jumping = false;
    this.jumpCut = false;
    this.wasGrounded = true;
    this.lastVy = 0;
    this.lastVx = 0;
    this.dashTime = 0;
    this.dashCooldown = 0;
    this.dashDir = 1;
    this.landTimer = 0;
    this.idleTime = 0;
    this.blinkTimer = 3;
    this.blinkHold = 0;
    this.state = 'idle';
    this.currentAnim = null;
    this.jumpSource = '-';
    this.jumpFlash = 0;
    this.grounded = true;
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
    if (justLanded && this.lastVy > 50) this.onLand(this.lastVy);
    if (grounded) { this.jumping = false; this.jumpCut = false; }

    // --- facing / crouch / dash --------------------------------------------
    const crouching = grounded && inp.down && this.dashTime <= 0;
    const dir = crouching ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir !== 0 && this.dashTime <= 0 && dir !== this.facing) {
      if (grounded && Math.abs(b.velocity.x) > 60) this.scene.dust(b.x + b.halfWidth, b.y + b.height, -dir);
      this.facing = dir;
    }

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
        if (vx * dir < 0)            vx = approach(vx, 0, decel);
        else if (Math.abs(vx) > max) vx = approach(vx, dir * max, decel);
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
    if (this.jumping && !this.jumpCut && !inp.jump && vy < 0) {
      vy *= PHYS.jumpCutMul;
      this.jumpCut = true;
    }

    b.setVelocity(vx, vy);
    this.lastVy = vy;
    this.lastVx = vx;

    // --- animation state -------------------------------------------------------
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

    this.animate(state, vy, dt);

    // --- visuals follow hitbox -------------------------------------------------
    const px = b.x + b.halfWidth, py = b.y + b.height;
    this.sprite.x = px; this.sprite.y = py;
    this.tail.x = px; this.tail.y = py;
    const flip = this.facing < 0;
    this.sprite.setFlipX(flip);
    this.tail.setFlipX(flip);
  }

  animate(state, vy, dt) {
    const F = this.F, t = this.cat.texture;
    const play = key => { if (this.currentAnim !== key) { this.sprite.play(key); this.currentAnim = key; } };
    const frame = (name) => { if (this.currentAnim !== 'f:' + name) { this.sprite.anims.stop(); this.sprite.setFrame(F[name]); this.currentAnim = 'f:' + name; } };

    switch (state) {
      case 'idle':
      case 'sit-loaf':
        // blink: every ~3-4s hold the blink frame for 120ms
        this.blinkTimer -= dt;
        if (this.blinkHold > 0) {
          this.blinkHold -= dt;
          frame('blink');
          if (this.blinkHold <= 0) { this.currentAnim = null; }
        } else {
          play(t + '-idle');
          if (this.blinkTimer <= 0) { this.blinkTimer = 3 + Math.random(); this.blinkHold = 0.12; }
        }
        break;
      case 'walk': play(t + '-walk'); break;
      case 'run': play(t + '-run'); break;
      case 'dash': frame('jump0'); break;
      case 'jump': frame(vy < -150 ? 'jump0' : 'jump1'); break;
      case 'fall': frame(vy < 250 ? 'fall0' : 'fall1'); break;
      case 'land': play(t + '-land'); break;
      case 'crouch': frame('crouch'); break;
    }

    // tail overlay: airborne uses the tail-up frame, otherwise the sway loop
    const airborne = state === 'jump' || state === 'fall' || state === 'dash';
    if (airborne) {
      if (this.tail.texture.key !== this.cat.tailAir) { this.tail.anims.stop(); this.tail.setTexture(this.cat.tailAir, 0); }
    } else if (this.tail.texture.key !== this.cat.tail) {
      this.tail.setTexture(this.cat.tail, 0);
      this.tail.play(this.cat.tail + '-sway');
    }
  }

  onJump() {
    this.squash(0.85, 1.15, 140);
  }

  onLand(impact) {
    this.landTimer = 2 / 12;
    this.squash(1.15, 0.85, 170);
    if (impact > 200) {
      const b = this.body;
      this.scene.dust(b.x + b.halfWidth - 6, b.y + b.height, -1);
      this.scene.dust(b.x + b.halfWidth + 6, b.y + b.height, 1);
    }
  }

  squash(sx, sy, ms) {
    const targets = [this.sprite, this.tail];
    this.scene.tweens.killTweensOf(targets);
    for (const s of targets) s.setScale(sx, sy);
    this.scene.tweens.add({ targets, scaleX: 1, scaleY: 1, duration: ms, ease: 'Quad.easeOut' });
  }
}

// ---------------------------------------------------------------------------
// HUD (spec §8)
// ---------------------------------------------------------------------------
class Hud {
  constructor(scene) {
    this.scene = scene;
    const d = 1000;
    this.lifeIcon = scene.add.image(4, 4, 'icon-life').setOrigin(0).setScrollFactor(0).setDepth(d);
    this.lifeText = this.text(14, 4);
    this.kibbleIcon = scene.add.image(36, 5, 'kibble').setOrigin(0).setScrollFactor(0).setDepth(d);
    this.kibbleText = this.text(44, 4);
    // powerup slot
    this.slot = scene.add.rectangle(74, 4, 12, 12).setOrigin(0).setStrokeStyle(1, 0x3a2a1a, 0.6).setScrollFactor(0).setDepth(d);
    this.refresh();
  }

  text(x, y) {
    const shadow = this.scene.add.bitmapText(x + 1, y + 1, 'font', '').setScrollFactor(0).setDepth(999).setTint(0x2a1a10);
    const main = this.scene.add.bitmapText(x, y, 'font', '').setScrollFactor(0).setDepth(1000).setTint(0xfff4dc);
    return { set(s) { shadow.setText(s); main.setText(s); } };
  }

  refresh() {
    this.lifeText.set('x' + GameState.lives);
    this.kibbleText.set(String(GameState.kibble).padStart(3, '0'));
  }
}

// ---------------------------------------------------------------------------
// Play scene
// ---------------------------------------------------------------------------
class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  create() {
    Sprites.setTextureManager(this.textures);
    Sprites.buildAll();
    Sprites.installFont(this);
    registerCatAnims(this, GameState.cat);

    // --- level ---------------------------------------------------------------
    const T = Sprites.TILE;
    const level = Levels.parse(Levels.get(GameState.level), T);
    this.level = level;
    const mapW = level.width * TILE;
    const mapH = level.height * TILE;
    const worldH = Math.max(H, mapH);
    this.mapOffsetY = worldH - mapH;   // bottom-align short maps to the screen

    this.physics.world.setBounds(0, 0, mapW, worldH);
    // One-way shelves: only snap onto a shelf when the feet are within 12px
    // of its top, so standing on the floor under a low shelf doesn't pop you up.
    this.physics.world.TILE_BIAS = 12;
    this.cameras.main.setBounds(0, 0, mapW, worldH);
    this.cameras.main.setBackgroundColor('#e6d8bf');
    this.drawBackdrop(mapW, worldH);

    const map = this.make.tilemap({ data: level.grid, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    this.layer = map.createLayer(0, tileset, 0, this.mapOffsetY).setDepth(5);
    this.layer.setCollision([T.FLOOR_TOP, T.FLOOR_FILL, T.SHELF, T.BRICK, T.PAW, T.PAW_USED]);
    this.layer.forEachTile(tile => {
      if (tile.index === T.SHELF) tile.setCollision(false, false, true, false);
    });
    // Phaser drops the top face of a solid tile whenever the tile above it
    // "collides", which includes one-way shelves. Restore it so the floor
    // under a shelf still holds you up.
    this.layer.forEachTile(tile => {
      if (tile.index < 0 || !tile.collides || tile.index === T.SHELF) return;
      const above = this.layer.getTileAt(tile.x, tile.y - 1);
      if (above && above.index === T.SHELF) tile.faceTop = true;
    });

    // --- entities ------------------------------------------------------------
    const tx = c => c.x * TILE + TILE / 2;
    const ty = c => this.mapOffsetY + c.y * TILE + TILE / 2;

    if (level.door) {
      this.door = this.add.image(tx(level.door), ty(level.door) + TILE / 2, 'door').setOrigin(0.5, 1).setDepth(4);
    }

    this.kibble = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const k of level.kibble) {
      const s = this.kibble.create(tx(k), ty(k), 'kibble').setDepth(8);
      s.body.setSize(8, 8);
      s.play({ key: 'kibble-glint', delay: Math.random() * 1000 });
      this.tweens.add({ targets: s, y: s.y - 2, duration: 600 + Math.random() * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // --- player ----------------------------------------------------------------
    const start = level.start;
    this.player = new Player(this, tx(start), this.mapOffsetY + (start.y + 1) * TILE, GameState.cat);
    this.physics.add.collider(this.player.box, this.layer);
    this.physics.add.overlap(this.player.box, this.kibble, (box, k) => this.collectKibble(k));

    // --- camera (spec §7: follow, dead-zone 40px) ------------------------------
    const cam = this.cameras.main;
    cam.startFollow(this.player.box, true, 1, 1);
    cam.setDeadzone(40, 40);

    // --- input --------------------------------------------------------------------
    const kb = this.input.keyboard;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
    this.keyReset = kb.addKey('R');
    this.keyDebugText = kb.addKey('BACKTICK');
    this.keyDebugBodies = kb.addKey('F2');

    // --- HUD / debug ---------------------------------------------------------------
    this.hud = new Hud(this);
    this.debugOn = false;
    this.debugText = this.add.text(2, 20, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setScrollFactor(0).setDepth(1001).setVisible(false);
  }

  /** Apartment wall: flat colour, a baseboard, and faint wallpaper stripes. */
  drawBackdrop(mapW, worldH) {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0xd9c7a6, 1);
    for (let x = 0; x < mapW; x += 32) g.fillRect(x, 0, 8, worldH);
    const floorY = this.mapOffsetY + 7 * TILE;
    g.fillStyle(0xb89a70, 1);
    g.fillRect(0, floorY - 6, mapW, 6);
    g.fillStyle(0x8c6d48, 1);
    g.fillRect(0, floorY - 1, mapW, 1);
  }

  dust(x, y, dir) {
    const s = this.add.sprite(x, y, 'dust').setOrigin(0.5, 1).setDepth(9).setFlipX(dir < 0);
    s.play('dust-puff');
    s.once('animationcomplete', () => s.destroy());
  }

  collectKibble(k) {
    k.disableBody(true, true);
    GameState.kibble += 1;
    if (GameState.kibble >= 100) {
      GameState.kibble -= 100;
      GameState.lives += 1;
    }
    this.hud.refresh();
    // pop text
    const t = this.add.bitmapText(k.x, k.y - 6, 'font', '+1').setOrigin(0.5).setDepth(50).setTint(0x8a5a2b);
    this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 450, onComplete: () => t.destroy() });
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
    const dt = Math.min(delta, 50) / 1000;
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
        `x ${Math.round(b.x)} y ${Math.round(b.y)}  tile ${Math.floor((b.x + b.halfWidth) / TILE)},${Math.floor((b.y + b.height - 1 - this.mapOffsetY) / TILE)}`,
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
  backgroundColor: '#e6d8bf',
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
