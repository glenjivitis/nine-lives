// game.js — Nine Lives
// Phase 3: title, character select (Scottie + Delia), pause, cat passives
// (Shadow + double jump, Float + ghost mice) on top of the complete level
// 1-1 from phase 2. All feel tunables live under PHYS.

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
  floatMaxFall: 130,
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
  shadowDelay: 0.5,

  maxFall: 450,
  airControl: 1.0,
  climbSpeed: 60,
  roombaSpeed: 40,
  itemSpeed: 45,
};

const HITBOX = { w: 20, h: 18 };

const NO_INPUT = Object.freeze({ left: false, right: false, up: false, down: false, jump: false, jumpPressed: false, run: false, actionPressed: false });

// Persistent run state
const GameState = {
  cat: 'scottie',
  lives: 9,
  kibble: 0,
  level: '1-1',
  checkpoint: null,   // { level, x, y }
  super: false,
  mice: {},           // level id -> [collected indices]
};

function resetRun(catKey) {
  GameState.cat = catKey;
  GameState.lives = 9;
  GameState.kibble = 0;
  GameState.level = Levels.all()[0];
  GameState.checkpoint = null;
  GameState.super = false;
  GameState.mice = {};
}

function approach(value, target, step) {
  if (value < target) return Math.min(value + step, target);
  if (value > target) return Math.max(value - step, target);
  return value;
}

// ---------------------------------------------------------------------------
// Procedural SFX (spec §9): tiny oscillator/noise voices, no audio files.
// ---------------------------------------------------------------------------
const Sfx = (() => {
  let ctx = null;
  let muted = false;
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(o) {
    const c = ac(); if (!c || muted) return;
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 !== undefined ? o.f1 : o.f0), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol || 0.15, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }
  function noise(dur, vol, f = 800) {
    const c = ac(); if (!c || muted) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(flt).connect(g).connect(c.destination);
    src.start();
  }
  return {
    unlock() { ac(); },
    setMuted(m) { muted = m; },
    jump()   { tone({ f0: 320, f1: 640, dur: 0.12, vol: 0.10 }); },
    land()   { noise(0.06, 0.12, 500); },
    kibble() { tone({ f0: 1100, f1: 1500, dur: 0.06, vol: 0.06 }); },
    purr()   { for (let i = 0; i < 6; i++) tone({ type: 'sawtooth', f0: 70, f1: 60, dur: 0.12, vol: 0.12, delay: i * 0.13 }); },
    stomp()  { tone({ f0: 420, f1: 110, dur: 0.16, vol: 0.14 }); noise(0.05, 0.08, 1200); },
    bonk()   { tone({ f0: 220, f1: 160, dur: 0.09, vol: 0.12 }); },
    powerup(){ [440, 554, 659, 880].forEach((f, i) => tone({ f0: f, dur: 0.12, vol: 0.09, delay: i * 0.07 })); },
    hurt()   { tone({ type: 'sawtooth', f0: 520, f1: 140, dur: 0.32, vol: 0.14 }); },
    yelp()   { tone({ f0: 700, f1: 1300, dur: 0.10, vol: 0.10 }); tone({ f0: 900, f1: 500, dur: 0.14, vol: 0.08, delay: 0.1 }); },
    die()    { [520, 440, 360, 280, 200].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.9, dur: 0.16, vol: 0.12, delay: i * 0.15 })); },
    checkpoint() { [660, 880].forEach((f, i) => tone({ f0: f, dur: 0.1, vol: 0.08, delay: i * 0.09 })); },
    door()   { noise(0.4, 0.06, 300); [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.25, vol: 0.10, delay: 0.3 + i * 0.12 })); },
    life()   { this.purr(); },
    mouse()  { [1200, 1600, 2000].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.08, vol: 0.06, delay: i * 0.06 })); },
    meow()   { tone({ type: 'square', f0: 620, f1: 880, dur: 0.14, vol: 0.10 }); tone({ type: 'square', f0: 880, f1: 480, dur: 0.22, vol: 0.10, delay: 0.14 }); },
    chime()  { [784, 988, 1175, 1568].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.08, delay: i * 0.1 })); },
    select() { tone({ f0: 500, f1: 700, dur: 0.05, vol: 0.06 }); },
    pause()  { tone({ f0: 600, f1: 300, dur: 0.12, vol: 0.08 }); },
  };
})();

// ---------------------------------------------------------------------------
// Cat definitions (spec §1). Passives: shadow, double, float, ghost.
// ---------------------------------------------------------------------------
const CATS = {
  scottie: { name: 'SCOTTIE', texture: 'scottie', passives: ['shadow', 'double'], sound: 'meow', blurb: 'SHADOW: STAND STILL TO VANISH' },
  delia:   { name: 'DELIA', texture: 'delia', passives: ['float', 'ghost'], sound: 'chime', blurb: 'FLOAT: HOLD JUMP. SEES GHOST MICE' },
};
const CAT_ORDER = ['scottie', 'delia'];

function registerAnims(scene) {
  for (const key of Object.keys(CATS)) {
    const cat = CATS[key];
    const F = Sprites.FRAMES[cat.texture];
    const A = (name, from, to, fps, repeat) => Sprites.addAnim(scene, cat.texture + '-' + name, cat.texture, F[from], F[to], fps, repeat);
    A('idle', 'idle0', 'idle3', 4, -1);
    A('walk', 'walk0', 'walk5', 10, -1);
    A('run', 'run0', 'run5', 14, -1);
    A('land', 'land0', 'land1', 12, 0);
    A('sit', 'sit0', 'sit1', 2, -1);
    Sprites.addAnim(scene, cat.texture + '-tail-sway', cat.texture + '-tail', 0, 2, 5, -1);
  }
  Sprites.addAnim(scene, 'dust-puff', 'dust', 0, 3, 16, 0);
  Sprites.addAnim(scene, 'kibble-glint', 'kibble', 0, 1, 2, -1);
  Sprites.addAnim(scene, 'roomba-idle', 'roomba', 0, 1, 3, -1);
  Sprites.addAnim(scene, 'roomba-hurt', 'roomba', 2, 3, 12, -1);
  Sprites.addAnim(scene, 'ghost-mouse-idle', 'ghost-mouse', 0, 1, 4, -1);
  const G = Sprites.FRAMES.glen;
  for (const who of ['glen', 'em']) {
    Sprites.addAnim(scene, who + '-wave', who, G.wave0, G.wave1, 2, -1);
    Sprites.addAnim(scene, who + '-pet', who, G.pet0, G.pet2, 4, -1);
    Sprites.addAnim(scene, who + '-hug', who, G.hug0, G.hug1, 2, -1);
  }
}

