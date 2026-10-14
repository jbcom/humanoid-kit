/**
 * Evaluates MHCLO bindings: places an attachment's vertices on the current
 * (morphed) base mesh. Each vertex is a weighted sum of three base vertices
 * plus an offset whose x, y and z are scaled by how much a reference distance
 * on the body has grown or shrunk since the asset was fitted, so attachments
 * keep their proportions on every body shape.
 */
import { type AttachmentEntry, type BoundAsset, SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { addInfluences, writeStrongest } from "../rig/influences.ts";

const AXES = ["x", "y", "z"] as const;

/** What binding reads of a bound mesh: an attachment or a garment. */
export type Bound = Pick<BoundAsset, "refVerts" | "weights" | "offsets"> & {
  entry: Pick<AttachmentEntry, "scale" | "vertexCount">;
};

/** Per-axis offset scale for the given control positions (1 when the asset has no scale references). */
export function bindingScale(asset: Bound, control: Float32Array): [number, number, number] {
  const s = asset.entry.scale;
  if (!s) return [1, 1, 1];
  return AXES.map((axis, i) => {
    const [v1, v2, reference] = s[axis];
    const d = Math.abs((control[v1 * 3 + i] as number) - (control[v2 * 3 + i] as number));
    return reference > 0 ? d / reference : 1;
  }) as [number, number, number];
}

/** Writes the attachment's control positions (`vertexCount * 3`) for the given body control positions. */
export function evaluateBinding(
  asset: Bound,
  control: Float32Array,
  out: Float32Array,
): Float32Array {
  const [sx, sy, sz] = bindingScale(asset, control);
  const { refVerts: r, weights: w, offsets: o } = asset;
  const n = asset.entry.vertexCount;
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    const a = (r[k] as number) * 3;
    const b = (r[k + 1] as number) * 3;
    const c = (r[k + 2] as number) * 3;
    const wa = w[k] as number;
    const wb = w[k + 1] as number;
    const wc = w[k + 2] as number;
    out[k] =
      wa * (control[a] as number) +
      wb * (control[b] as number) +
      wc * (control[c] as number) +
      (o[k] as number) * sx;
    out[k + 1] =
      wa * (control[a + 1] as number) +
      wb * (control[b + 1] as number) +
      wc * (control[c + 1] as number) +
      (o[k + 1] as number) * sy;
    out[k + 2] =
      wa * (control[a + 2] as number) +
      wb * (control[b + 2] as number) +
      wc * (control[c + 2] as number) +
      (o[k + 2] as number) * sz;
  }
  return out;
}

/**
 * Writes an MHCLO attachment with its source-authored free offsets multiplied.
 *
 * Every vertex keeps its three weighted base-mesh anchors, its source topology
 * and its per-axis body-shape scale. The multiplier changes only the original
 * offset from that anchored surface. A factor of one delegates to
 * `evaluateBinding`, preserving its exact default result.
 */
export function evaluateBindingWithOffsetScale(
  asset: Bound,
  control: Float32Array,
  offsetScale: number,
  out: Float32Array,
): Float32Array {
  if (!Number.isFinite(offsetScale) || offsetScale < 1)
    throw new RangeError("MHCLO offset scale must be a finite number at least 1");
  if (offsetScale === 1) return evaluateBinding(asset, control, out);
  const [sx, sy, sz] = bindingScale(asset, control);
  const { refVerts: r, weights: w, offsets: o } = asset;
  const n = asset.entry.vertexCount;
  // This output often is the cached geometry a renderer currently publishes.
  // Preflight every coordinate before writing so a rejected multiplier cannot
  // leave a partly overwritten attachment full of Float32 infinities.
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    const a = (r[k] as number) * 3;
    const b = (r[k + 1] as number) * 3;
    const c = (r[k + 2] as number) * 3;
    const wa = w[k] as number;
    const wb = w[k + 1] as number;
    const wc = w[k + 2] as number;
    const x =
      wa * (control[a] as number) +
      wb * (control[b] as number) +
      wc * (control[c] as number) +
      (o[k] as number) * sx * offsetScale;
    const y =
      wa * (control[a + 1] as number) +
      wb * (control[b + 1] as number) +
      wc * (control[c + 1] as number) +
      (o[k + 1] as number) * sy * offsetScale;
    const z =
      wa * (control[a + 2] as number) +
      wb * (control[b + 2] as number) +
      wc * (control[c + 2] as number) +
      (o[k + 2] as number) * sz * offsetScale;
    if (![x, y, z].every((value) => Number.isFinite(Math.fround(value))))
      throw new RangeError(`MHCLO offset scale exceeds finite Float32 output at vertex ${v}`);
  }
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    const a = (r[k] as number) * 3;
    const b = (r[k + 1] as number) * 3;
    const c = (r[k + 2] as number) * 3;
    const wa = w[k] as number;
    const wb = w[k + 1] as number;
    const wc = w[k + 2] as number;
    out[k] =
      wa * (control[a] as number) +
      wb * (control[b] as number) +
      wc * (control[c] as number) +
      (o[k] as number) * sx * offsetScale;
    out[k + 1] =
      wa * (control[a + 1] as number) +
      wb * (control[b + 1] as number) +
      wc * (control[c + 1] as number) +
      (o[k + 1] as number) * sy * offsetScale;
    out[k + 2] =
      wa * (control[a + 2] as number) +
      wb * (control[b + 2] as number) +
      wc * (control[c + 2] as number) +
      (o[k + 2] as number) * sz * offsetScale;
  }
  return out;
}

