/**
 * Expression lines: the creases a face makes when it moves (docs/ARCHITECTURE.md,
 * "Facial wrinkles"), driven by the face signals (`face.*`, src/rig/faceSignals.ts).
 * The forehead's and the furrows' are thin lines of colour on a coordinate exactly
 * linear in position (the palm's technique, `hands/creases.ts`); the rest are
 * crease relief like the elbow's and knee's:
 *
 * - the forehead's horizontal lines when the brows rise (`browRaise`);
 * - the vertical furrows between the brows when they draw down (`browFurrow`);
 * - crow's feet, the lines fanning from each eye's outer corner, when the lower
 *   lids and cheeks rise (`squint`) or the face smiles;
 * - the nasolabial folds, from the nose's wing past the mouth's corner, when the
 *   cheeks rise in a smile or the fold is deepened (`smile`, `nasolabial`);
 * - the nose's bridge lines when it wrinkles (`noseWrinkle`).
 *
 * CHOICE, not measurement. Where each set lies is read from the default
 * figure's own joints (the brows, the eyes' outer corners, the nose's wing), so
 * it follows the mesh; how many lines and how deep is art-directed, since no
 * measurement of the depth or spacing of facial wrinkles against expression is
 * in this repository. The depths are fractions of a millimetre, as a face's
 * are, and grow with age (`expressionDepth`): a child's elastic skin barely
 * lines, an old face keeps them.
 */
import { groupFaces, type HumanoidAssets, jointPosition } from "../../format/assetFormat.ts";
import { vertexAdjacency } from "../../makehuman/regions.ts";
import { labFromLinear } from "../cielab.ts";
import type { ColourLayer, DetailLayer } from "../layers.ts";
import { DEFAULT_SKIN_TONE, type Rgb, type SkinTone, skinAlbedo } from "../skinTone.ts";
import { skinZones } from "./skinZones.ts";

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const unit = (x: number) => Math.min(1, Math.max(0, x));

/** How much of a face's full expression depth an age has: a child's skin barely lines, an old face's does most. */
export function expressionAgeFactor(age: number | undefined): number {
  const years = age ?? 30;
  const anchors: [number, number][] = [
    [6, 0.2],
    [14, 0.45],
    [25, 0.8],
    [40, 1],
    [70, 1.4],
  ];
  if (years <= (anchors[0] as [number, number])[0]) return (anchors[0] as [number, number])[1];
  for (let i = 1; i < anchors.length; i++) {
    const [y1, f1] = anchors[i] as [number, number];
    const [y0, f0] = anchors[i - 1] as [number, number];
    if (years <= y1) return f0 + ((f1 - f0) * (years - y0)) / (y1 - y0);
  }
  return (anchors[anchors.length - 1] as [number, number])[1];
}

/** Depth of a groove at full expression, metres, for a grown face (art-directed). */
export const EXPRESSION_DEPTH = {
  crowsFeet: 0.0003,
  nasolabial: 0.0006,
  nose: 0.00025,
} as const;

/** Grooves across each set's window (art-directed). */
export const EXPRESSION_COUNT = {
  crowsFeet: 3,
  nasolabial: 1,
  nose: 3,
} as const;

type Fields = { mask: Float32Array; coord: Float32Array };