/** Decorative cat (title / select / pause): body + tail overlay, no physics. */
function makeCatActor(scene, catKey, x, y, depth = 10) {
  const cat = CATS[catKey];
  const tail = scene.add.sprite(x, y, cat.texture + '-tail').setOrigin(0.5, 1).setDepth(depth);
  const body = scene.add.sprite(x, y, cat.texture).setOrigin(0.5, 1).setDepth(depth + 1);
  tail.play(cat.texture + '-tail-sway');
  return {
    body, tail, cat,
    setPos(nx, ny) { body.x = nx; tail.x = nx; body.y = ny; tail.y = ny; },
    setFlip(f) { body.setFlipX(f); tail.setFlipX(f); },
    play(name) { body.play(cat.texture + '-' + name); },
    sit() { body.play(cat.texture + '-sit'); tail.setVisible(false); },
    destroy() { body.destroy(); tail.destroy(); },
  };
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

    this.tail = scene.add.sprite(x, groundY, this.cat.texture + '-tail').setOrigin(0.5, 1).setDepth(10);
    this.sprite = scene.add.sprite(x, groundY, this.cat.texture).setOrigin(0.5, 1).setDepth(11);
    this.glint = scene.add.image(x, groundY, 'glint').setDepth(12).setVisible(false);
    this.tail.play(this.cat.texture + '-tail-sway');

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
    this.jumpHeld = false;

    this.super = false;
    this.baseScale = 1;
    this.invuln = 0;
    this.hurtTimer = 0;
    this.dead = false;
    this.climbing = false;
    this.autoInput = null;
    this.speedScale = 1;
    this.locked = false;
    this.visualDx = 0;
    this.forceAnim = null;

    // passives
    this.doubleUsed = false;
    this.floating = false;
    this.stillTime = 0;
    this.shadow = false;
    this.setSuper(GameState.super, true);
  }

  has(passive) { return this.cat.passives.includes(passive); }

  respawn() {
    this.body.reset(this.spawn.x, this.spawn.y);
    this.coyote = this.buffer = this.dashTime = this.dashCooldown = 0;
    this.jumping = this.jumpCut = false;
    this.wasGrounded = true;
    this.lastVy = 0;
    this.facing = 1;
  }

  setSuper(on, silent = false) {
    this.super = on;
    GameState.super = on;
    this.baseScale = on ? 1.25 : 1;
    this.sprite.setScale(this.baseScale);
    this.tail.setScale(this.baseScale);
    if (!silent) this.squash(this.baseScale * 0.8, this.baseScale * 1.2, 220);
    this.scene.hud && this.scene.hud.refresh();
  }

  knockback(fromX) {
    const dir = (this.body.x + this.body.halfWidth) < fromX ? -1 : 1;
    this.body.setVelocity(dir * PHYS.knockback, -160);
    this.hurtTimer = 0.35;
    this.dashTime = 0;
    this.stopClimb();
  }

  launch(dir) {
    this.body.setVelocity(dir * 150, -210);
    this.hurtTimer = 0.45;
    this.dashTime = 0;
    this.stopClimb();
  }

  startClimb() {
    this.climbing = true;
    this.body.setAllowGravity(false);
    this.body.setVelocity(0, 0);
    this.jumping = false;
    this.dashTime = 0;
    this.doubleUsed = false;
  }

  stopClimb() {
    if (!this.climbing) return;
    this.climbing = false;
    this.body.setAllowGravity(true);
  }

  update(rawInp, dt) {
    if (this.dead) return;
    let inp = rawInp;
    if (this.autoInput) inp = this.autoInput(rawInp, dt);
    if (this.hurtTimer > 0) { this.hurtTimer -= dt; inp = NO_INPUT; }
    this.jumpHeld = inp.jump;

    const b = this.body;
    const cx = b.x + b.halfWidth, cy = b.y + b.halfHeight;
    const grounded = b.blocked.down;
    const justLanded = grounded && !this.wasGrounded;
    this.wasGrounded = grounded;

    // --- timers -----------------------------------------------------------
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.jumpFlash = Math.max(0, this.jumpFlash - dt);
    this.coyote = grounded ? PHYS.coyoteTime : Math.max(0, this.coyote - dt);
    this.buffer = inp.jumpPressed ? PHYS.jumpBuffer : Math.max(0, this.buffer - dt);

    if (justLanded && this.lastVy > 50) this.onLand(this.lastVy);
    if (grounded) { this.jumping = false; this.jumpCut = false; this.doubleUsed = false; }

    // --- curtain climbing ---------------------------------------------------
    const onCurtain = this.scene.curtainAt(cx, cy) || this.scene.curtainAt(cx, b.y + 2);
    if (!this.climbing && onCurtain && this.hurtTimer <= 0 && (inp.up || (inp.down && !grounded))) this.startClimb();
    if (this.climbing) {
      if (!onCurtain || (grounded && inp.down)) {
        this.stopClimb();
      } else if (inp.jumpPressed) {
        this.stopClimb();
        b.setVelocityY(PHYS.jumpVel * 0.85);
        this.jumping = true; this.jumpCut = false;
        this.buffer = 0;
        this.onJump();
      } else {
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (dir) this.facing = dir;
        const vy = (inp.up ? -PHYS.climbSpeed : 0) + (inp.down ? PHYS.climbSpeed : 0);
        b.setVelocity(dir * 40, vy);
        this.state = 'climb';
        this.grounded = false;
        this.setShadow(false);
        this.animate('climb', vy, dt);
        this.placeVisuals();
        return;
      }
    }

    // --- facing / crouch / dash --------------------------------------------
    const crouching = grounded && inp.down && this.dashTime <= 0;
    const dir = crouching ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir !== 0 && this.dashTime <= 0 && dir !== this.facing) {
      if (grounded && Math.abs(b.velocity.x) > 60) this.scene.dust(cx, b.y + b.height, -dir);
      this.facing = dir;
    }

    if (inp.actionPressed && this.dashCooldown <= 0 && this.dashTime <= 0 && !this.locked) {
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
      const max = (inp.run ? PHYS.runMax : PHYS.walkMax) * this.speedScale;
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
    } else if (inp.jumpPressed && !grounded && this.has('double') && !this.doubleUsed && this.hurtTimer <= 0) {
      // Scottie's double jump
      this.jumpSource = 'DOUBLE';
      this.jumpFlash = 0.8;
      vy = PHYS.doubleJumpVel;
      this.buffer = 0;
      this.doubleUsed = true;
      this.jumping = true;
      this.jumpCut = false;
      this.onJump();
      this.scene.dust(cx - 4, b.y + b.height, -1);
      this.scene.dust(cx + 4, b.y + b.height, 1);
    }
    if (this.jumping && !this.jumpCut && !inp.jump && vy < 0) {
      vy *= PHYS.jumpCutMul;
      this.jumpCut = true;
    }

    // Delia's float: hold jump while falling for 40% gravity
    const wantFloat = this.has('float') && !grounded && vy > 0 && inp.jump && this.hurtTimer <= 0;
    if (wantFloat !== this.floating) {
      this.floating = wantFloat;
      b.setGravityY(wantFloat ? -PHYS.gravity * (1 - PHYS.floatGravity) : 0);
    }
    if (this.floating) vy = Math.min(vy, PHYS.floatMaxFall);

    b.setVelocity(vx, vy);
    this.lastVy = vy;
    this.lastVx = vx;

    // Scottie's shadow: motionless on the ground for 0.5s -> enemies ignore her
    const still = grounded && dir === 0 && Math.abs(vx) < 1 && this.dashTime <= 0 && this.hurtTimer <= 0;
    this.stillTime = still ? this.stillTime + dt : 0;
    this.setShadow(this.has('shadow') && this.stillTime >= PHYS.shadowDelay);

    // --- animation state -------------------------------------------------------
    let state;
    if (this.hurtTimer > 0)                     state = 'hurt';
    else if (this.dashTime > 0)                 state = 'dash';
    else if (this.jumping && vy < 0)            state = 'jump';
    else if (!grounded)                         state = this.floating ? 'float' : (vy < 0 ? 'jump' : 'fall');
    else if (this.landTimer > 0)                state = 'land';
    else if (crouching)                         state = 'crouch';
    else if (Math.abs(vx) > PHYS.runMax * PHYS.runAnimThreshold) state = 'run';
    else if (Math.abs(vx) > 2)                  state = 'walk';
    else                                        state = this.idleTime > 6 ? 'sit-loaf' : 'idle';
    this.idleTime = (state === 'idle' || state === 'sit-loaf') ? this.idleTime + dt : 0;
    this.state = state;
    this.grounded = grounded;

    this.animate(state, vy, dt);
    this.placeVisuals();
  }

  setShadow(on) {
    if (on === this.shadow) return;
    this.shadow = on;
    this.glint.setVisible(on);
    if (!on && this.invuln <= 0) { this.sprite.setAlpha(1); this.tail.setAlpha(1); }
  }

  placeVisuals() {
    const b = this.body;
    const px = b.x + b.halfWidth + this.visualDx, py = b.y + b.height;
    this.sprite.x = px; this.sprite.y = py;
    this.tail.x = px; this.tail.y = py;
    const flip = this.facing < 0;
    this.sprite.setFlipX(flip);
    this.tail.setFlipX(flip);

    // alpha: invulnerability blink beats shadow
    if (this.invuln > 0) {
      this.invuln -= this.scene.dt;
      const on = Math.floor(this.invuln * 16) % 2 === 0;
      this.sprite.setAlpha(on ? 1 : 0.35); this.tail.setAlpha(on ? 1 : 0.35);
      if (this.invuln <= 0) { this.sprite.setAlpha(1); this.tail.setAlpha(1); }
    } else if (this.shadow) {
      this.sprite.setAlpha(0.5); this.tail.setAlpha(0.5);
    }
    if (this.shadow) {
      const s = this.baseScale;
      this.glint.x = px + this.facing * 8 * s;
      this.glint.y = py - 18 * s;
      this.glint.setVisible(Math.floor(this.scene.time.now / 400) % 3 !== 2);
    }
  }

  animate(state, vy, dt) {
    const F = this.F, t = this.cat.texture;
    const play = key => { if (this.currentAnim !== key) { this.sprite.play(key); this.currentAnim = key; } };
    const frame = (name) => { if (this.currentAnim !== 'f:' + name) { this.sprite.anims.stop(); this.sprite.setFrame(F[name]); this.currentAnim = 'f:' + name; } };

    if (this.forceAnim) state = this.forceAnim;
    switch (state) {
      case 'idle':
        this.blinkTimer -= dt;
        if (this.blinkHold > 0) {
          this.blinkHold -= dt;
          frame('blink');
          if (this.blinkHold <= 0) this.currentAnim = null;
        } else {
          play(t + '-idle');
          if (this.blinkTimer <= 0) { this.blinkTimer = 3 + Math.random(); this.blinkHold = 0.12; }
        }
        break;
      case 'sit-loaf': play(t + '-sit'); break;
      case 'walk': play(t + '-walk'); break;
      case 'run': play(t + '-run'); break;
      case 'dash': frame('jump0'); break;
      case 'jump': frame(vy < -150 ? 'jump0' : 'jump1'); break;
      case 'fall': frame(vy < 250 ? 'fall0' : 'fall1'); break;
      case 'float': frame('fall0'); break;
      case 'land': play(t + '-land'); break;
      case 'crouch': frame('crouch'); break;
      case 'hurt': frame('hurt'); break;
      case 'climb':
        if (vy !== 0) play(t + '-walk'); else frame('fall0');
        break;
    }

    const airborne = state === 'jump' || state === 'fall' || state === 'float' || state === 'dash' || state === 'hurt' || state === 'climb';
    const tailKey = t + '-tail', tailAirKey = t + '-tail-air';
    if (state === 'sit-loaf') {
      this.tail.setVisible(false);
    } else {
      this.tail.setVisible(true);
      if (airborne) {
        if (this.tail.texture.key !== tailAirKey) { this.tail.anims.stop(); this.tail.setTexture(tailAirKey, 0); }
      } else if (this.tail.texture.key !== tailKey) {
        this.tail.setTexture(tailKey, 0);
        this.tail.play(tailKey + '-sway');
      }
    }
  }

  onJump() {
    this.squash(this.baseScale * 0.85, this.baseScale * 1.15, 140);
    Sfx.jump();
  }

  onLand(impact) {
    this.landTimer = 2 / 12;
    this.squash(this.baseScale * 1.15, this.baseScale * 0.85, 170);
    Sfx.land();
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
    this.scene.tweens.add({ targets, scaleX: this.baseScale, scaleY: this.baseScale, duration: ms, ease: 'Quad.easeOut' });
  }
}

