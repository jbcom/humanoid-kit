/**
 * Derives a figure's presence (docs/PRESENCE.md) from what the model already
 * computed: the morphed control mesh (joint centroids give the anchors), the
 * rendered surface (bounds and the soles of the feet) and the recipe (skin and
 * age). Nothing is measured from pixels and nothing is guessed from a
 * category. Framework-free.
 */
import { AssetFormatError, type HumanoidAssets } from "../format/assetFormat.ts";
import type { Evaluation } from "../model/humanoidModel.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { luminance, SKIN_F0, skinAlbedo } from "../surface/skinTone.ts";
import type { AnchorName, FigurePresence, Vec3 } from "./presence.ts";

/** Where a figure stands and which way it faces; the id names it in the registry. */
export interface Placement {
  id: string;
  /** Ground position in world space (metres): where the soles meet the floor. */
  position: Vec3;
  /** Heading; only its direction on the ground matters. Must not be vertical. */
  facing: Vec3;
}

/** The joints presence reads, as the control-mesh vertices each joint is the centroid of. */
export interface PresenceJoints {
  headBase: readonly number[];
  headTop: readonly number[];
  leftEye: readonly number[];
  rightEye: readonly number[];
  mouth: readonly number[];
  chest: readonly number[];
  leftWrist: readonly number[];
  rightWrist: readonly number[];
  leftKnuckle: readonly number[];
  rightKnuckle: readonly number[];
  leftAnkle: readonly number[];
  rightAnkle: readonly number[];
  leftToe: readonly number[];
  rightToe: readonly number[];
}

/** MakeHuman skeleton joint (a bone end) for each joint presence reads. */
const JOINT_NAMES: Record<keyof PresenceJoints, string> = {
  headBase: "head____head",
  headTop: "head____tail",
  leftEye: "eye.L____tail",
  rightEye: "eye.R____tail",
  mouth: "oris01____head",
  chest: "spine01____head",
  leftWrist: "wrist.L____tail",
  rightWrist: "wrist.R____tail",
  leftKnuckle: "finger3-1.L____head",
  rightKnuckle: "finger3-1.R____head",
  leftAnkle: "foot.L____head",
  rightAnkle: "foot.R____head",
  leftToe: "toe3-1.L____tail",
  rightToe: "toe3-1.R____tail",
};

/**
 * The vertex lists of the joints presence reads, from a loaded body pack. They
 * are small and static, so a worker reports them once with its topology and
 * the main thread derives presence from every evaluation without the packs.
 */
export function presenceJoints(assets: HumanoidAssets): PresenceJoints {
  const out = {} as Record<keyof PresenceJoints, readonly number[]>;
  for (const [key, joint] of Object.entries(JOINT_NAMES)) {
    const verts = assets.manifest.skeleton.joints[joint];
    if (!verts || verts.length === 0) throw new AssetFormatError(`no joint ${joint}`);
    out[key as keyof PresenceJoints] = [...verts];
  }
  return out;
}

const centroid = (control: Float32Array, verts: readonly number[]): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += control[v * 3] as number;
    y += control[v * 3 + 1] as number;
    z += control[v * 3 + 2] as number;
  }
  const n = verts.length;
  return [x / n, y / n, z / n];
};

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** How much of the head's length (base to crown) the metering region of the face spans. */
const FACE_RADIUS_PER_HEAD_LENGTH = 0.75;

/** Surface points this close to the lowest point count as the soles of the feet, metres. */
const SOLE_DEPTH = 0.03;

interface Extent {
  min: [number, number];
  max: [number, number];
}

/**
 * Ground footprints from the soles of the rendered body: the left foot's is
 * the sole points at x ≥ 0, the right foot's those at x < 0. Each is a centre
 * and the half-length of its larger side.
 */
function soleFootprints(
  positions: Float32Array,
  groundOffset: number,
): { points: [number, number][]; radius: number } | null {
  const sides: (Extent | null)[] = [null, null];
  for (let i = 0; i < positions.length; i += 3) {
    if ((positions[i + 1] as number) + groundOffset > SOLE_DEPTH) continue;
    const x = positions[i] as number;
    const z = positions[i + 2] as number;
    const side = x >= 0 ? 0 : 1;
    const e = sides[side];
    if (!e) sides[side] = { min: [x, z], max: [x, z] };
    else {
      e.min = [Math.min(e.min[0], x), Math.min(e.min[1], z)];
      e.max = [Math.max(e.max[0], x), Math.max(e.max[1], z)];
    }
  }
  const [left, right] = sides;
  if (!left || !right) return null;
  const centre = (e: Extent): [number, number] => [
    (e.min[0] + e.max[0]) / 2,
    (e.min[1] + e.max[1]) / 2,
  ];
  const half = (e: Extent) => Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1]) / 2;
  return { points: [centre(left), centre(right)], radius: Math.max(half(left), half(right)) };
}

