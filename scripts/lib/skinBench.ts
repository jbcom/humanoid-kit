/**
 * A bench that measures how a skinning scheme deforms the body at the joint
 * extremes: the numbers behind docs/ARCHITECTURE.md, "Skinning artefacts", the
 * tuning of `SKIN_DUAL_SHARE` (scripts/research/tune-skin-share.ts) and the
 * tests that hold it (tests/skinning.test.ts).
 *
 * Each case bends or twists one bone of the packed figure about a world axis
 * (the rig's rest frames are axis-aligned, so that is exactly what a BVH
 * rotation does) and measures what the skinned body does there, with two
 * numbers:
 *
 * - girth: for the body's vertices at the joint, how far each is from the
 *   limb's centreline (the joints' polyline) posed over at rest. 1 is a clean
 *   joint; a pinch is below 1, and the candy wrapper's neck is near 0. Reported
 *   as the mean and the 5th and 95th percentiles over the joint's vertices.
 * - ΔV: the change in the whole body's volume, in thousandths of it (‰; an
 *   adult is about 55 L, so 1‰ is 55 mL). Only one joint moves, so it is that
 *   joint's volume lost (negative) or gained. A joint that folds onto itself
 *   counts the overlap twice, so a bent elbow reads a little high.
 */
import type { HumanoidAssets } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { IDENTITY_POSE, posedBoneHeads, type RestBones, restBones } from "../../src/rig/pose.ts";
import { bodyTriangles, girthRatios, meshVolume } from "./skinMeasure.ts";

type Vec = [number, number, number];

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export const BODY_TYPES: Record<string, Parameters<typeof createRecipe>[0]> = {
  average: {},
  "tall lean man": { macros: { gender: 1, height: 0.8, weight: 0.2, muscle: 0.4 } },
  "short full woman": { macros: { gender: 0, height: 0.2, weight: 0.8, muscle: 0.5 } },
  "muscular man": { macros: { gender: 1, muscle: 0.9, weight: 0.55 } },
  child: { macros: { age: 10 } },
};

/** A skinning scheme: base-mesh positions posed by bone rotations. */
export type Scheme = (
  rest: RestBones,
  rotations: Float32Array,
  positions: Float32Array,
  skinIndex: Uint8Array,
  skinWeight: Float32Array,
  out: Float32Array,
) => Float32Array;

interface Joint {
  name: string;
  /** The rig's group the joint belongs to, for tuning a group's bones together. */
  group: "arm" | "leg" | "spine";
  bone: string;
  /**
   * Bones that share the angle equally, each turning by its part about `axis`
   * (a spine bends along its length, not at one joint); default just `bone`.
   */
  bones?: string[];
  /** The rotation axis, from the rest figure, and the angles to try. */
  axis: (f: Figure) => Vec;
  angles: number[];
  /** The limb's centreline: the bones whose heads it passes through. */
  line: string[];
  /** The bone whose subtree is the limb (its vertices are the ones measured). */
  limb: string;
  /** The vertices measured: those of the limb near joint `line[around]`, or along the first segment. */
  zone: { around: number; radius: number } | { along: [number, number] };
}

export interface Figure {
  name: string;
  control: Float32Array;
  rest: RestBones;
  head: (name: string, rotations?: Float32Array) => Vec;
  /** Per vertex, the bone that weighs most. */
  owner: Uint8Array;
  restVolume: number;
}

/** The axis a hinge bends about, from its rest segments; `fallback` where they are straight. */
const hingeAxis = (a: string, b: string, c: string, fallback: Vec) => (f: Figure) => {
  const u = sub(f.head(b), f.head(a));
  const l = sub(f.head(c), f.head(b));
  const x = cross(u, l);
  return Math.hypot(...x) < 1e-3 * Math.hypot(...u) * Math.hypot(...l) ? fallback : unit(x);
};
const along = (a: string, b: string) => (f: Figure) => unit(sub(f.head(b), f.head(a)));
const ARM = "upperarm01.L";
const LEG = "upperleg01.L";

