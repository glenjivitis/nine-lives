// levels.js — tilemaps as string arrays (spec §7).
//
// Legend: '#' ground, '=' one-way platform, 'B' brick, '?' paw-block,
//         'K' kibble, 'R' roomba, 'C' cucumber trigger, '^' thumbtacks,
//         'S' start, 'D' door, '|' curtain (climb), '.' air

const Levels = (() => {
  const LEVELS = {};

  LEVELS['1-1'] = {
    id: '1-1',
    world: 1,
    rows: [
      '........................................................................................................................',
      '........................................................................................................................',
      '..................................KKK.......................===.........................................................',
      '.............?.......B?B..........===....................=======.....|.................KKK....?.........................',
      '.....................................................|...............|..............=====...............................',
      '........KKK...............R..........................|...............|.......R......................KK.................D',
      '.......=====..........R...........R.C................|........R......|..........................=====....R.R...........#',
      '###############...#############....############.....#####...####################....##############.....################',
      '###############...#############....############.....#####...####################....##############.....################',
      '###############...#############....############.....#####...####################....################...################',
      '###############...#############....############.....#####...####################....################...################',
    ],
  };

  /** Pad/trim every row to the same width. Floor rows extend with floor. */
  function normalize(rows) {
    const width = Math.max(...rows.map(r => r.length));
    return rows.map(r => {
      if (r.length >= width) return r.slice(0, width);
      const pad = r[r.length - 1] === '#' ? '#' : '.';
      return r + pad.repeat(width - r.length);
    });
  }

  /**
   * Parse a level into tile ids + entity lists.
   * Returns { width, height, grid (2D tile ids, -1 = air), oneWay: Set<"x,y">,
   *           start, door, kibble[], roombas[], cucumbers[], curtains[], pawBlocks[], bricks[], tacks[] }
   */
  function parse(level, T) {
    const rows = normalize(level.rows);
    const height = rows.length;
    const width = rows[0].length;
    const at = (x, y) => (y < 0 || y >= height || x < 0 || x >= width) ? '.' : rows[y][x];

    const grid = [];
    const out = {
      id: level.id, world: level.world, width, height, grid,
      oneWay: new Set(), start: null, door: null,
      kibble: [], roombas: [], cucumbers: [], curtains: [], pawBlocks: [], bricks: [], tacks: [], checkpoints: [],
    };

    for (let y = 0; y < height; y++) {
      const line = [];
      for (let x = 0; x < width; x++) {
        const c = at(x, y);
        let id = -1;
        switch (c) {
          case '#': id = at(x, y - 1) === '#' ? T.FLOOR_FILL : T.FLOOR_TOP; break;
          case '=': id = T.SHELF; out.oneWay.add(x + ',' + y); break;
          case 'B': id = T.BRICK; out.bricks.push({ x, y }); break;
          case '?': id = T.PAW; out.pawBlocks.push({ x, y }); break;
          case '^': id = T.TACKS; out.tacks.push({ x, y }); break;
          case '|': id = T.CURTAIN; out.curtains.push({ x, y }); break;
          case 'K': out.kibble.push({ x, y }); break;
          case 'R': out.roombas.push({ x, y }); break;
          case 'C': out.cucumbers.push({ x, y }); break;
          case 'S': out.start = { x, y }; break;
          case 'D': out.door = { x, y }; break;
          case 'F': out.checkpoints.push({ x, y }); break;
          default: break;
        }
        line.push(id);
      }
      grid.push(line);
    }

    if (!out.start) {
      // default: column 2, standing on the first floor tile found
      let y = 0;
      while (y < height && at(2, y) !== '#') y++;
      out.start = { x: 2, y: Math.max(0, y - 1) };
    }
    return out;
  }

  return { get: id => LEVELS[id], parse, all: () => Object.keys(LEVELS) };
})();

if (typeof module !== 'undefined') module.exports = Levels;
