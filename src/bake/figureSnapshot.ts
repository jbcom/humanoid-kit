/** Retained CPU surface snapshots at an explicit producer completion boundary. */
import { SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { proxyTopology } from "../model/proxy.ts";
import type { FigurePartRest, FigureRest, PosedFigure } from "./figure.ts";

export type FigureSnapshotIndexSelection = "render-visible" | "full-topology";

export interface FigureSnapshotOptions {
  figureId: string;
  /** The consumer's named Euclidean world coordinate frame, not an animation clip id. */
  coordinateFrameId: string;
  /** Default render-visible; full-topology retains hidden triangles on the same vertices. */
  indexSelection?: FigureSnapshotIndexSelection;
}

export interface FigureSnapshotEpochs {
  readonly topology: number;
  readonly geometry: number;
  readonly pose: number;
  readonly transform: number;
}

export interface FigureSnapshotBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** Arrays are caller-owned copies, read-only by contract; JavaScript does not freeze their elements. */
export interface FigureSnapshotPart {
  readonly id: string;
  readonly kind: string;
  readonly role: FigurePartRest["role"];
  readonly rest: Float32Array;
  readonly restNormals: Float32Array;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array | null;
  /** Selected triangles on these exact rest/posed vertices and their own UV chart. */
  readonly index: Uint32Array;
  readonly localBounds: FigureSnapshotBounds | null;
  readonly worldBounds: FigureSnapshotBounds | null;
}

/** A retained completed CPU frame; its positions already contain the ground lift once. */
export interface FigureSnapshot {
  readonly figureId: string;
  readonly coordinateFrameId: string;
  readonly completedFrameId: number;
  readonly epochs: FigureSnapshotEpochs;
  readonly unit: "metre";
  readonly metric: "euclidean";
  readonly matrixLayout: "column-major";
  /** Finite orientation-preserving rigid affine transform; scale and shear are rejected. */
  readonly toWorld: Float64Array;
  readonly body: string;
  readonly topology: string;
  readonly bodySha256: string;
  readonly indexSelection: FigureSnapshotIndexSelection;
  readonly groundOffset: number;
  readonly parts: readonly FigureSnapshotPart[];
  /** Exact AABBs of vertices referenced by the selected triangle arrays. */
  readonly localBounds: FigureSnapshotBounds;
  readonly worldBounds: FigureSnapshotBounds;
  readonly capabilities: {
    readonly bounds: "selected-indexed-triangles";
    readonly surfaceTriangles: "completed-cpu";
    readonly volume: "unavailable";
    readonly thickness: "unavailable";
    readonly watertightness: "unverified";
    readonly gpuParity: "unverified";
  };
}

export interface FigureSnapshotProducer {
  /** Accept a completed rest evaluation; invalidates prior current authority immediately. */
  replaceRest(rest: FigureRest): void;
  /**
   * Copies an already evaluated pose, never evaluates or skins again. Pose and
   * completed-frame epochs advance on every accepted call, including reused arrays.
   * Failed validation leaves every epoch and the previous current snapshot unchanged.
   */
  complete(posed: PosedFigure, toWorld: ArrayLike<number>): FigureSnapshot;
  /**
   * True only for this producer's latest completed snapshot with unedited payload.
   * Private stamps cannot be replaced by edits to public epoch fields. This compares
   * retained array contents as well as metadata; it is O(snapshot size).
   */
  current(snapshot: FigureSnapshot): boolean;
  /** Idempotent; ends current authority, while retained historical copies remain owned by callers. */
  release(): void;
}

export class FigureSnapshotError extends Error {
  override name = "FigureSnapshotError";
}

function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new FigureSnapshotError(message);
}

interface SnapshotCounters extends FigureSnapshotEpochs {
  readonly completedFrameId: number;
}