/** Landmarks of the default figure, read from its joints (mirrored for the right). */
function landmarks(assets: HumanoidAssets) {
  const P = assets.positions;
  const at = (bone: string): [number, number, number] => {
    const p = new Float32Array(3);
    jointPosition(assets, P, `${bone}____head`, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  return {
    eye: at("eye.L"),
    brow: at("oculi01.L"),
    outer: at("oculi02.L"),
    wing: at("levator03.L"),
    fold: at("levator04.L"),
    cheek: at("levator05.L"),
  };
}

interface Frame {
  n: number;
  P: Float32Array;
  normals: Float32Array;
  /** Whether a vertex is skin of the face's front (the head's, facing forward, clear of the eyeballs). */
  face: Uint8Array;
}

const frames = new WeakMap<HumanoidAssets, Frame>();
function frameOf(assets: HumanoidAssets): Frame {
  let f = frames.get(assets);
  if (f) return f;
  const n = assets.manifest.vertexCount;
  const zones = skinZones(assets);
  const head = zones.zone("head");
  const lm = landmarks(assets);
  // Only the skin the body draws: the helper geometry (tongue, eyelashes, joints) lies beyond it.
  const visible = new Uint8Array(n);
  for (const q of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) visible[assets.faceVerts[q * 4 + k] as number] = 1;
  const face = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const x = assets.positions[v * 3] as number;
    const y = assets.positions[v * 3 + 1] as number;
    const z = assets.positions[v * 3 + 2] as number;
    // The eyeball's helper geometry sits inside the lids: keep clear of it.
    const eyeDist = Math.min(
      Math.hypot(x - lm.eye[0], y - lm.eye[1], z - lm.eye[2]),
      Math.hypot(x + lm.eye[0], y - lm.eye[1], z - lm.eye[2]),
    );
    face[v] = visible[v] && (head[v] as number) > 0.5 && z > 0.06 && eyeDist > 0.012 ? 1 : 0;
  }
  f = { n, P: assets.positions, normals: zones.normals, face };
  frames.set(assets, f);
  return f;
}

/** Fields for one set of grooves: `shape(x, y, z)` gives a mask and a coordinate at a position of the left (+X) or midline. */
function fieldsOf(
  assets: HumanoidAssets,
  shape: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number],
): Fields {
  const f = frameOf(assets);
  const mask = new Float32Array(f.n);
  const coord = new Float32Array(f.n);
  for (let v = 0; v < f.n; v++) {
    if (!f.face[v]) continue;
    const [m, c] = shape(
      f.P[v * 3] as number,
      f.P[v * 3 + 1] as number,
      f.P[v * 3 + 2] as number,
      f.normals[v * 3] as number,
      f.normals[v * 3 + 1] as number,
      f.normals[v * 3 + 2] as number,
    );
    mask[v] = unit(m);
    coord[v] = unit(c);
  }
  return { mask, coord };
}

/** `fieldsOf` with the vertex's index first, for a shape that looks something up per vertex. */
function fieldsOfVertices(
  assets: HumanoidAssets,
  shape: (
    v: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
  ) => [number, number],
): Fields {
  const f = frameOf(assets);
  const mask = new Float32Array(f.n);
  const coord = new Float32Array(f.n);
  for (let v = 0; v < f.n; v++) {
    if (!f.face[v]) continue;
    const [m, c] = shape(
      v,
      f.P[v * 3] as number,
      f.P[v * 3 + 1] as number,
      f.P[v * 3 + 2] as number,
      f.normals[v * 3] as number,
      f.normals[v * 3 + 1] as number,
      f.normals[v * 3 + 2] as number,
    );
    mask[v] = unit(m);
    coord[v] = unit(c);
  }
  return { mask, coord };
}

const cached = (build: (assets: HumanoidAssets) => Fields) => {
  const cache = new WeakMap<HumanoidAssets, Fields>();
  return (assets: HumanoidAssets) => {
    let f = cache.get(assets);
    if (!f) {
      f = build(assets);
      cache.set(assets, f);
    }
    return f;
  };
};

/**
 * Metres along the skin's own surface (over the mesh's edges) from the brows'
 * band to each vertex, infinite where the face's skin does not reach. The mesh
 * is coarse over the forehead and the skull, so a mask built from heights alone
 * leaks across big triangles up and over the crown; a distance along the skin
 * from the brow is the anatomy's own measure (frontalis lines stop 5 to 7 cm
 * above the brows, glabellar lines 1 to 2.5 cm), and a vertex beyond it is zero.
 */
