/**
 * Which skin a stack of garments hides, and which of each garment the garments
 * over it hide in turn. Pure arithmetic over base-vertex visibility, no
 * geometry: `HumanoidModel` turns the results into index buffers.
 *
 * The behaviour is MakeHuman's, reimplemented here from its documented
 * description (docs/ARCHITECTURE.md, "Clothing"):
 *
 * - Garments are layered by `z_depth`, then by category (`GARMENT_LAYERS`),
 *   then by id, so the same outfit always stacks the same way. The stack is
 *   processed from the outermost garment in. Each garment is masked by the
 *   deletions of the garments above it only, then adds its own, so a garment's
 *   deletions hide the body and every garment under it, never itself and never
 *   one over it.
 * - A mask over base vertices reaches a garment's own vertices through the
 *   vertices it is bound to: a vertex bound to one base vertex copies it;
 *   otherwise it is hidden unless two of its three references are visible.
 * - A face is hidden only when all of its corners are hidden, so a face that
 *   keeps one visible corner stays and no gap opens along a garment's edge.
 */

/**
 * The order garments of equal `z_depth` stack in, innermost first, by the
 * category an asset declares as its `kind`. The values are MakeHuman's own (its
 * API's table: body 31, underwear 39, socks 43, shirt and trousers 47, sweater
 * 50, indoor jacket 53, shoes 57, coat 61, backpack 69); only their order
 * matters here. Hats sit outside everything: they hide no skin, and nothing
 * sits over them.
 */
export const GARMENT_LAYERS = {
  underwear: 39,
  socks: 43,
  clothes: 47,
  sweater: 50,
  jacket: 53,
  shoes: 57,
  coat: 61,
  hat: 65,
  backpack: 69,
} as const;

export type GarmentKind = keyof typeof GARMENT_LAYERS;

export class OutfitError extends Error {
  override name = "OutfitError";
}

/** What decides a garment's place in the stack. */
export interface LayerEntry {
  id: string;
  kind: string;
  /** MakeHuman's `z_depth`, the asset's own say in where it layers: lower is nearer the skin. */
  zDepth: number;
}

/** The part of a bound garment that masking reads. */
export interface MaskedGarment {
  entry: LayerEntry;
  /** Three base vertex indices per garment vertex. */
  refVerts: Uint32Array;
  weights: Float32Array;
  /** Base vertices this garment hides while worn. */
  deleteVerts: Uint32Array;
}

const layerOf = (e: LayerEntry): number => {
  const layer = (GARMENT_LAYERS as Readonly<Record<string, number>>)[e.kind];
  if (layer === undefined)
    throw new OutfitError(
      `${e.id}: "${e.kind}" is not a garment category (${Object.keys(GARMENT_LAYERS)})`,
    );
  return layer;
};

/**
 * Garment ids innermost first: by `z_depth`, then category, then id. The
 * asset's own `z_depth` comes first because it is what its author said:
 * MakeHuman's system shoes declare 5 and its suits 50, so trousers hang over
 * shoes, where a category table that put shoes over trousers would cut the
 * hem off at the ankle. The category decides only between garments of equal
 * depth (a coat over a shirt, both 50), where MakeHuman's own tiebreak is a
 * random uuid.
 */
export function layerOrder(entries: readonly LayerEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) throw new OutfitError(`${e.id} is worn twice`);
    seen.add(e.id);
  }
  return entries
    .map((e) => ({ e, layer: layerOf(e) }))
    .sort(
      (a, b) =>
        a.e.zDepth - b.e.zDepth ||
        a.layer - b.layer ||
        (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0),
    )
    .map((x) => x.e.id);
}

/**
 * A base-vertex visibility mask (1 visible) carried to a garment's own
 * vertices: a vertex bound exactly to one base vertex copies it, any other is
 * visible when at least two of its three reference vertices are.
 */
