/**
 * Joint crease detail layers (src/surface/regions/creases.ts): where they lie
 * on the base mesh, which side of the joint they fold on, and how the flexion
 * signals drive them.
 */
import { describe, expect, it } from "vitest";
import { jointPosition } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { FLEXION_JOINTS, flexionRig, jointFlexion } from "../src/rig/flexion.ts";
import { bodyPoseRotations, IDENTITY_POSE, restBones, rigData } from "../src/rig/pose.ts";
import {
  buildLayerFields,
  creaseHeight,
  type DetailLayer,
  paintStopTable,
  type SkinPaintInput,
} from "../src/surface/layers.ts";
import {
  CREASE_ABSORBED,
  CREASE_COUNT,
  CREASE_HALF_WIDTH,
  CREASE_LAYERS,
  CREASE_STRAIN,
  creaseDepth,
  creaseLayerId,
} from "../src/surface/regions/creases.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const n = assets.manifest.vertexCount;
const P = assets.positions;
const fields = buildLayerFields(assets, CREASE_LAYERS);
const normals = skinZones(assets).normals;

const input = (signals: Record<string, number> = {}): SkinPaintInput => ({
  tone: { melanin: 0.4, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals,
});

const layer = (id: string): DetailLayer => {
  const l = CREASE_LAYERS.find((x) => x.id === id);
  if (!l) throw new Error(`no layer ${id}`);
  return l;
};
const mask = (id: number, v: number) => fields[(id * n + v) * 3] as number;
const coord = (id: number, v: number) => fields[(id * n + v) * 3 + 1] as number;

const JOINTS = ["elbow", "knee"] as const;
const SIDES = ["L", "R"] as const;

/** A joint's rest geometry: its position, the axis through the segments either side, and its flex direction. */
function geometry(joint: (typeof JOINTS)[number], side: (typeof SIDES)[number]) {
  const spec = FLEXION_JOINTS.find((j) => j.name === `${joint}.${side}`);
  if (!spec) throw new Error(`no joint ${joint}.${side}`);
  const at = (bone: string) => {
    const p = new Float32Array(3);
    jointPosition(assets, P, `${bone}____head`, p, 0);
    return Array.from(p);
  };
  const [a, m, b] = [at(spec.above), at(spec.joint), at(spec.below)] as [
    number[],
    number[],
    number[],
  ];
  const axis = b.map((x, k) => x - (a[k] as number));
  const len = Math.hypot(...axis);
  return { head: m, axis: axis.map((x) => x / len), flexes: spec.flexes };
}

/** Vertices a layer covers strongly. */
const strong = (id: number) => {
  const out: number[] = [];
  for (let v = 0; v < n; v++) if (mask(id, v) > 0.5) out.push(v);
  return out;
};

describe("the crease layers' fields", () => {
  it("are one layer for each side of the elbows and knees, after the rest layers", () => {
    expect(CREASE_LAYERS.map((l) => l.id)).toEqual(
      JOINTS.flatMap((j) => SIDES.map((s) => creaseLayerId(j, s))),
    );
    for (const l of CREASE_LAYERS) {
      expect(l.kind).toBe("detail");
      expect(l.pattern).toBe("creases");
    }
    const ids = SKIN_LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of CREASE_LAYERS) expect(ids).toContain(l.id);
  });

  for (const joint of JOINTS)
    for (const side of SIDES) {
      const id = CREASE_LAYERS.findIndex((l) => l.id === creaseLayerId(joint, side));
      const g = geometry(joint, side);
      const half = CREASE_HALF_WIDTH[joint];

      it(`put the ${side} ${joint}'s creases across the joint, on the inside of the bend`, () => {
        const covered = strong(id);
        expect(covered.length).toBeGreaterThan(12);
        let side_ = 0;
        let facing = 0;
        for (const v of covered) {
          const d = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (g.head[k] as number));
          const along = d.reduce((s, x, k) => s + x * (g.axis[k] as number), 0);
          const radial = Math.hypot(...d.map((x, k) => x - along * (g.axis[k] as number)));
          // In a window about the joint's own position along the limb, and on the limb.
          expect(Math.abs(along), `vertex ${v}`).toBeLessThanOrEqual(half * 1.05);
          expect(radial, `vertex ${v}`).toBeLessThan(0.13);
          side_ += Math.sign(P[v * 3] as number) === (side === "L" ? 1 : -1) ? 1 : 0;
          facing +=
            (normals[v * 3] as number) * (g.flexes[0] as number) +
            (normals[v * 3 + 1] as number) * (g.flexes[1] as number) +
            (normals[v * 3 + 2] as number) * (g.flexes[2] as number);
        }
        // The side of the body it is on, and which way the skin there faces.
        expect(side_ / covered.length).toBeGreaterThan(0.99);
        expect(facing / covered.length).toBeGreaterThan(0.3);
      });

      it(`run the ${side} ${joint}'s coordinate along the limb, from one end of the window to the other`, () => {
        const covered = strong(id);
        const xs: number[] = [];
        const ys: number[] = [];
        for (const v of covered) {
          const d = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (g.head[k] as number));
          xs.push(d.reduce((s, x, k) => s + x * (g.axis[k] as number), 0));
          ys.push(coord(id, v));
        }
        const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
        const [mx, my] = [mean(xs), mean(ys)];
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        xs.forEach((x, i) => {
          sxy += (x - mx) * ((ys[i] as number) - my);
          sxx += (x - mx) ** 2;
          syy += ((ys[i] as number) - my) ** 2;
        });
        expect(sxy / Math.sqrt(sxx * syy)).toBeGreaterThan(0.97);
        expect(Math.min(...ys)).toBeLessThan(0.3);
        expect(Math.max(...ys)).toBeGreaterThan(0.7);
        for (const y of ys) expect(y).toBeGreaterThanOrEqual(0);
        for (const y of ys) expect(y).toBeLessThanOrEqual(1);
      });
    }

  it("are part of the package's public surface", async () => {
    const pkg = await import("../src/index.ts");
    expect(pkg.CREASE_LAYERS).toBe(CREASE_LAYERS);
    expect(pkg.CREASE_STRAIN).toBe(CREASE_STRAIN);
    expect(pkg.CREASE_ABSORBED).toBe(CREASE_ABSORBED);
    expect(pkg.CREASE_COUNT).toBe(CREASE_COUNT);
    expect(pkg.creaseDepth).toBe(creaseDepth);
    expect(pkg.CREASE_HALF_WIDTH).toBe(CREASE_HALF_WIDTH);
    expect(pkg.creaseLayerId).toBe(creaseLayerId);
  });

  it("lie within one window of their own joint, along the limb and in the posed bend too", () => {
    // Nothing of the elbow's creases reaches the forearm's far end (a bent forearm points at
    // the camera, and a crease half way down it reads as a ring at the wrist), and no crease
    // is further from its joint along the limb than its window.
    for (const joint of JOINTS)
      for (const side of SIDES) {
        const id = CREASE_LAYERS.findIndex((l) => l.id === creaseLayerId(joint, side));
        const g = geometry(joint, side);
        for (let v = 0; v < n; v++) {
          if (mask(id, v) <= 0.001) continue;
          const d = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (g.head[k] as number));
          const along = d.reduce((s, x, k) => s + x * (g.axis[k] as number), 0);
          expect(Math.abs(along), `${joint}.${side} vertex ${v}`).toBeLessThanOrEqual(
            CREASE_HALF_WIDTH[joint] + 1e-6,
          );
          expect(Math.hypot(...d), `${joint}.${side} vertex ${v}`).toBeLessThan(
            CREASE_HALF_WIDTH[joint] + 0.13,
          );
        }
      }
  });

  it("leave the rest of the body alone: no crease layer reaches a vertex far from every joint", () => {
    const joints = JOINTS.flatMap((j) => SIDES.map((s) => ({ j, ...geometry(j, s) })));
    for (let l = 0; l < CREASE_LAYERS.length; l++)
      for (let v = 0; v < n; v++) {
        if (mask(l, v) === 0) continue;
        const near = joints.some(
          (g) =>
            Math.hypot(...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (g.head[k] as number))) <
            CREASE_HALF_WIDTH[g.j] * 3,
        );
        expect(near, `layer ${l} vertex ${v}`).toBe(true);
      }
  });

  it("wrap no further round the limb than the inside of the bend: no ring, whatever the limb's girth", () => {
    // A crease that reaches the skin's sides, or its back, circles the limb like a band.
    // The mask is full only where the skin faces the bend, and gone by a quarter turn.
    for (const joint of JOINTS)
      for (const side of SIDES) {
        const id = CREASE_LAYERS.findIndex((l) => l.id === creaseLayerId(joint, side));
        const g = geometry(joint, side);
        for (let v = 0; v < n; v++) {
          if (mask(id, v) < 0.05) continue;
          const facing =
            (normals[v * 3] as number) * (g.flexes[0] as number) +
            (normals[v * 3 + 1] as number) * (g.flexes[1] as number) +
            (normals[v * 3 + 2] as number) * (g.flexes[2] as number);
          // At most 63° either side of the way the joint folds: the sides and the back of the
          // limb carry none, so a crease never reads as a seam round it.
          expect(facing, `${joint}.${side} vertex ${v}`).toBeGreaterThan(0.45);
        }
      }
  });
});

