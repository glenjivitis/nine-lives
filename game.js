// game.js — Nine Lives
// Phase 5: worlds 2-5 (backyard, alley, vet clinic, rooftop cafe), squirrels,
// sprinklers, spray bottles, the dog chase, the vacuum and bath bosses, box /
// laser / yarn powerups, bonus level, finale. All feel tunables live under PHYS.

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
  runMax: 170,             // no sprint; only the threshold for the ears-back animation (catnip, Pickle)
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
  catnipTime: 8,
  catnipSpeed: 1.4,
  catnipJump: 1.2,
  bellRange: 48,
  yowlStun: 1.5,
  yowlCooldown: 8,
  slideBoost: 1.5,
  rollHeight: 10,
  chaseScroll: 56,
  dogSpeed: 66,
  vacuumPull: 90,          // slower than walking so you can back away, faster than standing still
  bathFillTime: 60,
  yarnSpeed: 200,
  laserRange: 160,
};

const HITBOX = { w: 20, h: 18 };

const NO_INPUT = Object.freeze({ left: false, right: false, up: false, down: false, jump: false, jumpPressed: false, action: false, actionPressed: false });

// Persistent run state
const GameState = {
  cat: 'scottie',
  lives: 9,
  kibble: 0,
  level: '1-1',
  checkpoint: null,   // { level, x, y }
  super: false,
  mice: {},           // level id -> [collected indices]
  climbed: false,     // has the player used a curtain yet (drives the hint)
  bell: false,        // bell collar lasts the rest of the level
  afterBonus: null,   // campaign level to resume after the bonus level
};

function resetRun(catKey) {
  GameState.cat = catKey;
  GameState.lives = 9;
  GameState.kibble = 0;
  GameState.level = Levels.all()[0];
  GameState.checkpoint = null;
  GameState.super = false;
  GameState.mice = {};
  GameState.bell = false;
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
    ctx() { return ac(); },
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
    mouse()  { [880, 660, 440].forEach((f, i) => tone({ type: 'sine', f0: f, f1: f * 0.9, dur: 0.18, vol: 0.06, delay: i * 0.12 })); },   // a soft descending snore
    meow()   { tone({ type: 'square', f0: 620, f1: 880, dur: 0.14, vol: 0.10 }); tone({ type: 'square', f0: 880, f1: 480, dur: 0.22, vol: 0.10, delay: 0.14 }); },
    chime()  { [784, 988, 1175, 1568].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.08, delay: i * 0.1 })); },
    select() { tone({ f0: 500, f1: 700, dur: 0.05, vol: 0.06 }); },
    pause()  { tone({ f0: 600, f1: 300, dur: 0.12, vol: 0.08 }); },
    yowl()   { tone({ type: 'sawtooth', f0: 900, f1: 280, dur: 0.55, vol: 0.16 }); tone({ type: 'square', f0: 1200, f1: 400, dur: 0.4, vol: 0.06, delay: 0.05 }); },
    catnip() { [523, 659, 784, 659, 880, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.1, vol: 0.08, delay: i * 0.06 })); },
    bell()   { [1568, 2093].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.98, dur: 0.3, vol: 0.07, delay: i * 0.12 })); },
    crack()  { noise(0.12, 0.14, 900); tone({ f0: 180, f1: 90, dur: 0.12, vol: 0.10 }); },
    throw_() { tone({ f0: 500, f1: 900, dur: 0.08, vol: 0.06 }); },
    splash() { noise(0.25, 0.14, 1400); tone({ type: 'triangle', f0: 300, f1: 120, dur: 0.2, vol: 0.08 }); },
    spray()  { noise(0.15, 0.10, 2500); },
    bark()   { tone({ type: 'sawtooth', f0: 220, f1: 140, dur: 0.12, vol: 0.14 }); tone({ type: 'sawtooth', f0: 260, f1: 150, dur: 0.12, vol: 0.12, delay: 0.16 }); },
    hum()    { tone({ type: 'sawtooth', f0: 90, f1: 95, dur: 0.6, vol: 0.05 }); },
    boss()   { [220, 196, 174, 146].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.25, vol: 0.10, delay: i * 0.2 })); },
    win()    { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.10, delay: i * 0.12 })); },
    laser()  { tone({ f0: 1800, f1: 2400, dur: 0.05, vol: 0.05 }); },
    boing()  { tone({ type: 'triangle', f0: 300, f1: 600, dur: 0.15, vol: 0.09 }); },
  };
})();


// ---------------------------------------------------------------------------
// Music (spec §9): a procedural lofi loop. Swung drums, a warm filtered pad on
// seventh chords, a soft bass, a wandering pentatonic melody and vinyl crackle,
// all from oscillators and noise. One theme per world; nothing is streamed.
// ---------------------------------------------------------------------------
const Music = (() => {
  // chords as semitones from the key root; each chord holds for one bar
  const THEMES = {
    home:  { key: 0, bpm: 72, chords: [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [0, 4, 7, 11]], scale: [0, 2, 4, 7, 9] },   // Fmaj7 Em7 Dm7 Cmaj7
    w2:    { key: 2, bpm: 76, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], scale: [0, 2, 4, 7, 9] },  // I vi IV V7
    w3:    { key: -3, bpm: 68, chords: [[9, 12, 16, 19], [5, 9, 12, 16], [2, 5, 9, 12], [4, 8, 11, 14]], scale: [0, 3, 5, 7, 10] }, // Am7 Fmaj7 Dm7 E7, minor pentatonic
    w4:    { key: -1, bpm: 74, chords: [[2, 5, 9, 12], [7, 10, 14, 17], [0, 4, 7, 11], [5, 9, 12, 16]], scale: [0, 2, 4, 7, 9] },   // Dm7 Gm7 Cmaj7 Fmaj7
    w5:    { key: 3, bpm: 70, chords: [[5, 9, 12, 16], [7, 11, 14, 17], [4, 7, 11, 14], [9, 12, 16, 19]], scale: [0, 2, 4, 7, 9] },  // Fmaj7 G7 Em7 Am7
    boss:  { key: -3, bpm: 84, chords: [[9, 12, 16, 19], [8, 11, 14, 17], [9, 12, 16, 19], [4, 8, 11, 14]], scale: [0, 3, 5, 7, 10], heavy: true },
  };
  const C4 = 261.63;
  const freq = (semi, oct = 4) => C4 * Math.pow(2, (semi + (oct - 4) * 12) / 12);

  let ctx = null, master = null, tone = null, crackleSrc = null;
  let timer = null, theme = null, themeKey = null, step = 0, loop = 0, nextTime = 0;
  let muted = false, ducked = false, seed = 1, stats = { notes: 0 };
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  function ensure() {
    if (ctx) return ctx;
    ctx = Sfx.ctx();
    if (!ctx) return null;
    tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2400; tone.Q.value = 0.6;
    master = ctx.createGain(); master.gain.value = 0;
    tone.connect(master).connect(ctx.destination);
    return ctx;
  }
  function targetGain() { return muted ? 0 : (ducked ? 0.18 : 0.42); }
  function applyGain(ramp = 0.6) {
    if (!master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(targetGain(), t + ramp);
  }

  function osc(type, f, t0, dur, vol, opts = {}) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (opts.detune) o.detune.value = opts.detune;
    const a = opts.attack || 0.01, r = opts.release || 0.08;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    g.gain.setValueAtTime(vol, t0 + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.02);
    let dest = tone;
    if (opts.lowpass) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = opts.lowpass; f2.connect(tone); dest = f2; }
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    stats.notes++;
  }
  let noiseBuf = null;
  function noise(t0, dur, vol, type, f, q = 1) {
    if (!noiseBuf) { const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(g).connect(tone);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.02);
  }
  function kick(t0, heavy) { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(heavy ? 150 : 120, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.12); g.gain.setValueAtTime(heavy ? 0.9 : 0.7, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28); o.connect(g).connect(tone); o.start(t0); o.stop(t0 + 0.3); }
  function snare(t0) { noise(t0, 0.16, 0.22, 'bandpass', 1900, 0.8); const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t0); o.frequency.exponentialRampToValueAtTime(120, t0 + 0.08); g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12); o.connect(g).connect(tone); o.start(t0); o.stop(t0 + 0.14); }
  function hat(t0, open) { noise(t0, open ? 0.18 : 0.045, open ? 0.06 : 0.05, 'highpass', 6500, 0.7); }

  function startCrackle() {
    if (crackleSrc) return;
    const n = ctx.sampleRate * 3; const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { d[i] = (Math.random() * 2 - 1) * 0.35; if (Math.random() < 0.00045) d[i] = (Math.random() < 0.5 ? -1 : 1) * 0.9; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 3200; flt.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(flt).connect(g).connect(tone);
    src.start();
    crackleSrc = src;
  }

  function playStep(i, t0) {
    const T = theme; const stepLen = 60 / T.bpm / 4;
    const bar = Math.floor(i / 16), inBar = i % 16;
    const chord = T.chords[bar % T.chords.length];
    const swing = (inBar % 2 === 1) ? stepLen * 0.55 : 0;   // lay back the off 16ths
    // pad: whole-bar chord, gentle attack, warm and low in the mix
    if (inBar === 0) {
      const dur = stepLen * 16;
      chord.forEach((semi, k) => osc(k === 0 ? 'triangle' : 'sine', freq(T.key + semi, 4), t0, dur, 0.055, { attack: 0.5, release: 0.6, detune: (k - 1.5) * 4, lowpass: 900 }));
      osc('triangle', freq(T.key + chord[0], 3), t0, dur, 0.03, { attack: 0.6, release: 0.6, lowpass: 600 });
    }
    // bass: root on 1, fifth-ish pickup before 3, root on 3
    if (inBar === 0 || inBar === 8) osc('sine', freq(T.key + chord[0], 2), t0, stepLen * 6, 0.22, { attack: 0.02, release: 0.2 });
    if (inBar === 6 && rnd() < 0.7) osc('sine', freq(T.key + chord[2], 2), t0 + swing, stepLen * 1.5, 0.14, { attack: 0.02, release: 0.1 });
    if (inBar === 14 && rnd() < 0.5) osc('sine', freq(T.key + chord[0] - 2, 2), t0 + swing, stepLen * 1.5, 0.12, { attack: 0.02, release: 0.1 });
    // drums (swung 8ths on the hats)
    const heavy = !!T.heavy;
    if (inBar === 0 || inBar === 8 || (inBar === 10 && rnd() < (heavy ? 0.8 : 0.35)) || (heavy && inBar === 6)) kick(t0, heavy);
    if (inBar === 4 || inBar === 12) snare(t0 + stepLen * 0.03);
    if (inBar % 2 === 0) hat(t0 + swing, false);
    if (inBar === 14 && rnd() < 0.4) hat(t0 + swing, true);
    // (no lead melody: the pad, bass and drums carry it; a lead read as shrill)
  }

  function tick() {
    if (!ctx || !theme) return;
    const stepLen = 60 / theme.bpm / 4;
    while (nextTime < ctx.currentTime + 0.3) {
      playStep(step, nextTime);
      nextTime += stepLen;
      step = (step + 1) % (theme.chords.length * 16);
      if (step === 0) loop++;
    }
  }

  return {
    play(key) {
      if (!THEMES[key]) key = 'home';
      if (themeKey === key && timer) return;
      if (!ensure()) return;
      themeKey = key; theme = THEMES[key]; step = 0; loop = 0; seed = key.length * 7919 + 17;
      nextTime = ctx.currentTime + 0.1;
      startCrackle();
      applyGain(0.8);
      if (!timer) timer = setInterval(tick, 60);
    },
    stop() { if (master) applyGain(0.4); if (timer) { clearInterval(timer); timer = null; } themeKey = null; theme = null; },
    setMuted(m) { muted = m; if (ctx) applyGain(0.3); },
    duck(on) { ducked = on; if (ctx) applyGain(0.4); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    stats() { return { theme: themeKey, notes: stats.notes, state: ctx && ctx.state, step, loop }; },
    themeFor(level) { if (!level) return 'home'; if (level.boss) return 'boss'; return level.world === 1 ? 'home' : 'w' + level.world; },
  };
})();

