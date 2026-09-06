// sprites.js — procedural spritesheets.
//
// Every sprite in Nine Lives is data, not an image file. A frame is an array
// of rows; each row is a string where every character is one pixel:
//
//   '.'  or ' '   transparent
//   '0'..'9'      palette[0..9]
//   'a'..'z'      palette[10..35]
//
// makeSprite(name, frames, palette) draws all frames left-to-right onto one
// canvas, registers it as a Phaser texture called `name`, and adds numbered
// frames 0..n-1 so scene.anims.generateFrameNumbers(name, {start, end}) works.
//
// Character art is built from small hand-drawn parts (head, body, legs, tail)
// composed at offsets, so a walk cycle is "same parts, legs moved", and the
// parts stay editable as plain strings.

const Sprites = (() => {
  let textureManager = null;
  let built = false;

  function setTextureManager(tm) { textureManager = tm; }

  // ------------------------------------------------------------------------
  // Core helpers
  // ------------------------------------------------------------------------
  function parseColor(c) {
    if (Array.isArray(c)) return [c[0], c[1], c[2], c.length > 3 ? c[3] : 255];
    if (typeof c !== 'string' || c[0] !== '#') throw new Error('Sprites: bad color ' + c);
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map(ch => ch + ch).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error('Sprites: bad color ' + c);
    const n = parseInt(h, 16);
    if (h.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function charIndex(ch) {
    if (typeof ch === 'number') return ch;
    if (ch === '.' || ch === ' ') return -1;
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 97 && code <= 122) return code - 97 + 10;
    if (code >= 65 && code <= 90) return code - 65 + 10;
    throw new Error('Sprites: bad pixel char "' + ch + '"');
  }

  /**
   * Build a texture from index-art frames.
   * opts.width/height force a frame size; opts.align 'bottom' anchors the art
   * to the bottom of the frame (centred horizontally), otherwise top-left.
   */
  function makeSprite(name, frames, palette, opts = {}) {
    const tm = opts.textures || textureManager;
    if (!tm) throw new Error('Sprites.setTextureManager(scene.textures) must run before makeSprite');
    if (!Array.isArray(frames) || frames.length === 0) throw new Error('Sprites: ' + name + ' has no frames');
    if (!Array.isArray(frames[0])) frames = [frames];

    const artW = Math.max(...frames.map(f => Math.max(...f.map(r => r.length))));
    const artH = Math.max(...frames.map(f => f.length));
    const fw = opts.width || artW;
    const fh = opts.height || artH;
    if (artW > fw || artH > fh) {
      throw new Error('Sprites: ' + name + ' art (' + artW + 'x' + artH + ') exceeds frame size (' + fw + 'x' + fh + ')');
    }

    const rgba = palette.map(parseColor);
    const sheetW = fw * frames.length;
    const sheetH = fh;

    if (tm.exists(name)) tm.remove(name);
    const tex = tm.createCanvas(name, sheetW, sheetH);
    const ctx = tex.getContext();
    const img = ctx.createImageData(sheetW, sheetH);
    const data = img.data;

    frames.forEach((frame, i) => {
      const ox = i * fw;
      const fH = frame.length;
      const fW = Math.max(...frame.map(r => r.length));
      const dy = opts.align === 'bottom' ? fh - fH : 0;
      const dx = opts.align === 'bottom' ? Math.floor((fw - fW) / 2) : 0;
      for (let y = 0; y < fH; y++) {
        const row = frame[y];
        for (let x = 0; x < row.length; x++) {
          const idx = charIndex(row[x]);
          if (idx < 0) continue;
          const c = rgba[idx];
          if (!c) throw new Error('Sprites: ' + name + ' frame ' + i + ' uses palette index ' + idx + ' but palette has ' + rgba.length + ' colors');
          const p = ((y + dy) * sheetW + ox + x + dx) * 4;
          data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = c[3];
        }
      }
      tex.add(i, 0, ox, 0, fw, fh);
    });

    ctx.putImageData(img, 0, 0);
    tex.refresh();
    return { key: name, frameWidth: fw, frameHeight: fh, frameCount: frames.length };
  }

  function flipFrame(frame) {
    return frame.map(row => row.split('').reverse().join(''));
  }

  function addAnim(scene, key, textureKey, start, end, fps, repeat = -1) {
    if (scene.anims.exists(key)) return scene.anims.get(key);
    return scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(textureKey, { start, end }),
      frameRate: fps,
      repeat,
    });
  }

  /** Blank w x h frame. */
  function blank(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) rows.push('.'.repeat(w));
    return rows;
  }

  /**
   * Stamp `art` onto `frame` at (x, y). With union=true, outline pixels
   * (char '0') only land on transparent pixels, so overlapping parts merge
   * into one silhouette with a single outer outline.
   */
  function stamp(frame, art, x, y, union = false) {
    const H = frame.length, W = frame[0].length;
    const rows = frame.map(r => r.split(''));
    for (let j = 0; j < art.length; j++) {
      const row = art[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const px = x + i, py = y + j;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (union && ch === '0' && rows[py][px] !== '.') continue;
        rows[py][px] = ch;
      }
    }
    return rows.map(r => r.join(''));
  }

  function compose(w, h, layers) {
    let f = blank(w, h);
    for (const L of layers) {
      if (!L) continue;
      f = stamp(f, L.art, L.x || 0, L.y || 0, !!L.union);
    }
    return f;
  }

  /** Outlined oval, w x h: outline '0', fill '1', top highlight '2' (hiRows rows). */
  function oval(w, h, hiRows = 2) {
    const rows = [];
    const rx = w / 2, ry = h / 2;
    const inside = (x, y) => {
      const dx = (x + 0.5 - rx) / rx, dy = (y + 0.5 - ry) / ry;
      return dx * dx + dy * dy <= 1;
    };
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) { s += '.'; continue; }
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (edge) s += '0';
        else s += (y < 1 + hiRows) ? '2' : '1';
      }
      rows.push(s);
    }
    return rows;
  }

  // ------------------------------------------------------------------------
  // Cats. Every cat is the same rig (head, body oval, four legs, collar, tail
  // overlay) with its own parts and palette, so all cats share one animation
  // state machine (spec §2). Art faces right; the game flips for left.
  // ------------------------------------------------------------------------
  const FRAME_W = 32, FRAME_H = 24;

  /** Recolour a frame: map = { fromChar: toChar }. */
  function recolor(frame, map) {
    return frame.map(row => row.split('').map(ch => (map[ch] !== undefined ? map[ch] : ch)).join(''));
  }

  /** Solid blob (no outline) w x h filled with `fill`, optional bottom shade rows. */
  function blob(w, h, fill, shade, shadeRows = 0) {
    const rows = [];
    const rx = w / 2, ry = h / 2;
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - rx) / rx, dy = (y + 0.5 - ry) / ry;
        if (dx * dx + dy * dy > 1) s += '.';
        else s += (shade && y >= h - shadeRows) ? shade : fill;
      }
      rows.push(s);
    }
    return rows;
  }

  const LEG = ['0110', '0110', '0110', '0110', '0110', '0110', '0110', '0110', '0000'];
  const LEG_SHORT = ['0110', '0110', '0110', '0110', '0110', '0000'];
  const LEG_TUCK = ['0110', '0110', '0110', '0000'];

  // Standing legs: near-front 19, far-front 16, near-back 6, far-back 9; tops at y=15.
  function standLegs(leg) {
    return [
      { art: leg, x: 16, y: 15, far: true },
      { art: leg, x: 9, y: 15, far: true },
      { art: leg, x: 19, y: 15 },
      { art: leg, x: 6, y: 15 },
    ];
  }

  function walkLegs(leg, i, n) {
    const ph = (i / n) * Math.PI * 2;
    const sw = Math.round(2 * Math.sin(ph));
    const liftA = Math.cos(ph) > 0.4 ? 1 : 0;
    const liftB = Math.cos(ph + Math.PI) > 0.4 ? 1 : 0;
    const clamp = x => Math.max(5, Math.min(19, x));
    return [
      { art: leg, x: clamp(16 - sw), y: 15 - liftB, far: true },
      { art: leg, x: clamp(9 + sw), y: 15 - liftA, far: true },
      { art: leg, x: clamp(19 + sw), y: 15 - liftA },
      { art: leg, x: clamp(6 - sw), y: 15 - liftB },
    ];
  }

  function legSet(art, positions) {
    return positions.map(([x, y, far]) => ({ art, x, y, far: !!far }));
  }

  /**
   * One frame of a cat from part offsets.
   * def: { head, headBlink, headEarsBack, body, bodyLong, bodySquat, leg, legShort,
   *        legTuck, collar, collarDy, bodyX, bodyY, headX, headY, decorate(o) }
   */
  function catFrame(def, o) {
    const bodyY = (def.bodyY || 8) + (o.dy || 0);
    const headY = (def.headY || 0) + (o.dy || 0) + (o.headDy || 0);
    const body = o.body || def.body;
    const head = o.head || def.head;
    const legs = o.legs;
    const layers = [];
    for (const L of legs.filter(l => l.far)) layers.push({ art: L.art, x: L.x, y: L.y });
    layers.push({ art: body, x: (def.bodyX || 4) + (o.bodyDx || 0), y: bodyY, union: true });
    if (def.decorate) layers.push(...def.decorate({ bodyY, body, o }));
    for (const L of legs.filter(l => !l.far)) layers.push({ art: L.art, x: L.x, y: L.y, union: true });
    layers.push({ art: head, x: (def.headX || 17) + (o.headDx || 0), y: headY, union: true });
    layers.push({ art: def.collar, x: (def.headX || 17) + (o.headDx || 0) + (def.collarDx || 0), y: headY + (def.collarDy || 10) });
    return compose(FRAME_W, FRAME_H, layers);
  }

  /** Build the full shared frame set for a cat. Returns the frame-name map. */
  function buildCat(key, def) {
    const frames = [];
    const F = {};
    const push = (name, f) => { F[name] = frames.length; frames.push(f); };
    const leg = def.leg || LEG, legS = def.legShort || LEG_SHORT, legT = def.legTuck || LEG_TUCK;
    const stand = standLegs(leg);

    push('idle0', catFrame(def, { legs: stand }));
    push('idle1', catFrame(def, { legs: stand, dy: 1 }));
    push('idle2', catFrame(def, { legs: stand, dy: 1 }));
    push('idle3', catFrame(def, { legs: stand }));
    for (let i = 0; i < 6; i++) push('walk' + i, catFrame(def, { legs: walkLegs(leg, i, 6), dy: (i % 3 === 1) ? -1 : 0 }));
    for (let i = 0; i < 6; i++) push('run' + i, catFrame(def, { legs: walkLegs(leg, i, 6), head: def.headEarsBack, dy: (i % 3 === 1) ? -1 : 0 }));
    push('jump0', catFrame(def, { body: def.bodyLong, dy: -1, headDy: -1, legs: legSet(legS, [[17, 13, 1], [8, 15, 1], [20, 12], [5, 15]]) }));
    push('jump1', catFrame(def, { legs: legSet(legT, [[16, 15, 1], [9, 15, 1], [19, 15], [6, 15]]) }));
    push('fall0', catFrame(def, { legs: legSet(legS, [[17, 14, 1], [8, 14, 1], [20, 13], [5, 13]]) }));
    push('fall1', catFrame(def, { dy: 1, legs: legSet(legS, [[17, 15, 1], [8, 15, 1], [20, 14], [5, 14]]) }));
    push('land0', catFrame(def, { body: def.bodySquat, dy: 3, headDy: 1, legs: legSet(legS, [[16, 18, 1], [9, 18, 1], [19, 18], [6, 18]]) }));
    push('land1', catFrame(def, { dy: 2, legs: legSet(legS, [[16, 18, 1], [9, 18, 1], [19, 18], [6, 18]]) }));
    push('crouch', catFrame(def, { body: def.bodySquat, dy: 3, headDy: 2, legs: legSet(legS, [[16, 18, 1], [9, 18, 1], [19, 18], [6, 18]]) }));
    push('blink', catFrame(def, { legs: stand, head: def.headBlink }));
    push('hurt', catFrame(def, { body: def.bodyPuff || def.body, dy: -1, head: def.headEarsBack, legs: legSet(legS, [[17, 14, 1], [8, 14, 1], [20, 13], [5, 13]]) }));
    // signature sit pose (2 frames: open eyes, blink)
    push('sit0', def.sit(def, false));
    push('sit1', def.sit(def, true));

    makeSprite(key, frames, def.palette, { width: 32, height: 32, align: 'bottom' });
    const tailFrames = def.tail.map(t => compose(FRAME_W, FRAME_H, [{ art: t, x: def.tailX || 0, y: def.tailY || 1 }]));
    const tailAir = def.tailAir.map(t => compose(FRAME_W, FRAME_H, [{ art: t, x: def.tailX || 0, y: def.tailY || 1 }]));
    makeSprite(key + '-tail', tailFrames, def.palette, { width: 32, height: 32, align: 'bottom' });
    makeSprite(key + '-tail-air', tailAir, def.palette, { width: 32, height: 32, align: 'bottom' });
    // portrait: 48x48 picture frame with the sit pose inside
    const portrait = compose(48, 48, [
      { art: rectArt(48, 48, 'a', '9') },
      { art: rectArt(44, 44, 'b', '9'), x: 2, y: 2 },
      { art: def.sit(def, false), x: 8, y: 14 },
    ]);
    makeSprite(key + '-portrait', [portrait], def.palette.concat(['#7a4a24', '#c9c1b0', '#e6d8bf']), { width: 48, height: 48 });
    return F;
  }

  // Shared tail shapes (recoloured per cat)
  const TAIL_SWAY = [
    [
      '..00........', '.0210.......', '.0110.......', '.0110.......', '.0110.......', '.0110.......', '..0110......',
      '..0110......', '...0110.....', '....0110....', '.....0110...', '.....01100..', '......011110', '.......00000',
    ],
    [
      '...00.......', '..0210......', '..0110......', '..0110......', '.0110.......', '.0110.......', '.0110.......',
      '..0110......', '...0110.....', '....0110....', '.....0110...', '.....01100..', '......011110', '.......00000',
    ],
    [
      '............', '............', '00..........', '0210........', '0110........', '.0110.......', '.0110.......',
      '..0110......', '...0110.....', '....0110....', '.....0110...', '.....01100..', '......011110', '.......00000',
    ],
  ];
  const TAIL_UP = [[
    '.....00.....', '....0210....', '....0110....', '....0110....', '....0110....', '....0110....', '....0110....',
    '.....0110...', '.....0110...', '......0110..', '......0110..', '......01100.', '......011110', '.......00000',
  ]];

  // --- Scottie (spec §1.1) -------------------------------------------------
  const SCOTTIE_PAL = [
    '#0b0b10', // 0 outline / deep
    '#1c1c24', // 1 body
    '#3a3a48', // 2 highlight
    '#e8c53a', // 3 eye
    '#000000', // 4 pupil / nose
    '#2e2630', // 5 inner ear
    '#f2efe6', // 6 collar cream
    '#f0a6c0', // 7 collar pink trim
    '#3c3c44', // 8 collar buckle
  ];
  const SC_HEAD = [
    '.00.....00...',
    '.050...0550..',
    '.0550.05550..',
    '.05510055510.',
    '0112222211110',
    '0111111111110',
    '0111111341110',
    '0111111341110',
    '0111111111140',
    '.011111111110',
    '.001111111100',
    '...00000000..',
  ];
  const SC_HEAD_BLINK = SC_HEAD.map((r, i) => (i === 6 ? '0111111001110' : i === 7 ? '0111111111110' : r));
  const SC_HEAD_EARSBACK = [
    '.............',
    '00......00...',
    '0550...0550..',
    '.05510055510.',
    '0112222211110',
    '0111111111110',
    '0111111341110',
    '0111111341110',
    '0111111111140',
    '.011111111110',
    '.001111111100',
    '...00000000..',
  ];
  // Scottie's signature idle: the loaf, front paws stretched forward.
  function scottieSit(def, blink) {
    const paw = ['0000000', '0111110', '0000000'];
    return compose(FRAME_W, FRAME_H, [
      { art: oval(22, 9, 2), x: 3, y: 13, union: true },
      { art: paw, x: 16, y: 21, union: true },
      { art: paw, x: 19, y: 20, union: true },
      { art: blink ? SC_HEAD_BLINK : SC_HEAD, x: 15, y: 6, union: true },
      { art: def.collar, x: 15, y: 16 },
    ]);
  }
  const SCOTTIE = {
    palette: SCOTTIE_PAL,
    head: SC_HEAD, headBlink: SC_HEAD_BLINK, headEarsBack: SC_HEAD_EARSBACK,
    body: oval(18, 10, 2), bodyLong: oval(20, 9, 2), bodySquat: oval(18, 8, 2), bodyPuff: oval(19, 12, 2),
    collar: ['.7777', '76668', '.7777'], collarDy: 10,
    tail: TAIL_SWAY, tailAir: TAIL_UP,
    sit: scottieSit,
  };

  // --- Delia (spec §1.2) -----------------------------------------------------
  const DELIA_PAL = [
    '#3b3d48', // 0 outline
    '#f4f2ee', // 1 white
    '#d9d6d0', // 2 white shade
    '#7a7d86', // 3 gray
    '#5c5f69', // 4 gray shade
    '#a8c9a0', // 5 eye
    '#e3a0b0', // 6 nose
    '#9ec4a6', // 7 collar
    '#f2efe6', // 8 collar tag
  ];
  // Gray cap over the top of the head and both ears, white blaze down the front.
  const DL_HEAD = [
    '.00.....00...',
    '.040...0440..',
    '.0440.04440..',
    '.04430044310.',
    '0333333331110',
    '0333333311110',
    '0111111501110',
    '0111111501110',
    '0111111111160',
    '.011111111110',
    '.002111111200',
    '...00000000..',
  ];
  const DL_HEAD_BLINK = DL_HEAD.map((r, i) => (i === 6 ? '0111111001110' : i === 7 ? '0111111111110' : r));
  const DL_HEAD_EARSBACK = [
    '.............',
    '00......00...',
    '0440...0440..',
    '.04430044310.',
    '0333333331110',
    '0333333311110',
    '0111111501110',
    '0111111501110',
    '0111111111160',
    '.011111111110',
    '.002111111200',
    '...00000000..',
  ];
  // saddle patch: gray oval on the upper back, behind the shoulders
  const DL_SADDLE = blob(10, 6, '3', '4', 1);
  const DL_SADDLE_SQUAT = blob(10, 5, '3', '4', 1);
  function deliaDecorate({ bodyY, body }) {
    const squat = body.length <= 8;
    return [{ art: squat ? DL_SADDLE_SQUAT : DL_SADDLE, x: 5, y: bodyY + 1 }];
  }
  // Delia's signature idle: sitting upright, looking back over her shoulder,
  // tail curled around the front paws.
  function deliaSit(def, blink) {
    const headArt = flipFrame(blink ? DL_HEAD_BLINK : DL_HEAD);
    const tailCurl = ['.....0000000', '....03333333', '...033444444', '...0000000..'];
    const bodyUp = oval(12, 13, 0);
    return compose(FRAME_W, FRAME_H, [
      { art: bodyUp, x: 9, y: 9, union: true },
      { art: blob(8, 7, '3', '4', 1), x: 9, y: 10 },
      { art: LEG_SHORT, x: 14, y: 17, union: true },
      { art: LEG_SHORT, x: 18, y: 17, union: true },
      { art: tailCurl, x: 10, y: 20, union: true },
      { art: headArt, x: 6, y: 1, union: true },
      { art: flipFrame(def.collar), x: 8, y: 11 },
    ]);
  }
  const DELIA = {
    palette: DELIA_PAL,
    head: DL_HEAD, headBlink: DL_HEAD_BLINK, headEarsBack: DL_HEAD_EARSBACK,
    body: oval(18, 11, 0), bodyLong: oval(20, 10, 0), bodySquat: oval(18, 9, 0), bodyPuff: oval(19, 13, 0),
    bodyY: 7,
    collar: ['.7777', '77787', '.7777'], collarDy: 10,
    tail: TAIL_SWAY.map(t => recolor(t, { 1: '3', 2: '4' })),
    tailAir: TAIL_UP.map(t => recolor(t, { 1: '3', 2: '4' })),
    decorate: deliaDecorate,
    sit: deliaSit,
  };

  // --- The rest of the roster (spec §1.3): original designs, <= 6 visible colours each.
  // Shared palette slots: 0 outline, 1 base, 2 light/second, 3 marking, 4 inner ear,
  // 5 eye, 6 pupil, 7 nose, 8 collar.
  function blinkOf(head, eyeChars = '56') {
    return head.map((r, i) => {
      if (i !== 6 && i !== 7) return r;
      return r.split('').map(ch => (eyeChars.includes(ch) ? (i === 6 ? '0' : '1') : ch)).join('');
    });
  }
  function earsBackOf(head) {
    return ['.'.repeat(head[0].length), head[2], head[3]].concat(head.slice(4)).slice(0, head.length);
  }
  // Generic signature pose: sitting upright facing forward, tail curled round the paws.
  function sitUpright(def, blink) {
    const head = blink ? def.headBlink : def.head;
    const tailCurl = ['0000000.....', '3333330.....', '4444440.....', '.000000.....'];
    const tail = recolor(tailCurl, def.tailMap || {});
    const L = [
      { art: oval(12, 13, 0), x: 10, y: 9, union: true },
    ];
    if (def.decorateSit) L.push(...def.decorateSit());
    L.push(
      { art: def.legShort || LEG_SHORT, x: 12, y: 17, union: true },
      { art: def.legShort || LEG_SHORT, x: 16, y: 17, union: true },
      { art: tail, x: 4, y: 20, union: true },
      { art: head, x: 12, y: 1, union: true },
      { art: def.collar, x: 12, y: 11 },
    );
    return compose(FRAME_W, FRAME_H, L);
  }
  function bars(xs, y, h, ch) {
    return xs.map(x => ({ art: Array(h).fill(ch), x, y }));
  }

  // Marmalade — chunky orange tabby, stripes, white chin. Blue collar.
  const MARM_PAL = ['#4a2a10', '#e8923a', '#f4f2ee', '#b8641e', '#f0b890', '#7fbf5f', '#1a1a1a', '#e88a8a', '#4f8fe8'];
  const MARM_HEAD = [
    '.00.....00...',
    '.040...0440..',
    '.0440.04440..',
    '.04410044410.',
    '0113113113110',
    '0111311311110',
    '0111111561110',
    '0111111561110',
    '0111111122270',
    '.011111222220',
    '.002111122200',
    '...00000000..',
  ];
  const MARMALADE = {
    palette: MARM_PAL,
    head: MARM_HEAD, headBlink: blinkOf(MARM_HEAD), headEarsBack: earsBackOf(MARM_HEAD),
    body: oval(20, 11, 0), bodyLong: oval(22, 10, 0), bodySquat: oval(20, 9, 0), bodyPuff: oval(21, 13, 0),
    bodyX: 3, bodyY: 7,
    collar: ['.8888', '88888', '.8888'], collarDy: 10,
    tailMap: { 2: '3' },
    tail: TAIL_SWAY.map(t => recolor(t, { 2: '3' })), tailAir: TAIL_UP.map(t => recolor(t, { 2: '3' })),
    decorate: ({ bodyY }) => bars([7, 10, 13, 16], bodyY + 1, 3, '3'),
    decorateSit: () => bars([13, 16, 19], 11, 3, '3'),
    sit: sitUpright,
  };

  // Mochi — cream seal-point Siamese, blue eyes. Red collar.
  const MOCHI_PAL = ['#3a2a24', '#f2e6d0', '#d8c8b0', '#4a2f22', '#6a4a3a', '#4f8fe8', '#10101a', '#6a4a3a', '#c0304a'];
  const MOCHI_HEAD = [
    '.00.....00...',
    '.030...0330..',
    '.0330.03330..',
    '.03310033310.',
    '0111111111110',
    '0111111113310',
    '0111111563310',
    '0111111563310',
    '0111111333370',
    '.011111133330',
    '.002111133300',
    '...00000000..',
  ];
  const MOCHI_LEG = LEG.map((r, i) => (i >= 6 ? recolor([r], { 1: '3' })[0] : r));
  const MOCHI_LEG_S = LEG_SHORT.map((r, i) => (i >= 3 ? recolor([r], { 1: '3' })[0] : r));
  const MOCHI_LEG_T = LEG_TUCK.map((r, i) => (i >= 2 ? recolor([r], { 1: '3' })[0] : r));
  const MOCHI = {
    palette: MOCHI_PAL,
    head: MOCHI_HEAD, headBlink: blinkOf(MOCHI_HEAD), headEarsBack: earsBackOf(MOCHI_HEAD),
    body: oval(18, 10, 0), bodyLong: oval(20, 9, 0), bodySquat: oval(18, 8, 0), bodyPuff: oval(19, 12, 0),
    leg: MOCHI_LEG, legShort: MOCHI_LEG_S, legTuck: MOCHI_LEG_T,
    collar: ['.8888', '88888', '.8888'], collarDy: 10,
    tailMap: { 1: '3', 2: '4', 3: '3', 4: '4' },
    tail: TAIL_SWAY.map(t => recolor(t, { 1: '3', 2: '4' })), tailAir: TAIL_UP.map(t => recolor(t, { 1: '3', 2: '4' })),
    sit: sitUpright,
  };

  // Pickle — hairless sphynx, pink-beige, wrinkles, huge ears. Black collar.
  const PICKLE_PAL = ['#7a4a3a', '#e8b8a0', '#f4d0bc', '#c08878', '#f0c8c0', '#b8d860', '#202020', '#c07878', '#2a2a2a'];
  const PICKLE_HEAD = [
    '.00.....000..',
    '.040...04440.',
    '.0440..04440.',
    '.04410044410.',
    '0122333322110',
    '0111333311110',
    '0111111561110',
    '0111111561110',
    '0113111111170',
    '.013111111110',
    '.002111111200',
    '...00000000..',
  ];
  const PICKLE = {
    palette: PICKLE_PAL,
    head: PICKLE_HEAD, headBlink: blinkOf(PICKLE_HEAD), headEarsBack: earsBackOf(PICKLE_HEAD),
    body: oval(17, 9, 1), bodyLong: oval(19, 8, 1), bodySquat: oval(17, 7, 1), bodyPuff: oval(18, 11, 1),
    bodyY: 9,
    collar: ['.8888', '88888', '.8888'], collarDy: 10,
    tailMap: { 2: '3' },
    tail: TAIL_SWAY.map(t => recolor(t, { 2: '3' })), tailAir: TAIL_UP.map(t => recolor(t, { 2: '3' })),
    decorate: ({ bodyY }) => [{ art: ['333', '.33'], x: 15, y: bodyY + 2 }],
    sit: sitUpright,
  };

  // Biscuit — calico: white with orange and black patches. Green collar.
  const BISCUIT_PAL = ['#3a3030', '#f4f2ee', '#d9d6d0', '#e8923a', '#2a2a30', '#d8a840', '#101010', '#e3a0b0', '#6fbf6f'];
  const BISCUIT_HEAD = [
    '.00.....00...',
    '.040...0330..',
    '.0440.03330..',
    '.04410033310.',
    '0114411333310',
    '0111111333310',
    '0111111563110',
    '0111111561110',
    '0111111111170',
    '.011111111110',
    '.002111111200',
    '...00000000..',
  ];
  const BISCUIT = {
    palette: BISCUIT_PAL,
    head: BISCUIT_HEAD, headBlink: blinkOf(BISCUIT_HEAD), headEarsBack: earsBackOf(BISCUIT_HEAD),
    body: oval(18, 10, 0), bodyLong: oval(20, 9, 0), bodySquat: oval(18, 8, 0), bodyPuff: oval(19, 12, 0),
    collar: ['.8888', '88888', '.8888'], collarDy: 10,
    tailMap: { 1: '3', 2: '3' },
    tail: TAIL_SWAY.map(t => recolor(t, { 1: '3', 2: '3' }).map((r, i) => (i < 4 ? recolor([r], { 3: '4' })[0] : r))),
    tailAir: TAIL_UP.map(t => recolor(t, { 1: '3', 2: '3' }).map((r, i) => (i < 4 ? recolor([r], { 3: '4' })[0] : r))),
    decorate: ({ bodyY }) => [{ art: blob(8, 5, '3'), x: 11, y: bodyY + 1 }, { art: blob(6, 4, '4'), x: 5, y: bodyY + 2 }],
    decorateSit: () => [{ art: blob(7, 5, '3'), x: 12, y: 11 }],
    sit: sitUpright,
  };

  // Deli — bodega tabby: gray mackerel stripes, notched ear. Yellow collar.
  const DELI_PAL = ['#2a2a30', '#8a8a92', '#a8a8b0', '#4a4a55', '#c8a0a0', '#c8d040', '#101010', '#c07878', '#e8c14a'];
  const DELI_HEAD = [
    '.00.....0.0..',
    '.040...04.40.',
    '.0440.044440.',
    '.04410044410.',
    '0131313131310',
    '0111311311110',
    '0111111561110',
    '0111111561110',
    '0113111111170',
    '.011111111110',
    '.002211112200',
    '...00000000..',
  ];
  const DELI = {
    palette: DELI_PAL,
    head: DELI_HEAD, headBlink: blinkOf(DELI_HEAD), headEarsBack: earsBackOf(DELI_HEAD),
    body: oval(18, 10, 0), bodyLong: oval(20, 9, 0), bodySquat: oval(18, 8, 0), bodyPuff: oval(19, 12, 0),
    collar: ['.8888', '88888', '.8888'], collarDy: 10,
    tailMap: { 2: '3' },
    tail: TAIL_SWAY.map(t => recolor(t, { 2: '3' })), tailAir: TAIL_UP.map(t => recolor(t, { 2: '3' })),
    decorate: ({ bodyY }) => bars([6, 8, 10, 12, 14, 16], bodyY + 1, 4, '3').map((b, i) => ({ ...b, y: b.y + (i % 2) })),
    decorateSit: () => bars([13, 15, 17, 19], 11, 3, '3'),
    sit: sitUpright,
  };

  // Clover — gray Scottish Fold: folded ears, round face, copper eyes. Pink collar.
  const CLOVER_PAL = ['#3a3a48', '#8c96a8', '#b0b8c8', '#6a7488', '#c8a8b0', '#d8883a', '#101010', '#c88898', '#e88ab0'];
  const CLOVER_HEAD = [
    '.............',
    '.............',
    '.00......00..',
    '0440....0440.',
    '0111111111110',
    '0122111122110',
    '0111115651110',
    '0111115651110',
    '0111111111170',
    '0111111111110',
    '.001111111100',
    '..000000000..',
  ];
  const CLOVER = {
    palette: CLOVER_PAL,
    head: CLOVER_HEAD, headBlink: blinkOf(CLOVER_HEAD), headEarsBack: CLOVER_HEAD,
    body: oval(18, 11, 1), bodyLong: oval(20, 10, 1), bodySquat: oval(18, 9, 1), bodyPuff: oval(19, 13, 1),
    bodyY: 7,
    collar: ['.8888', '88888', '.8888'], collarDy: 10,
    tailMap: { 2: '3' },
    tail: TAIL_SWAY.map(t => recolor(t, { 2: '3' })), tailAir: TAIL_UP.map(t => recolor(t, { 2: '3' })),
    sit: sitUpright,
  };

  const ROSTER = { scottie: SCOTTIE, delia: DELIA, marmalade: MARMALADE, mochi: MOCHI, pickle: PICKLE, biscuit: BISCUIT, deli: DELI, clover: CLOVER };

  function buildScottie() { return buildCat('scottie', SCOTTIE); }
  function buildDelia() { return buildCat('delia', DELIA); }
  function buildRoster() {
    const out = {};
    for (const key of Object.keys(ROSTER)) out[key] = buildCat(key, ROSTER[key]);
    return out;
  }


  // ------------------------------------------------------------------------
  // World 1 tileset (16x16). Index order matters: see TILE below.
  // ------------------------------------------------------------------------
  const TILE = { FLOOR_TOP: 0, FLOOR_FILL: 1, SHELF: 2, BRICK: 3, PAW: 4, TACKS: 5, CURTAIN: 6, PAW_USED: 7, KITCHEN: 8, COUCH_L: 9, COUCH_M: 10, COUCH_R: 11, RUG: 12, WATER: 13, DECOR: 14, BLOCK: 15, CURTAIN_TOP: 16 };

  const TILE_PAL = [
    '#4a2f1a', // 0 dark seam
    '#9c6b3c', // 1 wood
    '#b8844d', // 2 light wood
    '#d9a765', // 3 highlight
    '#6b4a2a', // 4 brick dark
    '#c8955a', // 5 brick
    '#e0b378', // 6 brick light
    '#7a5a10', // 7 paw block dark
    '#f2c94c', // 8 paw block
    '#ffe08a', // 9 paw block light
    '#4a3a10', // a paw print
    '#5a1a1a', // b tack shadow
    '#d8d8e0', // c pin
    '#ff5a5a', // d tack head
    '#c03030', // e tack head dark
    '#2c3e6b', // f curtain dark
    '#4a6fb5', // g curtain
    '#6d8fd1', // h curtain light
    '#8a8070', // i used block
    '#b0a898', // j used block light
    '#eeeae0', // k kitchen tile light
    '#9a9aa4', // l kitchen tile dark
    '#c8c4bc', // m grout
    '#c04040', // n couch
    '#e05050', // o couch light
    '#7a2020', // p couch dark
    '#b03030', // q rug
    '#e8d0a0', // r rug border
    '#5fa04a', // s grass
    '#8fc85a', // t grass light
    '#6b4a2a', // u dirt
    '#3a6fbf', // v water
    '#7fb0ff', // w water light
    '#6a6a72', // x asphalt / steel
    '#8a8a94', // y asphalt light
    '#3a3a44', // z dark
  ];

  const T_FLOOR_TOP = [
    '3333333333333333',
    '2222222222222222',
    '1111111111111111',
    '1111111011111111',
    '1111111011111111',
    '0000000000000000',
    '1111111111111111',
    '1101111111111011',
    '1101111111111011',
    '0000000000000000',
    '1111111111111111',
    '1111111011111111',
    '1111111011111111',
    '0000000000000000',
    '1111111111111111',
    '1111111111111111',
  ];
  const T_FLOOR_FILL = [
    '1111111111111111',
    '1101111111111011',
    '1101111111111011',
    '0000000000000000',
    '1111111111111111',
    '1111111011111111',
    '1111111011111111',
    '0000000000000000',
    '1111111111111111',
    '1101111111111011',
    '1101111111111011',
    '0000000000000000',
    '1111111111111111',
    '1111111011111111',
    '1111111011111111',
    '0000000000000000',
  ];
  const T_SHELF = [
    '3333333333333333',
    '2222222222222222',
    '1111111111111111',
    '0000000000000000',
    '...0........0...',
    '...00.......00..',
    '...0.0......0.0.',
    '...0..0.....0..0',
    '...0...0....0...',
    '...0....0...0...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ];
  const T_BRICK = [
    '4444444444444444',
    '4666666664666664',
    '4655555564655564',
    '4655555564655564',
    '4655555564655564',
    '4444444444444444',
    '4666664666666664',
    '4655564655555564',
    '4655564655555564',
    '4655564655555564',
    '4444444444444444',
    '4666666664666664',
    '4655555564655564',
    '4655555564655564',
    '4655555564655564',
    '4444444444444444',
  ];
  const T_PAW = [
    '7777777777777777',
    '7999999999999997',
    '7988888888888897',
    '7988aa88aa888897',
    '7988aa88aa888897',
    '7988888888888897',
    '798aa8888aa88897',
    '798aa8888aa88897',
    '7988888aa8888897',
    '79888aaaaaa88897',
    '79888aaaaaa88897',
    '79888aaaaaa88897',
    '7988888aa8888897',
    '7988888888888897',
    '7988888888888897',
    '7777777777777777',
  ];
  const T_PAW_USED = [
    'iiiiiiiiiiiiiiii',
    'ijjjjjjjjjjjjjji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijiiiiiiiiiiiiji',
    'ijjjjjjjjjjjjjji',
    'iiiiiiiiiiiiiiii',
  ];
  const T_TACKS = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..c.....c.....c.',
    '..c.....c.....c.',
    '..c.....c.....c.',
    '.ddd...ddd...ddd',
    '.dee...dee...dee',
    'beeeb.beeeb.beee',
    'bbbbb.bbbbb.bbbb',
    '................',
  ];
  const T_CURTAIN = [
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
  ];
  const T_CURTAIN_TOP = [
    '0000000000000000',
    '3333333333333333',
    '.3.f3g.3h.f3g.3.',
    '..fgghfgghfgghf.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
    '.fgghfgghfgghfg.',
  ];

  const T_KITCHEN = [
    'kkkkkkkmlllllllm', 'kkkkkkkmlllllllm', 'kkkkkkkmlllllllm', 'kkkkkkkmlllllllm',
    'kkkkkkkmlllllllm', 'kkkkkkkmlllllllm', 'kkkkkkkmlllllllm', 'mmmmmmmmmmmmmmmm',
    'lllllllmkkkkkkkm', 'lllllllmkkkkkkkm', 'lllllllmkkkkkkkm', 'lllllllmkkkkkkkm',
    'lllllllmkkkkkkkm', 'lllllllmkkkkkkkm', 'lllllllmkkkkkkkm', 'mmmmmmmmmmmmmmmm',
  ];
  const T_COUCH_M = [
    'pppppppppppppppp', 'poooooooooooooop', 'pnnnnnnnnnnnnnnp', 'pnnnnnnnnnnnnnnp',
    'pnnnnnnnnnnnnnnp', 'pppppppppppppppp', 'pnnnnnnnnnnnnnnp', 'pnnnnnnnnnnnnnnp',
    'pnnnnnnnnnnnnnnp', 'pnnnnnnnnnnnnnnp', 'pnnnnnnnnnnnnnnp', 'pnnnnnnnnnnnnnnp',
    'pnnnnnnnnnnnnnnp', 'pppppppppppppppp', '.pp..........pp.', '.pp..........pp.',
  ];
  const T_COUCH_L = T_COUCH_M.map((r, i) => (i >= 1 && i <= 12 ? 'pooo' + r.slice(4) : r));
  const T_COUCH_R = T_COUCH_M.map((r, i) => (i >= 1 && i <= 12 ? r.slice(0, 12) + 'ooop' : r));
  const T_RUG = ['qqqqqqqqqqqqqqqq', 'qrrrrrrrrrrrrrrq', 'qrqqqqqqqqqqqqrq', 'qrrrrrrrrrrrrrrq', 'qqqqqqqqqqqqqqqq'].concat(T_FLOOR_TOP.slice(5));

  const T_WATER = [
    'wvwwvwwvwwvwwvwv', 'vvvvvvvvvvvvvvvv', 'vvvwvvvvwvvvvwvv', 'vvvvvvvvvvvvvvvv',
    'vvvvvvvvvvvvvvvv', 'vvwvvvvwvvvvwvvv', 'vvvvvvvvvvvvvvvv', 'vvvvvvvvvvvvvvvv',
    'vvvvvvvvvvvvvvvv', 'vvvvwvvvvwvvvvwv', 'vvvvvvvvvvvvvvvv', 'vvvvvvvvvvvvvvvv',
    'vvvvvvvvvvvvvvvv', 'vvvvvvvvvvvvvvvv', 'vvvvvvvvvvvvvvvv', 'vvvvvvvvvvvvvvvv',
  ];
  const ROW = (a, b, c) => a + b.repeat(14) + c;
  // World 2 backyard: grass over dirt, tree-branch shelves, picket fence decor, flowerpot block
  const W2_TOP = ['tttttttttttttttt', 'ssttsstttssttsst', 'ssssssssssssssss', 'sususususususuus'].concat(Array(12).fill('uuuuuuuuuuuuuuuu')).map((r, i) => (i === 7 || i === 12 ? 'uu0uuuuuu0uuuuuu' : r));
  const W2_FILL = Array(16).fill('uuuuuuuuuuuuuuuu').map((r, i) => (i % 5 === 2 ? 'uuuu0uuuuuuu0uuu' : r));
  const W2_SHELF = ['s.ss..ss.s..ss..', 'sssstssstsssssss', '1122112211221122', '0000000000000000', '......0...0.....', '......0....0....'].concat(Array(10).fill('................'));
  const W2_DECOR = ['....22......22..', '...2222....2222.', '...2332....2332.', '...2222....2222.', '...2222....2222.', '2222222222222222', '...2222....2222.', '...2222....2222.', '...2222....2222.', '2222222222222222', '...2222....2222.', '...2222....2222.', '...2222....2222.', '...2222....2222.', '...2222....2222.', '...2222....2222.'];
  const W2_BLOCK = ['0000000000000000', '0ssssssssssssss0', '0s6666666666666s'.slice(0, 15) + '0', '0666666666666660', '0555555555555550', '.05555555555550.', '.05555555555550.', '.05555555555550.', '.05444444444450.', '.05555555555550.', '.05555555555550.', '.05555555555550.', '..055555555550..', '..055555555550..', '..044444444440..', '...0000000000...'];
  // World 3 alley (night): sidewalk over dark brick, fire-escape grates, awning decor, dumpster block
  const W3_TOP = ['yyyyyyyyyyyyyyyy', 'xxxxxxxxxxxxxxxx', 'xxxxxxx0xxxxxxxx', 'zzzzzzzzzzzzzzzz'].concat(Array(12).fill('z44z44z44z44z44z').map((r, i) => (i % 2 ? '44z44z44z44z44z4' : r)));
  const W3_FILL = Array(16).fill('z44z44z44z44z44z').map((r, i) => (i % 2 ? '44z44z44z44z44z4' : r));
  const W3_SHELF = ['xyxyxyxyxyxyxyxy', 'yxyxyxyxyxyxyxyx', 'xxxxxxxxxxxxxxxx', 'zzzzzzzzzzzzzzzz', '..z..........z..', '..z..........z..', '..z..........z..', '..z..........z..'].concat(Array(8).fill('................'));
  const W3_DECOR = ['dddddddddddddddd', 'ccddccddccddccdd', 'ccddccddccddccdd', 'ccddccddccddccdd', 'ccddccddccddccdd', 'ccddccddccddccdd', 'ccddccddccddccdd', 'c..c..c..c..c..c'].concat(Array(8).fill('................'));
  const W3_BLOCK = ['0000000000000000', '0zzzzzzzzzzzzzz0', '0000000000000000', '0ssssssssssssss0', '0ssssssssssssss0', '0ss0ssssssss0ss0', '0ssssssssssssss0', '0ssssssssssssss0', '0ssssssssssssss0', '0ss0ssssssss0ss0', '0ssssssssssssss0', '0ssssssssssssss0', '0ssssssssssssss0', '0000000000000000', '.zz..........zz.', '.zz..........zz.'];
  // World 4 vet clinic: teal tile over gray, cone-of-shame platforms, cabinet decor, steel table block
  const W4_TOP = ['hhhhhhhhhhhhhhhh', 'ggggggggggggggg0', 'ggggggggggggggg0', '0000000000000000'].concat(Array(12).fill('yyyyyyyyyyyyyyyy').map((r, i) => (i % 4 === 1 ? 'yyyyyyy0yyyyyyyy' : r)));
  const W4_FILL = Array(16).fill('yyyyyyyyyyyyyyyy').map((r, i) => (i % 4 === 1 ? 'yyyyyyy0yyyyyyyy' : r));
  const W4_SHELF = ['kkkkkkkkkkkkkkkk', 'kmmmmmmmmmmmmmmk', 'kkkkkkkkkkkkkkkk', '0000000000000000', '..0kkkkkkkkkk0..', '...0kkkkkkkk0...', '....0kkkkkk0....', '.....0kkkk0.....', '......0000......'].concat(Array(7).fill('................'));
  const W4_DECOR = ['0000000000000000', '0kkkkkkkkkkkkkk0', '0kkkkkkkkkkkkkk0', '0kkkkk0kkkkkkkk0', '0kkkkkkkkkkkkkk0', '0000000000000000', '0kkkkkkkkkkkkkk0', '0kkkkkkkkkkkkkk0', '0kkkkk0kkkkkkkk0', '0kkkkkkkkkkkkkk0', '0000000000000000', '0kkkkkkkkkkkkkk0', '0kkkkkkkkkkkkkk0', '0kkkkk0kkkkkkkk0', '0kkkkkkkkkkkkkk0', '0000000000000000'];
  const W4_BLOCK = ['xxxxxxxxxxxxxxxx', 'yyyyyyyyyyyyyyyy', 'xxxxxxxxxxxxxxxx', '0000000000000000', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..xx........xx..', '..00........00..'];
  // World 5 rooftop cafe: concrete over brick, cafe-table platforms, railing decor, chimney block
  const W5_TOP = ['yyyyyyyyyyyyyyyy', 'xxxxxxxxxxxxxxxx', '0000000000000000', '4666466646664666'].concat(Array(12).fill('6664666466646664').map((r, i) => (i % 2 ? '4666466646664666' : r)));
  const W5_FILL = Array(16).fill('6664666466646664').map((r, i) => (i % 2 ? '4666466646664666' : r));
  const W5_SHELF = ['dddddddddddddddd', 'dccccccccccccccd', 'dddddddddddddddd', '0000000000000000', '.......00.......', '.......00.......', '.......00.......', '.......00.......', '.......00.......', '.......00.......', '.....000000.....'].concat(Array(5).fill('................'));
  const W5_DECOR = ['3.3..3.3..3.3..3', '2323323233232332', '..3..3..3..3..3.', '................', '................', 'z..z..z..z..z..z', 'zzzzzzzzzzzzzzzz', 'z..z..z..z..z..z', 'z..z..z..z..z..z', 'z..z..z..z..z..z', 'z..z..z..z..z..z', 'zzzzzzzzzzzzzzzz', 'z..z..z..z..z..z', 'z..z..z..z..z..z', 'z..z..z..z..z..z', 'z..z..z..z..z..z'];
  const W5_BLOCK = ['0000000000000000', '0444444444444440', '0000000000000000', '0666466646664660', '0646664666466640', '0666466646664660', '0646664666466640', '0666466646664660', '0646664666466640', '0666466646664660', '0646664666466640', '0666466646664660', '0646664666466640', '0666466646664660', '0646664666466440', '0000000000000000'];

  const WORLD_TILES = {
    1: { top: T_FLOOR_TOP, fill: T_FLOOR_FILL, shelf: T_SHELF, decor: T_CURTAIN, block: T_BRICK },
    2: { top: W2_TOP, fill: W2_FILL, shelf: W2_SHELF, decor: W2_DECOR, block: W2_BLOCK },
    3: { top: W3_TOP, fill: W3_FILL, shelf: W3_SHELF, decor: W3_DECOR, block: W3_BLOCK },
    4: { top: W4_TOP, fill: W4_FILL, shelf: W4_SHELF, decor: W4_DECOR, block: W4_BLOCK },
    5: { top: W5_TOP, fill: W5_FILL, shelf: W5_SHELF, decor: W5_DECOR, block: W5_BLOCK },
  };

  function buildTiles() {
    for (const w of Object.keys(WORLD_TILES)) {
      const t = WORLD_TILES[w];
      makeSprite('tiles-w' + w, [t.top, t.fill, t.shelf, T_BRICK, T_PAW, T_TACKS, T_CURTAIN, T_PAW_USED, T_KITCHEN, T_COUCH_L, T_COUCH_M, T_COUCH_R, T_RUG, T_WATER, t.decor, t.block, T_CURTAIN_TOP], TILE_PAL);
    }
    // alias for anything still asking for 'tiles'
    makeSprite('tiles', [T_FLOOR_TOP, T_FLOOR_FILL, T_SHELF, T_BRICK, T_PAW, T_TACKS, T_CURTAIN, T_PAW_USED, T_KITCHEN, T_COUCH_L, T_COUCH_M, T_COUCH_R, T_RUG, T_WATER, T_CURTAIN, T_BRICK, T_CURTAIN_TOP], TILE_PAL);
  }

  // ------------------------------------------------------------------------
  // Props / pickups
  // ------------------------------------------------------------------------
  function buildProps() {
    // Kibble pellet 6x6, 2 frames (glint)
    makeSprite('kibble', [
      ['.0000.', '011210', '012210', '011110', '011110', '.0000.'],
      ['.0000.', '011110', '011110', '011210', '012110', '.0000.'],
    ], ['#3a2416', '#8a5a2b', '#c48a4a']);

    // Door 16x32 (apartment door with frame and knob)
    const DOOR = [
      '4444444444444444',
      '4000000000000004',
      '4022222222222204',
      '4021111111111204',
      '4021222222211204',
      '4021211111211204',
      '4021211111211204',
      '4021211111211204',
      '4021211111211204',
      '4021222222211204',
      '4021111111111204',
      '4021111111111204',
      '4021222222211204',
      '4021211111211204',
      '4021211111211204',
      '4021211111213204',
      '4021211111211204',
      '4021211111211204',
      '4021222222211204',
      '4021111111111204',
      '4021111111111204',
      '4021222222211204',
      '4021211111211204',
      '4021211111211204',
      '4021211111211204',
      '4021211111211204',
      '4021211111211204',
      '4021222222211204',
      '4021111111111204',
      '4022222222222204',
      '4000000000000004',
      '4444444444444444',
    ];
    makeSprite('door', [DOOR], ['#3a2414', '#7a4a24', '#a3683a', '#e8c14a', '#c9c1b0']);


    // Floor lamp 16x32 (decor)
    const LAMP = [
      '....00000000....', '...0333333330...', '..033333333330..', '..033333333330..', '.03333333333330.', '.03333333333330.',
      '0000000000000000', '.......22.......',
    ].concat(Array(21).fill('.......11.......')).concat(['....00000000....', '...0111111110...', '....00000000....']);
    makeSprite('lamp', [LAMP], ['#3a2a1a', '#6a6a70', '#fff0a0', '#f2c94c']);

    // Catnip sprig 10x10
    makeSprite('catnip', [[
      '....00....', '...0110...', '..011210..', '.01112110.', '.01121110.', '.01121110.', '..011210..', '...0110...', '....00....', '....0.....',
    ]], ['#1f4d1f', '#4fa04f', '#a8e070']);
    // Bell collar 8x10
    makeSprite('bell', [[
      '...00...', '..0110..', '..0110..', '.011110.', '.011110.', '.011110.', '01111110', '00000000', '...00...', '...00...',
    ]], ['#7a5a10', '#f2c94c', '#ffe08a']);
    // Fish 12x8
    makeSprite('fish', [[
      '........0...', '..00000.00..', '.0111110110.', '01121111110.', '01111111110.', '.0111110110.', '..00000.00..', '........0...',
    ]], ['#1a3a6a', '#4f8fe8', '#ffffff']);

    // Heart 7x6, two sizes
    makeSprite('heart', [
      ['.00.00.', '0110110', '0111110', '.01110.', '..010..', '...0...'],
      ['.......', '.00.00.', '.01110.', '..010..', '...0...', '.......'],
    ], ['#c0304a', '#ff6a8a']);

    // ---- Apartment scenery (world 1)
    const CT = ['#4a3a2a', '#c8b48a', '#e0d0a8', '#2a2018', '#a8905a'];
    const catTree = compose(24, 48, [
      { art: rectArt(6, 34, '4'), x: 9, y: 6 },
      { art: rectArt(22, 4, '2'), x: 1, y: 4 },
      { art: rectArt(14, 4, '2'), x: 9, y: 20 },
      { art: rectArt(22, 14, '1'), x: 1, y: 34 },
      { art: blob(8, 9, '3'), x: 8, y: 37 },
      { art: rectArt(24, 3, '2'), x: 0, y: 45 },
    ]);
    makeSprite('deco-cattree', [catTree], CT);
    // Blue fish house: cloth cat cave shaped like a fish, the mouth is the door (eyes blink inside)
    const fishBody = recolor(oval(24, 18, 3), { 2: '2' });
    const fishHouse = (eyes) => compose(32, 22, [
      { art: ['..00', '.010', '0110', '0110', '0110', '.010', '..00'], x: 0, y: 6 },
      { art: ['0000', '0110', '0110', '0110', '0110', '0110', '0000'], x: 3, y: 6 },
      { art: fishBody, x: 6, y: 2, union: true },
      { art: ['.00.', '0110', '0110', '.00.'], x: 14, y: 0 },
      { art: blob(8, 11, '3'), x: 21, y: 6 },
      { art: eyes ? ['6.6'] : ['...'], x: 23, y: 10 },
      { art: ['44', '45'], x: 17, y: 5 },
      { art: rectArt(30, 2, '0', '0'), x: 1, y: 20 },
    ]);
    makeSprite('deco-fishhouse', [fishHouse(true), fishHouse(true), fishHouse(false)], ['#1f3f8f', '#3f7fdf', '#7fb0ff', '#16142a', '#ffffff', '#101010', '#f2c94c']);
    // Bookshelf
    const books = (seed) => { const cols = ['2', '3', '4', '5', '6']; let a = ''; for (let i = 0; i < 26; i++) a += cols[(i * 7 + seed) % 5]; return [a, a, a, a, a, a]; };
    const bookshelf = compose(32, 40, [
      { art: rectArt(32, 40, '1', '0') },
      { art: books(0), x: 3, y: 3 }, { art: rectArt(28, 2, '0', '0'), x: 2, y: 10 },
      { art: books(2), x: 3, y: 15 }, { art: rectArt(28, 2, '0', '0'), x: 2, y: 22 },
      { art: books(4), x: 3, y: 27 }, { art: rectArt(28, 2, '0', '0'), x: 2, y: 34 },
    ]);
    makeSprite('deco-bookshelf', [bookshelf], ['#4a2f1a', '#8a6a45', '#c04040', '#4070c0', '#40a060', '#e0c040', '#a060c0']);
    // Potted plant
    const plant = compose(18, 30, [
      { art: blob(10, 9, '1'), x: 4, y: 2 }, { art: blob(8, 8, '2'), x: 0, y: 6 }, { art: blob(8, 8, '2'), x: 10, y: 5 },
      { art: rectArt(2, 10, '3', '3'), x: 8, y: 10 },
      { art: rectArt(14, 3, '4', '0'), x: 2, y: 19 }, { art: rectArt(12, 9, '4', '0'), x: 3, y: 21 },
    ]);
    makeSprite('deco-plant', [plant], ['#2a4a1a', '#4f9a3a', '#7fc060', '#5a3a1a', '#c8703a']);
    // Framed cat picture (wall)
    makeSprite('deco-frame', [[
      '00000000000000', '01111111111110', '01222222222210', '01223.22.32210', '01223333332210', '01223432432210', '01223333332210', '01222333322210', '01222222222210', '01111111111110', '00000000000000',
    ]], ['#5a3a1a', '#c8a05a', '#e8dcc4', '#1c1c24', '#e8c53a']);
    // Food and water bowls
    makeSprite('deco-bowls', [[
      '................', '..2222....3333..', '.011110..044440.', '.011110..044440.', '..0000....0000..',
    ]], ['#3a2a2a', '#c85a5a', '#8a5a2b', '#4f8fe8', '#4a6fb5']);
    // Scratching post
    makeSprite('deco-post', [compose(14, 32, [{ art: rectArt(6, 28, '1'), x: 4, y: 0 }, { art: ['0000000000', '0111111110'], x: 2, y: 0 }, { art: rectArt(14, 4, '2'), x: 0, y: 28 }])], ['#4a3a2a', '#c8a86a', '#8a6a45']);

    // ---- Backyard scenery (world 2)
    const flower = (c) => [['..' + c + c + '..', '.' + c + c + c + c + '.', '.' + c + '5' + '5' + c + '.', '..' + c + c + '..', '...1..', '..11..', '...1..', '...1..', '..11..', '...1..'][0]];
    makeSprite('deco-flowers', [[
      '..22.....33...44', '.2222...3333.444', '.2552...3553.454', '..22.....33...44', '...1......1....1', '..11.....11...11', '...1......1....1', '.1.1.....1.1...1', '..11......11..11', '...1......1....1',
    ]], ['#2a4a1a', '#4f9a3a', '#ff6a8a', '#f2c94c', '#8f6fdf', '#ffe066']);
    makeSprite('deco-gnome', [[
      '.....00.....', '....0110....', '....0110....', '...011110...', '...011110...', '..01111110..', '.0111111110.', '00000000000.', '.0222222220.', '.0233233320.', '.0233333320.',
      '..04444440..', '.0355555530.', '.0355555530.', '.0355555530.', '..03555530..', '..00000000..', '..066..660..', '..066..660..', '..000..000..',
    ]], ['#3a1a1a', '#d03030', '#f0d0b0', '#ffffff', '#101010', '#3060c0', '#5a3a1a']);
    makeSprite('deco-hose', [[
      '....0000000.....', '..00111111100...', '.01100000001100.', '.010.......0110.', '.010..000..0110.', '.010.0110..0110.', '.011000110001100', '..0111111111100.', '...00000000000..', '.....00...00....',
    ]], ['#1f4d1f', '#4fa04f', '#7fd060']);
    makeSprite('deco-butterfly', [
      ['00...00', '0110110', '0112110', '.01110.', '..010..'],
      ['.0...0.', '.01010.', '.01210.', '..010..', '..010..'],
    ], ['#7a3a10', '#f2a030', '#101010']);

    // ---- Alley scenery (world 3)
    makeSprite('deco-trashcan', [[
      '.0000000000.', '011111111110', '.0000000000.', '..01111110..', '..01121110..', '..01111110..', '..01121110..', '..01111110..', '..01121110..', '..01111110..', '..01121110..', '..01111110..', '..01111110..', '..00000000..',
    ]], ['#2a2a30', '#8a8a94', '#a8a8b0']);
    makeSprite('deco-boxes', [compose(22, 18, [{ art: rectArt(12, 9, '1'), x: 10, y: 0 }, { art: rectArt(12, 9, '1'), x: 0, y: 9 }, { art: rectArt(10, 9, '1'), x: 12, y: 9 }, { art: ['22'], x: 4, y: 12 }, { art: ['22'], x: 15, y: 3 }])], ['#5a3a1a', '#c8955a', '#8a6a3a']);
    makeSprite('deco-puddle', [['..000000000000000000..', '.01111111111111111110.', '..000000000000000000..']], ['#1c2040', '#3a4a7a']);
    makeSprite('deco-poster', [[
      '000000000000', '011111111110', '012211112210', '012221122210', '012222222210', '012332233210', '012222222210', '012222322210', '011222222110', '011111111110', '011333333110', '011333333110', '011111111110', '000000000000',
    ]], ['#4a3a30', '#e8dcc4', '#2a2a30', '#c03030']);

    // ---- Clinic scenery (world 4)
    makeSprite('deco-chart', [[
      '0000000000000000', '0111111111111110', '0112211221111110', '0112211221111110', '0111111111111110', '0113311111331110', '0113311111331110', '0111133333111110', '0111333333311110', '0111333333311110', '0111133333111110', '0111111111111110',
      '0144444444444410', '0111111111111110', '0144444441111110', '0111111111111110', '0144444444411110', '0111111111111110', '0000000000000000',
    ]], ['#3a4a5a', '#ffffff', '#c03030', '#3a3a44', '#7fb0c8']);
    makeSprite('deco-carrier', [compose(22, 14, [{ art: rectArt(22, 14, '1'), x: 0, y: 0 }, { art: rectArt(10, 10, '2', '0'), x: 10, y: 2 }, { art: ['0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0'], x: 11, y: 3 }, { art: ['0000000000'], x: 6, y: -0 }])], ['#1a2a3a', '#4f8fe8', '#dfe8f0']);
    makeSprite('deco-scale', [['..000000000000..', '.01111111111110.', '.01122222221110.', '.01111111111110.', '..000000000000..', '.......00.......', '.00000000000000.', '.01111111111110.', '.00000000000000.']], ['#2a2a30', '#b0b0b8', '#3ac06a']);

    // ---- Rooftop scenery (world 5)
    const umbrella = compose(34, 46, [
      { art: rectArt(2, 40, '3', '3'), x: 16, y: 6 },
      { art: recolor(blob(34, 14, '1'), {}), x: 0, y: 0 },
      { art: ['22222', '22222'].map(r => r), x: 3, y: 3 }, { art: ['22222', '22222'], x: 14, y: 1 }, { art: ['22222', '22222'], x: 25, y: 3 },
      { art: rectArt(34, 2, '0', '0'), x: 0, y: 12 },
      { art: rectArt(12, 3, '3', '0'), x: 11, y: 43 },
    ]);
    makeSprite('deco-umbrella', [umbrella], ['#7a1a1a', '#e03a3a', '#f8f0e0', '#4a3a2a']);
    makeSprite('deco-coffee', [[
      '.....1.1........', '....1.1.1.......', '.....1.1........', '0000000000000...', '0222222222220000', '0222222222220220', '0222222222220220', '0222222222220000', '.00000000000....', '..0000000000....',
    ]], ['#3a2414', '#c8c8d0', '#f8f0e0']);
    makeSprite('deco-pigeon', [
      ['...00...', '..0110..', '.011110.', '01111110', '.011110.', '..0000..', '..0..0..'],
      ['..00....', '.0110...', '.011110.', '01111110', '.011110.', '..0000..', '..0..0..'],
    ], ['#3a3a44', '#8a8a94']);

    // Dust puff 8x8, 4 frames
    makeSprite('dust', [
      ['........', '........', '........', '...00...', '..0110..', '...00...', '........', '........'],
      ['........', '........', '..0000..', '.011110.', '.011110.', '..0000..', '........', '........'],
      ['........', '.00..00.', '0110.011', '.00..00.', '........', '.0....0.', '........', '........'],
      ['........', '0.....0.', '........', '........', '.......0', '0.......', '........', '........'],
    ], ['#c8bfae', '#e8e0d0']);

    // Cat-head life icon 8x8 (black cat, gold eyes)
    makeSprite('icon-life', [[
      '.0....0.',
      '.00..00.',
      '.000000.',
      '.010010.',
      '.000000.',
      '.000000.',
      '..0000..',
      '........',
    ]], ['#1c1c24', '#e8c53a']);

    // Ghost mouse icon 8x8 (Delia only, phase 3)
    makeSprite('icon-mouse', [[
      '........',
      '..00....',
      '.0110.0.',
      '0111100.',
      '0111110.',
      '.00000..',
      '........',
      '........',
    ]], ['#e8e8f0', '#ffffff']);
  }

  // ------------------------------------------------------------------------
  // 5x7 bitmap font, packed into 6x8 cells.
  // ------------------------------------------------------------------------
  const FONT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:x/.-!?+ *';
  const GLYPHS = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['..###', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '###..'],
    ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
    x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '..#..'],
    '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '*': ['..#..', '..#..', '.###.', '#####', '.###.', '..#..', '..#..'],
  };

  function buildFont() {
    const frames = [];
    for (const ch of FONT_CHARS) {
      const g = GLYPHS[ch];
      if (!g) throw new Error('font: missing glyph ' + ch);
      frames.push(g.map(r => r.replace(/#/g, '0') + '.'));
    }
    makeSprite('font', frames, ['#ffffff'], { width: 6, height: 8 });
  }

  /** Register the retro font with a scene (once per game). */
  function installFont(scene) {
    if (scene.cache.bitmapFont.exists('font')) return;
    const cfg = {
      image: 'font',
      width: 6,
      height: 8,
      chars: FONT_CHARS,
      charsPerRow: FONT_CHARS.length,
      spacing: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      lineSpacing: 2,
    };
    scene.cache.bitmapFont.add('font', Phaser.GameObjects.RetroFont.Parse(scene, cfg));
  }

  // ------------------------------------------------------------------------
  // Enemies & powerups (phase 2)
  // ------------------------------------------------------------------------
  function buildEnemies() {
    // Roomba 16x9: idle0, idle1 (light blinks), hurt0, hurt1 (flipped, wheels spin)
    const RB0 = [
      '....00000000....',
      '..002222222200..',
      '.01111111111110.',
      '0111111311111110',
      '0111111111111110',
      '0111111111111110',
      '0000000000000000',
      '.55........55...',
      '.55........55...',
    ];
    const RB1 = RB0.map((r, i) => (i === 3 ? '0111111411111110' : r));
    const RBH0 = [
      '.55........55...',
      '.55........55...',
      '0000000000000000',
      '0111111111111110',
      '0111111111111110',
      '0111111411111110',
      '.01111111111110.',
      '..002222222200..',
      '....00000000....',
    ];
    const RBH1 = RBH0.map((r, i) => (i < 2 ? '..55........55..' : r));
    makeSprite('roomba', [RB0, RB1, RBH0, RBH1], ['#2a2a30', '#6e6e78', '#9a9aa4', '#3ac06a', '#c0303a', '#111116'], { width: 16, height: 16, align: 'bottom' });

    // Cucumber 16x7
    makeSprite('cucumber', [[
      '.....0.00.0.....',
      '...00212212000..',
      '..0122222222210.',
      '.01221221221221 0'.replace(' ', ''),
      '0122212212212210',
      '0112221221222110',
      '.01111111111110.',
      '..000000000000..',
    ]], ['#1f4d1f', '#3f8f3f', '#7fd060', '#dfe7c0'], { width: 16, height: 16, align: 'bottom' });

    // Tuna can 12x9
    makeSprite('tuna', [[
      '..00000000..',
      '.0222222220.',
      '011111111110',
      '033333333330',
      '034433443430',
      '033333333330',
      '011111111110',
      '.0111111110.',
      '..00000000..',
    ]], ['#4a4a52', '#c8c8d0', '#e8e8f0', '#2f5fbf', '#7fa8ff']);

    // Food bowl 16x9: empty, full (checkpoint reached)
    const BOWL_E = [
      '................',
      '................',
      '................',
      '................',
      '0000000000000000',
      '0122222222222210',
      '.01111111111110.',
      '..011111111110..',
      '...0000000000...',
    ];
    const BOWL_F = BOWL_E.map((r, i) => (i === 1 ? '......3333......' : i === 2 ? '....3344333 3...'.replace(' ', '3') : i === 3 ? '...344334433 3..'.replace(' ', '3') : r));
    makeSprite('bowl', [BOWL_E, BOWL_F], ['#5a2a2a', '#c85a5a', '#e88080', '#8a5a2b', '#c48a4a'], { width: 16, height: 16, align: 'bottom' });

    // Brick fragment 4x4
    makeSprite('brick-bit', [['0000', '0110', '0110', '0000']], ['#6b4a2a', '#c8955a']);

    // Squirrel 16x16: idle0, idle1 (tail flick), hurt
    const SQ0 = [
      '..........00....', '.........0110...', '.........0110...', '....000..01110..', '...01110001110..', '..0111111101110.', '..0122111110110.',
      '..0111111111110.', '..0113111111110.', '...01111111110..', '....0111111110..', '....0111111110..', '.....011..0110..', '.....000..000...', '................', '................',
    ];
    const SQ1 = SQ0.map((r, i) => (i === 0 ? '.........00.....' : i === 1 ? '........0110....' : r));
    const SQH = SQ0.map((r, i) => (i === 6 ? '..0100111110110.' : r));
    makeSprite('squirrel', [SQ0, SQ1, SQH], ['#4a2a10', '#a86a3a', '#d09a5a', '#101010'], { width: 16, height: 16, align: 'bottom' });
    makeSprite('acorn', [['..00..', '.0220.', '011110', '011110', '.0110.', '..00..']], ['#3a2010', '#8a5a2a', '#c8a050']);

    // Sprinkler 16x16 (2 frames) + droplet 4x4
    const SPK = [
      '................', '................', '................', '................', '................', '................', '................', '.......11.......',
      '......0110......', '......0110......', '......0110......', '....00011000....', '...0111111110...', '..011111111110..', '..011111111110..', '..000000000000..',
    ];
    const SPK1 = SPK.map((r, i) => (i === 6 ? '......2..2......' : i === 7 ? '.......11.......' : r));
    makeSprite('sprinkler', [SPK, SPK1], ['#2a3a2a', '#5a7a5a', '#7fb0ff'], { width: 16, height: 16, align: 'bottom' });
    makeSprite('droplet', [['.00.', '0110', '0110', '.00.']], ['#3a6fbf', '#9fd0ff']);

    // Spray bottle 16x20 (2 frames: idle, squeeze) + water blob
    const SPB = [
      '......0000......', '.....011110.....', '....01111110....', '....0111111000..', '....011111111 0.'.replace(' ', '1'), '....0000000000..', '.....011110.....', '.....011110.....',
      '....01111110....', '...0122222210...', '...0122222210...', '...0122222210...', '...0122222210...', '...0122222210...', '...0122222210...', '...0122222210...',
      '...0122222210...', '...0111111110...', '....00000000....', '................',
    ];
    const SPB1 = SPB.map((r, i) => (i === 3 ? '....0111111110..' : i === 4 ? '....01111111110.' : r));
    makeSprite('spray', [SPB, SPB1], ['#1a2a3a', '#4f8fe8', '#9fd0ff'], { width: 16, height: 20, align: 'bottom' });
    makeSprite('blob', [['.00.', '0110', '0110', '.00.'], ['0000', '0110', '0110', '0000']], ['#3a6fbf', '#bfe0ff']);

    // Dog 32x24: run cycle 4 frames
    const dogFrame = (legA, legB) => [
      '.........................00.....', '........................0110....', '....0000000000.........011110...', '...011111111110.......0111111 0.'.replace(' ', '1'), '..01111111111110.....01111132110',
      '..01111111111110....011111111110', '..011111111111110000111111111100', '..0111111111111111111111111111..', '..0111111111111111111111111110..', '...01111111111111111111111110...',
      '...011111111111111111111110.....', '....0111111111111111111110......', '....0111111111111111111110......', '.....01111111111111111110.......',
    ].concat(Array(8).fill('....' + legA + '..........' + legB + '..')).concat(['................................', '................................']);
    const L1 = '0110.011', L2 = '.011011.', L3 = '..0110..', L4 = '.011011.';
    makeSprite('dog', [dogFrame(L1, L1), dogFrame(L2, L2), dogFrame(L3, L3), dogFrame(L4, L4)], ['#3a2414', '#a8763a', '#d8a860', '#101010'], { width: 32, height: 24, align: 'bottom' });

    // Vacuum boss 32x32 (2 frames) + plug 10x8
    const VAC = [
      '..............000...............', '.............01110..............', '.............01110..............', '.............01110..............', '.............01110..............',
      '.............01110..............', '............0111110.............', '...........011111110............', '..........01111111110...........', '.........0111111111110..........',
      '........011111111111110.........', '.......01111111111111110........', '......0111122222221111110.......', '......0111122222221111110.......', '......0111111111111111110.......',
      '......0111111111111111110.......', '......0111111111111111110.......', '......0111111111111111110.......', '......0111111111111111110.......', '......0111111111111111110.......',
      '......0111111111111111110.......', '......0111111111111111110.......', '.....011111111111111111110......', '.....011111111111111111110......', '.....011111111111111111110......',
      '.....011111111111111111110......', '.....000000000000000000000......', '.......033........033...........', '......0330........0330..........', '......0330........0330..........',
      '.......00..........00...........', '................................',
    ];
    const VAC1 = VAC.map((r, i) => (i === 12 || i === 13 ? r.replace(/2/g, '4') : r));
    makeSprite('vacuum', [VAC, VAC1], ['#2a2a30', '#8a2a3a', '#ff5a5a', '#3a3a44', '#ffd05a'], { width: 32, height: 32, align: 'bottom' });
    makeSprite('plug', [['..0..0....', '..0..0....', '0000000000', '0111111110', '0111111110', '0111111110', '0000000000', '....00....']], ['#1a1a1a', '#e8e8e8']);

    // Rubber duck 12x10 (2 frames) + drain plug 10x6 + bath tap 16x16
    const DUCK = ['....000.....', '...02210....', '..0222213...', '..0222210...', '000222200...', '022222220...', '0222222220..', '.02222220...', '..000000....', '............'];
    const DUCK1 = DUCK.map((r, i) => (i === 8 ? '.00000000...' : r));
    makeSprite('duck', [DUCK, DUCK1], ['#7a5a10', '#f2c94c', '#ffe066', '#e8802a'], { width: 12, height: 10 });
    makeSprite('drain', [['.00000000.', '0111111110', '0111111110', '0000000000', '....00....', '....00....']], ['#3a3a44', '#c8c8d0']);

    // Powerups: cardboard box 16x14, laser pointer 12x8, yarn ball 10x10
    makeSprite('box', [[
      '0000000000000000', '0111111111111110', '0122222222222210', '0100000000000010', '0111111111111110', '0111111111111110', '0111111111111110', '0111112111211110',
      '0111111111111110', '0111111111111110', '0111111111111110', '0111111111111110', '0111111111111110', '0000000000000000',
    ]], ['#5a3a1a', '#c8955a', '#8a6a3a']);
    makeSprite('laser', [['000000000...', '011111110...', '011111110.22', '000000000...', '............', '............', '............', '............']], ['#1a1a1a', '#8a8a92', '#ff2a2a']);
    makeSprite('dot', [['.0.', '000', '.0.']], ['#ff2a2a']);
    makeSprite('yarn', [['...0000...', '..011110..', '.01121110.', '0111121110', '0112111110', '0111112110', '0121111110', '.01111210.', '..011110..', '...0000...']], ['#7a1a1a', '#e03a3a', '#ff7a7a']);
    makeSprite('string', [['0']], ['#e03a3a']);

    // Cat flap door 16x32 + decor sprites: birdbath 16x24, neon sign 32x16, x-ray box 24x16, string lights 48x8
    makeSprite('catflap', [[
      '4444444444444444', '4000000000000004', '4022222222222204', '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204',
      '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204',
      '4021111111111204', '4021111111111204', '4021111111111204', '4021111111111204', '4020000000000204', '4025555555555204', '4025333333335204', '4025333333335204',
      '4025333333335204', '4025333333335204', '4025333333335204', '4025333333335204', '4025555555555204', '4020000000000204', '4000000000000004', '4444444444444444',
    ]], ['#3a2414', '#7a4a24', '#a3683a', '#e8dcc4', '#c9c1b0', '#5a3a1a']);
    makeSprite('birdbath', [[
      '................', '..000000000000..', '.01111111111110.', '.01222222222210.', '..000000000000..', '......0110......', '......0110......', '......0110......',
      '......0110......', '......0110......', '......0110......', '......0110......', '.....011110.....', '....01111110....', '...0111111110...', '...0000000000...',
    ]], ['#5a5a62', '#a8a8b0', '#7fb0ff'], { width: 16, height: 24, align: 'bottom' });
    makeSprite('neon', [
      ['00000000000000000000000000000000', '0..............................0', '0.1111.1111.1111..1111..1111...0', '0.1..1.1..1.1..1..1..1..1..1...0', '0.1111.1..1.1..1..1111..1111...0', '0.1..1.1..1.1..1..1..1..1..1...0', '0.1111.1111.1111..1..1..1..1...0', '0..............................0', '00000000000000000000000000000000'],
      ['00000000000000000000000000000000', '0..............................0', '0.2222.2222.2222..2222..2222...0', '0.2..2.2..2.2..2..2..2..2..2...0', '0.2222.2..2.2..2..2222..2222...0', '0.2..2.2..2.2..2..2..2..2..2...0', '0.2222.2222.2222..2..2..2..2...0', '0..............................0', '00000000000000000000000000000000'],
    ], ['#1a1030', '#ff4fd8', '#8f2a80']);
    makeSprite('xray', [[
      '000000000000000000000000', '011111111111111111111110', '011111222111112221111110', '011112222211122222111110', '011111222111112221111110', '011111121111111211111110', '011111111111111111111110', '011111121111111211111110',
      '011111222111112221111110', '011112222211122222111110', '011111222111112221111110', '011111111111111111111110', '000000000000000000000000', '..........0000..........', '..........0000..........', '..........0000..........',
    ]], ['#2a3a4a', '#9fd0ff', '#e8f4ff']);
    makeSprite('lights', [
      ['0..0..0..0..0..0..0..0..0..0..0..0..0..0..0..0..', '1..2..3..1..2..3..1..2..3..1..2..3..1..2..3..1..'],
      ['0..0..0..0..0..0..0..0..0..0..0..0..0..0..0..0..', '3..1..2..3..1..2..3..1..2..3..1..2..3..1..2..3..'],
    ], ['#3a3a44', '#ffd05a', '#ff6a8a', '#7fd0ff']);

    // Sleepy Z pickup (Delia only): a big Z with a little z drifting up, 2 frames
    makeSprite('ghost-mouse', [
      ['.......11.', '.......11.', '..........', '000000....', '....00....', '...00.....', '..00......', '000000....', '..........', '.......22.', '.......22.'],
      ['......11..', '......11..', '..........', '000000....', '....00....', '...00.....', '..00......', '000000....', '..........', '.......22.', '......22..'],
    ], ['#f2f2ff', '#c8d8ff', '#e8e8ff']);
    // HUD icon for the Z counter (overrides the mouse icon)
    makeSprite('icon-mouse', [[
      '0000000.',
      '....00..',
      '...00...',
      '..00....',
      '0000000.',
      '......11',
      '.....11.',
      '........',
    ]], ['#f4f2ee', '#c8d8ff']);
    // Delia's halo 14x5, three shimmer frames
    makeSprite('halo', [
      ['...00000000...', '.001111111100.', '00122222222100', '.001111111100.', '...00000000...'],
      ['...00000000...', '.001121112100.', '00122222222100', '.001211121100.', '...00000000...'],
      ['...00000000...', '.001111211100.', '00122212222100', '.001112111100.', '...00000000...'],
    ], ['#b8860b', '#f2c94c', '#fff4a0']);
  }

  // ------------------------------------------------------------------------
  // Glen & Em (spec §1.4): 32x48 frames, simple front-view figures.
  // ------------------------------------------------------------------------
  function rectArt(w, h, fill, outline = '0') {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        s += (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? outline : fill;
      }
      rows.push(s);
    }
    return rows;
  }

  // shared palette: 0 outline, 1 skin, 2 hair, 3 top, 4 top shade, 5 pants, 6 shoes, 7 face, 8 skin shade
  const GLEN_PAL = ['#1a1418', '#e8b89a', '#2a1e18', '#3a6fbf', '#2a4f8f', '#3a4a6a', '#222226', '#3a2a2a', '#c8987a'];
  const EM_PAL = ['#1a1418', '#f0c4a6', '#6b3f22', '#8f5fbf', '#6f3f9f', '#2a2a34', '#222226', '#3a2a2a', '#d0a488'];

  function humanFrames(cfg) {
    // cfg: { tall, hairLong }
    const H = 48, Wd = 32;
    const headW = 10, headH = 11;
    const torsoH = cfg.tall ? 15 : 12;
    const legH = cfg.tall ? 14 : 11;
    const hair = cfg.hairLong
      ? ['.00000000000.', '0222222222220', '0222222222220', '0222222222220', '022.......220', '022.......220', '022.......220', '022.......220', '022.......220', '022.......220', '022.......220', '.00.......00.']
      : ['..00000000..', '.0222222220.', '0222222222220'.slice(0, 12), '0222222222220'.slice(0, 12)];

    function head(x, y) {
      const layers = [];
      const face = [
        '..000000..',
        '.01111110.',
        '0111111110',
        '0111111110',
        '0171111710',
        '0111111110',
        '0111181110',
        '0111111110',
        '.01111110.',
        '.00111100.',
        '...0000...',
      ];
      if (cfg.hairLong) {
        layers.push({ art: hair, x: x - 1, y: y - 1 });
        layers.push({ art: face, x, y, union: true });
      } else {
        layers.push({ art: face, x, y });
        layers.push({ art: hair, x: x - 1, y: y - 1, union: false });
      }
      return layers;
    }

    function standing(armPose) {
      const baseY = H - 1;
      const legsY = baseY - legH - 2;
      const torsoY = legsY - torsoH + 1;
      const headY = torsoY - headH + 2;
      const cx = 16;
      const L = [];
      // legs
      L.push({ art: rectArt(6, legH + 1, '5'), x: cx - 7, y: legsY });
      L.push({ art: rectArt(6, legH + 1, '5'), x: cx + 1, y: legsY });
      L.push({ art: rectArt(7, 3, '6'), x: cx - 8, y: baseY - 2 });
      L.push({ art: rectArt(7, 3, '6'), x: cx + 1, y: baseY - 2 });
      // torso
      L.push({ art: rectArt(16, torsoH, '3'), x: cx - 8, y: torsoY });
      L.push({ art: rectArt(6, 2, '4', '4'), x: cx - 3, y: torsoY + 1 });
      // arms
      if (armPose === 'wave0' || armPose === 'wave1') {
        L.push({ art: rectArt(4, 10, '3'), x: cx - 11, y: torsoY + 1 });               // left arm down (sleeve)
        L.push({ art: rectArt(4, 4, '1'), x: cx - 11, y: torsoY + 10 });               // hand
        const up = armPose === 'wave0' ? 0 : 2;
        L.push({ art: rectArt(4, 8, '3'), x: cx + 8, y: torsoY - 6 + up });             // right arm up
        L.push({ art: rectArt(4, 5, '1'), x: cx + 8 + (armPose === 'wave1' ? 2 : 0), y: torsoY - 10 + up }); // hand
      } else {
        L.push({ art: rectArt(4, 10, '3'), x: cx - 11, y: torsoY + 1 });
        L.push({ art: rectArt(4, 4, '1'), x: cx - 11, y: torsoY + 10 });
        L.push({ art: rectArt(4, 10, '3'), x: cx + 8, y: torsoY + 1 });
        L.push({ art: rectArt(4, 4, '1'), x: cx + 8, y: torsoY + 10 });
      }
      L.push(...head(cx - 5, headY));
      return compose(Wd, H, L);
    }

    function crouched(reach) {
      // reach: 0..2 hand offset; 'hug' for both arms forward
      const baseY = H - 1;
      const legsY = baseY - 7;
      const torsoY = legsY - torsoH + 2;
      const headY = torsoY - headH + 2;
      const cx = 16;
      const L = [];
      L.push({ art: rectArt(9, 8, '5'), x: cx - 9, y: legsY });
      L.push({ art: rectArt(9, 8, '5'), x: cx + 1, y: legsY });
      L.push({ art: rectArt(8, 3, '6'), x: cx - 10, y: baseY - 2 });
      L.push({ art: rectArt(8, 3, '6'), x: cx + 3, y: baseY - 2 });
      L.push({ art: rectArt(16, torsoH, '3'), x: cx - 8, y: torsoY });
      L.push({ art: rectArt(6, 2, '4', '4'), x: cx - 3, y: torsoY + 1 });
      if (reach === 'hug') {
        // both arms wrap forward and low, around a cat sitting in front
        L.push({ art: rectArt(4, 6, '3'), x: cx - 11, y: baseY - 22 });
        L.push({ art: rectArt(12, 4, '3'), x: cx - 11, y: baseY - 17 });
        L.push({ art: rectArt(4, 6, '3'), x: cx + 8, y: baseY - 22 });
        L.push({ art: rectArt(12, 4, '3'), x: cx + 1, y: baseY - 17 });
        L.push({ art: rectArt(5, 4, '1'), x: cx - 2, y: baseY - 16 });
        L.push({ art: rectArt(5, 4, '1'), x: cx + 12, y: baseY - 16 });
      } else {
        L.push({ art: rectArt(4, 8, '3'), x: cx - 11, y: torsoY + 2 });
        L.push({ art: rectArt(4, 4, '1'), x: cx - 11, y: torsoY + 9 });
        // petting arm: out to the side at cat-head height, hand patting up and down
        const dy = [0, -2, 1][reach] || 0;
        L.push({ art: rectArt(4, 5, '3'), x: cx + 8, y: torsoY + 2 });
        L.push({ art: rectArt(11, 4, '3'), x: cx + 8, y: baseY - 17 + dy });
        L.push({ art: rectArt(5, 4, '1'), x: cx + 18, y: baseY - 17 + dy });
      }
      L.push(...head(cx - 5, headY));
      return compose(Wd, H, L);
    }

    return {
      frames: [standing('wave0'), standing('wave1'), crouched(0), crouched(1), crouched(2), crouched('hug'), crouched('hug')],
      map: { wave0: 0, wave1: 1, pet0: 2, pet1: 3, pet2: 4, hug0: 5, hug1: 6 },
    };
  }

  function buildHumans() {
    const glen = humanFrames({ tall: true, hairLong: false });
    makeSprite('glen', glen.frames, GLEN_PAL);
    const em = humanFrames({ tall: false, hairLong: true });
    // Em's hug frame 1: shift slightly so the pair "rocks"
    makeSprite('em', em.frames, EM_PAL);
    FRAMES.glen = glen.map;
    FRAMES.em = em.map;

    // Doorway 32x48: open (dark interior) and closed door
    const open = compose(32, 48, [
      { art: rectArt(32, 48, '1', '0') },
      { art: rectArt(28, 46, '2', '2'), x: 2, y: 2 },
      { art: rectArt(24, 44, '3', '3'), x: 4, y: 4 },
    ]);
    const closed = compose(32, 48, [
      { art: rectArt(32, 48, '1', '0') },
      { art: rectArt(28, 46, '4', '0'), x: 2, y: 2 },
      { art: rectArt(18, 14, '4', '5'), x: 7, y: 7 },
      { art: rectArt(18, 18, '4', '5'), x: 7, y: 25 },
      { art: ['66', '66'], x: 23, y: 24 },
    ]);
    makeSprite('doorway', [open, closed], ['#2a1a10', '#c9c1b0', '#8a8078', '#3a3448', '#7a4a24', '#5a3418', '#e8c14a']);
  }

  // ------------------------------------------------------------------------
  const FRAMES = {};   // FRAMES.scottie = { idle0: 0, ... }

  function buildAll() {
    if (built) return;
    built = true;
    buildTiles();
    buildProps();
    buildFont();
    buildEnemies();
    buildHumans();
    Object.assign(FRAMES, buildRoster());
  }

  return {
    setTextureManager, makeSprite, flipFrame, addAnim, compose, stamp, oval, blob, blank, recolor, rectArt,
    parseColor, buildAll, installFont, TILE, FRAMES, FONT_CHARS,
  };
})();

if (typeof module !== 'undefined') module.exports = Sprites;