/** @internal Checked atomic counter transition; not exported from the package root. */
export function advanceFigureSnapshotCounters(
  current: SnapshotCounters,
  advance: Partial<Record<keyof SnapshotCounters, boolean>>,
): SnapshotCounters {
  const next: { -readonly [Key in keyof SnapshotCounters]: number } = { ...current };
  for (const key of ["topology", "geometry", "pose", "transform", "completedFrameId"] as const) {
    requireValue(
      Number.isSafeInteger(current[key]) && current[key] >= 0,
      "snapshot counters must be nonnegative safe integers",
    );
    const value = current[key] + (advance[key] ? 1 : 0);
    requireValue(Number.isSafeInteger(value), "snapshot counter overflow");
    next[key] = value;
  }
  return next;
}

// Use intrinsic accessors: caller-owned views may shadow buffer/byteOffset.
const typedArrayPrototype = Object.getPrototypeOf(Float32Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;

const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  // Float32/Uint32 views are word-aligned even when they are buffer subviews.
  // Compare every word; differing float encodings still use Object.is so the
  // signed-zero and NaN semantics stay identical to the generic comparison.
  if (
    (a instanceof Float32Array && b instanceof Float32Array) ||
    (a instanceof Uint32Array && b instanceof Uint32Array)
  ) {
    const left = new Uint32Array(typedBuffer?.call(a), typedOffset?.call(a), a.length),
      right = new Uint32Array(typedBuffer?.call(b), typedOffset?.call(b), b.length);
    for (let k = 0; k < left.length; k++)
      if (left[k] !== right[k] && !Object.is(a[k], b[k])) return false;
    return true;
  }
  for (let k = 0; k < a.length; k++) if (!Object.is(a[k], b[k])) return false;
  return true;
};

const finite = (a: ArrayLike<number>): boolean => {
  for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k])) return false;
  return true;
};

function matrix(source: ArrayLike<number>): Float64Array {
  requireValue(source.length === 16 && finite(source), "toWorld must contain 16 finite values");
  const m = Float64Array.from(source);
  const at = (k: number) => m[k] as number;
  const epsilon = 1e-9;
  requireValue(
    Math.abs(at(3)) <= epsilon &&
      Math.abs(at(7)) <= epsilon &&
      Math.abs(at(11)) <= epsilon &&
      Math.abs(at(15) - 1) <= epsilon,
    "toWorld must be affine",
  );
  for (const start of [0, 4, 8]) {
    requireValue(
      Math.abs(Math.hypot(at(start), at(start + 1), at(start + 2)) - 1) <= epsilon,
      "toWorld scale is unsupported",
    );
  }
  for (const [a, b] of [
    [0, 4],
    [0, 8],
    [4, 8],
  ]) {
    requireValue(a !== undefined && b !== undefined, "matrix axes missing");
    requireValue(
      Math.abs(at(a) * at(b) + at(a + 1) * at(b + 1) + at(a + 2) * at(b + 2)) <= epsilon,
      "toWorld shear is unsupported",
    );
  }
  const determinant =
    at(0) * (at(5) * at(10) - at(6) * at(9)) -
    at(4) * (at(1) * at(10) - at(2) * at(9)) +
    at(8) * (at(1) * at(6) - at(2) * at(5));
  requireValue(Math.abs(determinant - 1) <= epsilon, "toWorld must preserve orientation");
  // Accepted near-affine floating-point input is normalized to an exact affine matrix.
  m[3] = 0;
  m[7] = 0;
  m[11] = 0;
  m[15] = 1;
  return m;
}

function indexRange(index: Uint32Array, vertices: number): void {
  requireValue(
    index instanceof Uint32Array && index.length % 3 === 0,
    "index must be Uint32 triangles",
  );
  for (const v of index)
    requireValue(v < vertices, "triangle index is outside its vertex correspondence");
}