const browDistances = new WeakMap<HumanoidAssets, Float64Array>();
export function distanceFromBrows(assets: HumanoidAssets): Float64Array {
  const cachedDistance = browDistances.get(assets);
  if (cachedDistance) return cachedDistance;
  const f = frameOf(assets);
  const { brow } = landmarks(assets);
  const { start, list } = vertexAdjacency(f.n, assets.faceVerts);
  const dist = new Float64Array(f.n).fill(Number.POSITIVE_INFINITY);
  // A binary heap of [distance, vertex].
  const heap: [number, number][] = [];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((heap[parent] as [number, number])[0] <= (heap[i] as [number, number])[0]) break;
      [heap[parent], heap[i]] = [heap[i] as [number, number], heap[parent] as [number, number]];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0])
          m = l;
        if (r < heap.length && (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0])
          m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i] as [number, number], heap[m] as [number, number]];
        i = m;
      }
    }
    return top;
  };
  // The brows' band: the face's skin at the brows' height, either side of the midline.
  for (let v = 0; v < f.n; v++) {
    if (!f.face[v]) continue;
    const x = Math.abs(f.P[v * 3] as number);
    if (Math.abs((f.P[v * 3 + 1] as number) - brow[1]) < 0.006 && x > 0.008 && x < 0.056) {
      dist[v] = 0;
      push([0, v]);
    }
  }
  while (heap.length > 0) {
    const [d, v] = pop();
    if (d > (dist[v] as number)) continue;
    for (let k = start[v] as number; k < (start[v + 1] as number); k++) {
      const w = list[k] as number;
      if (!f.face[w]) continue;
      const step = Math.hypot(
        (f.P[w * 3] as number) - (f.P[v * 3] as number),
        (f.P[w * 3 + 1] as number) - (f.P[v * 3 + 1] as number),
        (f.P[w * 3 + 2] as number) - (f.P[v * 3 + 2] as number),
      );
      if (d + step < (dist[w] as number)) {
        dist[w] = d + step;
        push([d + step, w]);
      }
    }
  }
  browDistances.set(assets, dist);
  return dist;
}

/**
 * Where the forehead's coordinate starts above the brows' joints, and how far it
 * runs, metres. A coordinate is stored in 0 to 1, and a vertex beyond the band is
 * stored clamped, which bends a line in any triangle that has one; so the band
 * reaches a face (about 2 cm) past the lines on either side, and the mask is zero
 * wherever the coordinate would be clamped (`inBand`).
 */
export const FOREHEAD_FROM = 0.004;
export const FOREHEAD_SPAN = 0.058;

/** The glabella's coordinate: x across `GLABELLA_HALF` either side of the midline. */
export const GLABELLA_HALF = 0.0245;

/**
 * The colour stops (of eight) each line sits on: stop k is at coordinate k/7. The
 * forehead's three lines fall about 2.1, 3.7 and 5.4 cm above the brows' joints
 * (frontalis lines stop 5 to 7 cm up, short of the hairline); the furrows 1.05 cm
 * either side of the midline, 2.1 cm apart, where the corrugators' lines fall.
 */
export const FOREHEAD_STOPS: readonly number[] = [2, 4, 6];
export const GLABELLA_STOPS: readonly number[] = [2, 5];

/**
 * How the forehead's lines depart from straight and even (CHOICES, so that three
 * lines read as a forehead's and not as stripes): they sag by `FOREHEAD_SAG` toward
 * each temple, wave by `FOREHEAD_WAVE` along their length, and their spacing varies
 * by `FOREHEAD_UNEVEN` of the span; and a line breaks up toward the temples where a
 * slow noise is high. The coordinate stays a smooth function of position sampled at
 * every vertex, so a line is a smooth curve across the mesh's triangles, never the
 * kinked path an interpolated nonlinear coordinate takes.
 */
export const FOREHEAD_SAG = 0.004;
export const FOREHEAD_WAVE = 0.0015;
export const FOREHEAD_UNEVEN = 0.02;

/** The most the forehead's coordinate (in metres of height) departs from straight. */
export const FOREHEAD_WARP_MAX = FOREHEAD_SAG + FOREHEAD_WAVE + FOREHEAD_UNEVEN * FOREHEAD_SPAN;

/** The forehead's coordinate at a point, 0 to 1 across its band: height, bent by the sag, the wave and the uneven spacing. */
export function foreheadCoordinate(browY: number, x: number, y: number): number {
  const raised =
    y + FOREHEAD_SAG * (x / 0.06) ** 2 + FOREHEAD_WAVE * Math.sin((2 * Math.PI * x) / 0.05 + 0.9);
  const t = (raised - (browY + FOREHEAD_FROM)) / FOREHEAD_SPAN;
  return t + FOREHEAD_UNEVEN * Math.sin(2 * Math.PI * 1.3 * t + 0.5);
}

