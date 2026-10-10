import { fromHalf, toHalf } from "./half.ts";
import {
  FOLD_KEYS,
  FOLD_OPENINGS,
  FOLD_ROW_TEXELS,
  HIP_FOLD,
  type HipFold,
  hipRotation,
  type StencilRows,
  type SurfaceFold,
} from "./hipFold.ts";
import { IDENTITY_POSE, type RestBones, skinPositions } from "./pose.ts";

/**
 * The hip fold on a drawn surface made to draw the solved shape (docs/ARCHITECTURE.md,
 * "The hip fold"). The fold is solved on the control mesh, and a surface built
 * from it by a subdivision stencil takes the stencil's mix of its displacements
 * (`surfaceFold`); but the renderer skins each of the surface's vertices by its
 * own weights, and in a crease a flexed hip turns ninety degrees, skinning a
 * vertex between two of the control mesh's is not the mix of skinning them:
 * the drawn crease folds over itself where the solved one does not (seated,
 * the average figure's hip crease 51 triangles turned over against 8 on its
 * solved control surface subdivided). So each row also takes, at every key, what
 * the surface as skinned there lacks of the solved surface subdivided, by how
 * much of its stencil the fold reaches (so that it falls to nothing where the
 * fold ends).
 */

/** What of a drawn surface `solvedSurfaceFold` reads: its stencil, its render vertices' surface vertices and their weights. */
export interface DrawnSurface {
  stencil: StencilRows;
  renderToSurface: ArrayLike<number>;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

/**
 * `surface` (`surfaceFold` of `fold` on `drawn`) with each row's displacement
 * corrected, at every opening and key, by the stencil's mix of the control mesh
 * skinned there (by `controlSkin`) less the drawn surface skinned there, both at
 * rest built from `control`, the figure's control vertices, with skeleton
 * `rest`. The rows' sides and normal changes are as they were. A new fold.
 */
export function solvedSurfaceFold(
  surface: SurfaceFold,
  fold: HipFold,
  drawn: DrawnSurface,
  rest: RestBones,
  control: Float32Array,
  controlSkin: { skinIndex: Uint8Array | Uint16Array; skinWeight: Float32Array },
): SurfaceFold {
  if (!surface.rows) return surface;
  const { stencil, renderToSurface } = drawn;
  // Each row's surface vertex, and a render vertex of it whose weights it is skinned by.
  const surfaceOf = new Int32Array(surface.rows).fill(-1);
  const renderOf = new Int32Array(surface.rows).fill(-1);
  for (let r = 0; r < renderToSurface.length; r++) {
    const row = surface.slot[r] as number;
    if (row < 0 || (renderOf[row] as number) >= 0) continue;
    renderOf[row] = r;
    surfaceOf[row] = renderToSurface[r] as number;
  }
  // The control vertices the rows' stencils mix, each skinned once per pose.
  const sourceIndex = new Map<number, number>();
  for (let row = 0; row < surface.rows; row++) {
    const s = surfaceOf[row] as number;
    if (s < 0) continue;
    for (let e = stencil.offsets[s] as number; e < (stencil.offsets[s + 1] as number); e++) {
      const v = stencil.src[e] as number;
      if (!sourceIndex.has(v)) sourceIndex.set(v, sourceIndex.size);
    }
  }
  const sources = [...sourceIndex.keys()];
  const sourceRest = new Float32Array(sources.length * 3);
  const sourceSkinIndex = new Uint16Array(sources.length * 4);
  const sourceSkinWeight = new Float32Array(sources.length * 4);
  sources.forEach((v, i) => {
    sourceRest.set(control.subarray(v * 3, v * 3 + 3), i * 3);
    for (let k = 0; k < 4; k++) {
      sourceSkinIndex[i * 4 + k] = controlSkin.skinIndex[v * 4 + k] as number;
      sourceSkinWeight[i * 4 + k] = controlSkin.skinWeight[v * 4 + k] as number;
    }
  });
  // Each row's surface vertex at rest (the stencil's mix of the control mesh, without any detail), its weights,
  // and how much of its stencil the fold reaches.
  const rowRest = new Float32Array(surface.rows * 3);
  const rowSkinIndex = new Uint16Array(surface.rows * 4);
  const rowSkinWeight = new Float32Array(surface.rows * 4);
  const reached = new Float32Array(surface.rows);
  for (let row = 0; row < surface.rows; row++) {
    const s = surfaceOf[row] as number;
    if (s < 0) continue;
    for (let e = stencil.offsets[s] as number; e < (stencil.offsets[s + 1] as number); e++) {
      const v = stencil.src[e] as number;
      const w = stencil.weights[e] as number;
      for (let k = 0; k < 3; k++)
        rowRest[row * 3 + k] =
          (rowRest[row * 3 + k] as number) + w * (control[v * 3 + k] as number);
      if ((fold.slot[v] as number) >= 0) reached[row] = (reached[row] as number) + w;
    }
    const r = renderOf[row] as number;
    for (let k = 0; k < 4; k++) {
      rowSkinIndex[row * 4 + k] = drawn.skinIndex[r * 4 + k] as number;
      rowSkinWeight[row * 4 + k] = drawn.skinWeight[r * 4 + k] as number;
    }
  }
  const hips = [".L", ".R"].map((s) => rest.names.indexOf(HIP_FOLD.bone + s));
  const data = Uint16Array.from(surface.data);
  const posedSources = new Float32Array(sources.length * 3);
  const posedRows = new Float32Array(surface.rows * 3);
  const row4 = FOLD_ROW_TEXELS * 4;
  for (let o = 0; o < FOLD_OPENINGS; o++)
    for (let key = 0; key < FOLD_KEYS; key++) {
      const degrees = HIP_FOLD.from + (key + 1) * HIP_FOLD.step;
      const rotations = IDENTITY_POSE(rest.names.length);
      hips.forEach((b, side) => {
        if (b >= 0) rotations.set(hipRotation(degrees, o * HIP_FOLD.opened, side ? -1 : 1), b * 4);
      });
      skinPositions(rest, rotations, sourceRest, sourceSkinIndex, sourceSkinWeight, posedSources);
      skinPositions(rest, rotations, rowRest, rowSkinIndex, rowSkinWeight, posedRows);
      for (let row = 0; row < surface.rows; row++) {
        const s = surfaceOf[row] as number;
        const share = reached[row] as number;
        if (s < 0 || share <= 0) continue;
        const lacks = [0, 0, 0];
        for (let e = stencil.offsets[s] as number; e < (stencil.offsets[s + 1] as number); e++) {
          const i = sourceIndex.get(stencil.src[e] as number) as number;
          const w = stencil.weights[e] as number;
          for (let k = 0; k < 3; k++)
            lacks[k] = (lacks[k] as number) + w * (posedSources[i * 3 + k] as number);
        }
        const at = row * row4 + (o * FOLD_KEYS + key) * 8;
        for (let k = 0; k < 3; k++)
          data[at + k] = toHalf(
            fromHalf(data[at + k] as number) +
              share * ((lacks[k] as number) - (posedRows[row * 3 + k] as number)),
          );
      }
    }
  return { slot: surface.slot, rows: surface.rows, data };
}