// ---------------------------------------------------------------------------
// Enemies & items
// ---------------------------------------------------------------------------
class Roomba extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'roomba', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(9);
    this.body.setSize(14, 8).setOffset(1, 8);
    this.dir = -1;
    this.alive = true;
    this.kind = 'roomba';
    this.play('roomba-idle');
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    if (!this.alive) return;
    const cam = this.scene.cameras.main;
    if (Math.abs(this.x - cam.midPoint.x) > W * 0.75) { this.body.setVelocityX(0); return; }
    if (this.body.blocked.left) this.dir = 1;
    else if (this.body.blocked.right) this.dir = -1;
    else if (this.body.blocked.down && !this.scene.solidAt(this.x + this.dir * 9, this.body.bottom + 2)) this.dir = -this.dir;
    this.body.setVelocityX(this.dir * PHYS.roombaSpeed);
    this.setFlipX(this.dir > 0);
  }

  stomp() {
    this.alive = false;
    this.play('roomba-hurt');
    this.body.enable = false;
    const scene = this.scene;
    scene.tweens.add({
      targets: this, y: this.y - 18, duration: 180, ease: 'Quad.easeOut',
      onComplete: () => scene.tweens.add({ targets: this, y: this.y + 220, duration: 800, ease: 'Quad.easeIn', onComplete: () => this.destroy() }),
    });
  }
}

class Item extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, kind, dir) {
    super(scene, x, y, kind);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.kind = kind;
    this.setDepth(8);
    this.dir = dir;
    this.body.setAllowGravity(false);
    this.body.enable = false;
    this.rising = true;
    scene.tweens.add({
      targets: this, y: y - 16, duration: 450, ease: 'Sine.easeOut',
      onComplete: () => {
        this.rising = false;
        this.body.enable = true;
        this.body.setAllowGravity(true);
        this.body.setVelocityX(this.dir * PHYS.itemSpeed);
      },
    });
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    if (this.rising || !this.body.enable) return;
    if (this.body.blocked.left) this.dir = 1;
    else if (this.body.blocked.right) this.dir = -1;
    this.body.setVelocityX(this.dir * PHYS.itemSpeed);
    if (this.y > this.scene.worldH + 32) this.destroy();
  }
}

// ---------------------------------------------------------------------------
// HUD (spec §8)
// ---------------------------------------------------------------------------
class Hud {
  constructor(scene, showMice) {
    this.scene = scene;
    const d = 1000;
    this.lifeIcon = scene.add.image(4, 4, 'icon-life').setOrigin(0).setScrollFactor(0).setDepth(d);
    this.lifeText = this.text(14, 4);
    this.kibbleIcon = scene.add.image(36, 5, 'kibble').setOrigin(0).setScrollFactor(0).setDepth(d);
    this.kibbleText = this.text(44, 4);
    this.slot = scene.add.rectangle(74, 3, 14, 12).setOrigin(0).setStrokeStyle(1, 0x3a2a1a, 0.6).setScrollFactor(0).setDepth(d);
    this.slotIcon = scene.add.image(81, 9, 'tuna').setScrollFactor(0).setDepth(d + 1).setVisible(false);
    if (showMice) {
      this.miceIcon = scene.add.image(W - 40, 4, 'icon-mouse').setOrigin(0).setScrollFactor(0).setDepth(d);
      this.miceText = this.text(W - 30, 4);
    }
    this.refresh();
  }

