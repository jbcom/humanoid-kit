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
import { posedBones, restBones, rigData } from "../rig/pose.ts";
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
  "mouth-corner.L",
  "mouth-corner.R",
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
  // The pulp of each digit's last segment, thumb (1) to little finger (5).
  "finger-pad-1.L",
  "finger-pad-2.L",
  "finger-pad-3.L",
  "finger-pad-4.L",
  "finger-pad-5.L",
  "finger-pad-1.R",
  "finger-pad-2.R",
  "finger-pad-3.R",
  "finger-pad-4.R",
  "finger-pad-5.R",
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

/**
 * A finger pad's place on its digit's last segment, as a share of the segment
 * from its joint to the tip: the pulp's centre, where the fingerprint's core
 * lies (CHOICE: the pulp fills the segment's distal two thirds), and the band
 * of the segment searched for it.
 */
const PAD_AT = 0.6;
const PAD_BAND: readonly [number, number] = [0.4, 0.9];
/** How far across the digit from its axis a pad may be, as a share of the fingertip's radius. */
const PAD_ACROSS = 0.5;
/** How much less nearly than the segment's most palmward vertex a pad may face the palm's way. */
const PAD_FACING_SLACK = 0.15;

/**
 * A digit's pad on one side (0 left, 1 right; digit 1 the thumb to 5 the
 * little finger): of the vertices on the middle of the digit's last segment
 * (`PAD_BAND`, within `PAD_ACROSS` of its axis), those facing the palm's way
 * nearly as much as the most palmward of them, the one nearest `PAD_AT` along
 * it. The thumb's pad faces the palm's way least, turned toward the fingers, so
 * the most palmward of its own segment is the measure, not a fixed facing.
 */
function fingerPad(assets: HumanoidAssets, used: Uint8Array, side: 0 | 1, digit: number): number {
  const frame = handFrame(assets);
  const joints = (frame.joints[side] as number[][])[digit] as number[];
  const start = joints[2] as number;
  const len = (joints[3] as number) - start;
  const radius = ((frame.radius[side] as number[])[digit] as number) || 0.007;
  const onPulp: number[] = [];
  let facing = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < assets.manifest.vertexCount; v++) {
    if (!used[v] || frame.side[v] !== side || frame.digit[v] !== digit) continue;
    const u = ((frame.along[v] as number) - start) / len;
    if (u < PAD_BAND[0] || u > PAD_BAND[1]) continue;
    if (Math.abs(frame.across[v] as number) > PAD_ACROSS * radius) continue;
    onPulp.push(v);
    facing = Math.max(facing, frame.volar[v] as number);
  }
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (const v of onPulp) {
    if ((frame.volar[v] as number) < facing - PAD_FACING_SLACK) continue;
    const d = Math.abs(((frame.along[v] as number) - start) / len - PAD_AT);
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  if (best < 0) throw new RangeError(`no pad vertex on digit ${digit}, side ${side}`);
  return best;
}
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
    // The mouth's widening moves its corners most of the skin it draws (and the inside of
    // the mouth, which the body does not draw, more).
    "mouth-corner.L": targetPeak(assets, "mouth/mouth-scale-horiz-incr", 1, (v) => used[v] === 1),
    "mouth-corner.R": targetPeak(assets, "mouth/mouth-scale-horiz-incr", -1, (v) => used[v] === 1),
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
    "finger-pad-1.L": fingerPad(assets, used, 0, 1),
    "finger-pad-2.L": fingerPad(assets, used, 0, 2),
    "finger-pad-3.L": fingerPad(assets, used, 0, 3),
    "finger-pad-4.L": fingerPad(assets, used, 0, 4),
    "finger-pad-5.L": fingerPad(assets, used, 0, 5),
    "finger-pad-1.R": fingerPad(assets, used, 1, 1),
    "finger-pad-2.R": fingerPad(assets, used, 1, 2),
    "finger-pad-3.R": fingerPad(assets, used, 1, 3),
    "finger-pad-4.R": fingerPad(assets, used, 1, 4),
    "finger-pad-5.R": fingerPad(assets, used, 1, 5),
    "sole.L": soleCentre(assets, used, head("foot.L"), head("toe1-1.L")),
    "sole.R": soleCentre(assets, used, head("foot.R"), head("toe1-1.R")),
  };
  vertexCache.set(assets, out);
  return out;
}

