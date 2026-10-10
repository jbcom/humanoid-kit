/**
 * The hip fold (docs/ARCHITECTURE.md, "The hip fold"): a hip flexed past a
 * right angle swings the front of the thigh into the belly, and the skin there
 * must give instead of passing through. The thigh may not reach more than 2 mm
 * behind the trunk's skin at any flexion up to the hip's furthest, in every
 * body; the fold must be nothing at rest and below its onset, and must not
 * fold the mesh over itself.
 */
import { describe, expect, it } from "vitest";
import { HipContact } from "../scripts/lib/hipContact.ts";
import { BODY_TYPES } from "../scripts/lib/skinBench.ts";
import { bodyTriangles } from "../scripts/lib/skinMeasure.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  addFoldNormal,
  boneMass,
  FOLD_BODIES,
  FOLD_KEYS,
  HIP_FOLD,
  type HipFold,
  hipPose,
  surfaceFold,
} from "../src/rig/hipFold.ts";
import { solveHipFold } from "../src/rig/hipFoldSolve.ts";
import { IDENTITY_POSE, restBones, skinPositions } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const names = assets.manifest.skeleton.bones.map((b) => b.name);
const tris = bodyTriangles(assets);
const model = new HumanoidModel(assets, { subdivision: 0 });

/** Both hips flexed `degrees` (the knee up), every other bone at rest. */
function flexed(degrees: number, sides: ("L" | "R")[] = ["L", "R"]) {
  const rotations = IDENTITY_POSE(names.length);
  const r = (-degrees * Math.PI) / 360;
  for (const s of sides)
    rotations.set([Math.sin(r), 0, 0, Math.cos(r)], names.indexOf(`upperleg01.${s}`) * 4);
  return rotations;
}

/**
 * The figure battery's extremes (docs/evidence/BATTERY.md, the `cross` set) that
 * the bench's five lack: deformation fails first on heavy and old bodies.
 */
const BATTERY_EXTREMES: typeof BODY_TYPES = {
  "slim woman": { macros: { age: 25, gender: 0, weight: 0, muscle: 0.3 } },
  "heavy woman": { macros: { age: 25, gender: 0, weight: 1, muscle: 0.3 } },
  "heavy man": { macros: { age: 25, gender: 1, weight: 1, muscle: 0.3 } },
  "elder woman": { macros: { age: 75, gender: 0 } },
};

const figures = Object.entries({ ...BODY_TYPES, ...BATTERY_EXTREMES }).map(([name, recipe]) => {
  const control = model.evaluate(createRecipe(recipe)).control;
  const rest = restBones(assets, control);
  const fold = solveHipFold(rest, control, assets.skinIndex, assets.skinWeight, tris);
  const contact = new HipContact(assets, rest, control, tris);
  return { name, control, rest, fold, contact };
});
const average = figures[0] as (typeof figures)[number];

const pose = (
  f: (typeof figures)[number],
  rotations: Float32Array,
  withFold: boolean,
): Float32Array =>
  skinPositions(
    f.rest,
    rotations,
    f.control,
    assets.skinIndex,
    assets.skinWeight,
    new Float32Array(f.control.length),
    withFold ? f.fold : undefined,
  );

describe("how far a hip is flexed (hipPose)", () => {
  const at = (degrees: number, bone = "upperleg01.L") =>
    hipPose(average.rest, flexed(degrees)).flexion[names.indexOf(bone)] as number;

  it("reads the flexion the pose put there, in degrees", () => {
    expect(at(0)).toBeCloseTo(0, 3);
    for (const degrees of [30, 90, 120, 135])
      expect(at(degrees), `${degrees}°`).toBeCloseTo(degrees, 0);
    expect(at(-30)).toBeCloseTo(-30, 0);
  });

  it("follows each hip alone, and the lower half of the thigh follows its upper half", () => {
    const left = hipPose(average.rest, flexed(120, ["L"]));
    const flex = (bone: string) => left.flexion[names.indexOf(bone)] as number;
    expect(flex("upperleg01.L")).toBeCloseTo(120, 0);
    expect(flex("upperleg02.L")).toBe(flex("upperleg01.L"));
    expect(flex("upperleg01.R")).toBeCloseTo(0, 5);
    expect(flex("upperleg02.R")).toBeCloseTo(0, 5);
    expect(left.thigh[names.indexOf("upperleg02.R")]).toBe(1);
    expect(left.thigh[names.indexOf("lowerleg01.L")]).toBe(0);
  });

  it("reads a hip that is opened out or twisted as not flexed at all", () => {
    const turn = (axis: 0 | 1 | 2, degrees: number) => {
      const rotations = IDENTITY_POSE(names.length);
      const q = [0, 0, 0, Math.cos((degrees * Math.PI) / 360)];
      q[axis] = Math.sin((degrees * Math.PI) / 360);
      rotations.set(q, names.indexOf("upperleg01.L") * 4);
      return hipPose(average.rest, rotations).flexion[names.indexOf("upperleg01.L")] as number;
    };
    expect(Math.abs(turn(2, 60)), "abducted").toBeLessThan(4);
    expect(Math.abs(turn(1, 120)), "twisted").toBeLessThan(1);
  });
});

