/**
 * The foundation's landmarks (docs/FOUNDATION.md, "What the foundation gives
 * layers"): named places on the posed, morphed body as drawn, each a position,
 * the skin's outward normal there and a tangent frame that follows the skin.
 * Garments anchor to them (a waistband to the hips, a garment's chest to the
 * nipples), affordances take their frames from them, and the foundation's
 * sheets point their cameras at them.
 *
 * A surface landmark is a base-mesh vertex, found once from the assets: the
 * peak of the MakeHuman target that shapes its feature (`targetPeak`), or, for
 * a place no target shapes, the body's own geometry at a joint. On a posed body
 * it is that vertex's own render vertex (`HumanoidModel.baseRenderVertices`),
 * its normal the skin's there, its tangent the way to the neighbour that was
 * most nearly up the body at rest, so the frame turns and bends with the skin.
 *
 * A joint landmark is a joint centre: the posed head of its bone, its tangent
 * along the limb, its normal the figure's forward turned by the bone.
 */
import { groupFaces, type HumanoidAssets } from "../format/assetFormat.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import { MIDLINE, namedTarget, targetPeak } from "../model/targetPeak.ts";
import { posedBones, restBones, rotateByBone } from "../rig/pose.ts";
import type { PosedBody } from "./posed.ts";

export type Vec3 = readonly [number, number, number];

/** A landmark on a posed body: where it is and the skin's frame there. */
export interface LandmarkFrame {
  position: Vec3;
  /** Outward from the skin (a joint's: the figure's forward, turned by its bone). */
  normal: Vec3;
  /** Along the skin, up the body at rest (a joint's: along the limb, away from the body). */
  tangent: Vec3;
  /** normal × tangent. */
  bitangent: Vec3;
}

/** The surface landmarks: base-mesh vertices on the skin. */
export const SURFACE_LANDMARKS = [
  "crown",
  "nose-tip",
  "upper-lip",
  "lower-lip",
  "chin",
  "ear-lobe.L",
  "ear-lobe.R",
  "sternum-notch",
  "nipple.L",
  "nipple.R",
  "navel",
  "pubic-point",
] as const;

/** The joint landmarks: joint centres, each a bone's head. */
export const JOINT_LANDMARKS = [
  "neck",
  "shoulder.L",
  "shoulder.R",
  "elbow.L",
  "elbow.R",
  "wrist.L",
  "wrist.R",
  "hip.L",
  "hip.R",
  "knee.L",
  "knee.R",
  "ankle.L",
  "ankle.R",
] as const;

export const LANDMARK_IDS = [...SURFACE_LANDMARKS, ...JOINT_LANDMARKS] as const;
export type SurfaceLandmarkId = (typeof SURFACE_LANDMARKS)[number];
export type JointLandmarkId = (typeof JOINT_LANDMARKS)[number];
export type LandmarkId = (typeof LANDMARK_IDS)[number];

/** Each joint landmark's bone, and the bone whose head the limb runs toward from it. */
const JOINTS: Readonly<Record<JointLandmarkId, { bone: string; toward: string }>> = {
  neck: { bone: "neck01", toward: "head" },
  "shoulder.L": { bone: "upperarm01.L", toward: "lowerarm01.L" },
  "shoulder.R": { bone: "upperarm01.R", toward: "lowerarm01.R" },
  "elbow.L": { bone: "lowerarm01.L", toward: "wrist.L" },
  "elbow.R": { bone: "lowerarm01.R", toward: "wrist.R" },
  // The wrist's limb is the forearm's: the hand's bones fan out from it.
  "wrist.L": { bone: "wrist.L", toward: "lowerarm01.L" },
  "wrist.R": { bone: "wrist.R", toward: "lowerarm01.R" },
  "hip.L": { bone: "upperleg01.L", toward: "lowerleg01.L" },
  "hip.R": { bone: "upperleg01.R", toward: "lowerleg01.R" },
  "knee.L": { bone: "lowerleg01.L", toward: "foot.L" },
  "knee.R": { bone: "lowerleg01.R", toward: "foot.R" },
  "ankle.L": { bone: "foot.L", toward: "toe1-1.L" },
  "ankle.R": { bone: "foot.R", toward: "toe1-1.R" },
};
/** Joint landmarks whose `toward` bone is behind them along the limb (the tangent points away from it). */
const AWAY = new Set<JointLandmarkId>(["wrist.L", "wrist.R"]);

