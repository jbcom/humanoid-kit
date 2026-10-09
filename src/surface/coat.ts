/**
 * The coat: short, dense hair standing off the skin (stubble, a dense chest, an
 * animal's pelt), drawn as shells (docs/ARCHITECTURE.md, "The coat"). This is
 * its pure part: the fields measured once from the base mesh (the comb field,
 * the direction hair lies, and the regions' masks), each region's paint for a
 * figure, the triangles a painted coat covers, and how many shells a figure's
 * size on screen earns. The renderer (`src/render/coat.ts`) draws from these.
 *
 * Body hair and the anthro fur are one coat: each adds regions (up to
 * `COAT_REGION_LIMIT`), and a region's paint is the only thing that differs.
 */
import type { HumanoidAssets } from "../format/assetFormat.ts";
import { groupFaces, jointPosition } from "../format/assetFormat.ts";
import type { SkinPaintInput } from "./layers.ts";
import { skinZones, zoneOfBone } from "./regions/skinZones.ts";
import type { Rgb } from "./skinTone.ts";

/** Regions a coat holds at most: two vec4 vertex attributes of masks. */
export const COAT_REGION_LIMIT = 8;

/** What a region grows for a figure. */
export interface CoatPaint {
  /** The share of follicles that grow a hair, 0..1 (0: the region draws nothing). */
  cover: number;
  /** Hair length, metres (shells break down past about 25 mm; longer is the cards'). */
  length: number;
  /** Follicles per cm². */
  density: number;
  /** How far the hair lies along the comb, 0 (standing) to 1 (flat). */
  lie: number;
  /** A strand's diameter, metres. */
  width: number;
  /** The hair's albedo, linear RGB (`hairAlbedo`). */
  colour: Rgb;
}

/** A region of the coat: where it may grow (a per-base-vertex mask) and what it grows. */
export interface CoatRegion {
  id: string;
  /** Targets the mask is measured from, packed with the body pack's first stage. */
  targets: readonly string[];
  mask(assets: HumanoidAssets): Float32Array;
  paint(input: SkinPaintInput): CoatPaint;
}

/**
 * A coat's fields on a surface's render vertices, in the topology: the
 * regions' ids, the comb (three floats a vertex, rest space, unit or 0) and
 * the masks (`COAT_REGION_LIMIT` bytes a vertex).
 */
export interface CoatFields {
  regions: string[];
  comb: Float32Array;
  masks: Uint8Array;
}

/** The longest coat hair, metres: shells separate at silhouettes past it. */
export const MAX_COAT_LENGTH = 0.025;

const unit = (x: number) => Math.min(1, Math.max(0, x));

type Vec3 = [number, number, number];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Bones whose hair runs along them, proximal to distal: the limbs'. */
const LIMB_ZONES = new Set(["upperArm", "forearm", "hand", "thigh", "shin", "foot"]);

/** Rounds of neighbour averaging that smooth the comb across bone boundaries. */
export const COMB_SMOOTHING = 6;

const combCache = new WeakMap<HumanoidAssets, Float32Array>();

/**
 * The comb field: per base vertex, the unit direction hair lies in rest space,
 * in the skin's tangent plane. Along each limb bone from proximal to distal;
 * down elsewhere (the trunk, the neck, the face), a choice where real hair has
 * whorls. Each vertex blends its bones by skin weight, the result is projected
 * to the tangent plane and smoothed `COMB_SMOOTHING` times by its neighbours.
 * Vertices off the drawn body are 0.
 */
export function combField(assets: HumanoidAssets): Float32Array {
  const known = combCache.get(assets);
  if (known) return known;
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const { normals } = skinZones(assets);
  const bones = assets.manifest.skeleton.bones;
  const at = (joint: string): Vec3 => {
    const p = new Float32Array(3);
    jointPosition(assets, P, joint, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  const boneDir: Vec3[] = bones.map((b) => {
    if (!LIMB_ZONES.has(zoneOfBone(b.name))) return [0, -1, 0];
    const h = at(b.head);
    const t = at(b.tail);
    return norm([t[0] - h[0], t[1] - h[1], t[2] - h[2]]);
  });
  const onBody = new Uint8Array(n);
  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const f of groupFaces(assets, "body")) {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    q.forEach((v, k) => {
      onBody[v] = 1;
      neighbours[v]?.add(q[(k + 1) % 4] as number);
      neighbours[v]?.add(q[(k + 3) % 4] as number);
    });
  }
  /** `d` projected to vertex v's tangent plane, unit length. */
  const tangent = (v: number, d: Vec3): Vec3 => {
    const nx = normals[v * 3] as number;
    const ny = normals[v * 3 + 1] as number;
    const nz = normals[v * 3 + 2] as number;
    const k = d[0] * nx + d[1] * ny + d[2] * nz;
    return norm([d[0] - k * nx, d[1] - k * ny, d[2] - k * nz]);
  };
  let comb = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    if (!onBody[v]) continue;
    const d: Vec3 = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = assets.skinWeight[v * 4 + k] as number;
      const b = boneDir[assets.skinIndex[v * 4 + k] as number];
      if (!b || w <= 0) continue;
      for (let c = 0; c < 3; c++) d[c] = (d[c] as number) + w * (b[c] as number);
    }
    comb.set(tangent(v, d), v * 3);
  }
  for (let round = 0; round < COMB_SMOOTHING; round++) {
    const next = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      if (!onBody[v]) continue;
      const d: Vec3 = [comb[v * 3] as number, comb[v * 3 + 1] as number, comb[v * 3 + 2] as number];
      for (const u of neighbours[v] as Set<number>)
        for (let c = 0; c < 3; c++) d[c] = (d[c] as number) + (comb[u * 3 + c] as number);
      next.set(tangent(v, d), v * 3);
    }
    comb = next;
  }
  combCache.set(assets, comb);
  return comb;
}

