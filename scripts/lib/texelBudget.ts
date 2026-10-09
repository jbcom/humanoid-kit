/**
 * How many texels a texture needs: its texel density on the default figure
 * against the closest framing the QA contact sheets judge it at
 * (docs/evidence/upscale-inventory.md).
 *
 * A triangle's texel density is sqrt(UV area × width × height / surface area),
 * texels per millimetre of skin or cloth. A texture resolves at a framing when
 * its texels are no larger than the screen's pixels there (texels/mm ≥ px/mm);
 * below that each texel is magnified into a visible block or blur. The packers
 * size a texture so that `COVERAGE` of its surface area resolves, never above
 * its source (they re-source, they do not invent) nor `TEXTURE_CEILING`.
 */
import type { BoundAsset } from "../../src/format/assetFormat.ts";
import { evaluateBinding } from "../../src/mhclo/bound.ts";

/** The playground's vertical field of view, degrees. */
export const FOV = 35;
/** The integrator's sheet pass renders at 2× pixel density. */
export const DPR = 2;

export interface Framing {
  /** Camera distance to the subject, metres. */
  distance: number;
  /** Sheet cell height, CSS pixels. */
  height: number;
  /** The QA sheet it is taken from. */
  sheet: string;
}

/**
 * The closest framing the QA sheets have used per area of skin, for what is worn
 * on the head (`face`), and for a clothed figure.
 */
export const FRAMINGS = {
  face: { distance: 0.42, height: 380, sheet: "lane-face/brows-tones-age6" },
  forearm: { distance: 0.369, height: 400, sheet: "lane-hands/tattoos-forearm-after" },
  hand: { distance: 0.129, height: 360, sheet: "lane-hands/hands-palm-child-after" },
  foot: { distance: 0.07, height: 520, sheet: "lane-clothing/feet-heel-macro" },
  torso: { distance: 0.222, height: 480, sheet: "lane-clothing/torso-breast-baseline" },
  clothed: {
    distance: 2.604,
    height: 560,
    sheet: "lane-clothing/garments-dual-skinning-poses",
  },
} as const satisfies Record<string, Framing>;
export type FramingId = keyof typeof FRAMINGS;

/**
 * What is worn on or in the head, seen at the face's framing; anything else
 * worn, at a clothed figure's. Both the packs' kinds and the packers' (a hair
 * style compiles as `hair`, `eyebrows` or `eyelashes`).
 */
const HEAD_KINDS = new Set([
  "eyes",
  "teeth",
  "tongue",
  "scalp",
  "brows",
  "lashes",
  "hair",
  "eyebrows",
  "eyelashes",
  "hat",
]);

/** The framing an attachment or garment of `kind` is judged at. */
export const framingOf = (kind: string): FramingId => (HEAD_KINDS.has(kind) ? "face" : "clothed");

/** Screen pixels per millimetre on a surface facing the camera at `f`. */
export const pxPerMm = (f: Framing) =>
  (f.height * DPR) / (2 * f.distance * Math.tan((FOV * Math.PI) / 360)) / 1000;

/** Share of a texture's surface area that must resolve at its framing. */
export const COVERAGE = 0.9;
/** Longest edge shipped: one 2048² RGBA8 texture is 16 MB on the GPU, 21 MB with mipmaps. */
export const TEXTURE_CEILING = 2048;

export interface Tri {
  /** Surface area, mm². */
  area: number;
  /** UV area, as a share of the whole texture. */
  uv: number;
  /** Whatever the caller groups by (a region of the body), or "". */
  region: string;
}

const triArea = (p: ArrayLike<number>, a: number, b: number, c: number) => {
  const ab = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (p[a * 3 + k] as number));
  const ac = [0, 1, 2].map((k) => (p[c * 3 + k] as number) - (p[a * 3 + k] as number));
  return (
    0.5 *
    Math.hypot(
      (ab[1] as number) * (ac[2] as number) - (ab[2] as number) * (ac[1] as number),
      (ab[2] as number) * (ac[0] as number) - (ab[0] as number) * (ac[2] as number),
      (ab[0] as number) * (ac[1] as number) - (ab[1] as number) * (ac[0] as number),
    )
  );
};