describe("the thigh through the belly, without the fold", () => {
  it("is clear at rest and passes through the belly at 120°, as the fold exists to correct", () => {
    for (const f of figures) {
      expect(f.contact.penetration(f.control), `${f.name} at rest`).toEqual({ depth: 0, count: 0 });
      const through = f.contact.penetration(pose(f, flexed(120), false));
      expect(through.depth, `${f.name} at 120°`).toBeGreaterThan(0.01);
      expect(through.count, `${f.name} at 120°`).toBeGreaterThan(20);
    }
  });
});

describe("the fold on the rendered surface (surfaceFold)", () => {
  it("mixes the control vertices' folds as the stencil mixes their positions, once per surface vertex", () => {
    const vector = (seed: number) =>
      Float32Array.from({ length: FOLD_KEYS * 3 }, (_, i) => seed + i * 0.001);
    const fold: HipFold = {
      vertices: Uint32Array.of(0, 1),
      slot: Int32Array.of(0, 1, -1),
      vectors: Float32Array.from([...vector(0.1), ...vector(-0.3)]),
      normals: Float32Array.from([...vector(0.7), ...vector(-0.9)]),
    };
    // Surface vertex 0 is half of control 0 and half of control 1; 1 is control 2 (not moved); 2 is control 1.
    const stencil = {
      offsets: Uint32Array.of(0, 2, 3, 4),
      src: Uint32Array.of(0, 1, 2, 1),
      weights: Float32Array.of(0.5, 0.5, 1, 1),
    };
    const surface = surfaceFold(fold, stencil, Uint32Array.of(0, 0, 1, 2, 2));
    expect(surface.rows).toBe(2);
    expect([...surface.slot]).toEqual([0, 0, -1, 1, 1]);
    expect(surface.data.length).toBe(2 * FOLD_KEYS * 8);
    for (let key = 0; key < FOLD_KEYS; key++)
      for (let k = 0; k < 3; k++) {
        const a = fold.vectors[key * 3 + k] as number;
        const b = fold.vectors[(FOLD_KEYS + key) * 3 + k] as number;
        expect(surface.data[key * 8 + k] as number).toBeCloseTo(0.5 * a + 0.5 * b, 6);
        expect(surface.data[(FOLD_KEYS + key) * 8 + k] as number).toBeCloseTo(b, 6);
        expect(surface.data[key * 8 + 3]).toBe(0);
        // The normal's change is mixed the same way, in the texel after the displacement's.
        const an = fold.normals[key * 3 + k] as number;
        const bn = fold.normals[(FOLD_KEYS + key) * 3 + k] as number;
        expect(surface.data[key * 8 + 4 + k] as number).toBeCloseTo(0.5 * an + 0.5 * bn, 6);
        expect(surface.data[(FOLD_KEYS + key) * 8 + 4 + k] as number).toBeCloseTo(bn, 6);
        expect(surface.data[key * 8 + 7]).toBe(0);
      }
  });

  it("is made by the model a flexion at a time, on the surface the figure is drawn on, and moves skin by the hips alone", () => {
    const steps = model.hipFold(createRecipe());
    let yielded = 0;
    for (;;) {
      const step = steps.next();
      if (step.done) {
        const { surface, fold } = step.value;
        expect(surface).toBe("base");
        expect(fold.rows).toBeGreaterThan(50);
        expect(fold.data.length).toBe(fold.rows * FOLD_KEYS * 8);
        const moved = fold.slot.filter((s) => s >= 0).length;
        expect(moved).toBeGreaterThanOrEqual(fold.rows);
        expect(moved).toBeLessThan(fold.slot.length / 10);
        for (const s of fold.slot) expect(s).toBeLessThan(fold.rows);
        break;
      }
      yielded++;
    }
    expect(yielded).toBe(FOLD_KEYS);
  });

  it("solves a shape once: asked again for the same figure it answers at once with the same fold, and a different one is solved", () => {
    const solved = (recipe: ReturnType<typeof createRecipe>) => {
      const steps = model.hipFold(recipe);
      let yielded = 0;
      for (;;) {
        const step = steps.next();
        if (step.done) return { yielded, fold: step.value.fold };
        yielded++;
      }
    };
    const first = solved(createRecipe({ macros: { weight: 0.8 } }));
    expect(first.yielded).toBe(FOLD_KEYS);
    const again = solved(createRecipe({ macros: { weight: 0.8 } }));
    expect(again.yielded).toBe(0);
    expect(again.fold.rows).toBe(first.fold.rows);
    expect([...again.fold.data]).toEqual([...first.fold.data]);
    // Not the same buffers: a reply transfers its own.
    expect(again.fold.data).not.toBe(first.fold.data);
    expect(solved(createRecipe({ macros: { weight: 0.3 } })).yielded).toBe(FOLD_KEYS);
  });
});