/** How much of a forehead line is left at a point: 1 at the centre, breaking up toward the temples. */
export function foreheadUnbroken(x: number, y: number): number {
  const noise =
    0.5 + 0.5 * Math.sin(2 * Math.PI * (x * 21 + 0.3)) * Math.sin(2 * Math.PI * (y * 26 + 1.1));
  const toTemples = smoothstep(0.025, 0.055, Math.abs(x));
  return 1 - 0.9 * toTemples * smoothstep(0.55, 0.85, noise);
}

/** 1 well inside a coordinate's band (`0 < t < 1`), fading to 0 over `edge` of it at either end. */
const inBand = (t: number, edge: number) =>
  smoothstep(0, edge, t) * (1 - smoothstep(1 - edge, 1, t));

/**
 * The forehead's lines: a coordinate that is a smooth function of position
 * (`foreheadCoordinate`: height, sagging and waving a little, spaced unevenly), so
 * a line at one of its colour stops is a smooth curve wherever the coarse mesh's
 * vertices fall, as the palm's creases are (`hands/creases.ts`). The mask is a
 * plateau over the forehead above the brows, fading toward the temples, where the
 * lines weaken and break up (`foreheadUnbroken`), and out of the coordinate's band.
 * Deepest at the centre, as frontalis lines are.
 */
const forehead = cached((assets) => {
  const { brow } = landmarks(assets);
  const dist = distanceFromBrows(assets);
  return fieldsOfVertices(assets, (v, x, y, _z, _nx, _ny, nz) => {
    const d = dist[v] as number;
    if (!Number.isFinite(d)) return [0, 0];
    const t = foreheadCoordinate(brow[1], x, y);
    const across = Math.abs(x);
    return [
      (1 - smoothstep(0.075, 0.095, d)) *
        inBand(t, 0.1) *
        foreheadUnbroken(x, y) *
        (1 - 0.5 * smoothstep(0.015, 0.05, across)) *
        (1 - smoothstep(0.05, 0.066, across)) *
        smoothstep(0.2, 0.5, nz),
      t,
    ];
  });
});

/** Where the furrows start and end above the brows' joints, metres: 1.5 to 2.5 cm long, each end soft. */
export const FURROW_FROM = -0.008;
export const FURROW_TO = 0.022;

/**
 * The furrows between the brows: a coordinate linear in x across 4.9 cm of the
 * midline, with a line at two of its colour stops (`GLABELLA_STOPS`), straight and
 * vertical. The mask caps them at both ends (`FURROW_FROM`, `FURROW_TO`: a furrow
 * is a short groove between the inner brows, not a line up the forehead) and fades
 * out of the coordinate's band.
 */
const glabella = cached((assets) => {
  const { brow } = landmarks(assets);
  const dist = distanceFromBrows(assets);
  return fieldsOfVertices(assets, (v, x, y, _z, _nx, _ny, nz) => {
    const d = dist[v] as number;
    if (!Number.isFinite(d)) return [0, 0];
    const t = (x + GLABELLA_HALF) / (2 * GLABELLA_HALF);
    const up = y - brow[1];
    return [
      (1 - smoothstep(0.03, 0.045, d)) *
        inBand(t, 0.15) *
        smoothstep(FURROW_FROM - 0.004, FURROW_FROM + 0.004, up) *
        (1 - smoothstep(FURROW_TO - 0.008, FURROW_TO, up)) *
        smoothstep(0.2, 0.5, nz),
      t,
    ];
  });
});

/**
 * The lines fanning from each eye's outer corner. One layer for both sides, the
 * right's the left's reflected: each side's coordinate is the angle about its
 * own corner, and one layer is two fewer channels in the field atlas.
 */
