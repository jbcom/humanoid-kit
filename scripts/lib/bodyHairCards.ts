/**
 * Body hair cards (docs/ARCHITECTURE.md, "Body hair"): sparse alpha cards for
 * the dense terminal hair of a beard and a chest, generated over the base mesh
 * and bound to it as MakeHuman binds hair, so they ride the hair pack's
 * loader, binding, occlusion bake, fields and material like any scalp style.
 *
 * Nothing here comes from a MakeHuman file: the cards and their strand map are
 * generated from the base mesh and a seed, so they are this project's own
 * bytes, and the hair pack's licence gate (which proves MakeHuman files CC0)
 * has nothing to prove for them.
 *
 * A card is a narrow strip of `SEGMENTS` quads rooted at a point on the skin,
 * running along the hair flow (the bind pose's downward direction in the
 * skin's plane, as the strand layers draw it) and lifting off the skin by its
 * `lift`. Each card vertex is bound to the three base vertices of the triangle
 * its root lies on, with the root's barycentric weights and its offset from the
 * root, so the card follows the skin as the figure's shape changes. Each card
 * has a `rank` in [0, 1): the renderer draws the cards whose rank is under the
 * figure's coverage, so density follows age, sex and the recipe without new
 * geometry.
 */
import type { HumanoidAssets } from "../../src/format/assetFormat.ts";
import { groupFaces } from "../../src/format/assetFormat.ts";
import { combField } from "../../src/surface/coat.ts";
import { GROWTH_SCALE } from "../../src/surface/hairFields.ts";
import { HAIR_STRAND_MEAN } from "../../src/surface/hairTone.ts";
import { beardMasks } from "../../src/surface/regions/bodyHairCoat.ts";
import type { CompiledAsset } from "./compileAsset.ts";

/** Quads along a card, root to tip. */
export const SEGMENTS = 3;

export interface CardSpec {
  id: string;
  /** Per base vertex, 0..1: where cards grow, and how densely. */
  mask: Float32Array;
  /** Cards per cm² where the mask is 1. */
  density: number;
  /** A card's length and width, metres. */
  length: number;
  width: number;
  /** How far a card's tip stands off the skin, as a fraction of its length. */
  lift: number;
  /** How far each card's direction may turn from the flow, radians. */
  spread: number;
  seed: number;
}

export interface Cards {
  compiled: CompiledAsset;
  /** Per card vertex, its card's rank in [0, 1): a card is drawn while its rank is under the coverage. */
  rank: Float32Array;
  /** Per card vertex, metres along its card from the root. */
  growth: Float32Array;
  cardCount: number;
}

/** A deterministic generator in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return scale(a, 1 / l);
};

/** Columns of the strand map: each card draws one, chosen at random. */
export const STRAND_COLUMNS = 8;

/** The cards' strand map's size, pixels: a column of 32 by 512, a card's width by its length. */
export const CARD_STRAND_MAP: readonly [number, number] = [256, 512];

/**
 * Cards over the skin where `spec.mask` lies, bound to the base mesh at rest.
 * The same spec always gives the same cards.
 */