// ---------------------------------------------------------------------------
// Cat definitions (spec §1). Passives: shadow, double, float, ghost.
// ---------------------------------------------------------------------------
const CATS = {
  scottie:   { name: 'SCOTTIE', texture: 'scottie', passives: ['shadow', 'double'], sound: 'meow', blurb: 'SHADOW: STAND STILL TO VANISH' },
  delia:     { name: 'DELIA', texture: 'delia', passives: ['float', 'ghost'], sound: 'chime', blurb: 'FLOAT: HOLD JUMP. CATCHES ZS' },
  marmalade: { name: 'MARMALADE', texture: 'marmalade', passives: ['bonk'], sound: 'meow', blurb: 'BONK: DASH THROUGH BRICKS' },
  mochi:     { name: 'MOCHI', texture: 'mochi', passives: ['yowl'], sound: 'meow', blurb: 'YOWL: ACTION STUNS EVERYONE' },
  pickle:    { name: 'PICKLE', texture: 'pickle', passives: ['slide'], sound: 'meow', blurb: 'SLIDE: FAST ON KITCHEN TILES' },
  biscuit:   { name: 'BISCUIT', texture: 'biscuit', passives: ['chaos'], sound: 'meow', blurb: 'CHAOS: A NEW PASSIVE EVERY LEVEL' },
  deli:      { name: 'DELI', texture: 'deli', passives: ['stocked'], sound: 'meow', blurb: 'STOCKED: STARTS WITH A POWERUP' },
  clover:    { name: 'CLOVER', texture: 'clover', passives: ['roll'], sound: 'meow', blurb: 'ROLL: CROUCH UNDER TIGHT GAPS' },
};
const CAT_ORDER = ['scottie', 'delia', 'marmalade', 'mochi', 'pickle', 'biscuit', 'deli', 'clover'];
const PASSIVE_POOL = ['shadow', 'double', 'float', 'ghost', 'bonk', 'yowl', 'slide', 'stocked', 'roll'];
const POWERUPS = ['tuna', 'catnip', 'bell', 'fish', 'box', 'laser', 'yarn'];
const ITEM_CHARGES = { laser: 3, yarn: 5, box: 1 };

/** Passives for this level (Biscuit rolls a random one each level). */
function resolvePassives(catKey) {
  const base = CATS[catKey].passives;
  if (!base.includes('chaos')) return base.slice();
  const pick = PASSIVE_POOL[Math.floor(Math.random() * PASSIVE_POOL.length)];
  return [pick];
}

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
  Sprites.addAnim(scene, 'ghost-mouse-idle', 'ghost-mouse', 0, 1, 3, -1);
  Sprites.addAnim(scene, 'halo-shimmer', 'halo', 0, 2, 5, -1);
  Sprites.addAnim(scene, 'deco-fishhouse-blink', 'deco-fishhouse', 0, 2, 1.5, -1);
  Sprites.addAnim(scene, 'deco-butterfly-flap', 'deco-butterfly', 0, 1, 6, -1);
  Sprites.addAnim(scene, 'deco-pigeon-peck', 'deco-pigeon', 0, 1, 2, -1);
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
  let halo = null;
  if (catKey === 'delia') {
    halo = scene.add.sprite(x, y - 30, 'halo').setDepth(depth + 2);
    halo.play('halo-shimmer');
    scene.tweens.add({ targets: halo, y: y - 33, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  return {
    body, tail, halo, cat,
    setPos(nx, ny) { body.x = nx; tail.x = nx; body.y = ny; tail.y = ny; if (halo) { halo.x = nx; } },
    setFlip(f) { body.setFlipX(f); tail.setFlipX(f); },
    play(name) { body.play(cat.texture + '-' + name); },
    sit() { body.play(cat.texture + '-sit'); tail.setVisible(false); },
    destroy() { body.destroy(); tail.destroy(); if (halo) halo.destroy(); },
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
    this.passives = scene.passives || this.cat.passives;
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
    // Delia's halo: floats above her head, shimmers, bobs
    this.halo = null;
    if (catKey === 'delia') { this.halo = scene.add.sprite(x, groundY - 30, 'halo').setDepth(12); this.halo.play('halo-shimmer'); this.haloT = 0; }

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
    this.climbCooldown = 0;
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
    this.rolling = false;
    this.catnip = 0;
    this.trailTimer = 0;
    this.yowlCooldown = 0;
    this.bell = !!GameState.bell;
    this.item = null;         // { kind, charges }
    this.hiding = false;      // cardboard box
    this.boxSprite = scene.add.image(x, groundY, 'box').setOrigin(0.5, 1).setDepth(12).setVisible(false);
    this.setSuper(GameState.super, true);
  }

  has(passive) { return this.passives.includes(passive); }

  setRolling(on) {
    if (on === this.rolling) return;
    this.rolling = on;
    if (on) this.body.setSize(HITBOX.w, PHYS.rollHeight).setOffset(0, HITBOX.h - PHYS.rollHeight);
    else this.body.setSize(HITBOX.w, HITBOX.h).setOffset(0, 0);
  }

  canStand() {
    const b = this.body, s = this.scene;
    const feet = b.y + b.height;
    const cx = b.x + b.halfWidth;
    return !s.solidAt(cx - 7, feet - HITBOX.h + 1) && !s.solidAt(cx + 7, feet - HITBOX.h + 1);
  }

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

  knockback(fromX, mult = 1) {
    const dir = (this.body.x + this.body.halfWidth) < fromX ? -1 : 1;
    this.body.setVelocity(dir * PHYS.knockback * mult, -160 * Math.sqrt(mult));
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
    if (!GameState.climbed) { GameState.climbed = true; const h = this.scene.climbHint; if (h) { this.scene.tweens.killTweensOf([h.bg, h.txt]); h.bg.destroy(); h.txt.destroy(); this.scene.climbHint = null; } }
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
    // cardboard box: hold action to hide (invulnerable, can't move)
    const wantHide = !!(this.item && this.item.kind === 'box' && inp.action && this.grounded && this.hurtTimer <= 0 && !this.locked);
    if (wantHide !== this.hiding) {
      this.hiding = wantHide;
      this.boxSprite.setVisible(wantHide);
      this.sprite.setVisible(!wantHide); this.tail.setVisible(!wantHide);
      if (wantHide) Sfx.bonk();
    }
    if (this.hiding) { inp = NO_INPUT; }
    this.jumpHeld = inp.jump;

    const b = this.body;
    const cx = b.x + b.halfWidth, cy = b.y + b.halfHeight;
    const grounded = b.blocked.down;
    const justLanded = grounded && !this.wasGrounded;
    this.wasGrounded = grounded;

    // --- timers -----------------------------------------------------------
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.yowlCooldown = Math.max(0, this.yowlCooldown - dt);
    if (this.catnip > 0) { this.catnip -= dt; if (this.catnip <= 0) { this.catnip = 0; this.scene.hud && this.scene.hud.refresh(); } }
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.jumpFlash = Math.max(0, this.jumpFlash - dt);
    this.coyote = grounded ? PHYS.coyoteTime : Math.max(0, this.coyote - dt);
    this.buffer = inp.jumpPressed ? PHYS.jumpBuffer : Math.max(0, this.buffer - dt);

    this.landedThisFrame = justLanded && this.lastVy > 50;
    if (this.landedThisFrame) this.onLand(this.lastVy);
    if (grounded) { this.jumping = false; this.jumpCut = false; this.doubleUsed = false; }

    // --- curtain climbing ---------------------------------------------------
    this.climbCooldown = Math.max(0, this.climbCooldown - dt);
    const feetY = b.y + b.height;
    const onCurtain = this.scene.curtainAt(cx, cy) || this.scene.curtainAt(cx, b.y + 2) || this.scene.curtainAt(cx, feetY - 1);
    if (!this.climbing && onCurtain && this.climbCooldown <= 0 && this.hurtTimer <= 0 && (inp.up || (inp.down && !grounded))) this.startClimb();
    if (this.climbing) {
      if (!onCurtain || (grounded && inp.down)) {
        this.stopClimb();
      } else if (inp.jumpPressed) {
        // jump off: a full jump, and no re-grab for a moment even if Up is still held
        this.stopClimb();
        this.climbCooldown = 0.35;
        b.setVelocityY(PHYS.jumpVel);
        this.jumping = true; this.jumpCut = false;
        this.buffer = 0;
        this.onJump();
      } else {
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (dir) this.facing = dir;
        let vy = (inp.up ? -PHYS.climbSpeed : 0) + (inp.down ? PHYS.climbSpeed : 0);
        // perch on the rod: never climb past the top of the curtain
        const topY = this.scene.curtainTopY(cx, feetY - 1);
        if (vy < 0 && feetY <= topY + 1) { vy = 0; b.y = topY + 1 - b.height; }
        this.perched = feetY <= topY + 1;
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
    // crouch; Clover keeps rolling while something is overhead
    const wantCrouch = grounded && inp.down && this.dashTime <= 0;
    const crouching = wantCrouch || (this.rolling && !this.canStand());
    if (this.has('roll')) this.setRolling(crouching); else if (this.rolling) this.setRolling(false);
    const dir = (crouching && !this.rolling) ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir !== 0 && this.dashTime <= 0 && dir !== this.facing) {
      if (grounded && Math.abs(b.velocity.x) > 60) this.scene.dust(cx, b.y + b.height, -dir);
      this.facing = dir;
    }

    if (inp.actionPressed && this.item && this.item.kind !== 'box' && !this.locked) {
      this.scene.useItem();
    } else if (inp.actionPressed && this.has('yowl') && !this.locked && this.yowlCooldown <= 0) {
      this.yowlCooldown = PHYS.yowlCooldown;
      this.scene.yowl();
    } else if (inp.actionPressed && !this.has('yowl') && !(this.item && this.item.kind !== 'box') && this.dashCooldown <= 0 && this.dashTime <= 0 && !this.locked) {
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
      let mult = this.speedScale;
      if (this.catnip > 0) mult *= PHYS.catnipSpeed;
      if (this.rolling) mult *= 0.8;
      if (this.has('slide') && grounded && this.scene.kitchenAt(cx, b.y + b.height + 1)) mult *= PHYS.slideBoost;
      const max = PHYS.walkMax * mult;   // no sprint: one walking speed, dash for bursts
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
      vy = PHYS.jumpVel * (this.catnip > 0 ? PHYS.catnipJump : 1);
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
    else if (crouching)                         state = this.rolling && Math.abs(vx) > 2 ? 'roll' : 'crouch';
    else if (Math.abs(vx) > PHYS.runMax * PHYS.runAnimThreshold) state = 'run';
    else if (Math.abs(vx) > 2)                  state = 'walk';
    else                                        state = this.idleTime > 6 ? 'sit-loaf' : 'idle';
    this.idleTime = (state === 'idle' || state === 'sit-loaf') ? this.idleTime + dt : 0;
    this.state = state;
    this.grounded = grounded;

    this.animate(state, vy, dt);
    this.placeVisuals();

    // catnip: rainbow tail trail
    if (this.catnip > 0) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) { this.trailTimer = 0.05; this.scene.rainbowPuff(this.tail.x - this.facing * 10 * this.baseScale, this.tail.y - 12 * this.baseScale); }
    }
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
    this.boxSprite.x = px; this.boxSprite.y = py;
    if (this.halo) {
      this.haloT = (this.haloT || 0) + (this.scene.dt || 0.016);
      const crouched = this.rolling || this.state === 'crouch' || this.state === 'roll';
      this.halo.x = px + (this.state === 'sit-loaf' ? 0 : this.facing * 2);
      this.halo.y = py - (crouched ? 18 : 30) * this.baseScale + Math.sin(this.haloT * 3.5) * 2;
      this.halo.setAlpha(this.sprite.alpha).setVisible(this.sprite.visible);
    }
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
      case 'roll': frame('crouch'); break;
      case 'hurt': frame('hurt'); break;
      case 'climb':
        if (vy !== 0) play(t + '-walk'); else frame(this.perched ? 'idle0' : 'fall0');
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
  constructor(scene, x, y, group) {
    super(scene, x, y, 'roomba', 0);
    scene.add.existing(this);
    group.add(this);   // group first: adding later would reset the body config
    this.setOrigin(0.5, 1).setDepth(9);
    this.body.setSize(14, 8).setOffset(1, 8);
    this.dir = -1;
    this.alive = true;
    this.kind = 'roomba';
    this.stunned = 0;
    this.play('roomba-idle');
  }

  stun(sec) {
    this.stunned = sec;
    this.setTint(0x8fa8ff);
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    if (!this.alive) return;
    if (this.stunned > 0) {
      this.stunned -= d / 1000;
      this.body.setVelocityX(0);
      this.setVisible(Math.floor(t / 80) % 4 !== 0);
      if (this.stunned <= 0) { this.clearTint(); this.setVisible(true); }
      return;
    }
    const cam = this.scene.cameras.main;
    if (Math.abs(this.x - cam.midPoint.x) > W * 0.75) { this.body.setVelocityX(0); return; }
    if (this.chaseT > 0) {
      // chasing a laser dot: beeline, happily off ledges
      this.chaseT -= d / 1000;
      this.dir = Math.sign(this.chaseX - this.x) || this.dir;
      this.body.setVelocityX(this.dir * PHYS.roombaSpeed * 1.8);
      this.setFlipX(this.dir > 0);
      return;
    }
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
  constructor(scene, x, y, kind, dir, group) {
    super(scene, x, y, kind);
    scene.add.existing(this);
    group.add(this);
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

class Squirrel extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, group) {
    super(scene, x, y, 'squirrel', 0);
    scene.add.existing(this);
    group.add(this);
    this.setOrigin(0.5, 1).setDepth(9);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    this.body.setSize(12, 12).setOffset(2, 4);
    this.alive = true;
    this.kind = 'squirrel';
    this.stunned = 0;
    this.timer = 1 + Math.random();
    this.setFlipX(false);
  }
  stun(sec) { this.stunned = sec; this.setTint(0x8fa8ff); }
  preUpdate(t, d) {
    super.preUpdate(t, d);
    if (!this.alive) return;
    const dt = d / 1000;
    if (this.stunned > 0) { this.stunned -= dt; if (this.stunned <= 0) this.clearTint(); return; }
    const p = this.scene.player;
    if (!p || p.dead) return;
    const dx = p.box.x - this.x;
    this.setFlipX(dx < 0);
    this.setFrame(Math.floor(t / 400) % 2);
    this.timer -= dt;
    if (this.timer <= 0 && Math.abs(dx) < 170 && Math.abs(p.box.y - this.y) < 100) {
      this.timer = 2;
      this.scene.throwAcorn(this.x, this.y - 10, Math.sign(dx) || 1, Math.abs(dx));
    }
  }
  stomp() {
    this.alive = false;
    this.setFrame(2);
    this.body.enable = false;
    const scene = this.scene;
    scene.tweens.add({ targets: this, y: this.y - 16, duration: 160, onComplete: () => scene.tweens.add({ targets: this, y: this.y + 220, angle: 180, duration: 800, onComplete: () => this.destroy() }) });
  }
}

class Sprinkler extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'sprinkler', 0);
    scene.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(9);
    this.phase = Math.random() * 4;
    this.on = false;
    this.drops = [];
    // arc of droplets going up and to the right, then falling
    // starts at the nozzle, peaks mid-way, comes back down to the grass
    for (let i = 0; i < 7; i++) {
      const dx = 8 + i * 9, dy = -6 - Math.sin((i / 6) * Math.PI) * 30;
      const dp = scene.add.image(x + dx, y + dy, 'droplet').setDepth(8).setVisible(false);
      dp.ox = dx; dp.oy = dy;
      this.drops.push(dp);
    }
  }
  preUpdate(t, d) {
    super.preUpdate(t, d);
    this.phase = (this.phase + d / 1000) % 4;
    const on = this.phase < 2;
    if (on !== this.on) { this.on = on; if (on) Sfx.spray(); }
    this.setFrame(on ? 1 : 0);
    const wob = Math.sin(t / 120) * 2;
    for (const dp of this.drops) { dp.setVisible(on); dp.y = this.y + dp.oy + wob; }
  }
  hitsPlayer(b) {
    if (!this.on) return false;
    for (const dp of this.drops) {
      if (dp.x > b.x - 2 && dp.x < b.x + b.width + 2 && dp.y > b.y - 2 && dp.y < b.y + b.height + 2) return true;
    }
    return false;
  }
}

class SprayBottle extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, group) {
    super(scene, x, y, 'spray', 0);
    scene.add.existing(this);
    group.add(this);
    this.setOrigin(0.5, 1).setDepth(9);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    this.body.setSize(10, 16).setOffset(3, 4);
    this.alive = true;
    this.kind = 'spray';
    this.stunned = 0;
    this.timer = 1.5;
  }
  stun(sec) { this.stunned = sec; this.setTint(0x8fa8ff); }
  preUpdate(t, d) {
    super.preUpdate(t, d);
    if (!this.alive) return;
    const dt = d / 1000;
    if (this.stunned > 0) { this.stunned -= dt; if (this.stunned <= 0) this.clearTint(); return; }
    const p = this.scene.player;
    if (!p || p.dead) return;
    const dx = p.box.x - this.x;
    this.setFlipX(dx < 0);
    this.timer -= dt;
    if (this.timer <= 0 && Math.abs(dx) < 150 && Math.abs(p.box.y - (this.y - 10)) < 60) {
      this.timer = 1.5;
      this.setFrame(1);
      this.scene.time.delayedCall(200, () => { if (this.active) this.setFrame(0); });
      this.scene.fireBlob(this.x + Math.sign(dx) * 8, this.y - 14, Math.sign(dx) || 1, p.box.x, p.box.y);
    }
  }
  stomp() {
    this.alive = false;
    this.body.enable = false;
    const scene = this.scene;
    scene.tweens.add({ targets: this, scaleY: 0.4, y: this.y, duration: 120, onComplete: () => scene.tweens.add({ targets: this, alpha: 0, duration: 400, onComplete: () => this.destroy() }) });
  }
}

