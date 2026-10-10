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
 * most nearly up the figure's own body at rest, so the frame turns and bends
 * with the skin.
 *
 * A joint landmark is a joint centre: the posed head of its bone, its tangent
 * along the limb that frames it, its normal the figure's forward turned by
 * that limb's bone.
 */
import { groupFaces, type HumanoidAssets } from "../format/assetFormat.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import { MIDLINE, namedTarget, targetPeak } from "../model/targetPeak.ts";
import { posedBones, restBones, rotateByBone } from "../rig/pose.ts";
import { handFrame } from "../surface/regions/hands/frame.ts";
import { skinZones } from "../surface/regions/skinZones.ts";
import type { PosedBody } from "./posed.ts";

export type Vec3 = readonly [number, number, number];

/** A landmark on a posed body: where it is and the skin's frame there. */
export interface LandmarkFrame {
  position: Vec3;
  /** Outward from the skin (a joint's: the figure's forward, turned by its limb's bone). */
  normal: Vec3;
  /** Along the skin, up the body at rest (a joint's: along its limb, away from the body). */
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
  "ear-canal.L",
  "ear-canal.R",
  "nostril.L",
  "nostril.R",
  "sternum-notch",
  "nipple.L",
  "nipple.R",
  "navel",
  "pubic-point",
  "palm.L",
  "palm.R",
  "sole.L",
  "sole.R",
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

/**
 * Each joint landmark: the bone whose head it is, and the limb it is framed by,
 * a bone from its head to its child's (`to`). The tangent runs along the limb,
 * away from the body, and the normal is the figure's forward turned by the
 * limb's bone, which is square to the limb at rest (the limbs hang in the
 * figure's frontal plane), so the frame never degenerates. A joint at a limb's
 * far end (the wrist, the ankle) is framed by the limb that reaches it, the
 * forearm and the shin: the hand's bones fan out from the wrist, and the foot
 * runs forward from the ankle.
 */
const JOINTS: Readonly<Record<JointLandmarkId, { at: string; limb: string; to: string }>> = {
  neck: { at: "neck01", limb: "neck01", to: "head" },
  "shoulder.L": { at: "upperarm01.L", limb: "upperarm01.L", to: "lowerarm01.L" },
  "shoulder.R": { at: "upperarm01.R", limb: "upperarm01.R", to: "lowerarm01.R" },
  "elbow.L": { at: "lowerarm01.L", limb: "lowerarm01.L", to: "wrist.L" },
  "elbow.R": { at: "lowerarm01.R", limb: "lowerarm01.R", to: "wrist.R" },
  "wrist.L": { at: "wrist.L", limb: "lowerarm01.L", to: "wrist.L" },
  "wrist.R": { at: "wrist.R", limb: "lowerarm01.R", to: "wrist.R" },
  "hip.L": { at: "upperleg01.L", limb: "upperleg01.L", to: "lowerleg01.L" },
  "hip.R": { at: "upperleg01.R", limb: "upperleg01.R", to: "lowerleg01.R" },
  "knee.L": { at: "lowerleg01.L", limb: "lowerleg01.L", to: "foot.L" },
  "knee.R": { at: "lowerleg01.R", limb: "lowerleg01.R", to: "foot.R" },
  "ankle.L": { at: "foot.L", limb: "lowerleg01.L", to: "foot.L" },
  "ankle.R": { at: "foot.R", limb: "lowerleg01.R", to: "foot.R" },
};

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

/** The drawn vertices a target moves by at least `share` of its largest move: the feature, not its falloff. */
function movedFully(
  assets: HumanoidAssets,
  used: Uint8Array,
  name: string,
  share: number,
): number[] {
  const t = namedTarget(assets, name);
  const size = (i: number) =>
    Math.hypot(
      t.deltas[i * 3] as number,
      t.deltas[i * 3 + 1] as number,
      t.deltas[i * 3 + 2] as number,
    );
  let max = 0;
  for (let i = 0; i < t.indices.length; i++) max = Math.max(max, size(i));
  return [...t.indices].filter((v, i) => used[v] && size(i) >= share * max);
}

/** Within this, seen from the side, an ear's vertices crowd round its bowl, metres. */
const EAR_CROWD = 0.004;
/** Within this of where they crowd, the bowl's floor is looked for, metres. */
const EAR_BOWL = 0.008;

/**
 * The ear canal's entrance on one side: the floor of the concha. The base mesh
 * draws the ear as a closed surface whose edge loops crowd round its bowl, so
 * of the vertices the ear's own move carries fully (not the head's falloff),
 * the bowl is where most of them lie within `EAR_CROWD` seen from the side, and
 * its floor is the most medial of those within `EAR_BOWL` of it.
 */
function earCanal(assets: HumanoidAssets, used: Uint8Array, side: 1 | -1): number {
  const ear = movedFully(
    assets,
    used,
    side === 1 ? "ears/l-ear-trans-up" : "ears/r-ear-trans-up",
    0.95,
  );
  const P = assets.positions;
  const sideways = (u: number, v: number) =>
    Math.hypot(
      (P[u * 3 + 1] as number) - (P[v * 3 + 1] as number),
      (P[u * 3 + 2] as number) - (P[v * 3 + 2] as number),
    );
  const crowd = (v: number) => ear.filter((u) => sideways(u, v) < EAR_CROWD).length;
  let bowl = ear[0] as number;
  let most = -1;
  for (const v of ear) {
    const c = crowd(v);
    if (c > most) {
      most = c;
      bowl = v;
    }
  }
  let floor = -1;
  for (const v of ear)
    if (
      sideways(v, bowl) < EAR_BOWL &&
      (floor < 0 || Math.abs(P[v * 3] as number) < Math.abs(P[floor * 3] as number))
    )
      floor = v;
  if (floor < 0) throw new RangeError(`no ear bowl on side ${side}`);
  return floor;
}

/** How nearly a vertex must face down at rest to be on a nostril's floor and walls. */
const NOSTRIL_FACING = 0.7;

/**
 * A nostril's opening on one side: of the nose's vertices on that side whose
 * skin faces down, the one nearest their centroid.
 */
function nostril(assets: HumanoidAssets, used: Uint8Array, side: 1 | -1): number {
  const N = skinZones(assets).normals;
  const P = assets.positions;
  const down = namedTarget(assets, "nose/nose-trans-up").indices.filter(
    (v) =>
      used[v] &&
      Math.sign(P[v * 3] as number) === side &&
      Math.abs(P[v * 3] as number) > MIDLINE &&
      -(N[v * 3 + 1] as number) > NOSTRIL_FACING,
  );
  if (down.length === 0) throw new RangeError(`no nostril on side ${side}`);
  const c = [0, 1, 2].map(
    (k) => down.reduce((s, v) => s + (P[v * 3 + k] as number), 0) / down.length,
  );
  let best = down[0] as number;
  let dist = Number.POSITIVE_INFINITY;
  for (const v of down) {
    const d = Math.hypot(...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (c[k] as number)));
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  return best;
}

/**
 * The palm's centre on one side (0 left, 1 right): of the vertices on the palm
 * (`HandFrame.volar` near 1, the skin facing the palm's way), the one nearest
 * the point midway from the wrist to the knuckles of the middle and ring
 * fingers, in the palm's own plane (`HandFrame.palm`).
 */
function palmCentre(assets: HumanoidAssets, used: Uint8Array, side: 0 | 1): number {
  const frame = handFrame(assets);
  const marks = frame.landmarks[side];
  if (!marks) throw new RangeError(`no hand frame for side ${side}`);
  const middle = marks.knuckles[1] as [number, number];
  const ring = marks.knuckles[2] as [number, number];
  const target: [number, number] = [(middle[0] + ring[0]) / 2, (middle[1] + ring[1]) / 4];
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (let v = 0; v < assets.manifest.vertexCount; v++) {
    if (!used[v] || frame.side[v] !== side || (frame.digit[v] as number) === 0) continue;
    if ((frame.volar[v] as number) < PALM_FACING) continue;
    const d = Math.hypot(
      (frame.palm[v * 2] as number) - target[0],
      (frame.palm[v * 2 + 1] as number) - target[1],
    );
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  if (best < 0) throw new RangeError(`no palm vertex on side ${side}`);
  return best;
}

/** How nearly a vertex must face the palm's way to be on the palm (`HandFrame.volar`). */
const PALM_FACING = 0.8;
/** How nearly a vertex must face down at rest to be on a sole. */
const SOLE_FACING = 0.8;

/**
 * The sole's centre on one side: of the foot's vertices whose skin faces down
 * at rest, the one nearest, seen from below, the point midway from the ankle to
 * the base of the big toe.
 */
function soleCentre(assets: HumanoidAssets, used: Uint8Array, ankle: Vec3, toe: Vec3): number {
  const zones = skinZones(assets);
  const foot = zones.zone("foot");
  const N = zones.normals;
  const P = assets.positions;
  const mid = [(ankle[0] + toe[0]) / 2, (ankle[2] + toe[2]) / 2] as const;
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (let v = 0; v < assets.manifest.vertexCount; v++) {
    if (
      !used[v] ||
      (foot[v] as number) < 0.5 ||
      Math.sign(P[v * 3] as number) !== Math.sign(ankle[0])
    )
      continue;
    if (-(N[v * 3 + 1] as number) < SOLE_FACING) continue;
    const d = Math.hypot((P[v * 3] as number) - mid[0], (P[v * 3 + 2] as number) - mid[1]);
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  if (best < 0) throw new RangeError("no sole vertex under the foot");
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
    "ear-canal.L": earCanal(assets, used, 1),
    "ear-canal.R": earCanal(assets, used, -1),
    "nostril.L": nostril(assets, used, 1),
    "nostril.R": nostril(assets, used, -1),
    // The jugular notch: the skin in front of the clavicles' inner ends.
    "sternum-notch": midlineInFront(assets, used, between("clavicle.L", "clavicle.R")),
    "nipple.L": targetPeak(assets, "breast/nipple-point-incr", 1),
    "nipple.R": targetPeak(assets, "breast/nipple-point-incr", -1),
    // The navel's centre is the bottom of the hole its target deepens.
    navel: deepestMoved(assets, "stomach/stomach-navel-in"),
    // The pubic point: the skin in front of the hips' centres, over the symphysis.
    "pubic-point": midlineInFront(assets, used, between("upperleg01.L", "upperleg01.R")),
    "palm.L": palmCentre(assets, used, 0),
    "palm.R": palmCentre(assets, used, 1),
    "sole.L": soleCentre(assets, used, head("foot.L"), head("toe1-1.L")),
    "sole.R": soleCentre(assets, used, head("foot.R"), head("toe1-1.R")),
  };
  vertexCache.set(assets, out);
  return out;
}

/**
 * Each surface landmark's render vertex on a body surface and its neighbours
 * (by welded vertex, so a landmark on a UV seam sees both sides): fixed by the
 * topology, so cached per model and surface.
 */
const anchorCache = new WeakMap<
  HumanoidModel,
  Map<"base" | "adult", Readonly<Record<SurfaceLandmarkId, { vertex: number; around: number[] }>>>
>();

function surfaceAnchors(
  model: HumanoidModel,
  body: PosedBody,
): Readonly<Record<SurfaceLandmarkId, { vertex: number; around: number[] }>> {
  const byModel = anchorCache.get(model) ?? new Map();
  anchorCache.set(model, byModel);
  const known = byModel.get(body.surface);
  if (known) return known;
  const render = model.baseRenderVertices(body.surface);
  const bases = landmarkVertices(model.assets);
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
  const out = {} as Record<SurfaceLandmarkId, { vertex: number; around: number[] }>;
  for (const id of SURFACE_LANDMARKS) {
    const vertex = render[bases[id]] as number;
    if (vertex < 0)
      throw new RangeError(`landmark ${id}: the ${body.surface} surface does not draw its vertex`);
    const around = [...(neighbours.get(body.weld[vertex] as number) ?? [])].sort((a, b) => a - b);
    if (around.length === 0) throw new RangeError(`landmark ${id}: its vertex has no neighbour`);
    out[id] = { vertex, around };
  }
  byModel.set(body.surface, out);
  return out;
}

/**
 * Of a landmark's neighbours, the one most nearly up the skin from it on this
 * figure at rest (forward where the skin faces up or down, at the crown):
 * which way its tangent points, chosen on the figure's own rest shape so the
 * frame never depends on which figure was asked about first.
 */
function upNeighbour(body: PosedBody, vertex: number, around: readonly number[]): number {
  const restAt = (r: number): Vec3 => [
    body.rest[r * 3] as number,
    body.rest[r * 3 + 1] as number,
    body.rest[r * 3 + 2] as number,
  ];
  const p = restAt(vertex);
  const n = unit([
    body.restNormals[vertex * 3] as number,
    body.restNormals[vertex * 3 + 1] as number,
    body.restNormals[vertex * 3 + 2] as number,
  ]);
  const want = Math.abs(dot(n, UP)) > 0.9 ? FORWARD : UP;
  let up = around[0] as number;
  let best = Number.NEGATIVE_INFINITY;
  for (const q of around) {
    const d = dot(across(sub(restAt(q), p), n), want);
    if (d > best) {
      best = d;
      up = q;
    }
  }
  return up;
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
    const { vertex, around } = anchors[id];
    const up = upNeighbour(body, vertex, around);
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
    const j = JOINTS[id];
    const limb = bone(j.limb);
    const t = unit(sub(at(heads, bone(j.to)), at(heads, limb)));
    const n = across(rotateByBone(world, limb, FORWARD), t);
    out[id] = { position: at(heads, bone(j.at)), normal: n, tangent: t, bitangent: cross(n, t) };
  }
  return out;
}