  text(x, y) {
    const shadow = this.scene.add.bitmapText(x + 1, y + 1, 'font', '').setScrollFactor(0).setDepth(999).setTint(0x2a1a10);
    const main = this.scene.add.bitmapText(x, y, 'font', '').setScrollFactor(0).setDepth(1000).setTint(0xfff4dc);
    return { set(s) { shadow.setText(s); main.setText(s); }, main, shadow };
  }

  refresh() {
    this.lifeText.set('x' + GameState.lives);
    this.kibbleText.set(String(GameState.kibble).padStart(3, '0'));
    this.slotIcon.setVisible(!!GameState.super);
    if (this.miceText) {
      const got = (GameState.mice[this.scene.level.id] || []).length;
      this.miceText.set(got + '/' + this.scene.miceTotal);
    }
  }
}

// ---------------------------------------------------------------------------
// Touch controls (spec §0): left, right, jump, action (+ pause corner).
// ---------------------------------------------------------------------------
class TouchControls {
  constructor(scene) {
    this.scene = scene;
    this.state = { left: false, right: false, jump: false, action: false, jumpPressed: false, actionPressed: false };
    this.objects = [];
    scene.input.addPointer(3);
    const mk = (x, y, w, h, label, key) => {
      const r = scene.add.rectangle(x, y, w, h, 0x000000, 0.16).setOrigin(0).setScrollFactor(0).setDepth(2000).setInteractive();
      const t = scene.add.bitmapText(x + w / 2, y + h / 2, 'font', label).setOrigin(0.5).setScrollFactor(0).setDepth(2001).setAlpha(0.6).setTint(0x000000);
      const down = () => {
        if (!this.state[key]) {
          this.state[key] = true;
          if (key === 'jump') this.state.jumpPressed = true;
          if (key === 'action') this.state.actionPressed = true;
        }
        r.setFillStyle(0x000000, 0.34);
      };
      const up = () => { this.state[key] = false; r.setFillStyle(0x000000, 0.16); };
      r.on('pointerdown', down);
      r.on('pointerover', p => { if (p.isDown) down(); });
      r.on('pointerup', up);
      r.on('pointerout', up);
      this.objects.push(r, t);
    };
    mk(6, 120, 44, 54, '<', 'left');
    mk(54, 120, 44, 54, '>', 'right');
    mk(222, 120, 44, 54, 'B', 'action');
    mk(270, 120, 44, 54, 'A', 'jump');
    // pause corner
    const pr = scene.add.rectangle(W - 18, 2, 16, 14, 0x000000, 0.16).setOrigin(0).setScrollFactor(0).setDepth(2000).setInteractive();
    const pt = scene.add.bitmapText(W - 10, 9, 'font', 'II').setOrigin(0.5).setScrollFactor(0).setDepth(2001).setAlpha(0.7).setTint(0x000000);
    pr.on('pointerdown', () => scene.togglePause());
    this.objects.push(pr, pt);
  }
  consume() {
    const s = { ...this.state };
    this.state.jumpPressed = false;
    this.state.actionPressed = false;
    return s;
  }
  setVisible(v) { for (const o of this.objects) o.setVisible(v); }
}

// ---------------------------------------------------------------------------
// Boot: build every texture once, then go to the title.
// ---------------------------------------------------------------------------
class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }
  create() {
    Sprites.setTextureManager(this.textures);
    Sprites.buildAll();
    Sprites.installFont(this);
    // small extras
    Sprites.makeSprite('glint', [['00', '00']], ['#ffe66a']);
    Sprites.makeSprite('star', [
      ['..0..', '..0..', '00100', '..0..', '..0..'],
      ['.....', '..0..', '.010.', '..0..', '.....'],
      ['..0..', '.....', '0.1.0', '.....', '..0..'],
    ], ['#fff4dc', '#ffffff']);
    Sprites.makeSprite('paw-cursor', [[
      '..00..00..',
      '.0110.0110',
      '.0110.0110',
      '00..0000..',
      '0110.00...',
      '0110.0110.',
      '.00.011110',
      '....011110',
      '....011110',
      '.....0000.',
    ]], ['#3a2a1a', '#f2c94c']);
    registerAnims(this);
    Sprites.addAnim(this, 'star-twinkle', 'star', 0, 2, 4, -1);
    this.scene.start('title');
  }
}

// ---------------------------------------------------------------------------
// Title (spec §8): chunky title, cats walking across the bottom, press any key.
// ---------------------------------------------------------------------------
class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }
  create() {
    this.cameras.main.setBackgroundColor('#e6d8bf');
    const g = this.add.graphics();
    g.fillStyle(0xd9c7a6, 1);
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 8, H);
    g.fillStyle(0xb89a70, 1); g.fillRect(0, 150, W, 6);
    g.fillStyle(0x8c6d48, 1); g.fillRect(0, 155, W, 1);
    this.add.tileSprite(0, 156, W, 24, 'tiles', Sprites.TILE.FLOOR_TOP).setOrigin(0);

    const title = 'NINE LIVES';
    this.add.bitmapText(W / 2 + 3, 46 + 3, 'font', title).setOrigin(0.5).setScale(3).setTint(0x3a2414);
    this.add.bitmapText(W / 2, 46, 'font', title).setOrigin(0.5).setScale(3).setTint(0xf2c94c);
    this.add.bitmapText(W / 2, 74, 'font', 'A CAT PLATFORMER').setOrigin(0.5).setTint(0x6b4a2a);
    const isTouch = this.sys.game.device.input.touch;
    this.prompt = this.add.bitmapText(W / 2, 112, 'font', isTouch ? 'TAP TO START' : 'PRESS ANY KEY').setOrigin(0.5).setTint(0x3a2414);

    // cats parade across the bottom
    this.cats = [];
    CAT_ORDER.forEach((key, i) => {
      const a = makeCatActor(this, key, 60 + i * 90, 156);
      a.play('walk');
      a.speed = 38 + i * 6;
      this.cats.push(a);
    });

    const go = () => {
      if (this.started) return;
      this.started = true;
      Sfx.unlock();
      Sfx.select();
      this.cameras.main.fadeOut(250, 230, 216, 191);
      this.time.delayedCall(260, () => this.scene.start('select'));
    };
    this.input.keyboard.once('keydown', go);
    this.input.once('pointerdown', go);
  }
  update(time, delta) {
    this.prompt.setVisible(Math.floor(time / 500) % 2 === 0);
    for (const a of this.cats) {
      const x = a.body.x + a.speed * delta / 1000;
      a.setPos(x > W + 20 ? -20 : x, 156);
    }
  }
}

// ---------------------------------------------------------------------------
// Character select (spec §1): portraits on a windowsill, sparkle on Delia.
// ---------------------------------------------------------------------------
class SelectScene extends Phaser.Scene {
  constructor() { super('select'); }
  create() {
    this.cameras.main.setBackgroundColor('#e6d8bf');
    this.cameras.main.fadeIn(250, 230, 216, 191);
    const g = this.add.graphics();
    g.fillStyle(0xd9c7a6, 1);
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 8, H);
    // window
    g.fillStyle(0xf4f1e8, 1); g.fillRect(24, 12, W - 48, 108);
    g.fillStyle(0x9fc8e8, 1); g.fillRect(28, 16, W - 56, 100);
    g.fillStyle(0xbfe0f4, 1); g.fillRect(28, 16, W - 56, 30);
    g.fillStyle(0x6b8f4a, 1); g.fillCircle(70, 70, 22); g.fillCircle(50, 84, 16); g.fillCircle(255, 62, 20); g.fillCircle(280, 80, 14);
    g.fillStyle(0x6b4a2a, 1); g.fillRect(66, 84, 6, 32); g.fillRect(252, 78, 5, 38);
    g.fillStyle(0xf4f1e8, 1); g.fillRect(W / 2 - 2, 16, 4, 100); g.fillRect(28, 64, W - 56, 4);
    // sill
    g.fillStyle(0xb8844d, 1); g.fillRect(16, 118, W - 32, 10);
    g.fillStyle(0xd9a765, 1); g.fillRect(16, 118, W - 32, 2);
    g.fillStyle(0x4a2f1a, 1); g.fillRect(16, 127, W - 32, 2);