class Yarn extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, dir, group) {
    super(scene, x, y, 'yarn');
    scene.add.existing(this);
    group.add(this);
    this.setDepth(12);
    this.body.setCircle(5);
    this.body.setBounce(1, 0.6);
    this.body.setVelocity(dir * PHYS.yarnSpeed, -50);
    this.bounces = 0;
    this.trail = 0;
    this.life = 4;
  }
  preUpdate(t, d) {
    super.preUpdate(t, d);
    this.angle += this.body.velocity.x * d / 60;
    this.life -= d / 1000;
    this.trail -= d / 1000;
    if (this.trail <= 0) {
      this.trail = 0.04;
      const bit = this.scene.add.image(this.x, this.y, 'string').setDepth(11).setAlpha(0.9);
      this.scene.tweens.add({ targets: bit, alpha: 0, duration: 1500, onComplete: () => bit.destroy() });
    }
    if (this.body.blocked.left || this.body.blocked.right) { this.bounces++; Sfx.boing(); }
    if (this.bounces > 3 || this.life <= 0 || this.y > this.scene.worldH + 20) this.destroy();
  }
}

class Dog extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'dog', 0);
    scene.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(13);
    this.frameT = 0;
    this.barkT = 1;
  }
  preUpdate(t, d) {
    super.preUpdate(t, d);
    this.frameT += d;
    this.setFrame(Math.floor(this.frameT / 70) % 4);
    this.barkT -= d / 1000;
    if (this.barkT <= 0) { this.barkT = 2 + Math.random() * 2; Sfx.bark(); }
  }
}

// ---------------------------------------------------------------------------
// HUD (spec §8)
// ---------------------------------------------------------------------------
class Hud {
  constructor(scene, showMice) {
    this.scene = scene;
    const d = 1000;
    // translucent backing so the HUD reads on night and clinic backdrops too
    scene.add.rectangle(2, 2, 122, 16, 0xfff4dc, 0.55).setOrigin(0).setScrollFactor(0).setDepth(d - 1);
    if (showMice) scene.add.rectangle(W - 44, 2, 42, 12, 0xfff4dc, 0.55).setOrigin(0).setScrollFactor(0).setDepth(d - 1);
    this.lifeIcon = scene.add.image(4, 4, 'icon-life').setOrigin(0).setScrollFactor(0).setDepth(d);
    this.lifeText = this.text(14, 4);
    this.kibbleIcon = scene.add.image(36, 5, 'kibble').setOrigin(0).setScrollFactor(0).setDepth(d);
    this.kibbleText = this.text(44, 4);
    this.slot = scene.add.rectangle(74, 3, 14, 12).setOrigin(0).setStrokeStyle(1, 0x3a2a1a, 0.6).setScrollFactor(0).setDepth(d);
    this.slotIcon = scene.add.image(81, 9, 'tuna').setScrollFactor(0).setDepth(d + 1).setVisible(false);
    this.cool = scene.add.rectangle(74, 16, 14, 2, 0x3a6fbf, 1).setOrigin(0).setScrollFactor(0).setDepth(d + 1).setVisible(false);
    this.itemIcon = scene.add.image(97, 9, 'yarn').setScrollFactor(0).setDepth(d + 1).setVisible(false);
    this.itemText = this.text(105, 4);
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
    const p = this.scene.player;
    const icon = (p && p.catnip > 0) ? 'catnip' : GameState.super ? 'tuna' : GameState.bell ? 'bell' : null;
    this.slotIcon.setVisible(!!icon);
    if (icon) this.slotIcon.setTexture(icon);
    const it = p && p.item;
    this.itemIcon.setVisible(!!it);
    if (it) { this.itemIcon.setTexture(it.kind); this.itemText.set(it.kind === 'box' ? (this.scene.touch ? 'HOLD B' : 'HOLD SHIFT') : 'x' + it.charges); } else this.itemText.set('');
    if (this.miceText) {
      const got = (GameState.mice[this.scene.level.id] || []).length;
      this.miceText.set(got + '/' + this.scene.miceTotal);
    }
  }
}