/*
 * A landmark's frame is found in three stages, so a renderer can frame one on
 * the figure as it draws it, each frame, without posing the whole body:
 *
 * - its anchors (`landmarkAnchors`), fixed by the model's topology: a surface
 *   landmark's render vertex and the vertices round it, a joint landmark's bones;
 * - the neighbour its tangent points to (`landmarkUps`), chosen on each
 *   figure's rest shape;
 * - its frame (`landmarkFrameInto`), from the posed skeleton and a callback that
 *   skins a render vertex as the figure is drawn.
 *
 * `landmarks(model, body)` runs them on a `PosedBody`.
 */

/** A surface landmark on one body surface: its render vertex, and the welded vertices round it. */
export interface SurfaceAnchor {
  readonly vertex: number;
  readonly around: readonly number[];
}

/** A joint landmark's bones, by index: whose head it is, and its limb, from `limb`'s head toward `to`'s. */
export interface JointAnchor {
  readonly at: number;
  readonly limb: number;
  readonly to: number;
}

/** Where every landmark is held on one body surface of a model (`landmarkAnchors`). */
export interface LandmarkAnchors {
  readonly surface: "base" | "adult";
  readonly vertices: Readonly<Record<SurfaceLandmarkId, SurfaceAnchor>>;
  readonly joints: Readonly<Record<JointLandmarkId, JointAnchor>>;
}

/** Fixed by the topology, so cached per model and surface. */
const anchorCache = new WeakMap<HumanoidModel, Map<"base" | "adult", LandmarkAnchors>>();

/**
 * Each surface landmark's render vertex on a body surface and its neighbours
 * (by welded vertex, `renderWeld`, so a landmark on a UV seam sees both
 * sides), and each joint landmark's bones. The model's target files must have
 * loaded: the surface landmarks are found from the targets that shape them.
 */
export function landmarkAnchors(
  model: HumanoidModel,
  surface: "base" | "adult" = "base",
): LandmarkAnchors {
  const byModel = anchorCache.get(model) ?? new Map<"base" | "adult", LandmarkAnchors>();
  anchorCache.set(model, byModel);
  const known = byModel.get(surface);
  if (known) return known;
  const render = model.baseRenderVertices(surface);
  const weld = model.renderWeld(surface);
  const I = model.bodyIndex(surface);
  const bases = landmarkVertices(model.assets);
  const neighbours = new Map<number, Set<number>>();
  for (let t = 0; t < I.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = weld[I[t + c] as number] as number;
      const set = neighbours.get(a) ?? new Set<number>();
      neighbours.set(a, set);
      set.add(weld[I[t + ((c + 1) % 3)] as number] as number);
      set.add(weld[I[t + ((c + 2) % 3)] as number] as number);
    }
  const vertices = {} as Record<SurfaceLandmarkId, SurfaceAnchor>;
  for (const id of SURFACE_LANDMARKS) {
    const vertex = render[bases[id]] as number;
    if (vertex < 0)
      throw new RangeError(`landmark ${id}: the ${surface} surface does not draw its vertex`);
    const around = [...(neighbours.get(weld[vertex] as number) ?? [])].sort((a, b) => a - b);
    if (around.length === 0) throw new RangeError(`landmark ${id}: its vertex has no neighbour`);
    vertices[id] = { vertex, around };
  }
  const names = rigData(model.assets).bones;
  const bone = (name: string) => {
    const b = names.indexOf(name);
    if (b < 0) throw new RangeError(`no bone ${name}`);
    return b;
  };
  const joints = {} as Record<JointLandmarkId, JointAnchor>;
  for (const id of JOINT_LANDMARKS) {
    const j = JOINTS[id];
    joints[id] = { at: bone(j.at), limb: bone(j.limb), to: bone(j.to) };
  }
  const out: LandmarkAnchors = { surface, vertices, joints };
  byModel.set(surface, out);
  return out;
}