    this.add.bitmapText(W / 2, 6, 'font', 'CHOOSE YOUR CAT').setOrigin(0.5, 0).setTint(0x3a2414);

    this.keys = CAT_ORDER;
    const n = this.keys.length;
    const spacing = 64;
    const x0 = W / 2 - (n - 1) * spacing / 2;
    this.slots = this.keys.map((key, i) => {
      const x = x0 + i * spacing, y = 118;
      const img = this.add.image(x, y, key + '-portrait').setOrigin(0.5, 1).setInteractive();
      const name = this.add.bitmapText(x, y + 13, 'font', CATS[key].name).setOrigin(0.5, 0).setTint(0x3a2414);
      img.on('pointerdown', () => { if (this.index === i) this.choose(); else { this.index = i; Sfx.select(); } });
      return { key, x, y, img, name };
    });
    this.cursor = this.add.rectangle(0, 0, 52, 52).setStrokeStyle(2, 0xf2c94c, 1).setOrigin(0.5, 1);
    this.paw = this.add.image(0, 0, 'paw-cursor').setOrigin(0.5, 1);
    this.blurb = this.add.bitmapText(W / 2, 144, 'font', '').setOrigin(0.5, 0).setTint(0x6b4a2a);
    this.hint = this.add.bitmapText(W / 2, 166, 'font', this.sys.game.device.input.touch ? 'TAP A CAT TWICE' : 'ARROWS  +  SPACE').setOrigin(0.5, 0).setTint(0x8c6d48);

    // Delia's slow 3-star sparkle
    const delia = this.slots.find(s => s.key === 'delia');
    this.stars = [];
    if (delia) {
      for (let i = 0; i < 3; i++) {
        const s = this.add.sprite(delia.x, delia.y - 24, 'star').setDepth(5);
        s.play({ key: 'star-twinkle', delay: i * 250 });
        this.stars.push(s);
      }
    }

    this.index = Math.max(0, this.keys.indexOf(GameState.cat));
    this.chosen = false;
    const kb = this.input.keyboard;
    this.kLeft = kb.addKey('LEFT'); this.kRight = kb.addKey('RIGHT');
    this.kA = kb.addKey('A'); this.kD = kb.addKey('D');
    this.kSpace = kb.addKey('SPACE'); this.kEnter = kb.addKey('ENTER');
    this.t = 0;
  }

  choose() {
    if (this.chosen) return;
    this.chosen = true;
    const key = this.keys[this.index];
    Sfx.unlock();
    if (CATS[key].sound === 'chime') Sfx.chime(); else Sfx.meow();
    const slot = this.slots[this.index];
    this.tweens.add({ targets: slot.img, scaleX: 1.15, scaleY: 1.15, duration: 120, yoyo: true, repeat: 2 });
    resetRun(key);
    this.time.delayedCall(900, () => {
      this.cameras.main.fadeOut(250, 0, 0, 0);
      this.time.delayedCall(260, () => this.scene.start('play'));
    });
  }

  update(time, delta) {
    const JD = Phaser.Input.Keyboard.JustDown;
    if (!this.chosen) {
      if (JD(this.kLeft) || JD(this.kA)) { this.index = (this.index + this.keys.length - 1) % this.keys.length; Sfx.select(); }
      if (JD(this.kRight) || JD(this.kD)) { this.index = (this.index + 1) % this.keys.length; Sfx.select(); }
      if (JD(this.kSpace) || JD(this.kEnter)) this.choose();
    }
    const slot = this.slots[this.index];
    this.cursor.x = slot.x; this.cursor.y = slot.y + 2;
    this.paw.x = slot.x; this.paw.y = slot.y - 52 - Math.abs(Math.sin(time / 300)) * 3;
    this.blurb.setText(CATS[slot.key].blurb);
    this.t += delta / 1000;
    this.stars.forEach((s, i) => {
      const a = this.t * 0.9 + i * Math.PI * 2 / 3;
      const delia = this.slots.find(x => x.key === 'delia');
      s.x = delia.x + Math.cos(a) * 30;
      s.y = delia.y - 24 + Math.sin(a) * 22;
    });
  }
}

// ---------------------------------------------------------------------------
// Pause (spec §8): overlay with the cat's sit-loaf portrait.
// ---------------------------------------------------------------------------
class PauseScene extends Phaser.Scene {
  constructor() { super('pause'); }
  create() {
    this.add.rectangle(0, 0, W, H, 0x1a1410, 0.6).setOrigin(0);
    const panel = this.add.rectangle(W / 2, H / 2, 150, 96, 0x1a1410, 0.9).setStrokeStyle(1, 0xfff4dc, 0.8);
    this.add.bitmapText(W / 2, H / 2 - 40, 'font', 'PAUSED').setOrigin(0.5).setScale(2).setTint(0xf2c94c);
    this.add.image(W / 2 - 40, H / 2 + 8, GameState.cat + '-portrait').setOrigin(0.5);
    const a = makeCatActor(this, GameState.cat, W / 2 + 26, H / 2 + 30);
    a.sit();
    this.add.bitmapText(W / 2 + 26, H / 2 - 16, 'font', CATS[GameState.cat].name).setOrigin(0.5).setTint(0xfff4dc);
    this.add.bitmapText(W / 2, H / 2 + 38, 'font', 'ESC RESUME   T TITLE').setOrigin(0.5).setTint(0xd9c7a6);
    const kb = this.input.keyboard;
    this.kEsc = kb.addKey('ESC'); this.kT = kb.addKey('T'); this.kP = kb.addKey('P');
    this.input.on('pointerdown', () => this.resume());
  }
  resume() {
    this.scene.resume('play');
    this.scene.stop();
  }
  update() {
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(this.kEsc) || JD(this.kP)) this.resume();
    if (JD(this.kT)) { this.scene.stop('play'); this.scene.start('title'); }
  }
}

// ---------------------------------------------------------------------------
// Play scene
// ---------------------------------------------------------------------------
class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  create() {
    // the scene object is reused on restart: clear everything from the last run
    this.cutscene = null;
    this.hud = null;
    this.touch = null;
    this.dt = 0;
    this.muted = this.muted || false;
    this.cameras.main.fadeIn(200, 0, 0, 0);

    // --- level ---------------------------------------------------------------
    const T = Sprites.TILE;
    this.T = T;
    const level = Levels.parse(Levels.get(GameState.level), T);
    this.level = level;
    const mapW = level.width * TILE;
    const mapH = level.height * TILE;
    const worldH = Math.max(H, mapH);
    this.worldW = mapW;
    this.worldH = worldH;
    this.mapOffsetY = worldH - mapH;

    this.physics.world.setBounds(0, 0, mapW, worldH);
    this.physics.world.setBoundsCollision(true, true, true, false);
    this.physics.world.TILE_BIAS = 12;
    this.cameras.main.setBounds(0, 0, mapW, worldH);
    this.cameras.main.setBackgroundColor('#e6d8bf');
    this.drawBackdrop(mapW, worldH);

