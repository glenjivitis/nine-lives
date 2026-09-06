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
  // Scottie (spec §1.1). Faces right; the game flips for left.
  // ------------------------------------------------------------------------
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

  // Head with tall ears, 13 x 12. Eye at (7..8, 6..7), nose at (11, 8).
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
  // Ears back (run / dash): flatter ears.
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

  const SC_BODY = oval(18, 10, 2);
  const SC_BODY_LONG = oval(20, 9, 2);   // stretched (jump)
  const SC_BODY_SQUAT = oval(18, 8, 2);  // squashed (land / crouch)

  const SC_LEG = ['0110', '0110', '0110', '0110', '0110', '0110', '0110', '0110', '0000'];
  const SC_LEG_SHORT = ['0110', '0110', '0110', '0110', '0110', '0000'];
  const SC_LEG_TUCK = ['0110', '0110', '0110', '0000'];

  // Collar band across the neck: pink / cream (with buckle) / pink.
  const SC_COLLAR = ['.7777', '76668', '.7777'];

  // Tail (own overlay). 12 x 14, base at bottom-right tucks under the body.
  const SC_TAIL = [
    [
      '..00........',
      '.0210.......',
      '.0110.......',
      '.0110.......',
      '.0110.......',
      '.0110.......',
      '..0110......',
      '..0110......',
      '...0110.....',
      '....0110....',
      '.....0110...',
      '.....01100..',
      '......011110',
      '.......00000',
    ],
    [
      '...00.......',
      '..0210......',
      '..0110......',
      '..0110......',
      '.0110.......',
      '.0110.......',
      '.0110.......',
      '..0110......',
      '...0110.....',
      '....0110....',
      '.....0110...',
      '.....01100..',
      '......011110',
      '.......00000',
    ],
    [
      '............',
      '............',
      '00..........',
      '0210........',
      '0110........',
      '.0110.......',
      '.0110.......',
      '..0110......',
      '...0110.....',
      '....0110....',
      '.....0110...',
      '.....01100..',
      '......011110',
      '.......00000',
    ],
  ];
  // Tail up (airborne)
  const SC_TAIL_AIR = [
    [
      '.....00.....',
      '....0210....',
      '....0110....',
      '....0110....',
      '....0110....',
      '....0110....',
      '....0110....',
      '.....0110...',
      '.....0110...',
      '......0110..',
      '......0110..',
      '......01100.',
      '......011110',
      '.......00000',
    ],
  ];

  const FRAME_W = 32, FRAME_H = 24;

  /** One Scottie frame from part offsets. */
  function scottieFrame(o) {
    const bodyY = 8 + (o.dy || 0);
    const headY = 0 + (o.dy || 0) + (o.headDy || 0);
    const body = o.body || SC_BODY;
    const head = o.head || SC_HEAD;
    const legs = o.legs; // [{art, x, y}] drawn in order (far legs first)
    const layers = [];
    // far legs go under the body
    for (const L of legs.filter(l => l.far)) layers.push({ art: L.art, x: L.x, y: L.y });
    layers.push({ art: body, x: 4 + (o.bodyDx || 0), y: bodyY, union: true });
    for (const L of legs.filter(l => !l.far)) layers.push({ art: L.art, x: L.x, y: L.y, union: true });
    layers.push({ art: head, x: 17 + (o.headDx || 0), y: headY, union: true });
    layers.push({ art: SC_COLLAR, x: 17 + (o.headDx || 0), y: headY + 10 });
    return compose(FRAME_W, FRAME_H, layers);
  }

  // Standing legs: near-front 19, far-front 16, near-back 6, far-back 9; tops at y=15.
  const STAND_LEGS = [
    { art: SC_LEG, x: 16, y: 15, far: true },
    { art: SC_LEG, x: 9, y: 15, far: true },
    { art: SC_LEG, x: 19, y: 15 },
    { art: SC_LEG, x: 6, y: 15 },
  ];

  function walkLegs(i, n) {
    const ph = (i / n) * Math.PI * 2;
    const sw = Math.round(2 * Math.sin(ph));
    const liftA = Math.cos(ph) > 0.4 ? 1 : 0;           // legs swinging forward lift
    const liftB = Math.cos(ph + Math.PI) > 0.4 ? 1 : 0;
    const clamp = x => Math.max(5, Math.min(19, x));      // keep leg tops inside the body oval
    return [
      { art: SC_LEG, x: clamp(16 - sw), y: 15 - liftB, far: true },
      { art: SC_LEG, x: clamp(9 + sw), y: 15 - liftA, far: true },
      { art: SC_LEG, x: clamp(19 + sw), y: 15 - liftA },
      { art: SC_LEG, x: clamp(6 - sw), y: 15 - liftB },
    ];
  }

  function buildScottie() {
    const frames = [];
    const F = {};
    const push = (name, f) => { F[name] = frames.length; frames.push(f); };

    // idle (4): breathe — body/head sink 1px on frames 1-2
    push('idle0', scottieFrame({ legs: STAND_LEGS }));
    push('idle1', scottieFrame({ legs: STAND_LEGS, dy: 1 }));
    push('idle2', scottieFrame({ legs: STAND_LEGS, dy: 1 }));
    push('idle3', scottieFrame({ legs: STAND_LEGS }));
    // walk (6)
    for (let i = 0; i < 6; i++) push('walk' + i, scottieFrame({ legs: walkLegs(i, 6), dy: (i % 3 === 1) ? -1 : 0 }));
    // run (6): ears back, bigger stride
    for (let i = 0; i < 6; i++) {
      push('run' + i, scottieFrame({ legs: walkLegs(i, 6), head: SC_HEAD_EARSBACK, dy: (i % 3 === 1) ? -1 : 0 }));
    }
    // jump (2): stretch (front paws reach forward, back legs trail), tuck
    push('jump0', scottieFrame({
      body: SC_BODY_LONG, dy: -1, headDy: -1,
      legs: [
        { art: SC_LEG_SHORT, x: 17, y: 13, far: true }, { art: SC_LEG_SHORT, x: 8, y: 15, far: true },
        { art: SC_LEG_SHORT, x: 20, y: 12 }, { art: SC_LEG_SHORT, x: 5, y: 15 },
      ],
    }));
    push('jump1', scottieFrame({
      legs: [
        { art: SC_LEG_TUCK, x: 16, y: 15, far: true }, { art: SC_LEG_TUCK, x: 9, y: 15, far: true },
        { art: SC_LEG_TUCK, x: 19, y: 15 }, { art: SC_LEG_TUCK, x: 6, y: 15 },
      ],
    }));
    // fall (2): limbs spread
    push('fall0', scottieFrame({
      legs: [
        { art: SC_LEG_SHORT, x: 17, y: 14, far: true }, { art: SC_LEG_SHORT, x: 8, y: 14, far: true },
        { art: SC_LEG_SHORT, x: 20, y: 13 }, { art: SC_LEG_SHORT, x: 5, y: 13 },
      ],
    }));
    push('fall1', scottieFrame({
      dy: 1,
      legs: [
        { art: SC_LEG_SHORT, x: 17, y: 15, far: true }, { art: SC_LEG_SHORT, x: 8, y: 15, far: true },
        { art: SC_LEG_SHORT, x: 20, y: 14 }, { art: SC_LEG_SHORT, x: 5, y: 14 },
      ],
    }));
    // land (2): squat, then half
    push('land0', scottieFrame({
      body: SC_BODY_SQUAT, dy: 3, headDy: 1,
      legs: [
        { art: SC_LEG_SHORT, x: 16, y: 18, far: true }, { art: SC_LEG_SHORT, x: 9, y: 18, far: true },
        { art: SC_LEG_SHORT, x: 19, y: 18 }, { art: SC_LEG_SHORT, x: 6, y: 18 },
      ],
    }));
    push('land1', scottieFrame({
      dy: 2,
      legs: [
        { art: SC_LEG_SHORT, x: 16, y: 18, far: true }, { art: SC_LEG_SHORT, x: 9, y: 18, far: true },
        { art: SC_LEG_SHORT, x: 19, y: 18 }, { art: SC_LEG_SHORT, x: 6, y: 18 },
      ],
    }));
    // crouch (1)
    push('crouch', scottieFrame({
      body: SC_BODY_SQUAT, dy: 3, headDy: 2,
      legs: [
        { art: SC_LEG_SHORT, x: 16, y: 18, far: true }, { art: SC_LEG_SHORT, x: 9, y: 18, far: true },
        { art: SC_LEG_SHORT, x: 19, y: 18 }, { art: SC_LEG_SHORT, x: 6, y: 18 },
      ],
    }));
    // blink
    push('blink', scottieFrame({ legs: STAND_LEGS, head: SC_HEAD_BLINK }));

    makeSprite('scottie', frames, SCOTTIE_PAL, { width: 32, height: 32, align: 'bottom' });

    // tail overlays, same frame space so they sit on the same origin
    const tailFrames = SC_TAIL.map(t => compose(FRAME_W, FRAME_H, [{ art: t, x: 0, y: 1 }]));
    const tailAir = SC_TAIL_AIR.map(t => compose(FRAME_W, FRAME_H, [{ art: t, x: 0, y: 1 }]));
    makeSprite('scottie-tail', tailFrames, SCOTTIE_PAL, { width: 32, height: 32, align: 'bottom' });
    makeSprite('scottie-tail-air', tailAir, SCOTTIE_PAL, { width: 32, height: 32, align: 'bottom' });

    return F;
  }

  // ------------------------------------------------------------------------
  // World 1 tileset (16x16). Index order matters: see TILE below.
  // ------------------------------------------------------------------------
  const TILE = { FLOOR_TOP: 0, FLOOR_FILL: 1, SHELF: 2, BRICK: 3, PAW: 4, TACKS: 5, CURTAIN: 6, PAW_USED: 7 };

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
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
    '....fghgfghg....',
  ];

  function buildTiles() {
    makeSprite('tiles', [T_FLOOR_TOP, T_FLOOR_FILL, T_SHELF, T_BRICK, T_PAW, T_TACKS, T_CURTAIN, T_PAW_USED], TILE_PAL);
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
      '....00000000....',
      '..0011222211100.',
      '.011111111111110',
      '0111111111111110',
      '0111111111111110',
      '.01111111111110.',
      '..000000000000..',
    ]], ['#1f4d1f', '#3f8f3f', '#6fbf5f', '#dfe7c0'], { width: 16, height: 16, align: 'bottom' });

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

    // Ghost mouse pickup 10x7 (Delia only)
    makeSprite('ghost-mouse', [
      ['...0000...', '..011110.0', '.01121100.', '0111111110', '0111111100', '.00000000.', '..0..0....'],
      ['...0000...', '..011110..', '.011211000', '0111111110', '0111111100', '.00000000.', '..0..0....'],
    ], ['#dcdcf0', '#ffffff', '#6a6a8a']);
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
        L.push({ art: rectArt(10, 4, '3'), x: cx - 14, y: torsoY + 6 });
        L.push({ art: rectArt(10, 4, '3'), x: cx + 5, y: torsoY + 6 });
        L.push({ art: rectArt(4, 4, '1'), x: cx - 17, y: torsoY + 8 });
        L.push({ art: rectArt(4, 4, '1'), x: cx + 14, y: torsoY + 8 });
      } else {
        L.push({ art: rectArt(4, 8, '3'), x: cx - 11, y: torsoY + 2 });
        L.push({ art: rectArt(4, 4, '1'), x: cx - 11, y: torsoY + 9 });
        // petting arm reaches down-forward
        L.push({ art: rectArt(4, 10 + reach, '3'), x: cx + 9, y: torsoY + 2 });
        L.push({ art: rectArt(5, 4, '1'), x: cx + 9, y: torsoY + 11 + reach });
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
    FRAMES.scottie = buildScottie();
  }

  return {
    setTextureManager, makeSprite, flipFrame, addAnim, compose, stamp, oval, blank,
    parseColor, buildAll, installFont, TILE, FRAMES, FONT_CHARS,
  };
})();

if (typeof module !== 'undefined') module.exports = Sprites;