/** A source-preserving facial-beard growth state, bounded by the rest floor. */
/** The stable unit-control point that reproduces the original source placement. */
export const SOURCE_GROWTH_FRACTION = 0.5;

export interface OffsetScaleGrowth {
  /** Whether this control should publish a renderable facial-hair mesh. */
  visible: boolean;
  /** Unit-control point at which the original source placement is exact. */
  nativeFraction: typeof SOURCE_GROWTH_FRACTION;
  /** The top of the authored source mesh's shared rest-space root frame. */
  sourceRootY: number;
  /** The upper source-height quantile used to derive the shared root normal. */
  sourceRootBandY: number;
  /** The lowest authored source vertex in that rest-space frame. */
  sourceFloorY: number;
  /** How much source depth below that root reaches the rest-floor endpoint. */
  restFloorDepthScale: number;
  /** The source-depth multiplier at this control value. */
  depthScale: number;
  /** Multiplier for transverse free offsets while the source beard is shrinking. */
  sourceScale: number;
}

/**
 * Resolves a unit growth fraction from no published mesh (zero), through the
 * exact source placement, to the deepest source vertex at `restFloorY` (one).
 * Above the source placement the mesh stretches by each vertex's source depth
 * below one common source-root frame. This preserves the source topology and
 * transverse placement; the model may add its separate source-derived body
 * clearance proxy without changing the face/jaw MHCLO anchors.
 */
export function resolveOffsetScaleGrowth(
  asset: Bound,
  control: Float32Array,
  restFloorY: number,
  growth: number,
): OffsetScaleGrowth {
  if (!Number.isFinite(growth) || growth < 0 || growth > 1)
    throw new RangeError("MHCLO growth must be a finite number in [0, 1]");
  if (!Number.isFinite(restFloorY)) throw new RangeError("MHCLO growth needs a finite rest floor");
  const native = evaluateBinding(asset, control, new Float32Array(asset.entry.vertexCount * 3));
  let sourceRootY = Number.NEGATIVE_INFINITY;
  let sourceFloorY = Number.POSITIVE_INFINITY;
  const heights: number[] = [];
  for (let v = 0; v < asset.entry.vertexCount; v++) {
    const y = native[v * 3 + 1] as number;
    heights.push(y);
    sourceRootY = Math.max(sourceRootY, y);
    sourceFloorY = Math.min(sourceFloorY, y);
  }
  heights.sort((left, right) => left - right);
  const sourceRootBandY = heights[Math.ceil((heights.length - 1) * 0.95)] as number;
  const sourceDepth = sourceRootBandY - sourceFloorY;
  if (!(sourceDepth > 0) || !Number.isFinite(sourceDepth))
    throw new RangeError("MHCLO growth needs source vertices below its root band");
  const restFloorDepthScale = (sourceRootBandY - restFloorY) / sourceDepth;
  if (!Number.isFinite(restFloorDepthScale) || restFloorDepthScale < 1)
    throw new RangeError("MHCLO growth rest floor must not rise above the source beard");
  const sourceScale = Math.min(1, growth / SOURCE_GROWTH_FRACTION);
  const depthScale =
    growth <= SOURCE_GROWTH_FRACTION
      ? sourceScale
      : 1 +
        ((growth - SOURCE_GROWTH_FRACTION) / (1 - SOURCE_GROWTH_FRACTION)) *
          (restFloorDepthScale - 1);
  return {
    visible: growth > 0,
    nativeFraction: SOURCE_GROWTH_FRACTION,
    sourceRootY,
    sourceRootBandY,
    sourceFloorY,
    restFloorDepthScale,
    depthScale,
    sourceScale,
  };
}

