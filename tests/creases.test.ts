/**
 * Joint crease detail layers (src/surface/regions/creases.ts): where they lie
 * on the base mesh, which side of the joint each folds on, and how the flexion
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
  type DetailLayer,
  paintStopTable,
  type SkinPaintInput,
} from "../src/surface/layers.ts";
import {
  CREASE_HALF_WIDTH,
  CREASE_HEIGHT_PER_STRAIN,
  CREASE_LAYERS,
  CREASE_STRAIN,
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

const JOINTS = ["elbow", "knee", "wrist"] as const;
const SIDES = ["L", "R"] as const;
const ROLES = ["flexor", "extensor"] as const;

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
  it("are a flexor and an extensor layer for each side of the elbows, knees and wrists, after the rest layers", () => {
    expect(CREASE_LAYERS.map((l) => l.id)).toEqual(
      JOINTS.flatMap((j) => SIDES.flatMap((s) => ROLES.map((r) => creaseLayerId(j, s, r)))),
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
    for (const side of SIDES)
      for (const role of ROLES) {
        const id = CREASE_LAYERS.findIndex((l) => l.id === creaseLayerId(joint, side, role));
        const g = geometry(joint, side);
        const half = CREASE_HALF_WIDTH[joint];

        it(`put the ${side} ${joint}'s ${role} creases across the joint, on the ${role === "flexor" ? "inside" : "outside"} of the bend`, () => {
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
          const mean = facing / covered.length;
          if (role === "flexor") expect(mean).toBeGreaterThan(0.3);
          else expect(mean).toBeLessThan(-0.3);
        });

        it(`run the ${side} ${joint}'s ${role} coordinate along the limb, from one end of the window to the other`, () => {
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

  it("never lay flexor and extensor creases on the same skin at once", () => {
    for (const joint of JOINTS)
      for (const side of SIDES) {
        const f = CREASE_LAYERS.findIndex((l) => l.id === creaseLayerId(joint, side, "flexor"));
        const e = CREASE_LAYERS.findIndex((l) => l.id === creaseLayerId(joint, side, "extensor"));
        for (let v = 0; v < n; v++) expect(mask(f, v) + mask(e, v)).toBeLessThanOrEqual(1.001);
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
});

describe("the crease layers' paint", () => {
  it("fold the flexor side as the joint bends: nothing straight, the whole at its limit", () => {
    for (const joint of JOINTS)
      for (const side of SIDES) {
        const l = layer(creaseLayerId(joint, side, "flexor"));
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

  it("wrinkle the extensor side as the joint straightens, and smooth it as it bends", () => {
    for (const joint of JOINTS)
      for (const side of SIDES) {
        const l = layer(creaseLayerId(joint, side, "extensor"));
        const at = (flex: number) => l.paint(input({ [`flex.${joint}.${side}`]: flex })).strength;
        expect(at(0)).toBeCloseTo(1, 6);
        expect(at(1)).toBe(0);
        let last = 1;
        for (let k = 1; k <= 20; k++) {
          const s = at(k / 20);
          expect(s).toBeLessThanOrEqual(last);
          last = s;
        }
      }
  });

  it("read their own joint's signal and no other", () => {
    const l = layer(creaseLayerId("elbow", "L", "flexor"));
    expect(
      l.paint(input({ "flex.elbow.R": 1, "flex.knee.L": 1, "flex.wrist.L": 1 })).strength,
    ).toBe(0);
    expect(l.paint(input({ "flex.elbow.L": 1 })).strength).toBeCloseTo(1, 6);
    // No signal is a straight joint.
    expect(l.paint(input()).strength).toBe(0);
    expect(layer(creaseLayerId("elbow", "L", "extensor")).paint(input()).strength).toBeCloseTo(
      1,
      6,
    );
  });

  it("scale each fold's depth with the strain the joint's skin takes: the knee's over the elbow's", () => {
    const depth = (joint: (typeof JOINTS)[number], role: (typeof ROLES)[number]) =>
      layer(creaseLayerId(joint, "L", role)).paint(input({ [`flex.${joint}.L`]: 1 })).height;
    for (const joint of JOINTS)
      expect(depth(joint, "flexor")).toBeCloseTo(
        CREASE_HEIGHT_PER_STRAIN * CREASE_STRAIN[joint],
        9,
      );
    // Measured: about 25 % skin strain over the forearm's extension, over 60 % at the knee's flexion.
    expect(CREASE_STRAIN.elbow).toBeCloseTo(0.25, 6);
    expect(CREASE_STRAIN.knee).toBeGreaterThan(0.6);
    expect(depth("knee", "flexor") / depth("elbow", "flexor")).toBeCloseTo(
      CREASE_STRAIN.knee / CREASE_STRAIN.elbow,
      6,
    );
    // Folds are deeper than the stretched side's wrinkles.
    for (const joint of JOINTS)
      expect(depth(joint, "extensor")).toBeLessThan(depth(joint, "flexor"));
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

  it("fold the elbows and knees in the flexed pose, and leave their backs smooth", () => {
    const s = signals("flexed");
    for (const joint of ["elbow", "knee"] as const)
      for (const side of SIDES) {
        expect(
          strength(creaseLayerId(joint, side, "flexor"), s),
          `${joint}.${side}`,
        ).toBeGreaterThan(0.85);
        expect(strength(creaseLayerId(joint, side, "extensor"), s)).toBeLessThan(0.1);
      }
  });

  it("wrinkle the backs of the elbows in the T-pose, which straightens them, and fold nothing", () => {
    const s = signals("tpose");
    for (const side of SIDES) {
      expect(strength(creaseLayerId("elbow", side, "flexor"), s)).toBeLessThan(0.05);
      expect(strength(creaseLayerId("elbow", side, "extensor"), s)).toBeGreaterThan(0.9);
    }
  });

  it("hold the rest A-pose's elbows part way, for they are already bent about 43 degrees", () => {
    const s = signals(null);
    for (const side of SIDES) {
      const flexor = strength(creaseLayerId("elbow", side, "flexor"), s);
      expect(flexor).toBeGreaterThan(0.02);
      expect(flexor).toBeLessThan(0.5);
    }
  });
});