export const JOINTS: Joint[] = [
  {
    name: "elbow flexion",
    group: "arm",
    bone: "lowerarm01.L",
    axis: hingeAxis("upperarm02.L", "lowerarm01.L", "wrist.L", [1, 0, 0]),
    angles: [45, 90, 120, 145],
    line: ["upperarm02.L", "lowerarm01.L", "wrist.L"],
    limb: ARM,
    zone: { around: 1, radius: 0.07 },
  },
  {
    name: "knee flexion",
    group: "leg",
    bone: "lowerleg01.L",
    axis: () => [1, 0, 0],
    angles: [45, 90, 120, 140],
    line: ["upperleg02.L", "lowerleg01.L", "foot.L"],
    limb: LEG,
    zone: { around: 1, radius: 0.09 },
  },
  {
    name: "wrist flexion",
    group: "arm",
    bone: "wrist.L",
    axis: hingeAxis("upperarm02.L", "lowerarm01.L", "wrist.L", [1, 0, 0]),
    angles: [45, 70],
    line: ["lowerarm02.L", "wrist.L", "finger3-1.L"],
    limb: ARM,
    zone: { around: 1, radius: 0.05 },
  },
  {
    name: "wrist extension",
    group: "arm",
    bone: "wrist.L",
    axis: (f) =>
      hingeAxis("upperarm02.L", "lowerarm01.L", "wrist.L", [1, 0, 0])(f).map((v) => -v) as Vec,
    angles: [45, 70],
    line: ["lowerarm02.L", "wrist.L", "finger3-1.L"],
    limb: ARM,
    zone: { around: 1, radius: 0.05 },
  },
  {
    name: "forearm twist",
    group: "arm",
    bone: "wrist.L",
    axis: along("lowerarm01.L", "wrist.L"),
    angles: [45, 90, 135, 180],
    line: ["lowerarm01.L", "wrist.L"],
    limb: ARM,
    zone: { along: [0.1, 0.9] },
  },
  {
    name: "upper arm twist",
    group: "arm",
    bone: ARM,
    axis: along(ARM, "lowerarm01.L"),
    angles: [45, 90, 135],
    line: [ARM, "lowerarm01.L"],
    limb: ARM,
    zone: { along: [0.1, 0.9] },
  },
  {
    name: "thigh twist",
    group: "leg",
    bone: LEG,
    axis: along(LEG, "lowerleg01.L"),
    angles: [45, 90],
    line: [LEG, "lowerleg01.L"],
    limb: LEG,
    zone: { along: [0.1, 0.9] },
  },
  {
    name: "shoulder raise (side)",
    group: "arm",
    bone: ARM,
    axis: () => [0, 0, 1],
    angles: [-45, -90, -130, -150, -170],
    line: [ARM, "lowerarm01.L"],
    limb: ARM,
    zone: { around: 0, radius: 0.12 },
  },
  {
    name: "shoulder raise (forward)",
    group: "arm",
    bone: ARM,
    axis: (f) => unit(cross(sub(f.head("lowerarm01.L"), f.head(ARM)), [0, 0, 1])),
    angles: [45, 90, 130, 150, 170],
    line: [ARM, "lowerarm01.L"],
    limb: ARM,
    zone: { around: 0, radius: 0.12 },
  },
  {
    // The trunk folded forward, shared out along the spine: five bones, a fifth each.
    name: "spine flexion",
    group: "spine",
    bone: "spine05",
    bones: ["spine05", "spine04", "spine03", "spine02", "spine01"],
    axis: () => [1, 0, 0],
    angles: [30, 60, 90],
    line: ["spine05", "spine04", "spine03", "spine02", "spine01"],
    limb: "spine05",
    zone: { around: 2, radius: 0.15 },
  },
  {
    name: "hip flexion",
    group: "leg",
    bone: LEG,
    axis: () => [1, 0, 0],
    angles: [-45, -90, -120],
    line: [LEG, "lowerleg01.L"],
    limb: LEG,
    zone: { around: 0, radius: 0.14 },
  },
  {
    name: "hip abduction",
    group: "leg",
    bone: LEG,
    axis: () => [0, 0, 1],
    angles: [-25, -45],
    line: [LEG, "lowerleg01.L"],
    limb: LEG,
    zone: { around: 0, radius: 0.14 },
  },
];

export interface Reading {
  figure: string;
  joint: string;
  angle: number;
  /** Girth ratio over the joint's vertices: mean, 5th percentile, 95th percentile. */
  mean: number;
  p5: number;
  p95: number;
  /** Change in the body's volume, in thousandths of it (‰). */
  dV: number;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;

/** A rotation of `degrees` about the unit `axis`, as a quaternion (x, y, z, w). */
const rotation = (axis: Vec, degrees: number): [number, number, number, number] => {
  const h = (degrees * Math.PI) / 360;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};

interface Case {
  figure: Figure;
  joint: Joint;
  angle: number;
  rotations: Float32Array;
  zone: Uint32Array;
  restLine: Vec[];
  posedLine: Vec[];
}

export class SkinBench {
  readonly assets: HumanoidAssets;
  readonly figures: Figure[];
  readonly cases: Case[];
  private readonly tris: Uint32Array;
  private readonly scratch: Float32Array;

  constructor(assets: HumanoidAssets, bodies: readonly string[] = Object.keys(BODY_TYPES)) {
    this.assets = assets;
    this.tris = bodyTriangles(assets);
    const model = new HumanoidModel(assets, { subdivision: 0 });
    this.figures = bodies.map((name) => this.figure(model, name));
    this.scratch = new Float32Array(this.figures[0]?.control.length ?? 0);
    this.cases = this.figures.flatMap((figure) =>
      JOINTS.flatMap((joint) => joint.angles.map((angle) => this.prepare(figure, joint, angle))),
    );
  }