/**
 * Writes the source-proxy growth placement. Before its native control point it
 * contracts the source placement continuously; after it, each vertex lengthens
 * by its native vertical depth below the common source-root band. The original
 * anchors, source vertices and faces are untouched.
 */
export function evaluateBindingWithGrowth(
  asset: Bound,
  control: Float32Array,
  growth: OffsetScaleGrowth,
  out: Float32Array,
  sourceRootFrames?: Float32Array,
): Float32Array {
  if (!growth.visible) throw new RangeError("MHCLO growth at zero has no renderable mesh");
  if (growth.sourceScale < 1 && sourceRootFrames?.length !== asset.entry.vertexCount * 3)
    throw new RangeError("MHCLO contraction requires each source vertex's attachment-root frame");
  if (growth.sourceScale === 1 && growth.depthScale === 1)
    return evaluateBinding(asset, control, out);
  const native = evaluateBinding(asset, control, new Float32Array(asset.entry.vertexCount * 3));
  const n = asset.entry.vertexCount;
  const coordinate = (v: number, axis: number): number => {
    const k = v * 3;
    if (growth.sourceScale < 1 && sourceRootFrames)
      return (
        (sourceRootFrames[k + axis] as number) +
        ((native[k + axis] as number) - (sourceRootFrames[k + axis] as number)) * growth.sourceScale
      );
    if (axis === 1) {
      const sourceY = native[k + 1] as number;
      return sourceY >= growth.sourceRootBandY
        ? sourceY
        : growth.sourceRootBandY - (growth.sourceRootBandY - sourceY) * growth.depthScale;
    }
    if (growth.sourceScale === 1) return native[k + axis] as number;
    return native[k + axis] as number;
  };
  // Geometry may be cached and published by the renderer. Check every result
  // before writing so an invalid state cannot leave a partial Float32 mesh.
  for (let v = 0; v < n; v++)
    for (let axis = 0; axis < 3; axis++)
      if (!Number.isFinite(Math.fround(coordinate(v, axis))))
        throw new RangeError(`MHCLO growth exceeds finite Float32 output at vertex ${v}`);
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    out[k] = coordinate(v, 0);
    out[k + 1] = coordinate(v, 1);
    out[k + 2] = coordinate(v, 2);
  }
  return out;
}

export interface SourceCardRootFrames {
  /** Every source vertex belonging to an attachment edge. */
  roots: Uint8Array;
  /** The nearest source-derived attachment-edge midpoint for every vertex. */
  frames: Float32Array;
}

/**
 * Finds the attached root boundary of every authored source card. Each open
 * boundary loop retains its edge nearest its MHCLO weighted base-surface
 * placement, so a connected source component with several card boundaries
 * keeps every attachment edge rather than one global winner. A closed source
 * component has no exposed root edge, so its whole component remains source-fixed.
 */