/** Forward, the way the figure faces at rest. */
const FORWARD: Vec3 = [0, 0, 1];
/** Up, the way a surface landmark's tangent points at rest. */
const UP: Vec3 = [0, 1, 0];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** `v` with its part along unit `n` removed, made unit. */
const across = (v: Vec3, n: Vec3): Vec3 => {
  const d = dot(v, n);
  return unit([v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]);
};

/** The vertices the drawn body uses (its face group), so helper geometry never holds a landmark. */
function bodyVertices(assets: HumanoidAssets): Uint8Array {
  const out = new Uint8Array(assets.manifest.vertexCount);
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) out[assets.faceVerts[f * 4 + k] as number] = 1;
  return out;
}

/**
 * The midline vertex of the drawn body nearest `point` among those in front of
 * it: where the skin over a joint on the midline is (the sternal notch over the
 * clavicles' inner ends, the pubic point over the hips).
 */
function midlineInFront(assets: HumanoidAssets, used: Uint8Array, point: Vec3): number {
  const P = assets.positions;
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (let v = 0; v < assets.manifest.vertexCount; v++) {
    if (!used[v] || Math.abs(P[v * 3] as number) > MIDLINE) continue;
    const q: Vec3 = [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
    if (q[2] <= point[2]) continue;
    // Nearest in height first: the skin straight in front of the joint.
    const d = Math.abs(q[1] - point[1]);
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  if (best < 0) throw new RangeError("no midline vertex in front of the joint");
  return best;
}

/** The deepest of the midline vertices a target moves: the bottom of the hole it shapes. */
function deepestMoved(assets: HumanoidAssets, name: string): number {
  const P = assets.positions;
  let best = -1;
  for (const v of namedTarget(assets, name).indices)
    if (
      Math.abs(P[v * 3] as number) <= MIDLINE &&
      (best < 0 || (P[v * 3 + 2] as number) < (P[best * 3 + 2] as number))
    )
      best = v;
  if (best < 0) throw new RangeError(`target ${name} moves no midline vertex`);
  return best;
}

const vertexCache = new WeakMap<HumanoidAssets, Readonly<Record<SurfaceLandmarkId, number>>>();

/** Each surface landmark's base-mesh vertex, found on these assets (cached). */
export function landmarkVertices(
  assets: HumanoidAssets,
): Readonly<Record<SurfaceLandmarkId, number>> {
  const known = vertexCache.get(assets);
  if (known) return known;
  const used = bodyVertices(assets);
  const bones = restBones(assets, assets.positions);
  const head = (name: string): Vec3 => {
    const b = bones.names.indexOf(name);
    if (b < 0) throw new RangeError(`no bone ${name}`);
    return [
      bones.heads[b * 3] as number,
      bones.heads[b * 3 + 1] as number,
      bones.heads[b * 3 + 2] as number,
    ];
  };
  const between = (a: string, b: string): Vec3 => {
    const p = head(a);
    const q = head(b);
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  };
  const P = assets.positions;
  let crown = -1;
  for (let v = 0; v < assets.manifest.vertexCount; v++)
    if (
      used[v] &&
      Math.abs(P[v * 3] as number) <= MIDLINE &&
      (crown < 0 || (P[v * 3 + 1] as number) > (P[crown * 3 + 1] as number))
    )
      crown = v;
  const out: Record<SurfaceLandmarkId, number> = {
    crown,
    "nose-tip": targetPeak(assets, "nose/nose-point-up", 0),
    "upper-lip": targetPeak(assets, "mouth/mouth-upperlip-middle-up", 0),
    "lower-lip": targetPeak(assets, "mouth/mouth-lowerlip-middle-down", 0),
    chin: targetPeak(assets, "chin/chin-prominent-incr", 0),
    "ear-lobe.L": targetPeak(assets, "ears/l-ear-lobe-incr", 1),
    "ear-lobe.R": targetPeak(assets, "ears/r-ear-lobe-incr", -1),
    // The jugular notch: the skin in front of the clavicles' inner ends.
    "sternum-notch": midlineInFront(assets, used, between("clavicle.L", "clavicle.R")),
    "nipple.L": targetPeak(assets, "breast/nipple-point-incr", 1),
    "nipple.R": targetPeak(assets, "breast/nipple-point-incr", -1),
    // The navel's centre is the bottom of the hole its target deepens.
    navel: deepestMoved(assets, "stomach/stomach-navel-in"),
    // The pubic point: the skin in front of the hips' centres, over the symphysis.
    "pubic-point": midlineInFront(assets, used, between("upperleg01.L", "upperleg01.R")),
  };
  vertexCache.set(assets, out);
  return out;
}

/**
 * Each surface landmark's render vertex on a body surface, and the neighbour
 * most nearly up the body from it at rest, which its tangent points to (cached
 * per model and surface: both are fixed by the topology).
 */
const anchorCache = new WeakMap<
  HumanoidModel,
  Map<"base" | "adult", Readonly<Record<SurfaceLandmarkId, { vertex: number; up: number }>>>
>();

function surfaceAnchors(
  model: HumanoidModel,
  body: PosedBody,
): Readonly<Record<SurfaceLandmarkId, { vertex: number; up: number }>> {
  const byModel = anchorCache.get(model) ?? new Map();
  anchorCache.set(model, byModel);
  const known = byModel.get(body.surface);
  if (known) return known;
  const render = model.baseRenderVertices(body.surface);
  const bases = landmarkVertices(model.assets);
  // Neighbours by welded vertex, so a landmark on a UV seam sees both sides.
  const neighbours = new Map<number, Set<number>>();
  const I = body.index;
  for (let t = 0; t < I.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = body.weld[I[t + c] as number] as number;
      const set = neighbours.get(a) ?? new Set<number>();
      neighbours.set(a, set);
      set.add(body.weld[I[t + ((c + 1) % 3)] as number] as number);
      set.add(body.weld[I[t + ((c + 2) % 3)] as number] as number);
    }
  const restAt = (r: number): Vec3 => [
    body.rest[r * 3] as number,
    body.rest[r * 3 + 1] as number,
    body.rest[r * 3 + 2] as number,
  ];
  const out = {} as Record<SurfaceLandmarkId, { vertex: number; up: number }>;
  for (const id of SURFACE_LANDMARKS) {
    const vertex = render[bases[id]] as number;
    if (vertex < 0)
      throw new RangeError(`landmark ${id}: the ${body.surface} surface does not draw its vertex`);
    const p = restAt(vertex);
    const n = unit([
      body.restNormals[vertex * 3] as number,
      body.restNormals[vertex * 3 + 1] as number,
      body.restNormals[vertex * 3 + 2] as number,
    ]);
    // Up along the skin; at the crown, whose normal is up, forward instead.
    const want = Math.abs(dot(n, UP)) > 0.9 ? FORWARD : UP;
    let up = -1;
    let best = Number.NEGATIVE_INFINITY;
    for (const q of neighbours.get(body.weld[vertex] as number) ?? []) {
      const d = dot(across(sub(restAt(q), p), n), want);
      if (d > best) {
        best = d;
        up = q;
      }
    }
    if (up < 0) throw new RangeError(`landmark ${id}: its vertex has no neighbour`);
    out[id] = { vertex, up };
  }
  byModel.set(body.surface, out);
  return out;
}

/** A frame from a normal and a direction along the skin. */
const frameOf = (position: Vec3, normal: Vec3, along: Vec3): LandmarkFrame => {
  const n = unit(normal);
  const t = across(along, n);
  return { position, normal: n, tangent: t, bitangent: cross(n, t) };
};

/** Every landmark of a posed body (`posedSurface`) of this model. */
export function landmarks(
  model: HumanoidModel,
  body: PosedBody,
): Readonly<Record<LandmarkId, LandmarkFrame>> {
  const at = (a: Float32Array, r: number): Vec3 => [
    a[r * 3] as number,
    a[r * 3 + 1] as number,
    a[r * 3 + 2] as number,
  ];
  const out = {} as Record<LandmarkId, LandmarkFrame>;
  const anchors = surfaceAnchors(model, body);
  for (const id of SURFACE_LANDMARKS) {
    const { vertex, up } = anchors[id];
    const p = at(body.positions, vertex);
    out[id] = frameOf(p, at(body.normals, vertex), sub(at(body.positions, up), p));
  }
  const { world, heads } = posedBones(body.bones, body.rotations);
  const bone = (name: string) => {
    const b = body.bones.names.indexOf(name);
    if (b < 0) throw new RangeError(`no bone ${name}`);
    return b;
  };
  for (const id of JOINT_LANDMARKS) {
    const { bone: name, toward } = JOINTS[id];
    const b = bone(name);
    const p = at(heads, b);
    const q = at(heads, bone(toward));
    const limb = AWAY.has(id) ? sub(p, q) : sub(q, p);
    // The limb is the frame's tangent; its normal is the figure's forward turned by the bone.
    const t = unit(limb);
    const n = across(rotateByBone(world, b, FORWARD), t);
    out[id] = { position: p, normal: n, tangent: t, bitangent: cross(n, t) };
  }
  return out;
}