const crowsFeet = cached((assets) => {
  const { outer } = landmarks(assets);
  const cx = outer[0];
  const spread = (55 * Math.PI) / 180;
  return fieldsOf(assets, (x, y, z) => {
    const dx = Math.abs(x) - cx;
    const dy = y - outer[1];
    const dz = z - outer[2];
    const r = Math.hypot(dx, dy, dz);
    const lateral = Math.hypot(dx, dz);
    const theta = Math.atan2(dy, Math.max(lateral, 1e-6));
    // Lateral of the corner: skin on the temple, not the lids.
    const outward = smoothstep(-0.002, 0.004, dx);
    const ring = smoothstep(0.005, 0.01, r) * (1 - smoothstep(0.026, 0.034, r));
    const fan = 1 - smoothstep(spread * 0.7, spread, Math.abs(theta));
    return [outward * ring * fan, (theta + spread) / (2 * spread)];
  });
});

/** The folds from the nose's wings, past the mouth's corners: one layer for both sides, as the crow's feet. */
const nasolabial = cached((assets) => {
  const { wing, fold, cheek } = landmarks(assets);
  // The line, from the wing through the fold and the cheek, extended past the mouth's corner.
  const end: [number, number, number] = [
    cheek[0] + (cheek[0] - fold[0]),
    cheek[1] + (cheek[1] - fold[1]),
    cheek[2] + (cheek[2] - fold[2]),
  ];
  const line = [wing, fold, cheek, end];
  const half = 0.009;
  return fieldsOf(assets, (x, y) => {
    const px = Math.abs(x);
    // The nearest point on the polyline, in the front-facing plane (X, Y): the fold runs down the cheek.
    let best = Number.POSITIVE_INFINITY;
    let signed = 0;
    let along = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as [number, number, number];
      const b = line[i + 1] as [number, number, number];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const len2 = ex * ex + ey * ey;
      const t = Math.min(1, Math.max(0, ((px - a[0]) * ex + (y - a[1]) * ey) / len2));
      const qx = a[0] + t * ex;
      const qy = a[1] + t * ey;
      const d = Math.hypot(px - qx, y - qy);
      if (d < best) {
        best = d;
        // Outward of the fold (away from the nose) is positive.
        signed = ((px - qx) * -ey + (y - qy) * ex) / Math.sqrt(len2);
        along = (i + t) / (line.length - 1);
      }
    }
    const cross = 1 - smoothstep(half * 0.6, half, best);
    // Soft ends: the fold starts at the wing and fades past the mouth.
    const ends = smoothstep(0, 0.12, along) * (1 - smoothstep(0.82, 1, along));
    return [cross * ends, 0.5 + signed / (2 * half)];
  });
});

/** Lines across the bridge of the nose. */
const noseBridge = cached((assets) => {
  const { eye, wing } = landmarks(assets);
  const y0 = wing[1] + 0.006;
  const y1 = eye[1] - 0.004;
  const half = 0.013;
  return fieldsOf(assets, (x, y, _z, _nx, _ny, nz) => [
    (1 - smoothstep(half - 0.004, half, Math.abs(x))) *
      smoothstep(y0 - 0.003, y0 + 0.003, y) *
      (1 - smoothstep(y1 - 0.003, y1 + 0.003, y)) *
      smoothstep(0.3, 0.7, nz),
    (y - y0) / (y1 - y0),
  ]);
});

const signal = (signals: Readonly<Record<string, number>>, name: string) =>
  unit(signals[`face.${name}`] ?? 0);

const layer = (
  id: string,
  fields: (assets: HumanoidAssets) => Fields,
  set: keyof typeof EXPRESSION_DEPTH,
  drive: (signals: Readonly<Record<string, number>>) => number,
): DetailLayer => ({
  id,
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields,
  paint: ({ signals, age }) => ({
    strength: smoothstep(0.1, 0.8, drive(signals)),
    height: EXPRESSION_DEPTH[set] * expressionAgeFactor(age),
    size: EXPRESSION_COUNT[set],
  }),
});

/**
 * How much a line of colour darkens the skin, in CIELAB lightness (L*), for a
 * grown face at full strength, and the most at any age. CHOICES, tuned against
 * `docs/evidence/expressions.md`. A line is darker by the same step of lightness
 * on every tone, not by the same fraction of its albedo, because a fraction of a
 * dark albedo is a step too small to see: the multiply is chosen per tone
 * (`lineShade`), so a line reads as well on deep skin as on fair.
 */
