import { SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { jointRotations } from "./folds.ts";
import { fromHalf, toHalf } from "./half.ts";
import { type JointFold, rowTexels, type StencilRows, type SurfaceFold } from "./jointFold.ts";
import { type RestBones, skinPositions } from "./pose.ts";

/**
 * A joint fold on a drawn surface made to draw the solved shape
 * (docs/ARCHITECTURE.md, "The hip fold"). The fold is solved on the control
 * mesh, and a surface built from it by a subdivision stencil takes the
 * stencil's mix of its displacements (`surfaceFold`); but the renderer skins
 * each of the surface's vertices by its own weights, and in a crease a joint
 * turns ninety degrees, skinning a vertex between two of the control mesh's is
 * not the mix of skinning them: the drawn crease folds over itself where the
 * solved one does not (seated, the average figure's hip crease 51 triangles
 * turned over against 8 on its solved control surface subdivided). So each row
 * also takes, at every key, what the surface as skinned there lacks of the
 * solved surface subdivided, by how much of its stencil the fold reaches (so
 * that it falls to nothing where the fold ends).
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
  fold: JointFold,
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
  const n = SKIN_INFLUENCES;
  const sourceSkinIndex = new Uint16Array(sources.length * n);
  const sourceSkinWeight = new Float32Array(sources.length * n);
  sources.forEach((v, i) => {
    sourceRest.set(control.subarray(v * 3, v * 3 + 3), i * 3);
    sourceSkinIndex.set(controlSkin.skinIndex.subarray(v * n, v * n + n), i * n);
    sourceSkinWeight.set(controlSkin.skinWeight.subarray(v * n, v * n + n), i * n);
  });
  // Each row's surface vertex at rest (the stencil's mix of the control mesh, without any detail), its weights,
  // and how much of its stencil the fold reaches.
  const rowRest = new Float32Array(surface.rows * 3);
  const rowSkinIndex = new Uint16Array(surface.rows * n);
  const rowSkinWeight = new Float32Array(surface.rows * n);
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
    rowSkinIndex.set(drawn.skinIndex.subarray(r * n, r * n + n), row * n);
    rowSkinWeight.set(drawn.skinWeight.subarray(r * n, r * n + n), row * n);
  }
  const { joint } = surface;
  const data = Uint16Array.from(surface.data);
  const posedSources = new Float32Array(sources.length * 3);
  const posedRows = new Float32Array(surface.rows * 3);
  const row4 = rowTexels(joint) * 4;
  for (let o = 0; o < joint.openings; o++)
    for (let key = 0; key < joint.keys; key++) {
      const degrees = joint.from + (key + 1) * joint.step;
      const rotations = jointRotations(joint, rest, degrees, o * joint.opened);
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
        const at = row * row4 + (o * joint.keys + key) * 8;
        for (let k = 0; k < 3; k++)
          data[at + k] = toHalf(
            fromHalf(data[at + k] as number) +
              share * ((lacks[k] as number) - (posedRows[row * 3 + k] as number)),
          );
      }
    }
  return { joint, slot: surface.slot, rows: surface.rows, data };
}