export function transferVisibility(
  visible: Uint8Array,
  garment: Pick<MaskedGarment, "refVerts" | "weights">,
): Uint8Array {
  const n = garment.refVerts.length / 3;
  const out = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const r0 = visible[garment.refVerts[v * 3] as number] as number;
    if (
      garment.weights[v * 3] === 1 &&
      garment.weights[v * 3 + 1] === 0 &&
      garment.weights[v * 3 + 2] === 0
    ) {
      out[v] = r0;
    } else {
      const count =
        r0 +
        (visible[garment.refVerts[v * 3 + 1] as number] as number) +
        (visible[garment.refVerts[v * 3 + 2] as number] as number);
      out[v] = count >= 2 ? 1 : 0;
    }
  }
  return out;
}

export interface StackVisibility {
  /** Base vertices still showing (1) once the whole outfit is worn. */
  base: Uint8Array;
  /** Each garment's own vertices still showing, by garment id. */
  garments: Map<string, Uint8Array>;
}

/**
 * Stacks `garments` (in any order) over `vertexCount` base vertices. `visible`
 * is the visibility to start from (all visible when omitted); it is not
 * changed.
 */
export function stackVisibility(
  vertexCount: number,
  garments: readonly MaskedGarment[],
  visible?: Uint8Array,
): StackVisibility {
  const byId = new Map(garments.map((g) => [g.entry.id, g] as const));
  const innerFirst = layerOrder(garments.map((g) => g.entry));
  const base = visible ? Uint8Array.from(visible) : new Uint8Array(vertexCount).fill(1);
  const out = new Map<string, Uint8Array>();
  for (let i = innerFirst.length - 1; i >= 0; i--) {
    const g = byId.get(innerFirst[i] as string) as MaskedGarment;
    // Masked by the garments above only: they have already deleted from `base`.
    out.set(g.entry.id, transferVisibility(base, g));
    for (const v of g.deleteVerts) base[v] = 0;
  }
  return { base, garments: out };
}

/**
 * Per face, whether it shows: 1 unless every one of its four corners is
 * hidden. `faces` lists the faces to read (default: all of `faceVerts`), and
 * the result is in that order.
 */
export function faceVisibility(
  faceVerts: Uint32Array,
  faces: Uint32Array | null,
  visible: Uint8Array,
): Uint8Array {
  const count = faces ? faces.length : faceVerts.length / 4;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const f = faces ? (faces[i] as number) : i;
    out[i] =
      (visible[faceVerts[f * 4] as number] as number) |
      (visible[faceVerts[f * 4 + 1] as number] as number) |
      (visible[faceVerts[f * 4 + 2] as number] as number) |
      (visible[faceVerts[f * 4 + 3] as number] as number);
  }
  return out;
}

/**
 * A triangle index buffer without the triangles of the hidden faces. A face
 * owns consecutive triangles, written face by face by the surface builders:
 * `trianglesPerFace` of them each (2 × 4^level once subdivided), or, for a
 * surface with finer faces in places, the starts given as `faceTriangles`
 * (`SurfaceMesh.faceTriangles`: face `f` owns `[faceTriangles[f],
 * faceTriangles[f + 1])`). Returns `index` itself when nothing is hidden.
 */
export function maskIndex(
  index: Uint32Array,
  faceVisible: Uint8Array,
  trianglesPerFace: number | Uint32Array,
): Uint32Array {
  let shown = 0;
  for (const v of faceVisible) shown += v;
  if (shown === faceVisible.length) return index;
  const start = (f: number) =>
    typeof trianglesPerFace === "number" ? f * trianglesPerFace : (trianglesPerFace[f] as number);
  let kept = 0;
  for (let f = 0; f < faceVisible.length; f++) if (faceVisible[f]) kept += start(f + 1) - start(f);
  const out = new Uint32Array(kept * 3);
  let o = 0;
  for (let f = 0; f < faceVisible.length; f++) {
    if (!faceVisible[f]) continue;
    const piece = index.subarray(start(f) * 3, start(f + 1) * 3);
    out.set(piece, o);
    o += piece.length;
  }
  return out;
}
