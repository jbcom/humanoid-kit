/**
 * Joint creases: relief where the skin folds and wrinkles at the elbows, knees
 * and wrists, driven by the pose's flexion signals (`flex.<joint>.<side>`,
 * src/rig/flexion.ts; docs/ARCHITECTURE.md, "Joint creases").
 *
 * Each joint carries two detail layers per side, for the two sides of the bend.
 * The *flexor* side (the inside of the bend: the crook of the elbow, the back
 * of the knee, the wrist's palm side) folds as the joint bends; the *extensor*
 * side (the elbow's point, the kneecap, the back of the wrist) is loose when
 * the joint is straight and wrinkles, and is drawn tight as it bends. Both are
 * ridges across the limb, so their coordinate runs along it through the joint.
 *
 * Where the skin goes is measured from the base mesh alone (as every layer's
 * fields are): a window along the limb about the joint, on the limb, on the
 * side of the bend the skin faces. How deep a fold is scales with the strain
 * the joint's skin takes, which is measured (SKIN-STATES.md, B5: +25 % at the
 * forearm's extension, over 60 % at the knee's flexion). How the relief looks
 * (its profile, how many creases, the depth per strain) is art-directed: no
 * measurement of crease depth or spacing against joint angle exists.
 */
import { type HumanoidAssets, jointPosition } from "../../format/assetFormat.ts";
import { FLEXION_JOINTS, type FlexionJoint } from "../../rig/flexion.ts";
import type { DetailLayer } from "../layers.ts";
import { skinZones } from "./skinZones.ts";

type CreaseJointName = "elbow" | "knee" | "wrist";
type Side = "L" | "R";
type Role = "flexor" | "extensor";

const JOINT_NAMES: readonly CreaseJointName[] = ["elbow", "knee", "wrist"];
const SIDES: readonly Side[] = ["L", "R"];
const ROLES: readonly Role[] = ["flexor", "extensor"];

/** Metres either side of the joint, along the limb, that its creases span. */
export const CREASE_HALF_WIDTH: Readonly<Record<CreaseJointName, number>> = {
  elbow: 0.05,
  knee: 0.07,
  wrist: 0.03,
};

/**
 * Skin strain at the joint's full flexion (fraction): measured at the forearm
 * (+25 % from 90° flexion to full extension) and the knee (over 60 % at
 * flexion). The wrist has no measurement and takes the forearm's.
 */
export const CREASE_STRAIN: Readonly<Record<CreaseJointName, number>> = {
  elbow: 0.25,
  knee: 0.65,
  wrist: 0.25,
};

/** Depth of a fold, metres, per unit of strain (art-directed). */
export const CREASE_HEIGHT_PER_STRAIN = 0.006;

/** How deep the extensor side's wrinkles are, against the flexor side's folds. */
const EXTENSOR_DEPTH = 0.3;

/** Creases across a layer's window, by joint and side of the bend (art-directed). */
const CREASE_COUNT: Readonly<Record<CreaseJointName, Readonly<Record<Role, number>>>> = {
  elbow: { flexor: 3, extensor: 3 },
  knee: { flexor: 3, extensor: 2 },
  wrist: { flexor: 2, extensor: 2 },
};

export const creaseLayerId = (joint: CreaseJointName, side: Side, role: Role) =>
  `creases.${joint}.${side}.${role}`;

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Metres from the limb's axis out to where skin stops being the limb's. */
const LIMB_RADIUS = { inside: 0.09, edge: 0.12 };

/**
 * One layer's per-vertex mask (window × on the limb × the bend's side) and
 * coordinate (along the limb across the window).
 */
function creaseFields(
  assets: HumanoidAssets,
  joint: FlexionJoint,
  half: number,
  role: Role,
): { mask: Float32Array; coord: Float32Array } {
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const at = (bone: string) => {
    const p = new Float32Array(3);
    jointPosition(assets, P, `${bone}____head`, p, 0);
    return p;
  };
  const [above, head, below] = [at(joint.above), at(joint.joint), at(joint.below)] as [
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  // The axis through the segments either side of the joint, from above to below.
  const axis = [0, 1, 2].map((k) => (below[k] as number) - (above[k] as number));
  const len = Math.hypot(...axis);
  const u = axis.map((x) => x / len) as [number, number, number];
  const { normals } = skinZones(assets);
  const sign = role === "flexor" ? 1 : -1;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const d = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (head[k] as number));
    const s = (d[0] as number) * u[0] + (d[1] as number) * u[1] + (d[2] as number) * u[2];
    const r = Math.hypot(
      (d[0] as number) - s * u[0],
      (d[1] as number) - s * u[1],
      (d[2] as number) - s * u[2],
    );
    const facing =
      (normals[v * 3] as number) * joint.flexes[0] +
      (normals[v * 3 + 1] as number) * joint.flexes[1] +
      (normals[v * 3 + 2] as number) * joint.flexes[2];
    const window = 1 - smoothstep(half * 0.75, half, Math.abs(s));
    const onLimb = 1 - smoothstep(LIMB_RADIUS.inside, LIMB_RADIUS.edge, r);
    mask[v] = window * onLimb * smoothstep(0.1, 0.6, sign * facing);
    coord[v] = Math.min(1, Math.max(0, (s + half) / (2 * half)));
  }
  return { mask, coord };
}

const flexion = (signals: Readonly<Record<string, number>>, name: string) =>
  Math.min(1, Math.max(0, signals[`flex.${name}`] ?? 0));

function creaseLayer(name: CreaseJointName, side: Side, role: Role): DetailLayer {
  const joint = FLEXION_JOINTS.find((j) => j.name === `${name}.${side}`);
  if (!joint) throw new Error(`no flexion joint ${name}.${side}`);
  const cache = new WeakMap<HumanoidAssets, { mask: Float32Array; coord: Float32Array }>();
  const depth =
    CREASE_HEIGHT_PER_STRAIN * CREASE_STRAIN[name] * (role === "flexor" ? 1 : EXTENSOR_DEPTH);
  return {
    id: creaseLayerId(name, side, role),
    // Every crease layer measures its coordinate along its own limb, through its own
    // joint, so where two layers reach one vertex they agree: one atlas channel for all.
    coordGroup: "creases",
    kind: "detail",
    pattern: "creases",
    targets: [],
    fields: (assets) => {
      let f = cache.get(assets);
      if (!f) {
        f = creaseFields(assets, joint, CREASE_HALF_WIDTH[name], role);
        cache.set(assets, f);
      }
      return f;
    },
    paint: ({ signals }) => {
      const bend = flexion(signals, joint.name);
      return {
        // The flexor side folds as the joint bends; the extensor side wrinkles
        // while it is straight and is drawn tight as it bends.
        strength: role === "flexor" ? smoothstep(0.05, 0.85, bend) : 1 - smoothstep(0, 0.6, bend),
        height: depth,
        size: CREASE_COUNT[name][role],
      };
    },
  };
}

/** Flexor and extensor creases for each side of the elbows, knees and wrists. */
export const CREASE_LAYERS: readonly DetailLayer[] = JOINT_NAMES.flatMap((j) =>
  SIDES.flatMap((s) => ROLES.map((r) => creaseLayer(j, s, r))),
);