function selectedIndex(
  rest: FigureRest,
  p: FigurePartRest,
  selection: FigureSnapshotIndexSelection,
): Uint32Array {
  if (selection === "render-visible") return p.index;
  if (p.role === "body" && rest.body !== "base" && rest.body !== "adult") {
    const t = proxyTopology(rest.model.assets, rest.body);
    requireValue(
      t.vertexCount * 3 === p.rest.length && p.uvs === null,
      "proxy vertex correspondence differs",
    );
    return t.index;
  }
  const t =
    p.role === "body"
      ? rest.body === "adult"
        ? rest.model.adultSurface()
        : rest.model.topology().body
      : p.role === "garment"
        ? rest.model.garmentTopology(p.id)
        : p.role === "facialHair"
          ? rest.model.hairTopology(p.id)
          : rest.model.topology().attachments.find((a) => a.id === p.id);
  requireValue(
    t && p.uvs && same(p.uvs, t.uvs) && t.uvs.length * 3 === p.rest.length * 2,
    "full topology does not share this part's vertex/UV correspondence",
  );
  return t.index;
}

interface CanonicalPart {
  id: string;
  kind: string;
  role: FigurePartRest["role"];
  sourceSelected: Uint32Array;
  source: FigurePartRest;
  rest: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  visible: Uint32Array;
  selected: Uint32Array;
  skinIndex: Uint8Array | Uint16Array;
  skinWeight: Float32Array;
  bodyRegion: Uint8Array;
}

function canonical(rest: FigureRest, selection: FigureSnapshotIndexSelection): CanonicalPart[] {
  requireValue(rest.model.assets.manifest.unit === "metre", "snapshot source units must be metres");
  requireValue(
    rest.parts.length > 0 && rest.parts[0]?.role === "body",
    "a figure must begin with its body",
  );
  const ids = new Set<string>();
  return rest.parts.map((p) => {
    requireValue(p.id.length > 0 && !ids.has(p.id), "part ids must be unique and nonempty");
    ids.add(p.id);
    const n = p.rest.length / 3;
    requireValue(
      p.rest instanceof Float32Array &&
        p.restNormals instanceof Float32Array &&
        (p.uvs === null || p.uvs instanceof Float32Array) &&
        (p.skinIndex instanceof Uint8Array || p.skinIndex instanceof Uint16Array) &&
        p.skinWeight instanceof Float32Array &&
        p.bodyRegion instanceof Uint8Array &&
        Number.isSafeInteger(n) &&
        n > 0 &&
        p.restNormals.length === n * 3 &&
        (p.uvs === null || p.uvs.length === n * 2) &&
        p.skinIndex.length === n * SKIN_INFLUENCES &&
        p.skinWeight.length === n * SKIN_INFLUENCES &&
        p.bodyRegion.length === n,
      "rest part array correspondence is invalid",
    );
    requireValue(
      finite(p.rest) && finite(p.restNormals) && (!p.uvs || finite(p.uvs)) && finite(p.skinWeight),
      "rest part arrays must be finite",
    );
    for (const bone of p.skinIndex)
      requireValue(bone < rest.bones.names.length, "skin bone is outside the rig");
    for (const weight of p.skinWeight) requireValue(weight >= 0, "skin weights cannot be negative");
    indexRange(p.index, n);
    const selected = selectedIndex(rest, p, selection);
    indexRange(selected, n);
    if (selection === "full-topology") {
      const triangles = new Set<string>();
      for (let k = 0; k < selected.length; k += 3)
        triangles.add(`${selected[k]},${selected[k + 1]},${selected[k + 2]}`);
      for (let k = 0; k < p.index.length; k += 3)
        requireValue(
          triangles.has(`${p.index[k]},${p.index[k + 1]},${p.index[k + 2]}`),
          "visible triangle is absent from full topology",
        );
    }
    return {
      id: p.id,
      kind: p.kind,
      role: p.role,
      sourceSelected: selected,
      source: p,
      rest: p.rest.slice(),
      normals: p.restNormals.slice(),
      uvs: p.uvs?.slice() ?? null,
      visible: p.index.slice(),
      selected: selected.slice(),
      skinIndex: p.skinIndex.slice(),
      skinWeight: p.skinWeight.slice(),
      bodyRegion: p.bodyRegion.slice(),
    };
  });
}