export function generateCards(assets: HumanoidAssets, spec: CardSpec): Cards {
  const P = assets.positions;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  const rand = random(spec.seed);
  const refVerts: number[] = [];
  const weights: number[] = [];
  const offsets: number[] = [];
  const faceVerts: number[] = [];
  const faceUvs: number[] = [];
  const uvs: number[] = [];
  const rank: number[] = [];
  const growth: number[] = [];
  let cards = 0;
  // Cards run along the coat's comb, the one direction body hair lies in.
  const comb = combField(assets);
  const combAt = (v: number): Vec3 => [
    comb[v * 3] as number,
    comb[v * 3 + 1] as number,
    comb[v * 3 + 2] as number,
  ];
  for (const f of groupFaces(assets, "body")) {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    for (const tri of [
      [q[0], q[1], q[2]],
      [q[0], q[2], q[3]],
    ] as [number, number, number][]) {
      const [a, b, c] = tri;
      const m =
        ((spec.mask[a] as number) + (spec.mask[b] as number) + (spec.mask[c] as number)) / 3;
      if (m <= 0) continue;
      const pa = at(a);
      const pb = at(b);
      const pc = at(c);
      const n0 = cross(sub(pb, pa), sub(pc, pa));
      const area = Math.hypot(...n0) / 2;
      // Expected cards on this triangle; the fraction is a draw, so totals are right on average.
      const expected = area * 1e4 * spec.density * m;
      let count = Math.floor(expected);
      if (rand() < expected - count) count++;
      const normal = norm(n0);
      for (let i = 0; i < count; i++) {
        let u = rand();
        let v = rand();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const w0 = 1 - u - v;
        const root = add(add(scale(pa, w0), scale(pb, u)), scale(pc, v));
        // The comb at the root in the face's plane, turned by up to the spread about the normal.
        const along = add(add(scale(combAt(a), w0), scale(combAt(b), u)), scale(combAt(c), v));
        let flow = sub(along, scale(normal, dot(along, normal)));
        if (Math.hypot(...flow) < 1e-6) flow = norm(cross(normal, [1, 0, 0]));
        flow = norm(flow);
        const side0 = norm(cross(normal, flow));
        const turn = (rand() * 2 - 1) * spec.spread;
        const dir = norm(add(scale(flow, Math.cos(turn)), scale(side0, Math.sin(turn))));
        const side = norm(cross(normal, dir));
        const len = spec.length * (0.7 + 0.3 * rand());
        const column = Math.floor(rand() * STRAND_COLUMNS);
        const r = rand();
        const base = refVerts.length / 3;
        for (let s = 0; s <= SEGMENTS; s++) {
          const t = s / SEGMENTS;
          // The strip leaves the skin and curves back toward it: lift rises as t(1 - t / 2).
          const centre = add(
            add(root, scale(dir, len * t)),
            scale(normal, spec.lift * len * t * (1 - t / 2) + 2e-4),
          );
          const half = (spec.width / 2) * (1 - 0.5 * t);
          for (const k of [-1, 1]) {
            const p = add(centre, scale(side, k * half));
            refVerts.push(a, b, c);
            weights.push(w0, u, v);
            offsets.push(...sub(p, root));
            uvs.push((column + (k < 0 ? 0 : 1)) / STRAND_COLUMNS, t);
            rank.push(r);
            growth.push(len * t);
          }
        }
        for (let s = 0; s < SEGMENTS; s++) {
          const i0 = base + s * 2;
          faceVerts.push(i0, i0 + 1, i0 + 3, i0 + 2);
          faceUvs.push(i0, i0 + 1, i0 + 3, i0 + 2);
        }
        cards++;
      }
    }
  }
  const vertexCount = refVerts.length / 3;
  return {
    cardCount: cards,
    rank: Float32Array.from(rank),
    growth: Float32Array.from(growth),
    compiled: {
      id: spec.id,
      kind: "hair",
      name: spec.id,
      zDepth: 50,
      vertexCount,
      faceCount: faceVerts.length / 4,
      scale: null,
      material: {
        color: [1, 1, 1],
        roughness: 0.6,
        texture: null,
        transparent: true,
        alphaToCoverage: true,
        backfaceCull: false,
      },
      arrays: {
        refVerts: Uint32Array.from(refVerts),
        weights: Float32Array.from(weights),
        offsets: Float32Array.from(offsets),
        faceVerts: Uint32Array.from(faceVerts),
        faceUvs: Uint32Array.from(faceUvs),
        uvs: Float32Array.from(uvs),
        deleteVerts: new Uint32Array(0),
      },
      evidence: {},
      textures: new Map(),
    },
  };
}

/**
 * The cards' strand map: `STRAND_COLUMNS` columns, each a tuft of fine strands
 * from root (v = 0) to tip, tapering, in grey with alpha, its alpha-weighted
 * mean luminance `HAIR_STRAND_MEAN` (as the packer normalises every style's), so
 * the material's pigment colour is the hair's albedo. RGBA, 8 bits, sRGB.
 */