// ---------------------------------------------------------------------------
// Touch controls (spec §0): a D-pad on the left, B (action) and A (jump) on
// the right, a pause corner. Input is polled from pointer positions every
// frame instead of per-button events, so a thumb can slide between
// directions, hit diagonals, and never leaves a button stuck down. Hit zones
// are much larger than the drawn shapes: anywhere in the lower-left quarter
// steers, anywhere near A/B presses the closer one.
// ---------------------------------------------------------------------------
class TouchControls {
  constructor(scene) {
    this.scene = scene;
    scene.input.addPointer(3);
    this.prev = { jump: false, action: false };
    this.objects = [];
    this.visible = true;
    const add = o => { o.setScrollFactor(0).setDepth(2000); this.objects.push(o); return o; };
    const INK = 0x000000, DIM = 0.16;
    // D-pad: four arms around a centre pad
    const C = this.padC = { x: 56, y: 132 };
    const T = 26, L = 30;
    this.pad = {
      up:    add(scene.add.rectangle(C.x - T / 2, C.y - T / 2 - L, T, L, INK, DIM).setOrigin(0)),
      down:  add(scene.add.rectangle(C.x - T / 2, C.y + T / 2, T, L, INK, DIM).setOrigin(0)),
      left:  add(scene.add.rectangle(C.x - T / 2 - L, C.y - T / 2, L, T, INK, DIM).setOrigin(0)),
      right: add(scene.add.rectangle(C.x + T / 2, C.y - T / 2, L, T, INK, DIM).setOrigin(0)),
    };
    add(scene.add.rectangle(C.x - T / 2, C.y - T / 2, T, T, INK, DIM).setOrigin(0));
    const g = add(scene.add.graphics()).setDepth(2001).setAlpha(0.55);
    g.fillStyle(INK, 1);
    const a = T / 2 + L - 9, h = 7;   // arrow tip distance from centre, half-width
    g.fillTriangle(C.x, C.y - a - 5, C.x - h, C.y - a + 5, C.x + h, C.y - a + 5);
    g.fillTriangle(C.x, C.y + a + 5, C.x - h, C.y + a - 5, C.x + h, C.y + a - 5);
    g.fillTriangle(C.x - a - 5, C.y, C.x - a + 5, C.y - h, C.x - a + 5, C.y + h);
    g.fillTriangle(C.x + a + 5, C.y, C.x + a - 5, C.y - h, C.x + a - 5, C.y + h);
    // A (jump) and B (action)
    this.btnA = { x: 288, y: 138, r: 22, key: 'jump' };
    this.btnB = { x: 236, y: 152, r: 18, key: 'action' };
    for (const b of [this.btnA, this.btnB]) {
      b.shape = add(scene.add.circle(b.x, b.y, b.r, INK, DIM));
      add(scene.add.bitmapText(b.x, b.y, 'font', b.key === 'jump' ? 'A' : 'B').setOrigin(0.5).setDepth(2001).setAlpha(0.6).setTint(INK));
    }
    // pause corner
    const pr = add(scene.add.rectangle(W - 30, 2, 28, 18, INK, DIM).setOrigin(0).setInteractive());
    add(scene.add.bitmapText(W - 16, 11, 'font', 'II').setOrigin(0.5).setDepth(2001).setAlpha(0.7).setTint(INK));
    pr.on('pointerdown', () => scene.togglePause());
    // hidden by keyboard use; any touch brings the pad back
    scene.input.on('pointerdown', p => { if (!this.visible && p.wasTouch) this.setVisible(true); });
  }
  /** Read the current touch state; call once per frame. */
  consume() {
    const s = { left: false, right: false, up: false, down: false, jump: false, action: false };
    for (const p of this.scene.input.manager.pointers) {
      if (!p.isDown) continue;
      const x = p.x, y = p.y;
      if (x < 118 && y > 70) {
        const dx = x - this.padC.x, dy = y - this.padC.y;
        if (dx * dx + dy * dy < 36) continue;               // dead centre
        if (Math.abs(dx) >= Math.abs(dy) * 0.5) { if (dx < 0) s.left = true; else s.right = true; }
        if (Math.abs(dy) >= Math.abs(dx) * 0.5) { if (dy < 0) s.up = true; else s.down = true; }
      } else if (x > 200 && y > 96) {
        const dA = Math.hypot(x - this.btnA.x, y - this.btnA.y) - this.btnA.r;
        const dB = Math.hypot(x - this.btnB.x, y - this.btnB.y) - this.btnB.r;
        if (Math.min(dA, dB) <= 14) { if (dA <= dB) s.jump = true; else s.action = true; }
      }
    }
    s.jumpPressed = s.jump && !this.prev.jump;
    s.actionPressed = s.action && !this.prev.action;
    this.prev = s;
    for (const k in this.pad) this.pad[k].setFillStyle(0x000000, s[k] ? 0.34 : 0.16);
    this.btnA.shape.setFillStyle(0x000000, s.jump ? 0.34 : 0.16);
    this.btnB.shape.setFillStyle(0x000000, s.action ? 0.34 : 0.16);
    return s;
  }
  setVisible(v) { this.visible = v; for (const o of this.objects) o.setVisible(v); }
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
    if (isTouch && !Fullscreen.active() && !Fullscreen.available()) {
      this.add.bitmapText(W / 2, 130, 'font', 'FULL SCREEN: SHARE THEN ADD TO HOME SCREEN').setOrigin(0.5).setTint(0x8c6d48);
    }
    this.add.bitmapText(W - 3, 3, 'font', 'BUILD ' + (window.BUILD || '?')).setOrigin(1, 0).setTint(0x6b4a2a);

    // cats parade across the bottom
    this.cats = [];
    CAT_ORDER.forEach((key, i) => {
      const a = makeCatActor(this, key, 60 + i * 90, 156);
      a.play('walk');
      a.speed = 38 + i * 6;
      this.cats.push(a);
    });

    Music.play('home');
    const go = () => {
      if (this.started) return;
      this.started = true;
      Sfx.unlock();
      Music.resume();
      Sfx.select();
      if (isTouch) Fullscreen.request();
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


    // upper shelf for the second row of portraits
    g.fillStyle(0xb8844d, 1); g.fillRect(40, 58, W - 80, 6);
    g.fillStyle(0xd9a765, 1); g.fillRect(40, 58, W - 80, 1);
    g.fillStyle(0x4a2f1a, 1); g.fillRect(40, 63, W - 80, 1);
    this.keys = CAT_ORDER;
    const perRow = 4, spacing = 64;
    const x0 = W / 2 - (perRow - 1) * spacing / 2;
    this.slots = this.keys.map((key, i) => {
      const row = Math.floor(i / perRow), c = i % perRow;
      const x = x0 + c * spacing, y = row === 0 ? 58 : 118;
      const img = this.add.image(x, y, key + '-portrait').setOrigin(0.5, 1).setInteractive();
      img.on('pointerdown', () => { if (this.index === i) this.choose(); else { this.index = i; Sfx.select(); } });
      return { key, x, y, img, row, c };
    });
    this.nameText = this.add.bitmapText(W / 2, 132, 'font', '').setOrigin(0.5, 0).setTint(0x3a2414);
    this.cursor = this.add.rectangle(0, 0, 52, 52).setStrokeStyle(2, 0xf2c94c, 1).setOrigin(0.5, 1);
    this.paw = this.add.image(0, 0, 'paw-cursor').setOrigin(0.5, 1);
    this.blurb = this.add.bitmapText(W / 2, 146, 'font', '').setOrigin(0.5, 0).setTint(0x6b4a2a);
    this.hint = this.add.bitmapText(W / 2, 166, 'font', this.sys.game.device.input.touch ? 'CHOOSE A CAT: TAP TWICE' : 'CHOOSE A CAT: ARROWS + SPACE').setOrigin(0.5, 0).setTint(0x8c6d48);

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
    this.kUp = kb.addKey('UP'); this.kDown = kb.addKey('DOWN');
    this.kA = kb.addKey('A'); this.kD = kb.addKey('D'); this.kW = kb.addKey('W'); this.kS = kb.addKey('S');
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
      const n = this.keys.length;
      if (JD(this.kLeft) || JD(this.kA)) { this.index = (this.index + n - 1) % n; Sfx.select(); }
      if (JD(this.kRight) || JD(this.kD)) { this.index = (this.index + 1) % n; Sfx.select(); }
      if (JD(this.kUp) || JD(this.kW) || JD(this.kDown) || JD(this.kS)) { this.index = (this.index + 4) % n; Sfx.select(); }
      if (JD(this.kSpace) || JD(this.kEnter)) this.choose();
    }
    const slot = this.slots[this.index];
    this.cursor.x = slot.x; this.cursor.y = slot.y + 2;
    this.paw.x = slot.x - 31 + Math.abs(Math.sin(time / 300)) * 2; this.paw.y = slot.y - 18;
    this.nameText.setText(CATS[slot.key].name);
    this.blurb.setText(CATS[slot.key].blurb);
    this.t += delta / 1000;
    this.stars.forEach((s, i) => {
      const a = this.t * 0.9 + i * Math.PI * 2 / 3;
      const delia = this.slots.find(x => x.key === 'delia');
      s.x = delia.x + Math.cos(a) * 30;
      s.y = delia.y - 24 + Math.sin(a) * 26;
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
    this.add.bitmapText(W / 2, H / 2 + 38, 'font', this.sys.game.device.input.touch ? 'TAP TO RESUME' : 'ESC RESUME   T TITLE   M MUTE').setOrigin(0.5).setTint(0xd9c7a6);
    const kb = this.input.keyboard;
    this.kEsc = kb.addKey('ESC'); this.kT = kb.addKey('T'); this.kP = kb.addKey('P');
    this.input.on('pointerdown', () => this.resume());
  }
  resume() {
    Music.duck(false);
    this.scene.resume('play');
    this.scene.stop();
  }
  update() {
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(this.kEsc) || JD(this.kP)) this.resume();
    if (JD(this.kT)) { Music.duck(false); this.scene.stop('play'); this.scene.start('title'); }
  }
}

