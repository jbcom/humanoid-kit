/**
 * Strand-map atlases for authored ropes, drawn from nothing: each tile is the pattern one rope
 * wears round its circumference and along its length (`tile` of `RopeSpec`), as vector shapes
 * rasterised by sharp (librsvg). Photographs of braids, twists and locs were looked at for the
 * proportions (a plait's stitch is about as long as the rope is wide; a twist's pitch is a
 * little over its width), and none was traced or sampled.
 *
 * A tile is periodic round the rope: its pattern is drawn with `PAD` pixels of itself repeated
 * on each side, so the mips never blend a tile's two edges with a neighbour's.
 */
import sharp from "sharp";

/** Pixels of a tile's own pattern repeated beyond each edge. */
export const PAD = 4;
export const TILE_WIDTH = 128;
export const TILE_COUNT = 4;
export const ATLAS_HEIGHT = 1024;
/** Atlas pixels per metre along a rope (V). */
export const PIXELS_PER_METRE = 1750;

/** The V span of one atlas height, metres of rope. */
export const METRES_PER_V = ATLAS_HEIGHT / PIXELS_PER_METRE;

/** A repeatable generator of numbers in [0, 1) from a seed (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The U range of tile `k`: only its own pattern, never the padding. */
export function tileRange(k: number): { u0: number; u1: number } {
  const total = TILE_WIDTH * TILE_COUNT;
  return {
    u0: (k * TILE_WIDTH + PAD) / total,
    u1: ((k + 1) * TILE_WIDTH - PAD) / total,
  };
}