export function generateStrandMap(width: number, height: number, seed: number): Uint8Array {
  const rand = random(seed);
  const lum = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  const colW = width / STRAND_COLUMNS;
  for (let col = 0; col < STRAND_COLUMNS; col++) {
    const strands = 6 + Math.floor(rand() * 7);
    for (let s = 0; s < strands; s++) {
      const x0 = col * colW + colW * (0.15 + 0.7 * rand());
      const lean = (rand() * 2 - 1) * colW * 0.25;
      const reach = 0.6 + 0.4 * rand();
      const shade = 0.7 + 0.6 * rand();
      const thick = 0.6 + 0.8 * rand();
      for (let y = 0; y < height; y++) {
        const t = y / (height - 1);
        if (t > reach) break;
        const x = x0 + lean * t * t;
        const w = thick * (1 - 0.7 * (t / reach));
        for (let px = Math.floor(x - 2); px <= Math.ceil(x + 2); px++) {
          if (px < col * colW || px >= (col + 1) * colW) continue;
          const cover = Math.max(0, Math.min(1, w + 0.5 - Math.abs(px + 0.5 - x)));
          if (cover <= 0) continue;
          const i = y * width + px;
          const a = alpha[i] as number;
          alpha[i] = a + cover * (1 - a);
          lum[i] = Math.max(lum[i] as number, shade);
        }
      }
    }
  }
  // Normalise the alpha-weighted mean of the linear luminance to the strand mean.
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < lum.length; i++) {
    sum += (lum[i] as number) * (alpha[i] as number);
    weight += alpha[i] as number;
  }
  const gain = weight > 0 ? HAIR_STRAND_MEAN / (sum / weight) : 1;
  const out = new Uint8Array(width * height * 4);
  const srgb = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  for (let i = 0; i < lum.length; i++) {
    const g = Math.round(srgb((lum[i] as number) * gain) * 255);
    out[i * 4] = g;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = g;
    out[i * 4 + 3] = Math.round((alpha[i] as number) * 255);
  }
  return out;
}

/** A body hair card entry of the hair pack: its spec, and the beard style it is worn for. */
export interface CardEntrySpec extends CardSpec {
  label: string;
  /** The beard style (`BeardStyle`) the cards are worn for; the model finds them by this tag. */
  style: string;
}

/**
 * The body hair cards shipped: a full beard's length over the coat's dense base
 * (docs/ARCHITECTURE.md, "Body hair"). The beard's whole area; cards a little
 * longer than the coat's hair, lying along the comb with some lift. The numbers
 * are choices.
 */
export const BODY_HAIR_CARDS = (assets: HumanoidAssets): CardEntrySpec[] => {
  const parts = beardMasks(assets);
  const beard = Float32Array.from(
    parts.cheeks,
    (c, v) => c + (parts.moustache[v] as number) + (parts.chin[v] as number),
  );
  return [
    {
      id: "beard-full",
      label: "Full beard",
      style: "full",
      mask: beard,
      density: 0.9,
      length: 0.028,
      width: 0.005,
      lift: 0.3,
      spread: 0.45,
      seed: 0x5eed,
    },
  ];
};

/** The fields the hair pack carries for one entry of generated cards, as `writeAttachments` extras. */
export function cardFields(cards: Cards, lift: number) {
  const n = cards.compiled.vertexCount;
  return {
    growth: Uint16Array.from(cards.growth, (g) => Math.min(65535, Math.round(g * GROWTH_SCALE))),
    // No hairline: the cards root in the coat, which hides where they meet the skin.
    uvScale: new Uint16Array(n),
    fade: new Uint8Array(n).fill(255),
    fin: new Uint8Array(n).fill(Math.round(Math.min(1, lift) * 255)),
    // Cards grow from the skin under the coat, which tints it: no scalp of their own.
    scalpVerts: new Uint16Array(0),
    scalpWeights: new Uint8Array(0),
    rank: Uint8Array.from(cards.rank, (r) => Math.min(255, Math.floor(r * 256))),
  };
}