  private figure(model: HumanoidModel, name: string): Figure {
    const recipe = BODY_TYPES[name];
    if (!recipe) throw new Error(`unknown body type ${name}`);
    const control = model.evaluate(createRecipe(recipe)).control;
    const rest = restBones(this.assets, control);
    const at = (heads: Float32Array, n: string): Vec => {
      const b = rest.names.indexOf(n);
      if (b < 0) throw new Error(`no bone ${n}`);
      return [heads[b * 3] as number, heads[b * 3 + 1] as number, heads[b * 3 + 2] as number];
    };
    const { skinIndex, skinWeight, manifest } = this.assets;
    const owner = new Uint8Array(manifest.vertexCount);
    for (let v = 0; v < owner.length; v++) {
      let best = 0;
      for (let k = 1; k < 4; k++)
        if ((skinWeight[v * 4 + k] as number) > (skinWeight[v * 4 + best] as number)) best = k;
      owner[v] = skinIndex[v * 4 + best] as number;
    }
    return {
      name,
      control,
      rest,
      head: (n, rotations) => at(rotations ? posedBoneHeads(rest, rotations) : rest.heads, n),
      owner,
      restVolume: meshVolume(control, this.tris),
    };
  }

  /** The bone and every bone below it. */
  private subtree(f: Figure, root: string): Set<number> {
    const out = new Set<number>([f.rest.names.indexOf(root)]);
    for (const b of f.rest.order) if (out.has(f.rest.parents[b] as number)) out.add(b);
    return out;
  }

  /** The vertices of the joint's zone: the limb's own, near the joint or along its first segment. */
  private zone(f: Figure, j: Joint): Uint32Array {
    const limb = this.subtree(f, j.limb);
    const heads = j.line.map((n) => f.head(n));
    const out: number[] = [];
    for (let v = 0; v < f.owner.length; v++) {
      if (!limb.has(f.owner[v] as number)) continue;
      const p: Vec = [
        f.control[v * 3] as number,
        f.control[v * 3 + 1] as number,
        f.control[v * 3 + 2] as number,
      ];
      if ("around" in j.zone) {
        if (Math.hypot(...sub(p, heads[j.zone.around] as Vec)) <= j.zone.radius) out.push(v);
      } else {
        const a = heads[0] as Vec;
        const axis = sub(heads[1] as Vec, a);
        const t = dot(sub(p, a), axis) / dot(axis, axis);
        if (t >= j.zone.along[0] && t <= j.zone.along[1]) out.push(v);
      }
    }
    return Uint32Array.from(out);
  }

  private prepare(figure: Figure, joint: Joint, angle: number): Case {
    const rotations = IDENTITY_POSE(figure.rest.names.length);
    const turned = joint.bones ?? [joint.bone];
    for (const bone of turned)
      rotations.set(
        rotation(joint.axis(figure), angle / turned.length),
        figure.rest.names.indexOf(bone) * 4,
      );
    return {
      figure,
      joint,
      angle,
      rotations,
      zone: this.zone(figure, joint),
      restLine: joint.line.map((n) => figure.head(n)),
      posedLine: joint.line.map((n) => figure.head(n, rotations)),
    };
  }

  /** What `scheme` does in one case. */
  read(scheme: Scheme, c: Case): Reading {
    const { skinIndex, skinWeight } = this.assets;
    const posed = scheme(
      c.figure.rest,
      c.rotations,
      c.figure.control,
      skinIndex,
      skinWeight,
      this.scratch,
    );
    const dV = ((meshVolume(posed, this.tris) - c.figure.restVolume) / c.figure.restVolume) * 1000;
    const ratios = girthRatios(c.figure.control, posed, c.zone, c.restLine, c.posedLine).sort(
      (a, b) => a - b,
    );
    return {
      figure: c.figure.name,
      joint: c.joint.name,
      angle: c.angle,
      mean: ratios.reduce((p, q) => p + q, 0) / ratios.length,
      p5: percentile(ratios, 0.05),
      p95: percentile(ratios, 0.95),
      dV,
    };
  }

  /** What `scheme` does in every case (or those of one joint group). */
  readings(scheme: Scheme, group?: Joint["group"]): Reading[] {
    return this.cases
      .filter((c) => !group || c.joint.group === group)
      .map((c) => this.read(scheme, c));
  }
}

/** Per joint and angle, the worst body's numbers for each scheme, as a table. */
export function table(all: Record<string, Reading[]>): string {
  const names = Object.keys(all);
  const lines: string[] = [];
  const f2 = (v: number) => v.toFixed(2);
  for (const j of JOINTS) {
    lines.push(
      `\n${j.name}   (girth: mean over bodies / 5th percentile of the worst body; ΔV: worst body)`,
    );
    for (const angle of j.angles) {
      const row = (scheme: string) => {
        const rs = (all[scheme] as Reading[]).filter(
          (r) => r.joint === j.name && r.angle === angle,
        );
        const worst = rs.reduce((p, r) => (r.p5 < p.p5 ? r : p));
        const dv = rs.reduce((p, r) => (Math.abs(r.dV) > Math.abs(p.dV) ? r : p));
        const mean = rs.reduce((p, r) => p + r.mean, 0) / rs.length;
        return `${scheme}: ${f2(mean)} / ${f2(worst.p5)}  ΔV ${dv.dV.toFixed(1).padStart(6)}‰`;
      };
      lines.push(`  ${String(angle).padStart(5)}°  ${names.map(row).join("   |   ")}`);
    }
  }
  return lines.join("\n");
}
