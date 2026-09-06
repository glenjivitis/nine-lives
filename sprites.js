// sprites.js — procedural spritesheets.
//
// Every sprite in Nine Lives is data, not an image file. A frame is an array
// of rows; each row is a string where every character is one pixel:
//
//   '.'  or ' '   transparent
//   '0'..'9'      palette[0..9]
//   'a'..'z'      palette[10..35]
//
// (Rows may also be arrays of numbers, -1 = transparent.)
//
// makeSprite(name, frames, palette) draws all frames left-to-right onto one
// canvas, registers it as a Phaser texture called `name`, and adds numbered
// frames 0..n-1 so scene.anims.generateFrameNumbers(name, {start, end}) works.
//
// Nothing here is scaled: pixels are drawn 1:1 and the game canvas is what
// gets zoomed (pixelArt + nearest-neighbor), so art stays crisp.

const Sprites = (() => {
  let textureManager = null;

  /** Call once (e.g. in a scene's preload/create) before makeSprite. */
  function setTextureManager(tm) {
    textureManager = tm;
  }

  /** '#rgb' | '#rrggbb' | '#rrggbbaa' | [r,g,b,(a)] -> [r,g,b,a] (0-255). */
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

  /** Character -> palette index, or -1 for transparent. */
  function charIndex(ch) {
    if (typeof ch === 'number') return ch;
    if (ch === '.' || ch === ' ') return -1;
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;        // '0'..'9'
    if (code >= 97 && code <= 122) return code - 97 + 10;  // 'a'..'z'
    if (code >= 65 && code <= 90) return code - 65 + 10;   // 'A'..'Z' (same as lowercase)
    throw new Error('Sprites: bad pixel char "' + ch + '"');
  }

  /**
   * Build a texture from index-art frames.
   * @param {string}   name     texture key
   * @param {Array}    frames   array of frames (each an array of rows), or a single frame
   * @param {string[]} palette  array of CSS hex colors, index = char in the art
   * @param {object}   [opts]   { width, height } to force a frame size (art is
   *                            top-left aligned and padded with transparency)
   * @returns {{key:string, frameWidth:number, frameHeight:number, frameCount:number}}
   */
  function makeSprite(name, frames, palette, opts = {}) {
    const tm = opts.textures || textureManager;
    if (!tm) throw new Error('Sprites.setTextureManager(scene.textures) must run before makeSprite');
    if (!Array.isArray(frames) || frames.length === 0) throw new Error('Sprites: ' + name + ' has no frames');
    if (!Array.isArray(frames[0])) frames = [frames]; // a single frame was passed

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
      for (let y = 0; y < frame.length; y++) {
        const row = frame[y];
        for (let x = 0; x < row.length; x++) {
          const idx = charIndex(row[x]);
          if (idx < 0) continue;
          const c = rgba[idx];
          if (!c) throw new Error('Sprites: ' + name + ' frame ' + i + ' uses palette index ' + idx + ' but palette has ' + rgba.length + ' colors');
          const p = (y * sheetW + ox + x) * 4;
          data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = c[3];
        }
      }
      tex.add(i, 0, ox, 0, fw, fh);
    });

    ctx.putImageData(img, 0, 0);
    tex.refresh();

    return { key: name, frameWidth: fw, frameHeight: fh, frameCount: frames.length };
  }

  /** Mirror a frame left-to-right (handy for asymmetric poses). */
  function flipFrame(frame) {
    return frame.map(row => (typeof row === 'string' ? row.split('').reverse().join('') : row.slice().reverse()));
  }

  /**
   * Register an animation over frames [start..end] of a makeSprite texture.
   * Skips silently if the animation already exists (scene restarts).
   */
  function addAnim(scene, key, textureKey, start, end, fps, repeat = -1) {
    if (scene.anims.exists(key)) return scene.anims.get(key);
    return scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(textureKey, { start, end }),
      frameRate: fps,
      repeat,
    });
  }

  return { setTextureManager, makeSprite, flipFrame, addAnim, parseColor };
})();