// ---------------------------------------------------------------------------
// Finale (spec §6): all eight cats inside, Delia on the windowsill.
// ---------------------------------------------------------------------------
class FinaleScene extends Phaser.Scene {
  constructor() { super('finale'); }
  create() {
    this.cameras.main.setBackgroundColor('#e6d8bf');
    this.cameras.main.fadeIn(600, 0, 0, 0);
    const g = this.add.graphics();
    g.fillStyle(0xd9c7a6, 1);
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 8, H);
    // window + sill
    g.fillStyle(0xf4f1e8, 1); g.fillRect(200, 22, 96, 66);
    g.fillStyle(0x2a2050, 1); g.fillRect(204, 26, 88, 58);
    for (let i = 0; i < 14; i++) { g.fillStyle(0xffffff, 1); g.fillRect(206 + (i * 37) % 84, 28 + (i * 23) % 50, 1, 1); }
    g.fillStyle(0xfff4c0, 1); g.fillCircle(276, 42, 8);
    g.fillStyle(0xf4f1e8, 1); g.fillRect(247, 26, 2, 58); g.fillRect(204, 54, 88, 2);
    g.fillStyle(0xb8844d, 1); g.fillRect(196, 88, 104, 8);
    g.fillStyle(0x4a2f1a, 1); g.fillRect(196, 95, 104, 1);
    // rug + floor
    g.fillStyle(0xb89a70, 1); g.fillRect(0, 150, W, 6);
    g.fillStyle(0x8c6d48, 1); g.fillRect(0, 155, W, 1);
    this.add.tileSprite(0, 156, W, 24, 'tiles-w1', Sprites.TILE.FLOOR_TOP).setOrigin(0);
    this.add.tileSprite(60, 156, 200, 16, 'tiles-w1', Sprites.TILE.RUG).setOrigin(0);
    this.add.image(24, 156, 'lamp').setOrigin(0.5, 1);
    // Glen & Em on the couch side
    this.add.tileSprite(96, 156, 48, 16, 'tiles-w1', Sprites.TILE.COUCH_M).setOrigin(0, 1);
    this.add.sprite(60, 156, 'glen').setOrigin(0.5, 1).play('glen-pet');
    this.add.sprite(84, 156, 'em').setOrigin(0.5, 1).play('em-wave');
    // the cats
    const spots = [[118, 156, 'sit'], [140, 156, 'idle'], [162, 156, 'sit'], [184, 156, 'walk'], [206, 156, 'idle'], [228, 156, 'sit'], [250, 156, 'idle']];
    let i = 0;
    for (const key of CAT_ORDER) {
      if (key === 'delia') { const a = makeCatActor(this, 'delia', 248, 88); a.sit(); a.setFlip(true); continue; }
      const [x, y, anim] = spots[i++];
      const a = makeCatActor(this, key, x, y);
      if (anim === 'sit') a.sit(); else a.play(anim);
      a.setFlip(i % 2 === 0);
    }
    const lx = 100;
    this.add.bitmapText(lx + 2, 26, 'font', 'HOME').setOrigin(0.5).setScale(3).setTint(0x3a2414);
    this.add.bitmapText(lx, 24, 'font', 'HOME').setOrigin(0.5).setScale(3).setTint(0xf2c94c);
    this.add.bitmapText(lx, 52, 'font', 'ALL NINE LIVES').setOrigin(0.5).setTint(0x6b4a2a);
    this.add.bitmapText(lx, 64, 'font', 'ACCOUNTED FOR').setOrigin(0.5).setTint(0x6b4a2a);
    const mice = Object.values(GameState.mice).reduce((a, l) => a + l.length, 0);
    this.add.bitmapText(lx, 84, 'font', 'KIBBLE ' + String(GameState.kibble).padStart(3, '0')).setOrigin(0.5).setTint(0x6b4a2a);
    this.add.bitmapText(lx, 96, 'font', 'LIVES x' + GameState.lives + (mice ? '  ZS ' + mice : '')).setOrigin(0.5).setTint(0x6b4a2a);
    this.prompt = this.add.bitmapText(W / 2, 170, 'font', 'THANKS FOR PLAYING').setOrigin(0.5).setTint(0x8c6d48);
    Music.play('home');
    Sfx.win();
    const go = () => { this.scene.start('title'); };
    this.time.delayedCall(1500, () => { this.input.keyboard.once('keydown', go); this.input.once('pointerdown', go); });
  }
  update(time) { this.prompt.setVisible(Math.floor(time / 600) % 2 === 0); }
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
    this.boss = null;
    this.bossText = null;
    this.chase = null;
    this.parallax = false;
    this.dt = 0;
    this.muted = this.muted || false;
    this.passives = resolvePassives(GameState.cat);
    this.cameras.main.fadeIn(200, 0, 0, 0);
    Music.play(Music.themeFor(Levels.get(GameState.level)));

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
    this.drawBackdrop(mapW, worldH, level.world);

    this.placeScenery(level);

    const map = this.make.tilemap({ data: level.grid, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage('tiles', 'tiles-w' + level.world, TILE, TILE, 0, 0);
    this.map = map;
    this.layer = map.createLayer(0, tileset, 0, this.mapOffsetY).setDepth(5);
    this.layer.setCollision([T.FLOOR_TOP, T.FLOOR_FILL, T.SHELF, T.BRICK, T.PAW, T.PAW_USED, T.KITCHEN, T.COUCH_L, T.COUCH_M, T.COUCH_R, T.RUG, T.BLOCK]);
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

    this.doorLocked = !!level.boss;
    if (level.door) {
      const dx = Math.min(tx(level.door), mapW - 16);
      const dy = tbottom(level.door);
      this.doorX = dx; this.doorY = dy;
      this.flap = !!level.door.flap;
      if (this.flap) {
        this.doorway = this.add.image(dx, dy, 'catflap').setOrigin(0.5, 1).setDepth(3);
      } else {
        this.doorway = this.add.image(dx, dy, 'doorway', 0).setOrigin(0.5, 1).setDepth(3);
        this.glen = this.add.sprite(dx - 7, dy, 'glen').setOrigin(0.5, 1).setDepth(4).play('glen-wave');
        this.em = this.add.sprite(dx + 7, dy, 'em').setOrigin(0.5, 1).setDepth(4).play('em-wave');
        if (this.doorLocked) { this.glen.setVisible(false); this.em.setVisible(false); this.doorway.setFrame(1); }
      }
      this.doorZone = new Phaser.Geom.Rectangle(dx - 26, dy - 64, 40, 64 + 24);
    }

    // decor sprites ('@'): birdbath / neon / x-ray box / string lights by world
    for (const dcr of level.decor) {
      const w = level.world;
      if (w === 2) this.add.image(tx(dcr), tbottom(dcr), 'birdbath').setOrigin(0.5, 1).setDepth(2);
      else if (w === 3) { const n = this.add.sprite(tx(dcr), ty(dcr), 'neon').setDepth(2); this.time.addEvent({ delay: 700, loop: true, callback: () => n.setFrame(n.frame.name === 0 ? 1 : 0) }); }
      else if (w === 4) this.add.image(tx(dcr), ty(dcr), 'xray').setDepth(2);
      else { const l = this.add.sprite(tx(dcr), ty(dcr), 'lights').setDepth(2); this.time.addEvent({ delay: 500, loop: true, callback: () => l.setFrame(l.frame.name === 0 ? 1 : 0) }); }
    }

    this.kibble = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const k of level.kibble) {
      const s = this.kibble.create(tx(k), ty(k), 'kibble').setDepth(8);
      s.body.setSize(8, 8);
      s.play({ key: 'kibble-glint', delay: Math.random() * 1000 });
      this.tweens.add({ targets: s, y: s.y - 2, duration: 600 + Math.random() * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    for (const l of level.lamps) this.add.image(tx(l), tbottom(l), 'lamp').setOrigin(0.5, 1).setDepth(2);

    // sleepy Zs (Delia only, or Biscuit rolling 'ghost'); level char 'G'
    this.seesMice = this.passives.includes('ghost');
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
    for (const r of level.roombas) new Roomba(this, tx(r), tbottom(r), this.enemies);
    for (const q of level.squirrels) new Squirrel(this, tx(q), tbottom(q), this.enemies);
    for (const y of level.sprays) new SprayBottle(this, tx(y), tbottom(y), this.enemies);
    this.physics.add.collider(this.enemies, this.layer);
    this.sprinklers = level.sprinklers.map(sp => new Sprinkler(this, tx(sp), tbottom(sp)));
    this.projectiles = this.physics.add.group();
    this.physics.add.collider(this.projectiles, this.layer, (pr) => { if (pr.kind === 'acorn') pr.destroy(); });
    this.yarns = this.physics.add.group();
    this.physics.add.collider(this.yarns, this.layer);
    this.physics.add.overlap(this.yarns, this.enemies, (y, e) => { if (e.alive) { e.stomp(); Sfx.stomp(); this.popText(e.x, e.y - 14, 'BONK', 0x3a3a48); } });
    this.laserDot = null;

    this.cucumbers = this.physics.add.group({ allowGravity: false, immovable: true });
    this.cucumberTriggers = level.cucumbers.map(c => ({ x: c.x * TILE, y: tbottom(c), fired: false }));

    this.items = this.physics.add.group();
    this.physics.add.collider(this.items, this.layer);

    // teach the curtains: a hint over the first one until the cat has climbed
    this.climbHint = null;
    if (level.curtains.length && !GameState.climbed) {
      const first = level.curtains.reduce((a, c) => (c.x < a.x || (c.x === a.x && c.y < a.y) ? c : a));
      const hx = tx(first), hy = this.mapOffsetY + first.y * TILE - 6;
      const bg = this.add.rectangle(hx, hy, 52, 11, 0x1a1410, 0.7).setDepth(49);
      const txt = this.add.bitmapText(hx, hy, 'font', 'UP: CLIMB').setOrigin(0.5).setDepth(50).setTint(0xfff4dc);
      this.climbHint = { bg, txt, x: hx };
      this.tweens.add({ targets: [bg, txt], y: hy - 3, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

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
    this.physics.add.overlap(this.player.box, this.projectiles, (box, pr) => { if (!this.player.hiding) { pr.destroy(); this.hurt(pr.x); } else pr.destroy(); });

    // --- chase / bosses --------------------------------------------------------
    this.chase = level.chase ? { dog: new Dog(this, start.x - 60, start.y), started: false } : null;
    if (level.boss === 'vacuum') this.setupVacuum(level, tx, tbottom);
    if (level.boss === 'bath') this.setupBath(level, tx, ty, tbottom);

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
    this.keyAct = kb.addKeys({ b: 'B', x: 'X' });   // B / X double as the action button on keyboards
    kb.on('keydown', () => { Sfx.unlock(); Music.resume(); if (this.touch) this.touch.setVisible(false); });
    this.input.on('pointerdown', () => { Sfx.unlock(); Music.resume(); });
    if (this.sys.game.device.input.touch) this.touch = new TouchControls(this);

    // --- HUD / debug ---------------------------------------------------------------
    this.hud = new Hud(this, this.seesMice);
    this.debugOn = false;
    this.debugText = this.add.text(2, 20, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 2, y: 1 },
    }).setScrollFactor(0).setDepth(1001).setVisible(false);

    if (level.boss) Sfx.boss();

    // level banner (+ passive note for Biscuit / Deli)
    const banner = this.add.bitmapText(W / 2, 60, 'font', 'LEVEL ' + level.id).setOrigin(0.5).setScale(2).setScrollFactor(0).setDepth(1500).setTint(0x3a2414);
    this.tweens.add({ targets: banner, alpha: 0, delay: 1200, duration: 400, onComplete: () => banner.destroy() });
    const catDef = CATS[GameState.cat];
    let note = null;
    if (catDef.passives.includes('chaos')) note = 'CHAOS: ' + this.passives[0].toUpperCase();
    if (this.passives.includes('stocked')) {
      const pick = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
      note = 'STOCKED: ' + pick.toUpperCase();
      this.time.delayedCall(600, () => { if (this.player && !this.player.dead) this.applyPowerup(pick, this.player.box.x, this.player.box.y); });
    }
    if (note) {
      const sub = this.add.bitmapText(W / 2, 80, 'font', note).setOrigin(0.5).setScrollFactor(0).setDepth(1500).setTint(0x8c3a1a);
      this.tweens.add({ targets: sub, alpha: 0, delay: 1800, duration: 400, onComplete: () => sub.destroy() });
    }
  }

  drawBackdrop(mapW, worldH, world) {
    const cam = this.cameras.main;
    if (world && world !== 1) {
      const keyFar = 'bg-far-' + world, keyNear = 'bg-near-' + world;
      if (!this.textures.exists(keyFar)) this.makeBackdropTextures(world, keyFar, keyNear);
      const skyColors = { 2: '#9fd0f0', 3: '#101428', 4: '#d8ecec', 5: '#f4b08a' };
      cam.setBackgroundColor(skyColors[world]);
      this.add.tileSprite(0, 0, W, H, keyFar).setOrigin(0).setScrollFactor(0).setDepth(0).setName('far');
      this.add.tileSprite(0, 0, W, H, keyNear).setOrigin(0).setScrollFactor(0).setDepth(0.5).setName('near');
      this.parallax = true;
      return;
    }
    cam.setBackgroundColor('#e6d8bf');
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

  /** Two 320x180 repeating backdrop textures per world (spec §6 parallax). */
  makeBackdropTextures(world, keyFar, keyNear) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const rect = (c, x, y, w, h) => { g.fillStyle(c, 1); g.fillRect(x, y, w, h); };
    const circ = (c, x, y, r) => { g.fillStyle(c, 1); g.fillCircle(x, y, r); };
    // far layer
    g.clear();
    if (world === 2) { rect(0x9fd0f0, 0, 0, W, H); for (let i = 0; i < 5; i++) { circ(0xffffff, 30 + i * 70, 30 + (i % 2) * 18, 12); circ(0xffffff, 48 + i * 70, 34 + (i % 2) * 18, 9); } rect(0x6fa85a, 0, 120, W, 60); for (let i = 0; i < 4; i++) { circ(0x4f8a3a, 40 + i * 90, 118, 22); rect(0x5a3a1a, 37 + i * 90, 118, 6, 30); } }
    if (world === 3) { rect(0x101428, 0, 0, W, H); for (let i = 0; i < 40; i++) rect(0xffffff, (i * 53) % W, (i * 29) % 90, 1, 1); circ(0xfff4c0, 260, 30, 12); for (let i = 0; i < 6; i++) { const h = 60 + (i * 37) % 50; rect(0x1c2040, i * 56, H - h - 20, 44, h + 20); for (let y = 0; y < h; y += 10) for (let x = 4; x < 40; x += 10) if ((x + y + i) % 3) rect(0xf2c94c, i * 56 + x, H - h - 16 + y, 4, 5); } }
    if (world === 4) { rect(0xd8ecec, 0, 0, W, H); rect(0xa8c8c8, 0, 0, W, 12); rect(0x8fb0b0, 0, 12, W, 2); for (let i = 0; i < 4; i++) { rect(0xffffff, 20 + i * 84, 30, 48, 36); rect(0x7fc8c8, 24 + i * 84, 34, 40, 28); } rect(0xb8d0d0, 0, 140, W, 40); }
    if (world === 5) { rect(0xf4b08a, 0, 0, W, 90); rect(0xe88a6a, 0, 90, W, 90); circ(0xffe0a0, 250, 70, 18); for (let i = 0; i < 7; i++) { const h = 40 + (i * 31) % 60; rect(0x5a3a4a, i * 48, H - h, 40, h); } }
    g.generateTexture(keyFar, W, H);
    // near layer (transparent background)
    g.clear();
    if (world === 2) { for (let i = 0; i < 20; i++) { rect(0xe8d8b0, i * 16, 130, 8, 30); rect(0xe8d8b0, i * 16 - 2, 130, 12, 3); } rect(0xd8c8a0, 0, 150, W, 3); for (let i = 0; i < 6; i++) circ(0x4f8a3a, 20 + i * 56, 156, 12); }
    if (world === 3) { rect(0x2a2438, 0, 100, W, 80); for (let y = 100; y < 180; y += 8) for (let x = 0; x < W; x += 16) rect(0x342c44, x + (y % 16 ? 8 : 0), y, 15, 7); rect(0x1a1428, 0, 178, W, 2); }
    if (world === 4) { for (let i = 0; i < 5; i++) { rect(0xe8f0f0, 10 + i * 66, 90, 50, 70); rect(0xc8d8d8, 10 + i * 66, 90, 50, 3); rect(0xc8d8d8, 34 + i * 66, 90, 2, 70); rect(0x8fb0b0, 22 + i * 66, 120, 6, 2); rect(0x8fb0b0, 42 + i * 66, 120, 6, 2); } }
    if (world === 5) { for (let i = 0; i < 8; i++) { rect(0x3a2a34, i * 44, 150, 3, 30); } rect(0x3a2a34, 0, 150, W, 3); rect(0x3a2a34, 0, 164, W, 2); for (let i = 0; i < 5; i++) { circ(0x8f6a4a, 30 + i * 70, 150, 8); rect(0x6a4a3a, 28 + i * 70, 150, 4, 30); } }
    g.generateTexture(keyNear, W, H);
    g.destroy();
  }

  /**
   * Non-interactive scenery behind the tiles (spec §6 theme props, and the
   * user's cat trees and fish house). Deterministic per level: props go on
   * floor stretches every 7-12 tiles, wall pieces up on the wall between them.
   */
  placeScenery(level) {
    const SETS = {
      1: { floor: ['deco-cattree', 'deco-fishhouse', 'deco-bookshelf', 'deco-plant', 'deco-bowls', 'deco-post', 'deco-fishhouse', 'deco-cattree'], wall: ['deco-frame'] },
      2: { floor: ['deco-flowers', 'deco-gnome', 'deco-flowers', 'deco-hose', 'deco-flowers'], wall: [], air: ['deco-butterfly'] },
      3: { floor: ['deco-trashcan', 'deco-boxes', 'deco-puddle', 'deco-trashcan'], wall: ['deco-poster'] },
      4: { floor: ['deco-carrier', 'deco-scale', 'deco-plant', 'deco-carrier'], wall: ['deco-chart'] },
      5: { floor: ['deco-umbrella', 'deco-plant', 'deco-coffee', 'deco-umbrella'], wall: [], air: ['deco-pigeon'] },
    };
    const set = SETS[level.world]; if (!set) return;
    const rows = Levels.get(level.id).rows;
    const W = level.width, H = level.height;
    const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? '.' : rows[y][x];
    const solidCh = '#TrUX';
    let seed = 7 + level.id.charCodeAt(0) * 31 + level.id.charCodeAt(2) * 17;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const anim = { 'deco-fishhouse': 'deco-fishhouse-blink', 'deco-butterfly': 'deco-butterfly-flap', 'deco-pigeon': 'deco-pigeon-peck' };
    const add = (key, x, y, depth) => {
      const sp = this.add.sprite(x, y, key).setOrigin(0.5, 1).setDepth(depth);
      if (anim[key]) sp.play({ key: anim[key], delay: rnd() * 800 });
      return sp;
    };
    let x = 6 + Math.floor(rnd() * 4);
    let n = 0;
    while (x < W - 8) {
      // a floor prop needs solid floor under it and two clear rows above the floor top
      let fy = -1;
      for (let y = 5; y < H; y++) if (solidCh.includes(at(x, y)) && !solidCh.includes(at(x, y - 1))) { fy = y; break; }
      const blockers = '#TrUX=B?^|WN';
      const clear = fy > 0 && [x - 1, x, x + 1].every(cx => !blockers.includes(at(cx, fy - 1)) && !blockers.includes(at(cx, fy - 2)) && !blockers.includes(at(cx, fy - 3)));
      if (clear && fy > 0) {
        const key = set.floor[n % set.floor.length];
        add(key, x * TILE + 8, this.mapOffsetY + fy * TILE, 1.5 + (n % 3) * 0.1);
        n++;
      }
      // a wall piece up high, between floor props
      if (set.wall.length && rnd() < 0.5) {
        const wx = x + 3 + Math.floor(rnd() * 3), wy = 2 + Math.floor(rnd() * 2);
        if (wx < W - 8 && at(wx, wy) === '.' && at(wx, wy + 1) === '.' && at(wx, wy - 1) === '.') add(set.wall[Math.floor(rnd() * set.wall.length)], wx * TILE + 8, this.mapOffsetY + (wy + 1) * TILE, 1.2);
      }
      // something in the air (butterflies, pigeons on the parapet) now and then
      if (set.air && rnd() < 0.45) {
        const ax = x + 2 + Math.floor(rnd() * 4), ay = 1 + Math.floor(rnd() * 4);
        if (ax < W - 8 && at(ax, ay) === '.') {
          const sp = add(set.air[0], ax * TILE + 8, this.mapOffsetY + (ay + 1) * TILE, 1.4);
          if (set.air[0] === 'deco-butterfly') this.tweens.add({ targets: sp, y: sp.y - 10, x: sp.x + 12, duration: 1800 + rnd() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
      }
      x += 5 + Math.floor(rnd() * 5);
    }
  }

  // --- tile queries -------------------------------------------------------------
  tileAt(wx, wy) { return this.layer.getTileAtWorldXY(wx, wy); }
  solidAt(wx, wy) { const t = this.tileAt(wx, wy); return !!(t && t.collides); }
  curtainAt(wx, wy) { const t = this.tileAt(wx, wy); return !!(t && (t.index === this.T.CURTAIN || t.index === this.T.CURTAIN_TOP)); }
  kitchenAt(wx, wy) { const t = this.tileAt(wx, wy); return !!(t && t.index === this.T.KITCHEN); }
  /** World y of the top edge of the topmost curtain tile in this column. */
  curtainTopY(wx, wy) {
    let t = this.tileAt(wx, wy);
    if (!t) return -9999;
    while (t.y > 0) { const up = this.layer.getTileAt(t.x, t.y - 1); if (!up || (up.index !== this.T.CURTAIN && up.index !== this.T.CURTAIN_TOP)) break; t = up; }
    return this.mapOffsetY + t.y * TILE;
  }

  rainbowPuff(x, y) {
    const hue = (this.time.now / 6) % 360;
    const color = Phaser.Display.Color.HSVToRGB(hue / 360, 0.8, 1).color;
    const r = this.add.rectangle(x, y, 3, 3, color, 1).setDepth(9);
    this.tweens.add({ targets: r, alpha: 0, y: y - 6, duration: 400, onComplete: () => r.destroy() });
  }

  /** Mochi's yowl: stun every enemy on screen. */
  yowl() {
    Sfx.yowl();
    const cam = this.cameras.main;
    cam.shake(200, 0.004);
    for (const e of this.enemies.getChildren()) {
      if (e.alive && e.stun && Math.abs(e.x - cam.midPoint.x) < W * 0.6) e.stun(PHYS.yowlStun);
    }
    const p = this.player;
    p.squash(p.baseScale * 1.3, p.baseScale * 1.3, 220);
    this.popText(p.box.x, p.box.y - 20, 'YOWL!', 0xc0304a);
  }

  throwAcorn(x, y, dir, dist) {
    const a = this.projectiles.create(x, y, 'acorn').setDepth(10);
    a.kind = 'acorn';
    a.body.setCircle(3);
    const vx = dir * Math.min(120, 50 + dist * 0.5);
    a.body.setVelocity(vx, -200);
    Sfx.throw_();
    this.time.delayedCall(4000, () => a.active && a.destroy());
  }

  fireBlob(x, y, dir, targetX, targetY) {
    const bl = this.projectiles.create(x, y, 'blob').setDepth(10);
    bl.kind = 'blob';
    bl.body.setAllowGravity(false);
    bl.body.setSize(4, 4);
    // aim at the cat (clamped to a shallow angle so it stays dodgeable)
    const ddx = ((targetX !== undefined ? targetX : x + dir) - x) * dir;   // measured along the firing direction
    const ddy = (targetY !== undefined ? targetY : y) - y;
    const ang = Phaser.Math.Clamp(Math.atan2(ddy, Math.max(1, ddx)), -0.6, 0.6);
    bl.body.setVelocity(dir * Math.cos(ang) * 110, Math.sin(ang) * 110);
    Sfx.spray();
    this.time.delayedCall(2500, () => bl.active && bl.destroy());
  }

  /** Action button with a held item: laser pointer or yarn ball. */
  useItem() {
    const p = this.player, it = p.item;
    if (!it || it.charges <= 0) return;
    const cx = p.box.x, cy = p.box.y;
    if (it.kind === 'laser') {
      Sfx.laser();
      const tx = cx + p.facing * PHYS.laserRange, ty = cy + 4;
      if (this.laserDot) this.laserDot.destroy();
      const dot = this.add.image(tx, ty, 'dot').setDepth(14);
      this.laserDot = dot;
      this.tweens.add({ targets: dot, alpha: 0.3, yoyo: true, repeat: -1, duration: 120 });
      // nearest live enemy chases the dot for 3s (roombas walk off ledges)
      let best = null, bd = 1e9;
      for (const e of this.enemies.getChildren()) { if (!e.alive || e.kind !== 'roomba') continue; const d = Math.abs(e.x - tx); if (d < bd) { bd = d; best = e; } }
      if (best) { best.chaseX = tx; best.chaseT = 3; }
      this.time.delayedCall(3000, () => { if (this.laserDot === dot) { dot.destroy(); this.laserDot = null; } });
    } else if (it.kind === 'yarn') {
      Sfx.throw_();
      new Yarn(this, cx + p.facing * 12, p.body.y + p.body.height - 6, p.facing, this.yarns);   // rolls along the floor
    }
    it.charges -= 1;
    if (it.charges <= 0) p.item = null;
    this.hud.refresh();
  }

  // --- Vacuum boss (4-4) ----------------------------------------------------------
  setupVacuum(level, tx, tbottom) {
    const x = tx(level.vacuum), y = tbottom(level.vacuum);
    const v = this.add.sprite(x, y, 'vacuum', 0).setDepth(9);
    v.setOrigin(0.5, 1);
    this.boss = { kind: 'vacuum', sprite: v, x, y, hits: 0, alive: true, plug: null, plugT: 0.5, humT: 0 };
    this.time.addEvent({ delay: 300, loop: true, callback: () => { if (this.boss.alive) v.setFrame(v.frame.name === 0 ? 1 : 0); } });
    this.bossText = this.add.bitmapText(W / 2, 20, 'font', 'STOMP THE PLUG x3').setOrigin(0.5).setScrollFactor(0).setDepth(1500).setTint(0x8c3a1a);
  }

  spawnPlug() {
    const bs = this.boss;
    const pl = this.physics.add.sprite(bs.x - 24, bs.y - 4, 'plug').setDepth(10);
    pl.body.setSize(12, 14).setOffset(-1, -6);   // tall body so a falling cat can't skip past it
    pl.body.setBounce(0, 0);
    pl.dir = -1;
    this.physics.add.collider(pl, this.layer);
    bs.plug = pl;
    this.physics.add.overlap(this.player.box, pl, () => this.onPlug(pl));
  }

  onPlug(pl) {
    const bs = this.boss;
    if (!bs.alive || !pl.active || pl.hit) return;
    const pb = this.player.body;
    const stomp = (pb.velocity.y > 0 || this.player.lastVy > 50 || this.player.landedThisFrame) && (pb.y + pb.height) <= pl.body.y + pl.body.height;
    if (!stomp) return;
    pl.hit = true;
    pb.setVelocityY(PHYS.stompBounce);
    Sfx.stomp();
    bs.hits += 1;
    this.cameras.main.shake(150, 0.006);
    this.popText(pl.x, pl.y - 12, bs.hits + '/3', 0xf2c94c);
    this.tweens.add({ targets: pl, alpha: 0, scaleY: 0.3, duration: 200, onComplete: () => pl.destroy() });
    bs.plug = null; bs.plugT = 1.5;
    if (bs.hits >= 3) this.bossDefeated();
  }

  bossDefeated() {
    const bs = this.boss;
    bs.alive = false;
    Sfx.win();
    if (this.bossText) this.bossText.setText('THE COAST IS CLEAR!');
    if (bs.kind === 'vacuum') {
      this.tweens.add({ targets: bs.sprite, angle: 80, y: bs.sprite.y + 6, duration: 700, ease: 'Bounce.easeOut' });
      for (let i = 0; i < 6; i++) this.time.delayedCall(i * 120, () => this.dust(bs.x - 10 + Math.random() * 20, bs.y - Math.random() * 20, 1));
    }
    this.doorLocked = false;
    if (this.doorway && !this.flap) { this.doorway.setFrame(0); if (this.glen) { this.glen.setVisible(true); this.em.setVisible(true); } }
  }

  updateVacuum(dt) {
    const bs = this.boss, p = this.player, b = p.body;
    if (!bs.alive) return;
    bs.humT -= dt; if (bs.humT <= 0) { bs.humT = 0.6; Sfx.hum(); }
    // landing squarely on the plug counts, even if the floor collider resolved first
    if (bs.plug && bs.plug.active && !bs.plug.hit && p.landedThisFrame) {
      const pl = bs.plug, cx = b.x + b.halfWidth, feet = b.y + b.height;
      if (Math.abs(cx - pl.x) < 15 && Math.abs(feet - (pl.body.y + pl.body.height)) < 6) this.onPlug(pl);
    }
    // plug skitters along the floor between the walls; respawns after a hit
    if (!bs.plug) { bs.plugT -= dt; if (bs.plugT <= 0) this.spawnPlug(); }
    else {
      // the cord only reaches so far: the plug skitters within 180px of the vacuum
      const pl = bs.plug;
      if (pl.body.blocked.left || pl.x < bs.x - 180) pl.dir = 1;
      else if (pl.body.blocked.right || pl.x > bs.x - 12) pl.dir = -1;
      pl.body.setVelocityX(pl.dir * 70);
    }
    // suction unless a steel table stands between the cat and the vacuum
    const cx = b.x + b.halfWidth, cy = b.y + b.halfHeight;
    const dx = bs.x - cx;
    if (Math.abs(dx) < 260 && !p.dead && !p.hiding) {
      let covered = false;
      const step = Math.sign(dx) * TILE;
      for (let x = cx + step; Math.abs(x - cx) < Math.abs(dx); x += step) { const t = this.tileAt(x, cy); if (t && t.index === this.T.BLOCK) { covered = true; break; } }
      if (!covered) {
        // a steady drift (not a force), so the cat's own movement logic stays in
        // charge: standing still drifts in, walking away barely holds, running escapes
        p.box.x += Math.sign(dx) * PHYS.vacuumPull * dt;
        if (Math.random() < 0.15) this.dust(cx - Math.sign(dx) * 12, b.y + b.height, -Math.sign(dx));
      }
    }
    if (Math.abs(dx) < 16 && Math.abs(bs.y - (b.y + b.height)) < 24) this.hurt(bs.x);
  }

  // --- Bath boss (5-2) -------------------------------------------------------------
  setupBath(level, tx, ty, tbottom) {
    const x = tx(level.bath), y = tbottom(level.bath);
    const floorY = this.mapOffsetY + 7 * TILE;
    this.boss = { kind: 'bath', alive: true, x, y, floorY, level: 0, rate: 1 / PHYS.bathFillTime, plugsLeft: level.plugs.length, ducks: [] };
    // tap
    const tap = this.add.graphics().setDepth(4);
    tap.fillStyle(0xc8c8d0, 1); tap.fillRect(x - 4, y - 40, 8, 40); tap.fillRect(x - 4, y - 44, 22, 6); tap.fillCircle(x + 18, y - 38, 4);
    this.water = this.add.rectangle(0, floorY, this.worldW, 0, 0x3a6fbf, 0.7).setOrigin(0, 1).setDepth(12);
    this.waterTop = this.add.rectangle(0, floorY, this.worldW, 2, 0x9fd0ff, 0.9).setOrigin(0, 1).setDepth(12);
    for (const pg of level.plugs) {
      const d = this.physics.add.image(tx(pg), tbottom(pg), 'drain').setOrigin(0.5, 1).setDepth(10);
      d.body.setAllowGravity(false); d.body.setImmovable(true);
      d.body.setSize(10, 6).setOffset(0, 0);
      this.physics.add.overlap(this.player.box, d, () => this.onDrain(d));
    }
    for (const dk of level.ducks) {
      const d = this.physics.add.sprite(tx(dk), tbottom(dk) - 4, 'duck').setDepth(10);
      d.body.setBounce(1, 0.9);
      d.body.setVelocity((Math.random() < 0.5 ? -1 : 1) * 60, -80);
      d.body.setCollideWorldBounds(true);
      d.body.setSize(10, 8);
      this.physics.add.collider(d, this.layer);
      this.physics.add.overlap(this.player.box, d, () => this.onDuck(d));
      this.time.addEvent({ delay: 250, loop: true, callback: () => d.active && d.setFrame(d.frame.name === 0 ? 1 : 0) });
      this.boss.ducks.push(d);
    }
    this.bossText = this.add.bitmapText(W / 2, 20, 'font', 'PULL 4 PLUGS!').setOrigin(0.5).setScrollFactor(0).setDepth(1500).setTint(0x8c3a1a);
  }

  onDrain(d) {
    const bs = this.boss;
    if (!bs.alive || !d.active) return;
    const pb = this.player.body;
    const stomp = (pb.velocity.y > 0 || this.player.lastVy > 50 || this.player.landedThisFrame) && (pb.y + pb.height) <= d.body.y + d.body.height + 2;
    if (!stomp) return;
    d.destroy();
    pb.setVelocityY(PHYS.stompBounce);
    Sfx.stomp(); Sfx.splash();
    bs.plugsLeft -= 1;
    bs.level = Math.max(0, bs.level - 0.22);
    bs.rate *= 0.8;
    this.popText(d.x, d.y - 12, (4 - bs.plugsLeft) + '/4', 0xf2c94c);
    if (bs.plugsLeft <= 0) { bs.rate = -0.5; this.bossDefeated(); }
  }

  onDuck(d) {
    const pb = this.player.body;
    const stomp = pb.velocity.y > 0 && (pb.y + pb.height) < d.body.y + d.body.height * 0.6;
    if (stomp) { pb.setVelocityY(PHYS.stompBounce); d.body.setVelocityY(120); Sfx.boing(); }
    else this.hurt(d.x);
  }

  updateBath(dt) {
    const bs = this.boss, p = this.player, b = p.body;
    bs.level = Phaser.Math.Clamp(bs.level + bs.rate * dt, 0, 1);
    const maxH = bs.floorY - (this.mapOffsetY + 8);
    const h = bs.level * maxH;
    this.water.height = h; this.water.setSize(this.worldW, h);
    this.waterTop.y = bs.floorY - h;
    for (const d of bs.ducks) if (d.active && d.y > bs.floorY - h - 4 && h > 6) { d.body.setVelocityY(Math.min(d.body.velocity.y, -90)); }
    if (bs.alive && h > 4 && (b.y + b.height) > bs.floorY - h + 4 && !p.dead) { Sfx.splash(); this.die(); }
    if (!bs.alive && bs.level <= 0) this.water.setVisible(false);
  }

  breakBrick(tile) {
    const wx = tile.x * TILE, wy = this.mapOffsetY + tile.y * TILE;
    Sfx.crack();
    this.layer.removeTileAt(tile.x, tile.y);
    for (const [ox, oy, vx, vy] of [[3, 3, -70, -220], [11, 3, 70, -220], [3, 11, -50, -150], [11, 11, 50, -150]]) {
      const bit = this.physics.add.image(wx + ox, wy + oy, 'brick-bit').setDepth(12);
      bit.body.setVelocity(vx, vy);
      this.time.delayedCall(900, () => bit.destroy());
    }
  }

  /** Which powerup a paw block holds: the first block of a level is always tuna. */
  powerupFor(tile) {
    const first = this.level.pawBlocks.reduce((a, b) => (b.x < a.x ? b : a));
    if (tile.x === first.x && tile.y === first.y) return 'tuna';
    const h = (tile.x * 7 + tile.y * 13) % 13;
    return ['tuna', 'tuna', 'tuna', 'catnip', 'catnip', 'bell', 'fish', 'box', 'laser', 'laser', 'yarn', 'yarn', 'tuna'][h];
  }

  applyPowerup(kind, x, y) {
    const p = this.player;
    switch (kind) {
      case 'tuna':
        if (!p.super) p.setSuper(true); else this.popText(x, y - 8, 'YUM');
        Sfx.powerup();
        break;
      case 'catnip':
        p.catnip = PHYS.catnipTime;
        Sfx.catnip();
        this.popText(x, y - 8, 'ZOOMIES', 0x2f8f4f);
        break;
      case 'bell':
        p.bell = true; GameState.bell = true;
        Sfx.bell();
        this.popText(x, y - 8, 'JINGLE', 0xb8860b);
        break;
      case 'fish':
        GameState.lives += 1;
        Sfx.life();
        this.popText(x, y - 8, '1UP', 0x2f8f4f);
        break;
      case 'box':
      case 'laser':
      case 'yarn':
        p.item = { kind, charges: ITEM_CHARGES[kind] };
        Sfx.powerup();
        { const k = this.touch ? 'B' : 'SHIFT'; this.popText(x, y - 8, kind === 'box' ? 'HOLD ' + k + ' TO HIDE' : kind === 'laser' ? k + ': LASER' : k + ': THROW', 0x3a6fbf); }
        break;
    }
    this.hud.refresh();
  }

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

  heart(x, y) {
    const h = this.add.image(x, y, 'heart', Math.random() < 0.5 ? 0 : 1).setDepth(60);
    this.tweens.add({ targets: h, y: y - 18, x: x + (Math.random() - 0.5) * 8, alpha: 0, duration: 900, ease: 'Sine.easeOut', onComplete: () => h.destroy() });
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
    this.popText(m.x, m.y - 8, 'ZZZ', 0xc8d8ff);
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
      new Item(this, wx + 8, wy + 8, this.powerupFor(tile), dir, this.items);
      this.time.delayedCall(450, () => Sfx.powerup());
    } else if (tile.index === T.BRICK) {
      if (this.player.super) {
        this.breakBrick(tile);
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
    this.applyPowerup(it.kind, it.x, it.y);
    it.destroy();
  }

  // --- enemies ----------------------------------------------------------------------
  onEnemyContact(e) {
    if (!e.alive || this.player.dead || this.cutscene || this.player.hiding) return;
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
    this.popText(this.player.box.x, this.player.box.y - 16, GameState.cucumbered ? '!!' : 'CUCUMBER!!', 0x2f8f2f);
    GameState.cucumbered = true;
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

  hurt(fromX, water = false) {
    const p = this.player;
    if (p.invuln > 0 || p.dead || this.cutscene || p.hiding) return;
    if (p.super) {
      p.setSuper(false);
      p.invuln = 1.0;
      p.knockback(fromX, water && p.has('slide') ? 2 : 1);
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
    p.tail.setVisible(false); if (p.halo) p.halo.setVisible(false);
    p.boxSprite.setVisible(false); p.sprite.setVisible(true);
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
      GameState.bell = false;
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
    Music.duck(true);
    this.scene.pause();
    this.scene.launch('pause');
  }

  // --- door ending (spec §6) ------------------------------------------------------
  startEnding() {
    const p = this.player;
    this.cutscene = { step: this.flap ? 'flap' : 'walk', t: 0 };
    if (this.chase) { this.chase.done = true; }
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
      case 'flap':
        // dog chase: dive through the cat flap
        if (p.box.x >= this.doorX - 6 || cs.t > 3) { p.sprite.setVisible(false); p.tail.setVisible(false); p.body.enable = false; Sfx.door(); cs.step = 'close'; cs.t = 0; }
        break;
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
          // they step out of the doorway to either side of the cat and crouch
          this.tweens.add({ targets: this.em, x: this.doorX - 24, duration: 350, ease: 'Sine.easeInOut', onComplete: () => this.em.play('em-pet') });
          this.tweens.add({ targets: this.glen, x: this.doorX + 7, duration: 350, ease: 'Sine.easeInOut', onComplete: () => { this.glen.setFlipX(true); this.glen.play('glen-pet'); } });
          this.heartT = 0.3;
          Sfx.purr();
        }
        break;
      case 'pet':
        this.heartT -= dt; if (this.heartT <= 0) { this.heartT = 0.45; this.heart(p.sprite.x + (Math.random() - 0.5) * 12, p.sprite.y - 22); }
        if (cs.t >= 2.4) {
          cs.step = 'hug'; cs.t = 0;
          this.glen.play('glen-hug'); this.em.play('em-hug');
          this.tweens.add({ targets: this.em, x: this.doorX - 16, duration: 300 });
          this.tweens.add({ targets: this.glen, x: this.doorX + 5, duration: 300 });
          p.sprite.setDepth(4.5); p.tail.setDepth(4.4); if (p.halo) p.halo.setDepth(4.6);
          p.forceAnim = 'sit-loaf';
          p.sprite.y -= 6; p.tail.y -= 6;
          p.autoInput = () => NO_INPUT;
          p.body.enable = false;
        }
        break;
      case 'hug':
        this.heartT -= dt; if (this.heartT <= 0) { this.heartT = 0.35; this.heart(p.sprite.x + (Math.random() - 0.5) * 20, p.sprite.y - 26); }
        if (cs.t >= 1.6) {
          cs.step = 'close'; cs.t = 0;
          this.doorway.setFrame(1).setDepth(20);
          this.glen.setVisible(false); this.em.setVisible(false);
          p.sprite.setVisible(false); p.tail.setVisible(false); if (p.halo) p.halo.setVisible(false);
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
          GameState.bell = false;
          const ids = Levels.all();
          const cur = this.level.bonus ? GameState.afterBonus : this.level.id;
          const next = ids[ids.indexOf(cur) + 1];
          const nextWorld = next ? Levels.get(next).world : null;
          // finished a world with every ghost mouse found -> bonus level first
          if (!this.level.bonus && this.seesMice && nextWorld !== this.level.world && this.worldMiceComplete(this.level.world)) {
            GameState.afterBonus = this.level.id;
            GameState.level = Levels.bonusId;
            this.scene.restart();
          } else if (this.level.final) {
            this.scene.start('finale');
          } else if (next) { GameState.level = next; this.scene.restart(); }
          else { this.scene.start('title'); }
        }
        break;
    }
  }

  worldMiceComplete(world) {
    for (const id of Levels.all()) {
      const lv = Levels.get(id);
      if (lv.world !== world) continue;
      const total = lv.rows.join('').split('G').length - 1;
      if (total > 0 && (GameState.mice[id] || []).length < total) return false;
    }
    return true;
  }

  showTally() {
    const cam = this.cameras.main;
    const lines = [
      'LEVEL ' + this.level.id + ' CLEAR!',
      'KIBBLE ' + String(GameState.kibble).padStart(3, '0'),
      'LIVES x' + GameState.lives,
    ];
    if (this.seesMice) lines.push('ZS CAUGHT ' + (GameState.mice[this.level.id] || []).length + '/' + this.miceTotal);
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
      up: c.up.isDown || w.up.isDown || (t && t.up),
      down: c.down.isDown || w.down.isDown || (t && t.down),
      jump: c.space.isDown || (t && t.jump),
      jumpPressed: JustDown(c.space) || (t && t.jumpPressed),
      action: c.shift.isDown || this.keyAct.b.isDown || this.keyAct.x.isDown || (t && t.action),
      actionPressed: JustDown(c.shift) || JustDown(this.keyAct.b) || JustDown(this.keyAct.x) || (t && t.actionPressed),
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
    if (JustDown(this.keyMute)) { this.muted = !this.muted; Sfx.setMuted(this.muted); Music.setMuted(this.muted); }
    if (JustDown(this.keyPause) || JustDown(this.keyPause2)) { this.togglePause(); return; }

    const p = this.player;
    const b = p.body;

    if (!p.dead && !this.cutscene && b.blocked.up && p.lastVy < 0) {
      const t = this.tileAt(b.x + b.halfWidth, b.y - 2);
      if (t && (t.index === this.T.PAW || t.index === this.T.BRICK)) this.bonkBlock(t);
    }

    p.update(inp, dt);

    if (this.parallax) {
      const sx = this.cameras.main.scrollX;
      const far = this.children.getByName('far'), near = this.children.getByName('near');
      if (far) far.tilePositionX = sx * 0.25;
      if (near) near.tilePositionX = sx * 0.55;
    }
    if (this.cutscene) { this.updateEnding(dt); return; }
    if (p.dead) return;

    const cx = b.x + b.halfWidth;
    const feet = b.y + b.height;

    // dog chase: the camera auto-scrolls, the dog gains when you dawdle
    if (this.chase) {
      const ch = this.chase, cam = this.cameras.main;
      if (!ch.started && cx > 40) { ch.started = true; ch.scroll = Math.max(0, cam.scrollX); cam.stopFollow(); Sfx.bark(); }
      if (ch.started) {
        // own float accumulator: the camera rounds scroll to whole pixels each
        // frame, which would swallow sub-pixel steps at slow scroll speeds
        ch.scroll = Math.min(ch.scroll + PHYS.chaseScroll * dt, this.worldW - W);
        cam.scrollX = ch.scroll;
        const dog = ch.dog;
        const target = cam.scrollX - 6;
        const gain = (b.velocity.x < PHYS.chaseScroll * 0.8) ? PHYS.dogSpeed : PHYS.chaseScroll;
        dog.x = Math.min(dog.x + gain * dt, Math.max(target, dog.x - 20 * dt));
        dog.x = Math.max(dog.x, target - 40);
        dog.y = this.floorBelow(dog.x + 8, this.mapOffsetY + 4 * TILE);
        if (b.x < cam.scrollX - 12 || dog.x + 12 > b.x) { this.die(); return; }
      } else { ch.dog.x = cx - 70; ch.dog.y = this.floorBelow(ch.dog.x, this.mapOffsetY + 4 * TILE); }
    }

    // bosses
    if (this.boss && this.boss.kind === 'vacuum') this.updateVacuum(dt);
    if (this.boss && this.boss.kind === 'bath') this.updateBath(dt);

    // sprinklers and water tiles
    for (const sp of this.sprinklers) if (sp.hitsPlayer(b)) { this.hurt(sp.x, true); break; }
    {
      const t1 = this.tileAt(cx, feet - 4), t2 = this.tileAt(cx, b.y + 4);
      if ((t1 && t1.index === this.T.WATER) || (t2 && t2.index === this.T.WATER)) { Sfx.splash(); this.hurt(cx + (p.facing * 8), true); }
    }

    if (b.y > this.worldH + 8) { this.die(); return; }

    // Marmalade's Bonk: dashing into a brick breaks it (momentum counts for a
    // moment after the dash ends, so clipping a wall at the tail of a dash works)
    if (p.has('bonk') && (p.dashTime > 0 || p.dashCooldown > PHYS.dashCooldown - PHYS.dashTime - 0.15) && (b.blocked.left || b.blocked.right)) {
      const t = this.tileAt(cx + p.dashDir * (b.halfWidth + 3), b.y + b.halfHeight);
      if (t && t.index === this.T.BRICK) { this.breakBrick(t); p.dashTime = Math.max(p.dashTime, 0.08); }
    }

    // bell collar: kibble within range drifts to the cat
    if (p.bell) {
      for (const k of this.kibble.getChildren()) {
        if (!k.active) continue;
        const dx = cx - k.x, dy = (b.y + b.halfHeight) - k.y;
        const d = Math.hypot(dx, dy);
        if (d < PHYS.bellRange && d > 1) { const s = 140 * dt / d; k.x += dx * s; k.y += dy * s; }
      }
    }

    // Mochi's cooldown bar
    if (this.hud.cool) {
      const on = p.has('yowl');
      this.hud.cool.setVisible(on);
      if (on) this.hud.cool.width = 14 * (1 - p.yowlCooldown / PHYS.yowlCooldown);
    }

    // catnip: gentle screen wobble
    this.cameras.main.setZoom(p.catnip > 0 ? 1 + Math.sin(time / 90) * 0.012 : 1);

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

    if (this.doorZone && !this.doorLocked && (p.grounded || this.flap) && Phaser.Geom.Rectangle.Contains(this.doorZone, cx, feet - 1)) this.startEnding();

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
// Full screen on phones. Android browsers honour requestFullscreen from a tap;
// iPhone Safari has no element full screen, so there the answer is Add to Home
// Screen (the manifest + meta tags make that launch without browser chrome).
const Fullscreen = {
  available() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); },
  active() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || navigator.standalone
      || (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)));
  },
  request() {
    if (!this.available() || this.active()) return;
    const el = document.documentElement;
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    Promise.resolve(p).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  },
};

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
  scene: [BootScene, TitleScene, SelectScene, PlayScene, PauseScene, FinaleScene],
});

window.addEventListener('resize', () => {
  const z = computeZoom();
  if (game.scale.zoom !== z) game.scale.setZoom(z);
});