describe("the hip fold", () => {
  it("keeps the thigh less than 2 mm behind the belly's skin at the flexions it is solved at, and halfway between, in every body", () => {
    // The solved flexions are `HIP_FOLD.step` apart, and the solver looks at each halfway back too.
    const solved: number[] = [];
    for (
      let degrees = HIP_FOLD.from + HIP_FOLD.step;
      degrees <= HIP_FOLD.to;
      degrees += HIP_FOLD.step
    )
      solved.push(degrees, degrees - HIP_FOLD.step / 2);
    for (const f of figures)
      for (const degrees of solved) {
        const { depth } = f.contact.penetration(pose(f, flexed(degrees), true));
        expect(depth, `${f.name} at ${degrees}°`).toBeLessThan(0.002);
      }
  });

  it("keeps the thigh less than 8 mm behind the belly's skin at any flexion, in every body", () => {
    // Between the flexions looked at, what the straight line from one fold to the next leaves.
    for (const f of figures)
      for (const degrees of [37, 47, 53, 63, 77, 87, 93, 101, 111, 123, 127, 131, 137, 139]) {
        const { depth } = f.contact.penetration(pose(f, flexed(degrees), true));
        expect(depth, `${f.name} at ${degrees}°`).toBeLessThan(0.008);
      }
  });

  it("changes nothing at rest, or before the fold starts", () => {
    for (const f of figures)
      for (const degrees of [0, HIP_FOLD.from]) {
        const a = pose(f, flexed(degrees), false);
        const b = pose(f, flexed(degrees), true);
        let worst = 0;
        for (let i = 0; i < a.length; i++)
          worst = Math.max(worst, Math.abs((a[i] as number) - (b[i] as number)));
        expect(worst, `${f.name} at ${degrees}°`).toBe(0);
      }
  });

  it("moves only the skin the thigh holds most of, and by less than the thigh is thick", () => {
    const thigh = boneMass(names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.thigh);
    const trunk = boneMass(names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.trunk);
    for (const f of figures) {
      // Skin the trunk holds most of, or the thigh a quarter of, stays where the bones put it (its normal turns beside what moves).
      f.fold.vertices.forEach((v, s) => {
        let moved = false;
        for (let i = 0; i < FOLD_KEYS * 3; i++)
          if (f.fold.vectors[s * FOLD_KEYS * 3 + i] !== 0) moved = true;
        if (!moved) return;
        expect(thigh[v] as number, `${f.name} vertex ${v}`).toBeGreaterThanOrEqual(0.25);
        expect(thigh[v] as number, `${f.name} vertex ${v}`).toBeGreaterThan(trunk[v] as number);
      });
      expect(f.fold.vertices.length, f.name).toBeGreaterThan(50);
      let furthest = 0;
      for (let i = 0; i < f.fold.vectors.length; i += 3)
        furthest = Math.max(
          furthest,
          Math.hypot(
            f.fold.vectors[i] as number,
            f.fold.vectors[i + 1] as number,
            f.fold.vectors[i + 2] as number,
          ),
        );
      expect(furthest, f.name).toBeGreaterThan(0.03);
      expect(furthest, f.name).toBeLessThan(0.2);
    }
  });

  it("folds one hip alone, and the other at the same figure", () => {
    for (const side of ["L", "R"] as const) {
      const { depth } = average.contact.penetration(pose(average, flexed(120, [side]), true));
      expect(depth, `${side} hip alone`).toBeLessThan(0.002);
    }
  });

  it("leaves the skin of a hip that is not flexed exactly where the bones put it, and moves every other point", () => {
    const rotations = flexed(120, ["L"]);
    const bare = pose(average, rotations, false);
    const folded = pose(average, rotations, true);
    const right = (v: number) => {
      let thighs = 0;
      let rightOnes = 0;
      for (let k = 0; k < 4; k++) {
        const bone = names[assets.skinIndex[v * 4 + k] as number] as string;
        if (!/^upperleg0[12]\./.test(bone)) continue;
        thighs += assets.skinWeight[v * 4 + k] as number;
        if (bone.endsWith(".R")) rightOnes += assets.skinWeight[v * 4 + k] as number;
      }
      return thighs > 0 && rightOnes === thighs;
    };
    let kept = 0;
    let moved = 0;
    for (const v of average.fold.vertices) {
      const same = [0, 1, 2].every((k) => folded[v * 3 + k] === bare[v * 3 + k]);
      if (right(v)) {
        expect(same, `right thigh vertex ${v}`).toBe(true);
        kept++;
      } else if (!same) moved++;
    }
    for (let i = 0; i < folded.length; i++) expect(Number.isFinite(folded[i])).toBe(true);
    expect(kept).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(20);
  });

  it("turns the skin's normal where the fold has changed its shape, to the displaced mesh's own", () => {
    /** Each vertex's unit normal on `positions`, its triangles' weighted by area. */
    const normalsOf = (positions: Float32Array) => {
      const sum = new Float64Array(positions.length);
      for (let t = 0; t < tris.length; t += 3) {
        const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]] as [number, number, number];
        const u = [0, 1, 2].map(
          (k) => (positions[b * 3 + k] as number) - (positions[a * 3 + k] as number),
        );
        const w = [0, 1, 2].map(
          (k) => (positions[c * 3 + k] as number) - (positions[a * 3 + k] as number),
        );
        const cross = [
          (u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
          (u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
          (u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
        ];
        for (const v of [a, b, c])
          for (let k = 0; k < 3; k++)
            sum[v * 3 + k] = (sum[v * 3 + k] as number) + (cross[k] as number);
      }
      for (let v = 0; v < sum.length / 3; v++) {
        const l =
          Math.hypot(sum[v * 3] as number, sum[v * 3 + 1] as number, sum[v * 3 + 2] as number) || 1;
        for (let k = 0; k < 3; k++) sum[v * 3 + k] = (sum[v * 3 + k] as number) / l;
      }
      return sum;
    };
    const angle = (a: ArrayLike<number>, b: ArrayLike<number>, v: number) =>
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (a[v * 3] as number) * (b[v * 3] as number) +
              (a[v * 3 + 1] as number) * (b[v * 3 + 1] as number) +
              (a[v * 3 + 2] as number) * (b[v * 3 + 2] as number),
          ),
        ),
      ) *
        180) /
      Math.PI;
    for (const f of [average, figures[3] as (typeof figures)[number]]) {
      const bare = normalsOf(pose(f, flexed(120), false));
      const folded = normalsOf(pose(f, flexed(120), true));
      // What the shader does: the skinned normal plus the fold's change, made a unit vector again.
      const shaded = Float64Array.from(bare);
      let turned = 0;
      for (const v of f.fold.vertices) {
        const delta = new Float32Array(3);
        addFoldNormal(f.fold, v, 120, delta, 0);
        let l = 0;
        for (let k = 0; k < 3; k++) {
          shaded[v * 3 + k] = (bare[v * 3 + k] as number) + (delta[k] as number);
          l += (shaded[v * 3 + k] as number) ** 2;
        }
        for (let k = 0; k < 3; k++)
          shaded[v * 3 + k] = (shaded[v * 3 + k] as number) / Math.sqrt(l);
        // The bones' normal and the displaced mesh's differ where the fold changed the shape...
        if (angle(bare, folded, v) > 30) turned++;
        // ... and the shader's is the displaced mesh's.
        expect(angle(shaded, folded, v), `${f.name} vertex ${v}`).toBeLessThan(1);
      }
      expect(turned, f.name).toBeGreaterThan(20);
    }
  });

  it("turns with the figure's root", () => {
    // The fold is made in the figure's own axes: a root turned about the vertical turns it with the body.
    const root = names.indexOf("root");
    const turned = flexed(120);
    const r = Math.PI / 3;
    turned.set([0, Math.sin(r / 2), 0, Math.cos(r / 2)], root * 4);
    const { depth } = average.contact.penetration(pose(average, turned, true));
    expect(depth).toBeLessThan(0.002);
  });
});