    const map = this.make.tilemap({ data: level.grid, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    this.map = map;
    this.layer = map.createLayer(0, tileset, 0, this.mapOffsetY).setDepth(5);
    this.layer.setCollision([T.FLOOR_TOP, T.FLOOR_FILL, T.SHELF, T.BRICK, T.PAW, T.PAW_USED]);
    this.layer.forEachTile(tile => {
      if (tile.index === T.SHELF) tile.setCollision(false, false, true, false);
    });
    this.layer.forEachTile(tile => {
      if (tile.index < 0 || !tile.collides || tile.index === T.SHELF) return;
      const above = this.layer.getTileAt(tile.x, tile.y - 1);
      if (above && above.index === T.SHELF) tile.faceTop = true;
    });

    // --- entities ------------------------------------------------------------
    const tx = c => c.x * TILE + TILE / 2;
    const ty = c => this.mapOffsetY + c.y * TILE + TILE / 2;
    const tbottom = c => this.mapOffsetY + (c.y + 1) * TILE;

    if (level.door) {
      const dx = Math.min(tx(level.door), mapW - 16);
      const dy = tbottom(level.door);
      this.doorX = dx; this.doorY = dy;
      this.doorway = this.add.image(dx, dy, 'doorway', 0).setOrigin(0.5, 1).setDepth(3);
      this.glen = this.add.sprite(dx - 7, dy, 'glen').setOrigin(0.5, 1).setDepth(4).play('glen-wave');
      this.em = this.add.sprite(dx + 7, dy, 'em').setOrigin(0.5, 1).setDepth(4).play('em-wave');
      this.doorZone = new Phaser.Geom.Rectangle(dx - 26, dy - 64, 40, 64 + 24);
    }

    this.kibble = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const k of level.kibble) {
      const s = this.kibble.create(tx(k), ty(k), 'kibble').setDepth(8);
      s.body.setSize(8, 8);
      s.play({ key: 'kibble-glint', delay: Math.random() * 1000 });
      this.tweens.add({ targets: s, y: s.y - 2, duration: 600 + Math.random() * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // ghost mice (Delia only)
    const catDef = CATS[GameState.cat];
    this.seesMice = catDef.passives.includes('ghost');
    this.miceTotal = level.ghostMice.length;
    this.mice = this.physics.add.group({ allowGravity: false, immovable: true });
    if (this.seesMice) {
      const got = GameState.mice[level.id] || [];
      level.ghostMice.forEach((m, i) => {
        if (got.includes(i)) return;
        const s = this.mice.create(tx(m), ty(m), 'ghost-mouse').setDepth(8).setAlpha(0.8);
        s.index = i;
        s.play({ key: 'ghost-mouse-idle', delay: i * 150 });
        this.tweens.add({ targets: s, y: s.y - 3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      });
    }

    this.enemies = this.physics.add.group();
    for (const r of level.roombas) this.enemies.add(new Roomba(this, tx(r), tbottom(r)));
    this.physics.add.collider(this.enemies, this.layer);

    this.cucumbers = this.physics.add.group({ allowGravity: false, immovable: true });
    this.cucumberTriggers = level.cucumbers.map(c => ({ x: c.x * TILE, y: tbottom(c), fired: false }));

    this.items = this.physics.add.group();
    this.physics.add.collider(this.items, this.layer);

    this.bowls = level.checkpoints.map(c => {
      const s = this.add.image(tx(c), tbottom(c), 'bowl', 0).setOrigin(0.5, 1).setDepth(7);
      return { sprite: s, x: tx(c), y: tbottom(c), done: false };
    });

    // --- player ----------------------------------------------------------------
    let start = { x: tx(level.start), y: this.mapOffsetY + (level.start.y + 1) * TILE };
    const cp = GameState.checkpoint;
    if (cp && cp.level === level.id) {
      start = { x: cp.x, y: cp.y };
      for (const bw of this.bowls) if (Math.abs(bw.x - cp.x) < 2) { bw.done = true; bw.sprite.setFrame(1); }
    }
    this.player = new Player(this, start.x, start.y, GameState.cat);
    this.physics.add.collider(this.player.box, this.layer);
    this.physics.add.overlap(this.player.box, this.kibble, (box, k) => this.collectKibble(k));
    this.physics.add.overlap(this.player.box, this.mice, (box, m) => this.collectMouse(m));
    this.physics.add.overlap(this.player.box, this.enemies, (box, e) => this.onEnemyContact(e));
    this.physics.add.overlap(this.player.box, this.cucumbers, (box, c) => this.onCucumber(c));
    this.physics.add.overlap(this.player.box, this.items, (box, it) => this.onItem(it));

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
    this.keyMute = kb.addKey('M');
    this.keyPause = kb.addKey('ESC');
    this.keyPause2 = kb.addKey('P');
    kb.on('keydown', () => { Sfx.unlock(); if (this.touch) this.touch.setVisible(false); });
    this.input.on('pointerdown', () => { Sfx.unlock(); });
    if (this.sys.game.device.input.touch) this.touch = new TouchControls(this);

    // --- HUD / debug ---------------------------------------------------------------
    this.hud = new Hud(this, this.seesMice);
    this.debugOn = false;
    this.debugText = this.add.text(2, 20, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setScrollFactor(0).setDepth(1001).setVisible(false);

    // level banner
    const banner = this.add.bitmapText(W / 2, 60, 'font', 'LEVEL ' + level.id).setOrigin(0.5).setScale(2).setScrollFactor(0).setDepth(1500).setTint(0x3a2414);
    this.tweens.add({ targets: banner, alpha: 0, delay: 1200, duration: 400, onComplete: () => banner.destroy() });
  }

  drawBackdrop(mapW, worldH) {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0xd9c7a6, 1);
    for (let x = 0; x < mapW; x += 32) g.fillRect(x, 0, 8, worldH);
    const floorY = this.mapOffsetY + 7 * TILE;
    g.fillStyle(0xb89a70, 1);
    g.fillRect(0, floorY - 6, mapW, 6);
    g.fillStyle(0x8c6d48, 1);
    g.fillRect(0, floorY - 1, mapW, 1);
    for (let x = 96; x < mapW; x += 480) {
      g.fillStyle(0xf4f1e8, 1); g.fillRect(x, 24, 56, 44);
      g.fillStyle(0x9fc8e8, 1); g.fillRect(x + 3, 27, 50, 38);
      g.fillStyle(0x6b8f4a, 1); g.fillCircle(x + 34, 42, 10); g.fillCircle(x + 26, 48, 8);
      g.fillStyle(0x6b4a2a, 1); g.fillRect(x + 32, 50, 3, 15);
      g.fillStyle(0xf4f1e8, 1); g.fillRect(x + 27, 27, 2, 38); g.fillRect(x + 3, 45, 50, 2);
    }
  }

  // --- tile queries -------------------------------------------------------------
  tileAt(wx, wy) { return this.layer.getTileAtWorldXY(wx, wy); }
  solidAt(wx, wy) { const t = this.tileAt(wx, wy); return !!(t && t.collides); }
  curtainAt(wx, wy) { const t = this.tileAt(wx, wy); return !!(t && t.index === this.T.CURTAIN); }

  floorBelow(wx, wy) {
    for (let y = wy; y < this.worldH; y += TILE) {
      const t = this.tileAt(wx, y);
      if (t && t.collides) return this.mapOffsetY + t.y * TILE;
    }
    return this.worldH;
  }

  dust(x, y, dir) {
    const s = this.add.sprite(x, y, 'dust').setOrigin(0.5, 1).setDepth(9).setFlipX(dir < 0);
    s.play('dust-puff');
    s.once('animationcomplete', () => s.destroy());
  }

  popText(x, y, str, tint = 0x8a5a2b) {
    const t = this.add.bitmapText(x, y, 'font', str).setOrigin(0.5).setDepth(50).setTint(tint);
    this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, duration: 500, onComplete: () => t.destroy() });
  }

  // --- pickups / blocks -----------------------------------------------------------
  collectKibble(k) {
    k.disableBody(true, true);
    GameState.kibble += 1;
    Sfx.kibble();
    if (GameState.kibble >= 100) {
      GameState.kibble -= 100;
      GameState.lives += 1;
      Sfx.life();
      this.popText(k.x, k.y - 8, '1UP', 0x2f8f4f);
    }
    this.hud.refresh();
    this.popText(k.x, k.y - 6, '+1');
  }

  collectMouse(m) {
    m.disableBody(true, true);
    const list = GameState.mice[this.level.id] || (GameState.mice[this.level.id] = []);
    if (!list.includes(m.index)) list.push(m.index);
    Sfx.mouse();
    this.hud.refresh();
    this.popText(m.x, m.y - 8, '*', 0xffffff);
  }

  bonkBlock(tile) {
    const T = this.T;
    const wx = tile.x * TILE, wy = this.mapOffsetY + tile.y * TILE;
    const bump = (frameIndex, after) => {
      const img = this.add.image(wx, wy, 'tiles', frameIndex).setOrigin(0).setDepth(6);
      this.tweens.add({ targets: img, y: wy - 5, duration: 70, yoyo: true, ease: 'Quad.easeOut', onComplete: () => { img.destroy(); after && after(); } });
    };
    if (tile.index === T.PAW) {
      Sfx.bonk();
      this.layer.removeTileAt(tile.x, tile.y);
      bump(T.PAW, () => this.layer.putTileAt(T.PAW_USED, tile.x, tile.y));
      const dir = this.player.facing;
      this.items.add(new Item(this, wx + 8, wy + 8, 'tuna', dir));
      this.time.delayedCall(450, () => Sfx.powerup());
    } else if (tile.index === T.BRICK) {
      if (this.player.super) {
        Sfx.stomp();
        this.layer.removeTileAt(tile.x, tile.y);
        for (const [ox, oy, vx, vy] of [[3, 3, -70, -220], [11, 3, 70, -220], [3, 11, -50, -150], [11, 11, 50, -150]]) {
          const bit = this.physics.add.image(wx + ox, wy + oy, 'brick-bit').setDepth(12);
          bit.body.setVelocity(vx, vy);
          this.time.delayedCall(900, () => bit.destroy());
        }
      } else {
        Sfx.bonk();
        this.layer.removeTileAt(tile.x, tile.y);
        bump(T.BRICK, () => this.layer.putTileAt(T.BRICK, tile.x, tile.y));
      }
    }
    const above = this.enemies.getChildren().filter(e => e.alive && Math.abs(e.x - (wx + 8)) < 14 && Math.abs(e.body.bottom - wy) < 3);
    for (const e of above) { e.stomp(); Sfx.stomp(); }
  }

  onItem(it) {
    if (it.rising) return;
    if (it.kind === 'tuna') {
      if (!this.player.super) this.player.setSuper(true);
      else this.popText(it.x, it.y - 8, 'YUM');
      this.hud.refresh();
      Sfx.powerup();
    }
    it.destroy();
  }

  // --- enemies ----------------------------------------------------------------------
  onEnemyContact(e) {
    if (!e.alive || this.player.dead || this.cutscene) return;
    const pb = this.player.body;
    const feet = pb.y + pb.height;
    const stomp = pb.velocity.y > 0 && feet < e.body.y + e.body.height * 0.7;
    if (stomp) {
      e.stomp();
      pb.setVelocityY(this.player.jumpHeld ? PHYS.stompBounceHold : PHYS.stompBounce);
      this.player.jumping = true; this.player.jumpCut = true;
      this.player.squash(this.player.baseScale * 1.2, this.player.baseScale * 0.8, 120);
      Sfx.stomp();
      this.popText(e.x, e.y - 14, 'BONK', 0x3a3a48);
    } else if (this.player.shadow) {
      // Scottie's Shadow: enemies don't see her while she holds still
    } else {
      this.hurt(e.x);
    }
  }

  onCucumber(c) {
    if (c.cooldown > 0 || this.player.dead || this.cutscene) return;
    c.cooldown = 1.0;
    const dir = (this.player.body.x + HITBOX.w / 2) < c.x ? -1 : 1;
    this.player.launch(dir);
    Sfx.yelp();
    this.popText(this.player.box.x, this.player.box.y - 16, '!!', 0xc03030);
  }

  spawnCucumber(trig) {
    const px = this.player.box.x;
    let x = px - 40, y = this.worldH;
    for (const off of [40, 32, 24, 16]) {
      const fx = px - off, fy = this.floorBelow(fx, this.player.box.y);
      if (fy < this.worldH) { x = fx; y = fy; break; }
    }
    if (y >= this.worldH) { x = px - 24; y = trig.y; }
    const c = this.cucumbers.create(x, y, 'cucumber').setOrigin(0.5, 1).setDepth(9);
    c.body.setSize(14, 6).setOffset(1, 10);
    c.cooldown = 0.3;
    c.setScale(0.2);
    this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.easeOut' });
    Sfx.bonk();
  }

  hurt(fromX) {
    const p = this.player;
    if (p.invuln > 0 || p.dead || this.cutscene) return;
    if (p.super) {
      p.setSuper(false);
      p.invuln = 1.0;
      p.knockback(fromX);
      Sfx.hurt();
    } else {
      this.die();
    }
  }

  die() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.stopClimb();
    p.setShadow(false);
    p.body.enable = false;
    p.sprite.anims.stop();
    p.sprite.setFrame(p.F.hurt);
    p.tail.setVisible(false);
    p.sprite.setAlpha(1);
    this.cameras.main.stopFollow();
    Sfx.die();
    const targets = p.sprite;
    this.tweens.add({
      targets, y: p.sprite.y - 40, duration: 260, ease: 'Quad.easeOut',
      onComplete: () => this.tweens.add({ targets, y: p.sprite.y + 260, duration: 900, ease: 'Quad.easeIn' }),
    });
    this.time.delayedCall(1400, () => {
      GameState.lives -= 1;
      GameState.super = false;
      if (GameState.lives <= 0) {
        this.gameOver();
      } else {
        this.scene.restart();
      }
    });
  }

  gameOver() {
    this.add.rectangle(0, 0, W, H, 0x1a1410, 0.8).setOrigin(0).setScrollFactor(0).setDepth(3000);
    this.add.bitmapText(W / 2, H / 2 - 10, 'font', 'OUT OF LIVES').setOrigin(0.5).setScale(2).setScrollFactor(0).setDepth(3001).setTint(0xf2c94c);
    this.add.bitmapText(W / 2, H / 2 + 14, 'font', 'ALL NINE. IMPRESSIVE.').setOrigin(0.5).setScrollFactor(0).setDepth(3001).setTint(0xfff4dc);
    this.time.delayedCall(2500, () => {
      GameState.lives = 9; GameState.kibble = 0; GameState.checkpoint = null;
      this.scene.start('title');
    });
  }

  reachCheckpoint(bw) {
    bw.done = true;
    bw.sprite.setFrame(1);
    GameState.checkpoint = { level: this.level.id, x: bw.x, y: bw.y };
    Sfx.checkpoint();
    this.popText(bw.x, bw.y - 20, 'YUM', 0xc85a5a);
  }

  togglePause() {
    if (this.cutscene || this.player.dead) return;
    Sfx.pause();
    this.scene.pause();
    this.scene.launch('pause');
  }

  // --- door ending (spec §6) ------------------------------------------------------
  startEnding() {
    const p = this.player;
    this.cutscene = { step: 'walk', t: 0 };
    p.locked = true;
    p.speedScale = 0.5;
    p.setShadow(false);
    p.autoInput = () => ({ ...NO_INPUT, right: true, jump: true, jumpPressed: p.grounded && p.body.blocked.right });
    Sfx.door();
    if (this.touch) this.touch.setVisible(false);
  }

  updateEnding(dt) {
    const cs = this.cutscene, p = this.player;
    cs.t += dt;
    switch (cs.step) {
      case 'walk':
        if (p.box.x >= this.doorX - 4 || cs.t > 6) {
          cs.step = 'rub'; cs.t = 0;
          p.autoInput = () => NO_INPUT;
          p.forceAnim = 'walk';
        }
        break;
      case 'rub':
        p.visualDx = Math.sin(cs.t * 6) * 3;
        p.facing = Math.cos(cs.t * 6) >= 0 ? 1 : -1;
        if (cs.t >= 2.0) {
          cs.step = 'pet'; cs.t = 0;
          p.visualDx = 0; p.forceAnim = 'idle'; p.facing = 1;
          this.glen.play('glen-pet'); this.em.play('em-pet');
          Sfx.purr();
        }
        break;
      case 'pet':
        if (cs.t >= 1.8) {
          cs.step = 'hug'; cs.t = 0;
          this.glen.play('glen-hug'); this.em.play('em-hug');
          p.sprite.setDepth(4.5); p.tail.setDepth(4.4);
          p.sprite.y -= 14; p.tail.y -= 14;
          p.autoInput = () => NO_INPUT;
          p.body.enable = false;
        }
        break;
      case 'hug':
        if (cs.t >= 1.2) {
          cs.step = 'close'; cs.t = 0;
          this.doorway.setFrame(1).setDepth(20);
          this.glen.setVisible(false); this.em.setVisible(false);
          p.sprite.setVisible(false); p.tail.setVisible(false);
          Sfx.door();
        }
        break;
      case 'close':
        if (cs.t >= 0.6) {
          cs.step = 'tally'; cs.t = 0;
          this.showTally();
        }
        break;
      case 'tally':
        if (cs.t >= 3.5) {
          cs.step = 'done';
          GameState.checkpoint = null;
          const ids = Levels.all();
          const next = ids[ids.indexOf(this.level.id) + 1];
          if (next) { GameState.level = next; this.scene.restart(); }
          else { this.scene.start('title'); }
        }
        break;
    }
  }

  showTally() {
    const cam = this.cameras.main;
    const lines = [
      'LEVEL ' + this.level.id + ' CLEAR!',
      'KIBBLE ' + String(GameState.kibble).padStart(3, '0'),
      'LIVES x' + GameState.lives,
    ];
    if (this.seesMice) lines.push('GHOST MICE ' + (GameState.mice[this.level.id] || []).length + '/' + this.miceTotal);
    const panel = this.add.rectangle(W / 2, H / 2, 160, 24 + lines.length * 16, 0x1a1410, 0.85).setScrollFactor(0).setDepth(3000);
    panel.setStrokeStyle(1, 0xfff4dc, 0.8);
    lines.forEach((s, i) => {
      this.add.bitmapText(W / 2, H / 2 - (lines.length - 1) * 8 + i * 16, 'font', s).setOrigin(0.5).setScrollFactor(0).setDepth(3001).setTint(i === 0 ? 0xf2c94c : 0xfff4dc);
    });
    cam.flash(300, 255, 244, 220);
  }

  // --- input ---------------------------------------------------------------------------
  readInput() {
    const c = this.cursors, w = this.wasd;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    const t = this.touch ? this.touch.consume() : null;
    return {
      left: c.left.isDown || w.left.isDown || (t && t.left),
      right: c.right.isDown || w.right.isDown || (t && t.right),
      up: c.up.isDown || w.up.isDown,
      down: c.down.isDown || w.down.isDown,
      jump: c.space.isDown || (t && t.jump),
      jumpPressed: JustDown(c.space) || (t && t.jumpPressed),
      run: c.shift.isDown || (t && t.action),
      actionPressed: JustDown(c.shift) || (t && t.actionPressed),
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
    this.dt = dt;
    const inp = this.readInput();
    const JustDown = Phaser.Input.Keyboard.JustDown;

    if (JustDown(this.keyReset) && !this.cutscene) this.player.respawn();
    if (JustDown(this.keyDebugText)) { this.debugOn = !this.debugOn; this.debugText.setVisible(this.debugOn); }
    if (JustDown(this.keyDebugBodies)) this.toggleBodyDebug();
    if (JustDown(this.keyMute)) { this.muted = !this.muted; Sfx.setMuted(this.muted); }
    if (JustDown(this.keyPause) || JustDown(this.keyPause2)) { this.togglePause(); return; }

    const p = this.player;
    const b = p.body;

    if (!p.dead && !this.cutscene && b.blocked.up && p.lastVy < 0) {
      const t = this.tileAt(b.x + b.halfWidth, b.y - 2);
      if (t && (t.index === this.T.PAW || t.index === this.T.BRICK)) this.bonkBlock(t);
    }

    p.update(inp, dt);

    if (this.cutscene) { this.updateEnding(dt); return; }
    if (p.dead) return;

    const cx = b.x + b.halfWidth;
    const feet = b.y + b.height;

    if (b.y > this.worldH + 8) { this.die(); return; }

    for (const x of [b.x + 3, b.x + b.width - 3]) {
      const t = this.tileAt(x, feet - 1);
      if (t && t.index === this.T.TACKS && feet > this.mapOffsetY + t.y * TILE + 8) { this.hurt(cx + (x < cx ? 8 : -8)); break; }
    }

    for (const trig of this.cucumberTriggers) {
      if (!trig.fired && cx > trig.x + 8 && p.grounded) { trig.fired = true; this.spawnCucumber(trig); }
    }
    for (const c of this.cucumbers.getChildren()) if (c.cooldown > 0) c.cooldown -= dt;

    for (const bw of this.bowls) {
      if (!bw.done && Math.abs(cx - bw.x) < 12 && Math.abs(feet - bw.y) < 20) this.reachCheckpoint(bw);
    }

    if (this.doorZone && p.grounded && Phaser.Geom.Rectangle.Contains(this.doorZone, cx, feet - 1)) this.startEnding();

    if (this.debugOn) {
      const ms = s => String(Math.round(s * 1000)).padStart(3) + 'ms';
      this.debugText.setText([
        `${p.state.padEnd(8)} vx ${String(Math.round(b.velocity.x)).padStart(4)}  vy ${String(Math.round(b.velocity.y)).padStart(4)}  ${p.grounded ? 'GROUND' : 'AIR'}${p.super ? ' SUPER' : ''}${p.shadow ? ' SHADOW' : ''}${p.floating ? ' FLOAT' : ''}`,
        `coyote ${ms(p.coyote)}  buffer ${ms(p.buffer)}  dash cd ${p.dashCooldown.toFixed(2)}`,
        `last jump: ${p.jumpFlash > 0 ? '>> ' + p.jumpSource + ' <<' : p.jumpSource}   fps ${Math.round(this.game.loop.actualFps)}`,
        `x ${Math.round(b.x)} y ${Math.round(b.y)}  tile ${Math.floor(cx / TILE)},${Math.floor((feet - 1 - this.mapOffsetY) / TILE)}`,
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
  scene: [BootScene, TitleScene, SelectScene, PlayScene, PauseScene],
});

window.addEventListener('resize', () => {
  const z = computeZoom();
  if (game.scale.zoom !== z) game.scale.setZoom(z);
});
