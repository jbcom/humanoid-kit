/**
 * Expression lines: the creases a face makes when it moves (docs/ARCHITECTURE.md,
 * "Facial wrinkles"), drawn by the same crease layers as the elbow and knee and
 * driven by the face signals (`face.*`, src/rig/faceSignals.ts):
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
import type { DetailLayer } from "../layers.ts";
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
  forehead: 0.0007,
  glabella: 0.0005,
  crowsFeet: 0.0003,
  nasolabial: 0.0006,
  nose: 0.00025,
} as const;

/** Grooves across each set's window (art-directed). */
export const EXPRESSION_COUNT = {
  forehead: 5,
  glabella: 4,
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
const browDistances = new WeakMap<HumanoidAssets, Float32Array>();
function distanceFromBrows(assets: HumanoidAssets): Float32Array {
  const cachedDistance = browDistances.get(assets);
  if (cachedDistance) return cachedDistance;
  const f = frameOf(assets);
  const { brow } = landmarks(assets);
  const { start, list } = vertexAdjacency(f.n, assets.faceVerts);
  const dist = new Float32Array(f.n).fill(Number.POSITIVE_INFINITY);
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

/** Horizontal lines across the forehead, above the brows. */
const FOREHEAD_FROM = 0.01;
const FOREHEAD_TO = 0.062;
const forehead = cached((assets) => {
  const { brow } = landmarks(assets);
  const dist = distanceFromBrows(assets);
  const f = fieldsOfVertices(assets, (v, x, y, _z, _nx, _ny, nz) => {
    const d = dist[v] as number;
    if (!Number.isFinite(d)) return [0, 0];
    return [
      smoothstep(FOREHEAD_FROM, FOREHEAD_FROM + 0.014, d) *
        (1 - smoothstep(FOREHEAD_TO - 0.02, FOREHEAD_TO, d)) *
        // Above the brows only, and fading toward the temples.
        smoothstep(brow[1] - 0.002, brow[1] + 0.004, y) *
        (1 - smoothstep(0.048, 0.062, Math.abs(x))) *
        smoothstep(0.2, 0.5, nz),
      // The grooves run across the forehead by height, which is smooth over the
      // coarse mesh where a distance along its edges is not.
      (y - (brow[1] + FOREHEAD_FROM)) / (FOREHEAD_TO - FOREHEAD_FROM),
    ];
  });
  return f;
});

/** Vertical furrows between the brows: short, from the brows' band up 1 to 2.5 cm. */
const glabella = cached((assets) => {
  const { eye } = landmarks(assets);
  const dist = distanceFromBrows(assets);
  // Four grooves across 6 cm put them at 0.75 and 2.25 cm either side of the midline;
  // the mask keeps only the two nearest, a centimetre and a half apart, straight and
  // near-vertical, and the coordinate runs unclamped across the whole window so the
  // grooves do not bend where a clamp would flatten it.
  const half = 0.03;
  const reach = 0.013;
  return fieldsOfVertices(assets, (v, x, y, _z, _nx, _ny, nz) => {
    const d = dist[v] as number;
    if (!Number.isFinite(d)) return [0, 0];
    return [
      (1 - smoothstep(0.012, 0.026, d)) *
        (1 - smoothstep(reach - 0.004, reach, Math.abs(x))) *
        smoothstep(eye[1] + 0.008, eye[1] + 0.016, y) *
        smoothstep(0.2, 0.5, nz),
      (x + half) / (2 * half),
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

export const expressionLineId = (name: string) => `lines.${name}`;

/** The expression lines, after the joint creases. */
export const EXPRESSION_LINE_LAYERS: readonly DetailLayer[] = [
  layer(expressionLineId("forehead"), forehead, "forehead", (s) => signal(s, "browRaise")),
  layer(expressionLineId("crows-feet"), crowsFeet, "crowsFeet", (s) =>
    Math.max(signal(s, "squint"), 0.6 * signal(s, "smile")),
  ),
  layer(expressionLineId("glabella"), glabella, "glabella", (s) => signal(s, "browFurrow")),
  layer(expressionLineId("nasolabial"), nasolabial, "nasolabial", (s) =>
    Math.max(signal(s, "nasolabial"), 0.7 * signal(s, "smile")),
  ),
  layer(expressionLineId("nose"), noseBridge, "nose", (s) => signal(s, "noseWrinkle")),
];