/**
 * The regions' masks per base vertex, `COAT_REGION_LIMIT` bytes a vertex
 * (0..255, unused regions 0): the layout the renderer's two mask attributes
 * read.
 */
export function coatMasks(assets: HumanoidAssets, regions: readonly CoatRegion[]): Uint8Array {
  if (regions.length > COAT_REGION_LIMIT)
    throw new RangeError(
      `a coat holds at most ${COAT_REGION_LIMIT} regions, not ${regions.length}`,
    );
  const n = assets.manifest.vertexCount;
  const out = new Uint8Array(n * COAT_REGION_LIMIT);
  regions.forEach((r, k) => {
    const m = r.mask(assets);
    if (m.length !== n)
      throw new RangeError(`coat region ${r.id}: a mask needs one value per vertex`);
    for (let v = 0; v < n; v++)
      out[v * COAT_REGION_LIMIT + k] = Math.round(unit(m[v] as number) * 255);
  });
  return out;
}

/**
 * Each region's paint for a figure, `COAT_REGION_LIMIT` rows of eight floats:
 * (cover, length, density, lie) then (red, green, blue, width). Regions past
 * the list, and a region that paints no cover, are zero rows. A paint out of
 * range is an error, never clamped.
 */
export function paintCoat(
  regions: readonly CoatRegion[],
  input: SkinPaintInput,
  out = new Float32Array(COAT_REGION_LIMIT * 8),
): Float32Array {
  out.fill(0);
  regions.forEach((r, k) => {
    const p = r.paint(input);
    if (!(p.length > 0 && p.length <= MAX_COAT_LENGTH && p.density > 0 && p.width > 0))
      throw new RangeError(
        `coat region ${r.id}: length must be in (0, ${MAX_COAT_LENGTH}] m, density and width > 0`,
      );
    const cover = unit(p.cover);
    if (cover === 0) return;
    out.set([cover, p.length, p.density, unit(p.lie), ...p.colour, p.width], k * 8);
  });
  return out;
}

/** Whether a paint table (`paintCoat`) grows any hair. */
export const coatPainted = (table: Float32Array): boolean =>
  Array.from({ length: COAT_REGION_LIMIT }, (_, k) => table[k * 8] as number).some((c) => c > 0);

/**
 * The triangles of `index` the coat covers: those with a corner in a region
 * the figure paints (`masks`, per vertex of the index, `COAT_REGION_LIMIT`
 * bytes; `table` from `paintCoat`). The coat draws only these, so it costs
 * nothing where nothing grows.
 */
export function coatTriangles(
  index: ArrayLike<number>,
  masks: Uint8Array,
  table: Float32Array,
): Uint32Array {
  const painted: number[] = [];
  for (let k = 0; k < COAT_REGION_LIMIT; k++) if ((table[k * 8] as number) > 0) painted.push(k);
  if (painted.length === 0) return new Uint32Array(0);
  const grows = (v: number) =>
    painted.some((k) => (masks[v * COAT_REGION_LIMIT + k] as number) > 0);
  const out: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] as number;
    const b = index[t + 1] as number;
    const c = index[t + 2] as number;
    if (grows(a) || grows(b) || grows(c)) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

/** Shells at most and at least. */
export const COAT_SHELLS = { min: 4, max: 16 } as const;

/**
 * How many shells a figure `pixels` tall on screen draws: one per 60 pixels of
 * height, between `COAT_SHELLS.min` and `.max` (a choice: a full-height figure
 * in a 1080-pixel view draws 16, one a tenth of that draws 4).
 */
export function coatShellCount(pixels: number): number {
  if (!(pixels > 0)) return COAT_SHELLS.min;
  return Math.max(COAT_SHELLS.min, Math.min(COAT_SHELLS.max, Math.round(pixels / 60)));
}