describe("the crease layers' paint", () => {
  it("fold as the joint bends: nothing straight, the whole at its limit", () => {
    for (const joint of JOINTS)
      for (const side of SIDES) {
        const l = layer(creaseLayerId(joint, side));
        const at = (flex: number) => l.paint(input({ [`flex.${joint}.${side}`]: flex })).strength;
        expect(at(0)).toBe(0);
        expect(at(1)).toBeCloseTo(1, 6);
        let last = 0;
        for (let k = 1; k <= 20; k++) {
          const s = at(k / 20);
          expect(s).toBeGreaterThanOrEqual(last);
          last = s;
        }
        expect(at(0.5)).toBeGreaterThan(0.2);
        expect(at(0.5)).toBeLessThan(0.95);
      }
  });

  it("read their own joint's signal and no other", () => {
    const l = layer(creaseLayerId("elbow", "L"));
    expect(
      l.paint(input({ "flex.elbow.R": 1, "flex.knee.L": 1, "flex.wrist.L": 1 })).strength,
    ).toBe(0);
    expect(l.paint(input({ "flex.elbow.L": 1 })).strength).toBeCloseTo(1, 6);
    // No signal is a straight joint.
    expect(l.paint(input()).strength).toBe(0);
  });

  it("fold as deep as the strain the joint's skin takes asks: the knee's deeper than the elbow's", () => {
    const depth = (joint: (typeof JOINTS)[number]) =>
      layer(creaseLayerId(joint, "L")).paint(input({ [`flex.${joint}.L`]: 1 })).height;
    for (const joint of JOINTS) expect(depth(joint)).toBe(creaseDepth(joint));
    // Measured: about 25 % skin strain over the forearm's extension, over 60 % at the knee's flexion.
    expect(CREASE_STRAIN.elbow).toBeCloseTo(0.25, 6);
    expect(CREASE_STRAIN.knee).toBeGreaterThan(0.6);
    expect(creaseDepth("elbow")).toBeCloseTo(0.0028, 4);
    expect(creaseDepth("knee")).toBeCloseTo(0.0062, 4);
    expect(creaseDepth("knee")).toBeGreaterThan(creaseDepth("elbow"));
  });

  it("take up, in each groove, about the skin the strain says a crease must absorb", () => {
    // The groove's skin path is longer than its span by what it takes up. Integrate the
    // profile the shader draws (`creaseHeight`) over one crease, as long as the spacing.
    for (const joint of JOINTS) {
      const spacing = (2 * CREASE_HALF_WIDTH[joint]) / CREASE_COUNT[joint];
      const depth = creaseDepth(joint);
      const steps = 4000;
      let path = 0;
      let last = creaseHeight(depth, 1, 0);
      for (let k = 1; k <= steps; k++) {
        const h = creaseHeight(depth, 1, k / steps);
        path += Math.hypot(spacing / steps, h - last);
        last = h;
      }
      const taken = CREASE_ABSORBED * CREASE_STRAIN[joint] * spacing;
      expect((path - spacing) / taken, joint).toBeGreaterThan(0.9);
      expect((path - spacing) / taken, joint).toBeLessThan(1.1);
    }
  });

  it("have a positive size and fill the stop table", () => {
    const table = paintStopTable(CREASE_LAYERS, input({ "flex.elbow.L": 0.7 }));
    expect(table.every(Number.isFinite)).toBe(true);
    for (const l of CREASE_LAYERS) expect(l.paint(input()).size).toBeGreaterThan(0);
  });
});

