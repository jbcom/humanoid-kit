/**
 * Joint creases: the folds the skin makes where it is pressed together on the
 * inside of a bend (the crook of the elbow, the back of the knee), driven by the
 * pose's flexion signals (`flex.<joint>.<side>`, src/rig/flexion.ts;
 * docs/ARCHITECTURE.md, "Joint creases").
 *
 * The wrists have none: their skin has no strain measurement, and the folds
 * drawn at the wrist (2.5 mm deep, round the palm side) read as a pale
 * bracelet, where a real wrist has fine lines a fraction of a millimetre deep.
 *
 * One detail layer for each joint and side. Its folds are ridges across the
 * limb, so its coordinate runs along the limb through the joint. The outside of
 * the bend (the elbow's point, the kneecap) has no layer: the measured strain
 * there is a stretch, which draws the skin smooth, and wrinkling when it is
 * loose is not backed by any measurement (it was drawn once, 0.5 mm deep, and
 * read as bands round the limb).
 *
 * Where the skin goes is measured from the base mesh alone (as every layer's
 * fields are): a window along the limb about the joint, on the limb, on the
 * side of the bend the skin faces. How deep a fold is follows from the strain
 * the joint's skin takes (SKIN-STATES.md, B5: +25 % at the forearm's extension,
 * over 60 % at the knee's flexion): see `creaseDepth`. How the relief looks (its
 * profile and how many creases) is art-directed: no measurement of crease depth
 * or spacing against joint angle exists.
 */
import { type HumanoidAssets, jointPosition } from "../../format/assetFormat.ts";
import { FLEXION_JOINTS, type FlexionJoint } from "../../rig/flexion.ts";
import type { DetailLayer } from "../layers.ts";
import { skinZones } from "./skinZones.ts";

export type CreaseJointName = "elbow" | "knee";
type Side = "L" | "R";

const JOINT_NAMES: readonly CreaseJointName[] = ["elbow", "knee"];
const SIDES: readonly Side[] = ["L", "R"];

/** Metres either side of the joint, along the limb, that its creases span. */
export const CREASE_HALF_WIDTH: Readonly<Record<CreaseJointName, number>> = {
  elbow: 0.05,
  knee: 0.07,
};

/**
 * Skin strain at the joint's full flexion (fraction): measured at the forearm
 * (+25 % from 90° flexion to full extension) and the knee (over 60 % at
 * flexion).
 */
export const CREASE_STRAIN: Readonly<Record<CreaseJointName, number>> = {
  elbow: 0.25,
  knee: 0.65,
};

/** Creases across a layer's window (art-directed). */
export const CREASE_COUNT: Readonly<Record<CreaseJointName, number>> = {
  elbow: 3,
  knee: 3,
};

/**
 * The share of a joint's skin strain that the creases take up, the rest going
 * into the skin's own compression and the flesh bulging beside the fold (art-
 * directed: no measurement of how the strain divides exists).
 */
export const CREASE_ABSORBED = 0.1;

/**
 * How much longer the skin's path across one crease is than the crease's span,
 * in units of depth² ÷ span, for the profile the shader draws (`creaseHeight`:
 * `sin⁶(πt)` across a period): ½∫g′² = 378π²/1024, about 3.64, to first order
 * in the slope.
 */
const PROFILE_STRETCH = (378 * Math.PI ** 2) / 1024;

/**
 * Depth of a fold, metres, at the joint's full flexion. A crease whose span is
 * `s` and depth `d` takes up `PROFILE_STRETCH × d² ÷ s` of skin, so a crease
 * that must take up `e` is `√(e·s ÷ PROFILE_STRETCH)` deep. Each crease takes
 * its share of the strain over the window:
 * `e = CREASE_ABSORBED × strain × s`, with `s` the window ÷ the crease count.
 * That is 2.8 mm at the elbow and 6.2 mm at the knee.
 */
export function creaseDepth(joint: CreaseJointName): number {
  const spacing = (2 * CREASE_HALF_WIDTH[joint]) / CREASE_COUNT[joint];
  const taken = CREASE_ABSORBED * CREASE_STRAIN[joint] * spacing;
  return Math.sqrt((taken * spacing) / PROFILE_STRETCH);
}

export const creaseLayerId = (joint: CreaseJointName, side: Side) => `creases.${joint}.${side}`;

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
    mask[v] = window * onLimb * smoothstep(0.1, 0.6, facing);
    coord[v] = Math.min(1, Math.max(0, (s + half) / (2 * half)));
  }
  return { mask, coord };
}

const flexion = (signals: Readonly<Record<string, number>>, name: string) =>
  Math.min(1, Math.max(0, signals[`flex.${name}`] ?? 0));

function creaseLayer(name: CreaseJointName, side: Side): DetailLayer {
  const joint = FLEXION_JOINTS.find((j) => j.name === `${name}.${side}`);
  if (!joint) throw new Error(`no flexion joint ${name}.${side}`);
  const cache = new WeakMap<HumanoidAssets, { mask: Float32Array; coord: Float32Array }>();
  const depth = creaseDepth(name);
  return {
    id: creaseLayerId(name, side),
    kind: "detail",
    pattern: "creases",
    targets: [],
    fields: (assets) => {
      let f = cache.get(assets);
      if (!f) {
        f = creaseFields(assets, joint, CREASE_HALF_WIDTH[name]);
        cache.set(assets, f);
      }
      return f;
    },
    paint: ({ signals }) => ({
      // Nothing straight, the whole near the joint's limit.
      strength: smoothstep(0.05, 0.85, flexion(signals, joint.name)),
      height: depth,
      size: CREASE_COUNT[name],
    }),
  };
}

/** Creases for each side of the elbows and knees. */
export const CREASE_LAYERS: readonly DetailLayer[] = JOINT_NAMES.flatMap((j) =>
  SIDES.map((s) => creaseLayer(j, s)),
);