export const LINE_DELTA_L = 6;
export const LINE_DELTA_L_MAX = 12;

/** The most a line's multiply may take from a channel, at any tone (a line is a fold, not a hole). */
export const LINE_DARKENING_MAX = 0.55;

/** Luminance (Y, of white 1) of CIELAB lightness `L`. */
const luminanceOfLightness = (L: number) => (L > 8 ? ((L + 16) / 116) ** 3 : L / (24389 / 27));

/**
 * The colour a line multiplies the skin by at `age` for skin of `tone`: the factor
 * that lowers the skin's L* by `LINE_DELTA_L` (times the age factor, to
 * `LINE_DELTA_L_MAX`), slightly redder where it is deeper (a fold's shadow keeps the
 * skin's warmth, as the flush under it).
 */
export function lineShade(age: number | undefined, tone: SkinTone = DEFAULT_SKIN_TONE): Rgb {
  const skinL = labFromLinear(skinAlbedo(tone))[0];
  const drop = Math.min(LINE_DELTA_L_MAX, LINE_DELTA_L * expressionAgeFactor(age));
  const kept = luminanceOfLightness(Math.max(0, skinL - drop)) / luminanceOfLightness(skinL);
  const k = Math.min(LINE_DARKENING_MAX, 1 - kept);
  return [1 - k, 1 - k * 0.94, 1 - k * 0.9];
}

/** The deepest groove a line's relief cuts at full strength, for a grown face, metres (CHOICES: no measurement of wrinkle depth is in this repository). */
export const LINE_RELIEF = { forehead: 0.0006, glabella: 0.0007 } as const;

/**
 * A set of lines drawn as colour and shading: a multiply layer whose stops at
 * `stops` hold the line's shade and the rest leave the skin as it is, and whose
 * relief (`SkinLayerPaint.relief`) cuts a groove at the same stops, tilting the
 * normal per pixel by the gradient of the same coordinate, so the line is lit on
 * one side and shadowed on the other at every tone. A thin line carried by a
 * coordinate that is a smooth function of position is exact across the mesh's big
 * triangles where relief interpolated from vertices bends (the technique of the
 * palm's creases, `hands/creases.ts`).
 */
const colourLines = (
  id: string,
  fields: (assets: HumanoidAssets) => Fields,
  stops: readonly number[],
  depth: number,
  drive: (signals: Readonly<Record<string, number>>) => number,
): ColourLayer => ({
  id,
  blend: "multiply",
  targets: [],
  fields,
  paint: ({ signals, age, tone }) => {
    const one: Rgb = [1, 1, 1];
    const shade = lineShade(age, tone);
    const groove = depth * expressionAgeFactor(age);
    return {
      strength: smoothstep(0.1, 0.8, drive(signals)),
      stops: Array.from({ length: 8 }, (_, k) => (stops.includes(k) ? shade : one)),
      relief: Array.from({ length: 8 }, (_, k) => (stops.includes(k) ? groove : 0)),
    };
  },
});

export const expressionLineId = (name: string) => `lines.${name}`;

/** The expression lines, after the joint creases. */
export const EXPRESSION_LINE_LAYERS: readonly (DetailLayer | ColourLayer)[] = [
  colourLines(expressionLineId("forehead"), forehead, FOREHEAD_STOPS, LINE_RELIEF.forehead, (s) =>
    signal(s, "browRaise"),
  ),
  layer(expressionLineId("crows-feet"), crowsFeet, "crowsFeet", (s) =>
    Math.max(signal(s, "squint"), 0.6 * signal(s, "smile")),
  ),
  colourLines(expressionLineId("glabella"), glabella, GLABELLA_STOPS, LINE_RELIEF.glabella, (s) =>
    signal(s, "browFurrow"),
  ),
  layer(expressionLineId("nasolabial"), nasolabial, "nasolabial", (s) =>
    Math.max(signal(s, "nasolabial"), 0.7 * signal(s, "smile")),
  ),
  layer(expressionLineId("nose"), noseBridge, "nose", (s) => signal(s, "noseWrinkle")),
];