function bounds(
  positions: Float32Array,
  index: Uint32Array,
  m: Float64Array,
): { localBounds: FigureSnapshotBounds | null; worldBounds: FigureSnapshotBounds | null } {
  if (index.length === 0) return { localBounds: null, worldBounds: null };
  const localMin: [number, number, number] = [Infinity, Infinity, Infinity],
    localMax: [number, number, number] = [-Infinity, -Infinity, -Infinity],
    worldMin: [number, number, number] = [Infinity, Infinity, Infinity],
    worldMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const v of index) {
    const x = positions[v * 3] as number,
      y = positions[v * 3 + 1] as number,
      z = positions[v * 3 + 2] as number;
    const wx =
        (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
      wy = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
      wz = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
    requireValue(
      Number.isFinite(wx) && Number.isFinite(wy) && Number.isFinite(wz),
      "selected world bounds are nonfinite",
    );
    localMin[0] = Math.min(localMin[0], x);
    localMin[1] = Math.min(localMin[1], y);
    localMin[2] = Math.min(localMin[2], z);
    localMax[0] = Math.max(localMax[0], x);
    localMax[1] = Math.max(localMax[1], y);
    localMax[2] = Math.max(localMax[2], z);
    worldMin[0] = Math.min(worldMin[0], wx);
    worldMin[1] = Math.min(worldMin[1], wy);
    worldMin[2] = Math.min(worldMin[2], wz);
    worldMax[0] = Math.max(worldMax[0], wx);
    worldMax[1] = Math.max(worldMax[1], wy);
    worldMax[2] = Math.max(worldMax[2], wz);
  }
  return {
    localBounds: { min: localMin, max: localMax },
    worldBounds: { min: worldMin, max: worldMax },
  };
}

function union(
  parts: readonly FigureSnapshotPart[],
  key: "localBounds" | "worldBounds",
): FigureSnapshotBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const b = p[key];
    if (b)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis] as number, b.min[axis] as number);
        max[axis] = Math.max(max[axis] as number, b.max[axis] as number);
      }
  }
  requireValue(finite(min) && finite(max), "an empty selected figure cannot publish valid bounds");
  return { min, max };
}

const copyBounds = (b: FigureSnapshotBounds | null): FigureSnapshotBounds | null =>
  b ? { min: [...b.min], max: [...b.max] } : null;

function copySnapshot(s: FigureSnapshot): FigureSnapshot {
  const localBounds = copyBounds(s.localBounds),
    worldBounds = copyBounds(s.worldBounds);
  requireValue(localBounds && worldBounds, "snapshot bounds missing");
  return {
    ...s,
    epochs: { ...s.epochs },
    toWorld: s.toWorld.slice(),
    capabilities: { ...s.capabilities },
    localBounds,
    worldBounds,
    parts: s.parts.map((p) => ({
      ...p,
      rest: p.rest.slice(),
      restNormals: p.restNormals.slice(),
      positions: p.positions.slice(),
      normals: p.normals.slice(),
      uvs: p.uvs?.slice() ?? null,
      index: p.index.slice(),
      localBounds: copyBounds(p.localBounds),
      worldBounds: copyBounds(p.worldBounds),
    })),
  };
}

const equalBounds = (a: FigureSnapshotBounds | null, b: FigureSnapshotBounds | null) =>
  a === null || b === null ? a === b : same(a.min, b.min) && same(a.max, b.max);

function unedited(s: FigureSnapshot, original: FigureSnapshot): boolean {
  for (const key of [
    "figureId",
    "coordinateFrameId",
    "completedFrameId",
    "unit",
    "metric",
    "matrixLayout",
    "body",
    "topology",
    "bodySha256",
    "indexSelection",
    "groundOffset",
  ] as const)
    if (s[key] !== original[key]) return false;
  for (const key of ["topology", "geometry", "pose", "transform"] as const)
    if (s.epochs[key] !== original.epochs[key]) return false;
  for (const key of [
    "bounds",
    "surfaceTriangles",
    "volume",
    "thickness",
    "watertightness",
    "gpuParity",
  ] as const)
    if (s.capabilities[key] !== original.capabilities[key]) return false;
  if (
    !same(s.toWorld, original.toWorld) ||
    !equalBounds(s.localBounds, original.localBounds) ||
    !equalBounds(s.worldBounds, original.worldBounds) ||
    s.parts.length !== original.parts.length
  )
    return false;
  return s.parts.every((p, i) => {
    const o = original.parts[i];
    if (
      !o ||
      p.id !== o.id ||
      p.kind !== o.kind ||
      p.role !== o.role ||
      !equalBounds(p.localBounds, o.localBounds) ||
      !equalBounds(p.worldBounds, o.worldBounds)
    )
      return false;
    for (const key of ["rest", "restNormals", "positions", "normals", "index"] as const)
      if (
        !ArrayBuffer.isView(p[key]) ||
        p[key].constructor !== o[key].constructor ||
        !same(p[key], o[key])
      )
        return false;
    return p.uvs === null || o.uvs === null
      ? p.uvs === o.uvs
      : p.uvs instanceof Float32Array && same(p.uvs, o.uvs);
  });
}