export function sourceCardRootFrames(
  asset: Bound & Pick<BoundAsset, "faceVerts">,
  control: Float32Array,
  native: Float32Array,
): SourceCardRootFrames {
  const count = asset.entry.vertexCount;
  const parent = Uint32Array.from({ length: count }, (_, vertex) => vertex);
  const find = (start: number): number => {
    let vertex = start;
    while ((parent[vertex] as number) !== vertex) {
      parent[vertex] = parent[parent[vertex] as number] as number;
      vertex = parent[vertex] as number;
    }
    return vertex;
  };
  const join = (left: number, right: number) => {
    left = find(left);
    right = find(right);
    if (left !== right) parent[right] = left;
  };
  const edges = new Map<string, { left: number; right: number; count: number }>();
  for (let offset = 0; offset < asset.faceVerts.length; offset += 4) {
    const face = [0, 1, 2, 3].map((corner) => asset.faceVerts[offset + corner] as number);
    for (let corner = 0; corner < 4; corner++) {
      const left = face[corner] as number;
      const right = face[(corner + 1) % 4] as number;
      join(left, right);
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      const old = edges.get(key);
      edges.set(key, old ? { ...old, count: old.count + 1 } : { left, right, count: 1 });
    }
  }
  const components = new Map<number, number[]>();
  for (let vertex = 0; vertex < count; vertex++) {
    const component = find(vertex);
    const vertices = components.get(component) ?? [];
    vertices.push(vertex);
    components.set(component, vertices);
  }
  type Edge = { left: number; right: number };
  const boundaries = new Map<number, Edge[]>();
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;
    const component = find(edge.left);
    const boundary = boundaries.get(component) ?? [];
    boundary.push(edge);
    boundaries.set(component, boundary);
  }
  const distance = (vertex: number): number => {
    const k = vertex * 3;
    let squared = 0;
    for (let axis = 0; axis < 3; axis++) {
      let anchor = 0;
      for (let reference = 0; reference < 3; reference++)
        anchor +=
          (asset.weights[k + reference] as number) *
          (control[(asset.refVerts[k + reference] as number) * 3 + axis] as number);
      squared += ((native[k + axis] as number) - anchor) ** 2;
    }
    return squared;
  };
  const roots = new Uint8Array(count);
  const frames = new Float32Array(native.length);
  const squaredDistance = (left: number, right: number): number => {
    const leftOffset = left * 3;
    const rightOffset = right * 3;
    let squared = 0;
    for (let axis = 0; axis < 3; axis++)
      squared +=
        ((native[leftOffset + axis] as number) - (native[rightOffset + axis] as number)) ** 2;
    return squared;
  };
  for (const [component, vertices] of components) {
    const boundary = boundaries.get(component);
    if (!boundary?.length) {
      for (const vertex of vertices) {
        roots[vertex] = 1;
        frames.set(native.subarray(vertex * 3, vertex * 3 + 3), vertex * 3);
      }
      continue;
    }
    const byVertex = new Map<number, Edge[]>();
    for (const edge of boundary)
      for (const vertex of [edge.left, edge.right]) {
        const incident = byVertex.get(vertex) ?? [];
        incident.push(edge);
        byVertex.set(vertex, incident);
      }
    const rootEdges: Edge[] = [];
    const seen = new Set<Edge>();
    for (const boundaryEdge of boundary) {
      if (seen.has(boundaryEdge)) continue;
      const loop: Edge[] = [];
      const pending = [boundaryEdge];
      seen.add(boundaryEdge);
      while (pending.length) {
        const edge = pending.pop() as Edge;
        loop.push(edge);
        for (const vertex of [edge.left, edge.right])
          for (const nearby of byVertex.get(vertex) ?? [])
            if (!seen.has(nearby)) {
              seen.add(nearby);
              pending.push(nearby);
            }
      }
      rootEdges.push(
        loop.reduce((best, edge) =>
          distance(edge.left) + distance(edge.right) < distance(best.left) + distance(best.right)
            ? edge
            : best,
        ),
      );
    }
    for (const root of rootEdges) {
      roots[root.left] = 1;
      roots[root.right] = 1;
    }
    for (const vertex of vertices) {
      const nearest = rootEdges.reduce((best, edge) => {
        return squaredDistance(vertex, edge.left) + squaredDistance(vertex, edge.right) <
          squaredDistance(vertex, best.left) + squaredDistance(vertex, best.right)
          ? edge
          : best;
      });
      for (let axis = 0; axis < 3; axis++)
        frames[vertex * 3 + axis] =
          ((native[nearest.left * 3 + axis] as number) +
            (native[nearest.right * 3 + axis] as number)) /
          2;
    }
  }
  return { roots, frames };
}

/** Returns the source-derived attached vertices for callers needing only a mask. */
export function sourceCardRoots(
  asset: Bound & Pick<BoundAsset, "faceVerts">,
  control: Float32Array,
  native: Float32Array,
): Uint8Array {
  return sourceCardRootFrames(asset, control, native).roots;
}

/** Skin weights for an attachment: each vertex blends the weights of its three base vertices, the heaviest `SKIN_INFLUENCES` kept. */
export function bindingSkin(
  asset: Bound,
  baseIndex: Uint8Array,
  baseWeight: Float32Array,
): { index: Uint8Array; weight: Float32Array } {
  const n = asset.entry.vertexCount;
  const index = new Uint8Array(n * SKIN_INFLUENCES);
  const weight = new Float32Array(n * SKIN_INFLUENCES);
  const acc = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    acc.clear();
    for (let j = 0; j < 3; j++) {
      const bw = asset.weights[v * 3 + j] as number;
      if (bw === 0) continue;
      addInfluences(acc, baseIndex, baseWeight, asset.refVerts[v * 3 + j] as number, bw);
    }
    writeStrongest(acc, index, weight, v * SKIN_INFLUENCES);
  }
  return { index, weight };
}