/** Each surface landmark's place in `SURFACE_LANDMARKS`, which `landmarkUps` is in. */
const SURFACE_INDEX: ReadonlyMap<LandmarkId, number> = new Map(
  SURFACE_LANDMARKS.map((id, i) => [id, i]),
);

/**
 * Of each surface landmark's neighbours (in `SURFACE_LANDMARKS` order), the one
 * most nearly up the skin from it on this figure at rest (forward where the
 * skin faces up or down, at the crown): which way its tangent points, chosen on
 * the figure's own rest shape (`rest` and `restNormals`, its evaluated render
 * vertices) so the frame never depends on which figure was asked about first.
 */
export function landmarkUps(
  anchors: LandmarkAnchors,
  rest: Float32Array,
  restNormals: Float32Array,
): Int32Array {
  const restAt = (r: number): Vec3 => [
    rest[r * 3] as number,
    rest[r * 3 + 1] as number,
    rest[r * 3 + 2] as number,
  ];
  return Int32Array.from(SURFACE_LANDMARKS, (id) => {
    const { vertex, around } = anchors.vertices[id];
    const p = restAt(vertex);
    const n = unit([
      restNormals[vertex * 3] as number,
      restNormals[vertex * 3 + 1] as number,
      restNormals[vertex * 3 + 2] as number,
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
  });
}

/**
 * Skins render vertex `vertex` as the figure is drawn, writing its position
 * (and, when `normal` is given, its unit normal) in the figure's own space.
 */
export type SkinRenderVertex = (
  vertex: number,
  position: Float32Array,
  normal: Float32Array | null,
) => void;

/** The posed skeleton (`posedBones`): each bone's world rotation (`bones * 4`) and head (`bones * 3`). */
export interface PosedSkeleton {
  readonly world: Float32Array;
  readonly heads: Float32Array;
}

/** A landmark frame to write into, so framing one each frame allocates nothing. */
export interface FrameOut {
  position: [number, number, number];
  normal: [number, number, number];
  tangent: [number, number, number];
  bitangent: [number, number, number];
}

/** A frame to write into. */
export const frameOut = (): FrameOut => ({
  position: [0, 0, 0],
  normal: [0, 0, 0],
  tangent: [0, 0, 0],
  bitangent: [0, 0, 0],
});

/** The skinned position and normal of a landmark's vertex, and of its up neighbour. */
const P = new Float32Array(3);
const N = new Float32Array(3);
const Q = new Float32Array(3);

/**
 * Writes into `out` the frame on position (px, py, pz) whose normal is
 * (nx, ny, nz) made unit and whose tangent is (ax, ay, az) made square to it
 * and unit, its bitangent normal × tangent.
 */
function writeFrame(
  out: FrameOut,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  ax: number,
  ay: number,
  az: number,
): FrameOut {
  const nl = Math.hypot(nx, ny, nz);
  const n0 = nx / nl;
  const n1 = ny / nl;
  const n2 = nz / nl;
  const d = ax * n0 + ay * n1 + az * n2;
  const sx = ax - n0 * d;
  const sy = ay - n1 * d;
  const sz = az - n2 * d;
  const tl = Math.hypot(sx, sy, sz);
  const t0 = sx / tl;
  const t1 = sy / tl;
  const t2 = sz / tl;
  out.position[0] = px;
  out.position[1] = py;
  out.position[2] = pz;
  out.normal[0] = n0;
  out.normal[1] = n1;
  out.normal[2] = n2;
  out.tangent[0] = t0;
  out.tangent[1] = t1;
  out.tangent[2] = t2;
  out.bitangent[0] = n1 * t2 - n2 * t1;
  out.bitangent[1] = n2 * t0 - n0 * t2;
  out.bitangent[2] = n0 * t1 - n1 * t0;
  return out;
}

/**
 * One landmark's frame on a posed figure, written into `out`: a surface
 * landmark's from its render vertex as `skin` draws it, its normal there and
 * the way to its up neighbour (`ups`, from `landmarkUps`); a joint landmark's
 * from the posed skeleton. Allocates nothing.
 */
export function landmarkFrameInto(
  id: LandmarkId,
  anchors: LandmarkAnchors,
  ups: Int32Array,
  skin: SkinRenderVertex,
  skeleton: PosedSkeleton,
  out: FrameOut,
): FrameOut {
  const s = SURFACE_INDEX.get(id);
  if (s !== undefined) {
    skin(anchors.vertices[id as SurfaceLandmarkId].vertex, P, N);
    skin(ups[s] as number, Q, null);
    const px = P[0] as number;
    const py = P[1] as number;
    const pz = P[2] as number;
    return writeFrame(
      out,
      px,
      py,
      pz,
      N[0] as number,
      N[1] as number,
      N[2] as number,
      (Q[0] as number) - px,
      (Q[1] as number) - py,
      (Q[2] as number) - pz,
    );
  }
  const j = anchors.joints[id as JointLandmarkId];
  const { world, heads } = skeleton;
  const h = (b: number, k: number) => heads[b * 3 + k] as number;
  // Along the limb, away from the body.
  let t0 = h(j.to, 0) - h(j.limb, 0);
  let t1 = h(j.to, 1) - h(j.limb, 1);
  let t2 = h(j.to, 2) - h(j.limb, 2);
  const tl = Math.hypot(t0, t1, t2);
  t0 /= tl;
  t1 /= tl;
  t2 /= tl;
  // The figure's forward (0, 0, 1) turned by the limb's bone, as `rotate` does it.
  const qx = world[j.limb * 4] as number;
  const qy = world[j.limb * 4 + 1] as number;
  const qz = world[j.limb * 4 + 2] as number;
  const qw = world[j.limb * 4 + 3] as number;
  const rx = 2 * (qy * 1 - qz * 0);
  const ry = 2 * (qz * 0 - qx * 1);
  const rz = 2 * (qx * 0 - qy * 0);
  const fx = 0 + qw * rx + (qy * rz - qz * ry);
  const fy = 0 + qw * ry + (qz * rx - qx * rz);
  const fz = 1 + qw * rz + (qx * ry - qy * rx);
  // The normal is that made square to the limb, which the tangent runs along exactly.
  const d = fx * t0 + fy * t1 + fz * t2;
  const sx = fx - t0 * d;
  const sy = fy - t1 * d;
  const sz = fz - t2 * d;
  const nl = Math.hypot(sx, sy, sz);
  const n0 = sx / nl;
  const n1 = sy / nl;
  const n2 = sz / nl;
  out.position[0] = h(j.at, 0);
  out.position[1] = h(j.at, 1);
  out.position[2] = h(j.at, 2);
  out.normal[0] = n0;
  out.normal[1] = n1;
  out.normal[2] = n2;
  out.tangent[0] = t0;
  out.tangent[1] = t1;
  out.tangent[2] = t2;
  out.bitangent[0] = n1 * t2 - n2 * t1;
  out.bitangent[1] = n2 * t0 - n0 * t2;
  out.bitangent[2] = n0 * t1 - n1 * t0;
  return out;
}

/** Every landmark's frame on a posed figure (`landmarkFrameInto` for each). */
export function landmarkFrames(
  anchors: LandmarkAnchors,
  ups: Int32Array,
  skin: SkinRenderVertex,
  skeleton: PosedSkeleton,
): Readonly<Record<LandmarkId, LandmarkFrame>> {
  const out = {} as Record<LandmarkId, LandmarkFrame>;
  for (const id of LANDMARK_IDS)
    out[id] = landmarkFrameInto(id, anchors, ups, skin, skeleton, frameOut());
  return out;
}

/** Every landmark of a posed body (`posedSurface`) of this model. */
export function landmarks(
  model: HumanoidModel,
  body: PosedBody,
): Readonly<Record<LandmarkId, LandmarkFrame>> {
  const anchors = landmarkAnchors(model, body.surface);
  const skin: SkinRenderVertex = (v, position, normal) => {
    position.set(body.positions.subarray(v * 3, v * 3 + 3));
    normal?.set(body.normals.subarray(v * 3, v * 3 + 3));
  };
  return landmarkFrames(
    anchors,
    landmarkUps(anchors, body.rest, body.restNormals),
    skin,
    posedBones(body.bones, body.rotations),
  );
}