/**
 * Owns completion epochs for one explicit CPU producer. This does not observe
 * React, animation channels or GPU buffers. Call complete after their actual
 * CPU geometry and placement completion boundary, using that existing pose.
 */
export function createFigureSnapshotProducer(
  initial: FigureRest,
  options: FigureSnapshotOptions,
): FigureSnapshotProducer {
  requireValue(
    options.figureId.trim().length > 0 && options.coordinateFrameId.trim().length > 0,
    "figure and coordinate frame ids must be nonempty",
  );
  const figureId = options.figureId,
    coordinateFrameId = options.coordinateFrameId;
  const selection = options.indexSelection ?? "render-visible";
  requireValue(
    selection === "render-visible" || selection === "full-topology",
    "unknown index selection",
  );
  let rest = initial,
    parts = canonical(rest, selection),
    live = true;
  let sourceModel = rest.model;
  let body = rest.body,
    bones = rest.bones,
    boneCount = rest.bones.names.length;
  let sourceTopology = rest.model.assets.manifest.topology,
    bodySha256 = rest.model.assets.manifest.body.sha256;
  let counters: SnapshotCounters = {
    topology: 1,
    geometry: 1,
    pose: 0,
    transform: 0,
    completedFrameId: 0,
  };
  let placement: Float64Array | null = null;
  const retained = new WeakMap<FigureSnapshot, FigureSnapshot>();
  return {
    replaceRest(next) {
      requireValue(live, "producer is released");
      const nextParts = canonical(next, selection);
      const equalTopology =
        next.body === body &&
        next.model.assets.manifest.topology === sourceTopology &&
        next.model.assets.manifest.body.sha256 === bodySha256 &&
        nextParts.length === parts.length &&
        nextParts.every((p, i) => {
          const old = parts[i];
          return (
            old &&
            p.id === old.id &&
            p.role === old.role &&
            p.rest.length === old.rest.length &&
            same(p.visible, old.visible) &&
            same(p.selected, old.selected)
          );
        });
      const nextCounters = advanceFigureSnapshotCounters(counters, {
        topology: !equalTopology,
        geometry: true,
      });
      const nextTopology = next.model.assets.manifest.topology,
        nextSha = next.model.assets.manifest.body.sha256;
      rest = next;
      sourceModel = rest.model;
      parts = nextParts;
      body = rest.body;
      bones = rest.bones;
      boneCount = bones.names.length;
      sourceTopology = nextTopology;
      bodySha256 = nextSha;
      counters = nextCounters;
    },
    complete(posed, toWorld) {
      requireValue(live, "producer is released");
      requireValue(
        rest.model === sourceModel &&
          rest.body === body &&
          rest.bones === bones &&
          rest.model.assets.manifest.unit === "metre" &&
          rest.model.assets.manifest.topology === sourceTopology &&
          rest.model.assets.manifest.body.sha256 === bodySha256 &&
          rest.parts.length === parts.length &&
          rest.parts.every((p, i) => p === parts[i]?.source) &&
          posed.body === body &&
          posed.bones === bones &&
          posed.parts.length === parts.length &&
          posed.rotations instanceof Float32Array &&
          finite(posed.rotations) &&
          posed.rotations.length === boneCount * 4 &&
          Number.isFinite(posed.groundOffset),
        "completed pose does not bind to this rest figure",
      );
      const m = matrix(toWorld);
      const copied = parts.map((p, i): FigureSnapshotPart => {
        const value = posed.parts[i],
          source = p.source;
        requireValue(
          value &&
            source.id === p.id &&
            source.role === p.role &&
            source.kind === p.kind &&
            value.id === p.id &&
            value.role === p.role &&
            value.kind === p.kind &&
            value.rest === source.rest &&
            value.restNormals === source.restNormals &&
            value.index === source.index &&
            value.uvs === source.uvs &&
            value.skinIndex === source.skinIndex &&
            value.skinWeight === source.skinWeight &&
            value.bodyRegion === source.bodyRegion &&
            same(value.rest, p.rest) &&
            same(value.restNormals, p.normals) &&
            same(value.index, p.visible) &&
            (value.uvs === null ? p.uvs === null : p.uvs !== null && same(value.uvs, p.uvs)) &&
            same(p.sourceSelected, p.selected) &&
            same(value.skinIndex, p.skinIndex) &&
            same(value.skinWeight, p.skinWeight) &&
            same(value.bodyRegion, p.bodyRegion),
          "pose canonical part changed without a completed rest replacement",
        );
        requireValue(
          value.positions instanceof Float32Array &&
            value.normals instanceof Float32Array &&
            value.positions.length === p.rest.length &&
            value.normals.length === p.rest.length &&
            finite(value.positions) &&
            finite(value.normals),
          "posed part correspondence or coordinates are invalid",
        );
        const positions = value.positions.slice(),
          index = p.selected.slice();
        return {
          id: value.id,
          kind: value.kind,
          role: value.role,
          rest: p.rest.slice(),
          restNormals: p.normals.slice(),
          positions,
          normals: value.normals.slice(),
          uvs: p.uvs?.slice() ?? null,
          index,
          ...bounds(positions, index, m),
        };
      });
      const nextCounters = advanceFigureSnapshotCounters(counters, {
        pose: true,
        transform: !(placement && same(placement, m)),
        completedFrameId: true,
      });
      const snapshot: FigureSnapshot = {
        figureId,
        coordinateFrameId,
        completedFrameId: nextCounters.completedFrameId,
        epochs: {
          topology: nextCounters.topology,
          geometry: nextCounters.geometry,
          pose: nextCounters.pose,
          transform: nextCounters.transform,
        },
        unit: "metre",
        metric: "euclidean",
        matrixLayout: "column-major",
        toWorld: m,
        body,
        topology: sourceTopology,
        bodySha256,
        indexSelection: selection,
        groundOffset: posed.groundOffset,
        parts: copied,
        localBounds: union(copied, "localBounds"),
        worldBounds: union(copied, "worldBounds"),
        capabilities: {
          bounds: "selected-indexed-triangles",
          surfaceTriangles: "completed-cpu",
          volume: "unavailable",
          thickness: "unavailable",
          watertightness: "unverified",
          gpuParity: "unverified",
        },
      };
      const privateCopy = copySnapshot(snapshot);
      retained.set(snapshot, privateCopy);
      counters = nextCounters;
      placement = privateCopy.toWorld;
      return snapshot;
    },
    current(snapshot) {
      const original = retained.get(snapshot);
      if (
        !live ||
        !original ||
        original.completedFrameId !== counters.completedFrameId ||
        original.epochs.topology !== counters.topology ||
        original.epochs.geometry !== counters.geometry ||
        original.epochs.pose !== counters.pose ||
        original.epochs.transform !== counters.transform
      )
        return false;
      try {
        return (
          unedited(snapshot, original) &&
          live &&
          original.completedFrameId === counters.completedFrameId &&
          original.epochs.topology === counters.topology &&
          original.epochs.geometry === counters.geometry &&
          original.epochs.pose === counters.pose &&
          original.epochs.transform === counters.transform
        );
      } catch {
        return false;
      }
    },
    release() {
      live = false;
    },
  };
}