const grey = (v: number) => {
  const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${g},${g},${g})`;
};

type Shape = (dx: number) => string;

/**
 * A pattern repeated for a tile's width with its padding: `draw(dx)` draws the pattern shifted by
 * `dx` pixels, and is called for the tile and for one period to either side.
 */
function tileGroup(k: number, period: number, draw: Shape): string {
  const x0 = k * TILE_WIDTH + PAD;
  const pieces: string[] = [];
  for (const shift of [-period, 0, period]) pieces.push(draw(x0 + shift));
  return `<g clip-path="url(#clip${k})">${pieces.join("")}</g>`;
}

const clips = () =>
  Array.from(
    { length: TILE_COUNT },
    (_, k) =>
      `<clipPath id="clip${k}"><rect x="${k * TILE_WIDTH}" y="0" width="${TILE_WIDTH}" height="${ATLAS_HEIGHT}"/></clipPath>`,
  ).join("");

async function rasterise(body: string, background: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH * TILE_COUNT}" height="${ATLAS_HEIGHT}" viewBox="0 0 ${TILE_WIDTH * TILE_COUNT} ${ATLAS_HEIGHT}"><defs>${clips()}<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="0.6"/></filter></defs><rect width="100%" height="100%" fill="${grey(background)}"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * A three-strand plait: columns of V-shaped stitches whose arms are strands, each arm shaded from
 * a dark edge to a light middle and drawn with the fibres that run along it, rows overlapping the
 * ones above, neighbouring columns half a stitch apart.
 */
export async function braidAtlas(seed = 7): Promise<Buffer> {
  const rand = random(seed);
  const columns = 4;
  const pattern = TILE_WIDTH - 2 * PAD;
  const colWidth = pattern / columns;
  const pitch = 30;
  const arm = 13;
  const body: string[] = [];
  for (let k = 0; k < TILE_COUNT; k++) {
    const tone = 0.85 + 0.3 * rand();
    const rows = Math.ceil(ATLAS_HEIGHT / pitch) + 2;
    const stitches = Array.from({ length: rows * columns }, (_, n) => ({
      c: n % columns,
      r: Math.floor(n / columns),
      lift: 0.8 + 0.4 * rand(),
      fibres: Array.from({ length: 7 }, () => rand()),
    }));
    body.push(
      tileGroup(k, pattern, (x) =>
        stitches
          .map(({ c, r, lift, fibres }) => {
            const cx = x + (c + 0.5) * colWidth;
            const y = r * pitch + (c % 2) * (pitch / 2) - pitch;
            const h = pitch * 1.45;
            const half = colWidth * 0.5;
            const arms = [-1, 1].map((side) => {
              const x1 = cx + side * half;
              const x2 = cx;
              // The arm as a parallelogram from the top corner to the bottom middle, with nested
              // narrower ones lighter inside it: edge, body, ridge.
              const band = (width: number, g: number) =>
                `<polygon points="${x1 - width / 2},${y} ${x1 + width / 2},${y} ${x2 + width / 2},${y + h} ${x2 - width / 2},${y + h}" fill="${grey(g * tone * lift)}"/>`;
              const strands = fibres
                .map((f, i) => {
                  const t0 = (i + f * 0.7) / fibres.length;
                  const fx1 = x1 + (t0 - 0.5) * arm * 0.9;
                  const fx2 = x2 + (t0 - 0.5) * arm * 0.9;
                  return `<line x1="${fx1}" y1="${y}" x2="${fx2}" y2="${y + h}" stroke="${grey(0.2 + 0.7 * f)}" stroke-width="0.8"/>`;
                })
                .join("");
              return `${band(arm, 0.22)}${band(arm * 0.78, 0.5)}${band(arm * 0.45, 0.78)}${strands}`;
            });
            return arms.join("");
          })
          .join(""),
      ),
    );
  }
  return rasterise(`<g filter="url(#soft)">${body.join("")}</g>`, 0.12);
}

/**
 * A two-strand twist: two ropes of fibre wound round each other, seen as diagonal ridges that run
 * once round the tile for a pitch of `pitch` pixels along it, each ridge shaded from its dark edge
 * to a light crest with the fibres drawn along it, a crevice between.
 */
export async function twistAtlas(seed = 5): Promise<Buffer> {
  const rand = random(seed);
  const pattern = TILE_WIDTH - 2 * PAD;
  const pitch = 34;
  // The ridge climbs `2 * pitch` over the tile's width, so it meets itself round the tube.
  const climb = (2 * pitch) / pattern;
  const body: string[] = [];
  for (let k = 0; k < TILE_COUNT; k++) {
    const tone = 0.85 + 0.3 * rand();
    const ridges = Math.ceil(ATLAS_HEIGHT / pitch) + 4;
    const jitter = Array.from({ length: ridges }, () => 0.85 + 0.3 * rand());
    const fibres = Array.from({ length: ridges }, () => Array.from({ length: 9 }, () => rand()));
    body.push(
      tileGroup(k, pattern, (x) =>
        jitter
          .map((lift, i) => {
            const y0 = (i - 2) * pitch;
            const edge = (inset: number, thick: number, g: number) => {
              const a = y0 + inset;
              const b = a + thick;
              const x1 = x + pattern;
              return `<polygon points="${x},${a} ${x1},${a + climb * pattern} ${x1},${b + climb * pattern} ${x},${b}" fill="${grey(g * tone * lift)}"/>`;
            };
            const lines = (fibres[i] as number[])
              .map((f, j) => {
                const off = pitch * 0.12 + (j / 9) * pitch * 0.5;
                return `<line x1="${x}" y1="${y0 + off}" x2="${x + pattern}" y2="${y0 + off + climb * pattern}" stroke="${grey(0.25 + 0.7 * f)}" stroke-width="0.8"/>`;
              })
              .join("");
            return `${edge(0, pitch * 0.62, 0.2)}${edge(pitch * 0.06, pitch * 0.5, 0.48)}${edge(pitch * 0.14, pitch * 0.3, 0.8)}${lines}`;
          })
          .join(""),
      ),
    );
  }
  return rasterise(`<g filter="url(#soft)">${body.join("")}</g>`, 0.1);
}

/**
 * A loc: hair matted into a rope, no pattern to it but fibres that wander along its length, a
 * few that stand out lighter, and the dark creases and knots where the matting folds.
 */
export async function locAtlas(seed = 3): Promise<Buffer> {
  const rand = random(seed);
  const pattern = TILE_WIDTH - 2 * PAD;
  const body: string[] = [];
  for (let k = 0; k < TILE_COUNT; k++) {
    const strokes: string[] = [];
    const wavy = (x0: number, y0: number, length: number, amp: number, g: number, w: number) => {
      const phase = rand() * 6.28;
      const freq = 0.02 + 0.03 * rand();
      const points: string[] = [];
      for (let y = 0; y <= length; y += 8)
        points.push(`${x0 + amp * Math.sin(phase + freq * y)},${y0 + y}`);
      return (dx: number) =>
        `<polyline points="${points
          .map((p) => {
            const [px, py] = p.split(",") as [string, string];
            return `${Number(px) + dx},${py}`;
          })
          .join(
            " ",
          )}" fill="none" stroke="${grey(g)}" stroke-width="${w}" stroke-linecap="round"/>`;
    };
    const fibres = Array.from({ length: 520 }, () =>
      wavy(
        rand() * pattern,
        rand() * ATLAS_HEIGHT - 80,
        120 + rand() * 260,
        2 + rand() * 6,
        0.18 + 0.7 * rand() ** 1.5,
        0.7 + rand() * 1.2,
      ),
    );
    const creases = Array.from({ length: 70 }, () => ({
      x: rand() * pattern,
      y: rand() * ATLAS_HEIGHT,
      length: 14 + rand() * 30,
    }));
    for (const f of fibres) strokes.push(tileGroup(k, pattern, f));
    for (const c of creases)
      strokes.push(
        tileGroup(
          k,
          pattern,
          (dx) =>
            `<line x1="${c.x + dx}" y1="${c.y}" x2="${c.x + dx + c.length * 0.6}" y2="${c.y + 3}" stroke="${grey(0.05)}" stroke-width="2.2" stroke-linecap="round"/>`,
        ),
      );
    body.push(strokes.join(""));
  }
  return rasterise(`<g filter="url(#soft)">${body.join("")}</g>`, 0.3);
}