/** The figure standing at the origin facing +z: the frame every evaluation is in. */
const REST: Placement = { id: "", position: [0, 0, 0], facing: [0, 0, 1] };

/**
 * A figure's presence from its evaluation: anchors from the morphed control
 * mesh's joint centroids, ground footprint from the soles, bounds from every
 * surface point, measured skin reflectance, face size from the head, and the
 * age policy's verdict, all moved onto `placement`.
 *
 * The evaluation is in the figure's own frame (+z forward, origin at the
 * middle of the body); `groundOffset` lifts it onto the floor.
 */
export function presenceFromEvaluation(input: {
  evaluation: Evaluation;
  recipe: Recipe;
  joints: PresenceJoints;
  placement: Placement;
}): FigurePresence {
  const { evaluation: ev, recipe, joints, placement } = input;
  const lift = ev.groundOffset;
  const at = (verts: readonly number[]): Vec3 => {
    const [x, y, z] = centroid(ev.control, verts);
    return [x, y + lift, z];
  };
  const headBase = at(joints.headBase);
  const headTop = at(joints.headTop);
  const eyes = mid(at(joints.leftEye), at(joints.rightEye));
  const anchors: Record<AnchorName, Vec3> = {
    head: mid(headBase, headTop),
    face: mid(eyes, at(joints.mouth)),
    chest: at(joints.chest),
    leftHand: mid(at(joints.leftWrist), at(joints.leftKnuckle)),
    rightHand: mid(at(joints.rightWrist), at(joints.rightKnuckle)),
    leftFoot: mid(at(joints.leftAnkle), at(joints.leftToe)),
    rightFoot: mid(at(joints.rightAnkle), at(joints.rightToe)),
  };

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const surface of [ev.positions, ...ev.attachments.map((a) => a.positions)])
    for (let i = 0; i < surface.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const c = (surface[i + k] as number) + (k === 1 ? lift : 0);
        if (c < (min[k] as number)) min[k] = c;
        if (c > (max[k] as number)) max[k] = c;
      }

  const feet: [number, number][] = [
    [anchors.leftFoot[0], anchors.leftFoot[2]],
    [anchors.rightFoot[0], anchors.rightFoot[2]],
  ];
  const soles = soleFootprints(ev.positions, lift);

  const s = recipe.skin;
  const albedo = skinAlbedo({
    melanin: s.melanin,
    haemoglobin: s.haemoglobin,
    undertone: s.undertone,
    override: s.override,
  });

  const rest: FigurePresence = {
    ...REST,
    bounds: { min, max },
    anchors,
    footprint: soles ?? { points: feet, radius: 0.1 },
    appearance: { albedo, luminance: luminance(albedo), specular: SKIN_F0 },
    faceRadius:
      FACE_RADIUS_PER_HEAD_LENGTH *
      Math.hypot(headTop[0] - headBase[0], headTop[1] - headBase[1], headTop[2] - headBase[2]),
    adult: isAdult(recipe),
  };
  return placePresence(rest, placement);
}

/**
 * Moves a presence onto a new placement (turning about its ground position),
 * keeping everything else. Re-place from a figure's rest presence rather than
 * chaining: a turned figure's bounds are the box around the turned box.
 */
export function placePresence(presence: FigurePresence, placement: Placement): FigurePresence {
  const [fx, , fz] = placement.facing;
  const len = Math.hypot(fx, fz);
  if (!(len > 1e-9)) throw new RangeError("facing must have a horizontal component");
  const facing: Vec3 = [fx / len, 0, fz / len];
  // Rotation from the presence's own heading to the new one, about the vertical.
  const [ox, , oz] = presence.facing;
  const olen = Math.hypot(ox, oz);
  const [os, oc] = [ox / olen, oz / olen];
  const cos = facing[2] * oc + facing[0] * os;
  const sin = facing[0] * oc - facing[2] * os;
  const [px, py, pz] = presence.position;
  const [nx, ny, nz] = placement.position;
  const move = ([x, y, z]: Vec3): Vec3 => {
    const dx = x - px;
    const dz = z - pz;
    return [nx + dx * cos + dz * sin, ny + (y - py), nz - dx * sin + dz * cos];
  };
  const { min, max } = presence.bounds;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
    move([c & 1 ? max[0] : min[0], c & 2 ? max[1] : min[1], c & 4 ? max[2] : min[2]]),
  );
  const anchors = Object.fromEntries(
    Object.entries(presence.anchors).map(([name, p]) => [name, move(p)]),
  ) as Record<AnchorName, Vec3>;
  return {
    ...presence,
    id: placement.id,
    position: [...placement.position],
    facing,
    bounds: {
      min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k] as number))) as Vec3,
      max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k] as number))) as Vec3,
    },
    anchors,
    footprint: {
      points: presence.footprint.points.map(([x, z]) => {
        const [mx, , mz] = move([x, py, z]);
        return [mx, mz] as [number, number];
      }),
      radius: presence.footprint.radius,
    },
  };
}