describe("the crease layers in a pose", () => {
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const rig = rigData(assets);
  const rest = restBones(assets, model.evaluate(createRecipe()).control);
  const signals = (pose: string | null) =>
    jointFlexion(
      flexionRig(rest),
      rest,
      pose ? bodyPoseRotations(rig, pose) : IDENTITY_POSE(rest.names.length),
    );
  const strength = (id: string, s: Record<string, number>) => layer(id).paint(input(s)).strength;

  it("fold the elbows and knees in the flexed pose", () => {
    const s = signals("flexed");
    for (const joint of ["elbow", "knee"] as const)
      for (const side of SIDES)
        expect(strength(creaseLayerId(joint, side), s), `${joint}.${side}`).toBeGreaterThan(0.85);
  });

  it("have no layer for the wrists, whose creases read as a bracelet", () => {
    expect(CREASE_LAYERS.some((l) => l.id.includes("wrist"))).toBe(false);
  });

  it("fold nothing at the elbows in the T-pose, which straightens them", () => {
    const s = signals("tpose");
    for (const side of SIDES) expect(strength(creaseLayerId("elbow", side), s)).toBeLessThan(0.05);
  });

  it("hold the rest A-pose's elbows part way, for they are already bent about 43 degrees", () => {
    const s = signals(null);
    for (const side of SIDES) {
      const fold = strength(creaseLayerId("elbow", side), s);
      expect(fold).toBeGreaterThan(0.02);
      expect(fold).toBeLessThan(0.5);
    }
  });
});