const uvArea = (u: ArrayLike<number>, a: number, b: number, c: number) =>
  0.5 *
  Math.abs(
    ((u[b * 2] as number) - (u[a * 2] as number)) *
      ((u[c * 2 + 1] as number) - (u[a * 2 + 1] as number)) -
      ((u[c * 2] as number) - (u[a * 2] as number)) *
        ((u[b * 2 + 1] as number) - (u[a * 2 + 1] as number)),
  );

/**
 * The triangles of quads `first` to `first + count` (a triangle repeats its last
 * corner), positions in metres; `region` names each by its first corner.
 */
export function triangles(
  positions: ArrayLike<number>,
  uvs: ArrayLike<number>,
  faceVerts: ArrayLike<number>,
  faceUvs: ArrayLike<number>,
  first: number,
  count: number,
  region: (vertex: number) => string = () => "",
): Tri[] {
  const out: Tri[] = [];
  for (let f = first; f < first + count; f++) {
    const v = [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k] as number);
    const t = [0, 1, 2, 3].map((k) => faceUvs[f * 4 + k] as number);
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 2, 3],
    ] as const) {
      if (v[k] === v[j] || v[k] === v[i]) continue;
      const area = triArea(positions, v[i] as number, v[j] as number, v[k] as number) * 1e6;
      const uv = uvArea(uvs, t[i] as number, t[j] as number, t[k] as number);
      if (area > 0 && uv > 0) out.push({ area, uv, region: region(v[i] as number) });
    }
  }
  return out;
}

/** What `boundTriangles` reads of an attachment or garment. */
export type BoundMesh = Pick<
  BoundAsset,
  "refVerts" | "weights" | "offsets" | "faceVerts" | "faceUvs" | "uvs"
> & { entry: Pick<BoundAsset["entry"], "scale" | "vertexCount" | "faceCount"> };

/**
 * An attachment's or garment's triangles fitted to the base mesh at `base`
 * (metres); `region` names each by the base vertex its first corner binds to most.
 */
export function boundTriangles(
  mesh: BoundMesh,
  base: Float32Array,
  region: (baseVertex: number) => string = () => "",
): Tri[] {
  const pos = evaluateBinding(mesh, base, new Float32Array(mesh.entry.vertexCount * 3));
  return triangles(pos, mesh.uvs, mesh.faceVerts, mesh.faceUvs, 0, mesh.entry.faceCount, (v) =>
    region(mesh.refVerts[v * 3] as number),
  );
}

/**
 * Texels per mm of a `w`×`h` texture over `tris`: the area-weighted quantile
 * `q` (0.5 the median; 1 − COVERAGE the density `COVERAGE` of the area meets).
 */
export function texelDensity(tris: readonly Tri[], w: number, h: number, q: number): number {
  const rows = tris
    .map((t) => ({ d: Math.sqrt((t.uv * w * h) / t.area), a: t.area }))
    .sort((x, y) => x.d - y.d);
  const total = rows.reduce((s, r) => s + r.a, 0);
  let acc = 0;
  for (const r of rows) {
    acc += r.a;
    if (acc >= q * total) return r.d;
  }
  return rows.at(-1)?.d ?? 0;
}

/**
 * Edges are rounded up to a multiple of this, not to a power of two: WebGL2
 * mipmaps and repeats any size, and a power of two would cost up to four times
 * the texels a texture needs (an eye that needs 1386 would get 2048).
 */
export const EDGE_STEP = 128;

/**
 * The smallest longest edge, a multiple of `EDGE_STEP`, at which `COVERAGE` of
 * `tris`' area resolves at `framing` (a square texture's density scales with
 * its edge).
 */
export function neededEdge(tris: readonly Tri[], framing: FramingId): number {
  const d = texelDensity(tris, 1, 1, 1 - COVERAGE);
  return Math.max(EDGE_STEP, Math.ceil(pxPerMm(FRAMINGS[framing]) / d / EDGE_STEP) * EDGE_STEP);
}

/**
 * The longest edge a texture ships at: its pack's default edge (`floor`) or
 * more when it needs it, but never more than its source has (`sourceEdge`) nor
 * `TEXTURE_CEILING`. Need only raises a texture: shrinking one that resolves
 * would save little, and alpha cut-outs lose coverage as they shrink.
 */
export const shippedEdge = (needed: number, sourceEdge: number, floor: number) =>
  Math.min(Math.max(needed, floor), sourceEdge, TEXTURE_CEILING);
