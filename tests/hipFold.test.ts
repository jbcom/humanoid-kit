/**
 * The hip fold (docs/ARCHITECTURE.md, "The hip fold"): a hip flexed past a
 * right angle swings the front of the thigh into the belly, and the skin there
 * must give instead of passing through. The thigh may not reach more than 2 mm
 * behind the trunk's skin at any flexion up to the hip's furthest, in every
 * body; the fold must be nothing at rest and below its onset, and must not
 * fold the mesh over itself.
 */
import { describe, expect, it } from "vitest";
import { CreaseFlaps, HipContact, PressReach, vertexNormals } from "../scripts/lib/hipContact.ts";
import { BODY_TYPES } from "../scripts/lib/skinBench.ts";
import { bodyTriangles } from "../scripts/lib/skinMeasure.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  addFold,
  addFoldNormal,
  boneMass,
  FOLD_BODIES,
  FOLD_KEYS,
  FOLD_OPENINGS,
  FOLD_ROW_TEXELS,
  FOLD_THIGH_HOLD,
  FOLD_TRUNK_REACH,
  foldSides,
  HIP_FOLD,
  type HipFold,
  hipFlexion,
  hipRotation,
  nearHips,
  renderFold,
  surfaceFold,
  TRUNK_SHARE,
} from "../src/rig/hipFold.ts";
import { solveHipFold } from "../src/rig/hipFoldSolve.ts";
import {
  bodyPoseRotations,
  IDENTITY_POSE,
  restBones,
  rigData,
  skinNormals,
  skinPositions,
} from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const names = assets.manifest.skeleton.bones.map((b) => b.name);
const tris = bodyTriangles(assets);
const model = new HumanoidModel(assets, { subdivision: 0 });

/** Both hips flexed `flexion` and opened `opening` degrees to their sides, every other bone at rest. */
function opened(flexion: number, opening: number) {
  const rotations = IDENTITY_POSE(names.length);
  rotations.set(hipRotation(flexion, opening, 1), names.indexOf("upperleg01.L") * 4);
  rotations.set(hipRotation(flexion, opening, -1), names.indexOf("upperleg01.R") * 4);
  return rotations;
}

/**
 * How much deeper (metres) the thigh may be through the belly at openings between
 * those the fold is solved at than at the solved ones, flexed 120° to 135°. The
 * coordinator's bound (2026-10-10). Measured: played on the line between two
 * openings solved apart, 8 to 31 mm at 10° in eight of the nine bodies; solved
 * with the poses between them looked at (`AJAR`), none.
 */
const OPENING_SLACK = 0.002;

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

/**
 * The most the fold may move belly skin lying farther than 3 cm from any of the
 * thighs' skin, as a share of the deepest it moves the belly. Measured
 * (2026-10-10): the press solved with the thighs together and read by flexion
 * alone, 0.95 to 1.00 in the squat and up to 0.36 in the tuck (a groove down the
 * belly's middle); let go where no thigh is and keyed by the opening, 0.00 in the
 * squat and at most 0.005 in the tuck. CHOICE: a small bound above that.
 */
const PRESS_APART = 0.05;

/**
 * The most of the crease's inverted triangles, as a share of those the bones
 * alone leave, that the fold may leave over every body and pose of the flap
 * gate. Measured (2026-10-10): the thigh pushed out alone, 0.68; the shared
 * solve, 0.50. CHOICE: between the two, so the gate holds the share and fails
 * a fold that pushes the thigh's skin past its neighbours again.
 */
const FLAP_SHARE = 0.6;

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

describe("how far a hip is flexed (hipFlexion)", () => {
  const at = (degrees: number) => hipFlexion(average.rest, flexed(degrees)).left;

  it("reads the flexion the pose put there, in degrees", () => {
    expect(at(0)).toBeCloseTo(0, 3);
    for (const degrees of [30, 90, 120, 135])
      expect(at(degrees), `${degrees}°`).toBeCloseTo(degrees, 0);
    expect(at(-30)).toBeCloseTo(-30, 0);
  });

  it("follows each hip alone", () => {
    const left = hipFlexion(average.rest, flexed(120, ["L"]));
    expect(left.left).toBeCloseTo(120, 0);
    expect(left.right).toBeCloseTo(0, 5);
    const right = hipFlexion(average.rest, flexed(90, ["R"]));
    expect(right.right).toBeCloseTo(90, 0);
    expect(right.left).toBeCloseTo(0, 5);
  });

  it("reads a hip that is opened out or twisted as not flexed at all", () => {
    const turn = (axis: 0 | 1 | 2, degrees: number) => {
      const rotations = IDENTITY_POSE(names.length);
      const q = [0, 0, 0, Math.cos((degrees * Math.PI) / 360)];
      q[axis] = Math.sin((degrees * Math.PI) / 360);
      rotations.set(q, names.indexOf("upperleg01.L") * 4);
      return hipFlexion(average.rest, rotations).left;
    };
    expect(Math.abs(turn(2, 60)), "abducted").toBeLessThan(1e-4);
    expect(Math.abs(turn(1, 120)), "twisted").toBeLessThan(1e-4);
  });

  it("reads how far each hip is opened, and hipRotation makes the hip it reads", () => {
    for (const [flexion, opening] of [
      [0, 0],
      [90, 20],
      [125, 20],
      [60, -10],
      [135, 35],
    ] as const) {
      const rotations = IDENTITY_POSE(names.length);
      rotations.set(hipRotation(flexion, opening, 1), names.indexOf("upperleg01.L") * 4);
      rotations.set(hipRotation(flexion, opening, -1), names.indexOf("upperleg01.R") * 4);
      const hips = hipFlexion(average.rest, rotations);
      for (const [f, o] of [
        [hips.left, hips.leftOpening],
        [hips.right, hips.rightOpening],
      ] as const) {
        expect(f, `${flexion}/${opening}`).toBeCloseTo(flexion, 3);
        expect(o, `${flexion}/${opening}`).toBeCloseTo(opening, 3);
      }
    }
    // The deep squat's hips are flexed 125° and opened 20° in its channels, and read so.
    const squat = hipFlexion(average.rest, bodyPoseRotations(rigData(assets), "squat"));
    expect(squat.left).toBeCloseTo(125, 1);
    expect(squat.right).toBeCloseTo(125, 1);
    expect(squat.leftOpening).toBeCloseTo(20, 1);
    expect(squat.rightOpening).toBeCloseTo(20, 1);
    // A leg swung out alone is opened, not flexed.
    const rotations = IDENTITY_POSE(names.length);
    rotations.set(hipRotation(0, 40, 1), names.indexOf("upperleg01.L") * 4);
    expect(hipFlexion(average.rest, rotations).leftOpening).toBeCloseTo(40, 3);
  });
});

describe("which hip drives a vertex's fold (foldSides)", () => {
  const sides = foldSides(average.rest, average.control, assets.skinIndex, assets.skinWeight);
  const mass = (v: number, side: "L" | "R") => {
    let m = 0;
    for (let k = 0; k < 4; k++)
      if (
        new RegExp(`^upperleg0[12]\\.${side}$`).test(
          names[assets.skinIndex[v * 4 + k] as number] as string,
        )
      )
        m += assets.skinWeight[v * 4 + k] as number;
    return m;
  };

  it("gives a thigh's skin to its own hip alone", () => {
    let left = 0;
    let right = 0;
    for (let v = 0; v < sides.length; v++) {
      if (mass(v, "L") > 0.999) {
        expect(sides[v], `left thigh vertex ${v}`).toBeCloseTo(1, 5);
        left++;
      }
      if (mass(v, "R") > 0.999) {
        expect(sides[v], `right thigh vertex ${v}`).toBeCloseTo(0, 5);
        right++;
      }
    }
    expect(left).toBeGreaterThan(100);
    expect(right).toBeGreaterThan(100);
  });

  it("gives the trunk's skin to the hip on its side, and half to each at the middle", () => {
    const hipX = average.rest.heads[names.indexOf("upperleg01.L") * 3] as number;
    let middle = 0;
    for (let v = 0; v < sides.length; v++) {
      if (mass(v, "L") + mass(v, "R") > 0) continue;
      const x = average.control[v * 3] as number;
      if (x >= hipX) expect(sides[v], `vertex ${v}`).toBe(1);
      if (x <= -hipX) expect(sides[v], `vertex ${v}`).toBe(0);
      if (Math.abs(x) < 1e-4) {
        expect(sides[v], `vertex ${v}`).toBeCloseTo(0.5, 3);
        middle++;
      }
    }
    expect(middle).toBeGreaterThan(20);
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
    // Every key of every opening, per vertex.
    const K = FOLD_OPENINGS * FOLD_KEYS;
    const vector = (seed: number) =>
      Float32Array.from({ length: K * 3 }, (_, i) => seed + i * 0.001);
    const fold: HipFold = {
      vertices: Uint32Array.of(0, 1),
      slot: Int32Array.of(0, 1, -1),
      vectors: Float32Array.from([...vector(0.1), ...vector(-0.3)]),
      normals: Float32Array.from([...vector(0.7), ...vector(-0.9)]),
      side: Float32Array.of(1, 0.2),
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
    expect(surface.data.length).toBe(2 * FOLD_ROW_TEXELS * 4);
    expect(FOLD_ROW_TEXELS).toBe(K * 2);
    // A row's side is in its first texel: the mix of its moved vertices' sides.
    expect(surface.data[3]).toBeCloseTo(0.6, 6);
    expect(surface.data[K * 8 + 3]).toBeCloseTo(0.2, 6);
    expect([...renderFold(surface).side].map((s) => +s.toFixed(6))).toEqual([0.6, 0.2]);
    const back = renderFold(surface);
    for (let key = 0; key < K; key++)
      for (let k = 0; k < 3; k++) {
        const a = fold.vectors[key * 3 + k] as number;
        const b = fold.vectors[(K + key) * 3 + k] as number;
        expect(surface.data[key * 8 + k] as number).toBeCloseTo(0.5 * a + 0.5 * b, 6);
        expect(surface.data[(K + key) * 8 + k] as number).toBeCloseTo(b, 6);
        if (key > 0) expect(surface.data[key * 8 + 3]).toBe(0);
        // The normal's change is mixed the same way, in the texel after the displacement's.
        const an = fold.normals[key * 3 + k] as number;
        const bn = fold.normals[(K + key) * 3 + k] as number;
        expect(surface.data[key * 8 + 4 + k] as number).toBeCloseTo(0.5 * an + 0.5 * bn, 6);
        expect(surface.data[(K + key) * 8 + 4 + k] as number).toBeCloseTo(bn, 6);
        expect(surface.data[key * 8 + 7]).toBe(0);
        // And read back as the fold of the render vertices.
        expect(back.vectors[(K + key) * 3 + k] as number).toBeCloseTo(b, 6);
      }
  });

  it("reads the fold between its openings by how far the hip is opened", () => {
    // One vertex: 1 cm out along x with the thighs together, 3 cm opened, at every key.
    const K = FOLD_OPENINGS * FOLD_KEYS;
    const fold: HipFold = {
      vertices: Uint32Array.of(0),
      slot: Int32Array.of(0),
      vectors: Float32Array.from({ length: K * 3 }, (_, i) =>
        i % 3 === 0 ? (i < FOLD_KEYS * 3 ? 0.01 : 0.03) : 0,
      ),
      normals: new Float32Array(K * 3),
      side: Float32Array.of(1),
    };
    const at = (opening: number) => {
      const out = new Float32Array(3);
      addFold(fold, 0, 100, opening, out, 0);
      return out[0] as number;
    };
    expect(at(0)).toBeCloseTo(0.01, 6);
    expect(at(-15)).toBeCloseTo(0.01, 6);
    expect(at(HIP_FOLD.opened / 2)).toBeCloseTo(0.02, 6);
    expect(at(HIP_FOLD.opened)).toBeCloseTo(0.03, 6);
    expect(at(HIP_FOLD.opened * 2)).toBeCloseTo(0.03, 6);
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
        expect(fold.data.length).toBe(fold.rows * FOLD_ROW_TEXELS * 4);
        const moved = fold.slot.filter((s) => s >= 0).length;
        expect(moved).toBeGreaterThanOrEqual(fold.rows);
        expect(moved).toBeLessThan(fold.slot.length / 10);
        for (const s of fold.slot) expect(s).toBeLessThan(fold.rows);
        break;
      }
      yielded++;
    }
    expect(yielded).toBe(FOLD_OPENINGS * FOLD_KEYS);
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
    expect(first.yielded).toBe(FOLD_OPENINGS * FOLD_KEYS);
    const again = solved(createRecipe({ macros: { weight: 0.8 } }));
    expect(again.yielded).toBe(0);
    expect(again.fold.rows).toBe(first.fold.rows);
    expect([...again.fold.data]).toEqual([...first.fold.data]);
    // Not the same buffers: a reply transfers its own.
    expect(again.fold.data).not.toBe(first.fold.data);
    expect(solved(createRecipe({ macros: { weight: 0.3 } })).yielded).toBe(
      FOLD_OPENINGS * FOLD_KEYS,
    );
    // Two figures solved whole, each at two openings: some seconds of one core each (docs/ARCHITECTURE.md, "Where it runs").
  }, 120_000);
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
      for (const degrees of solved)
        for (let o = 0; o < FOLD_OPENINGS; o++) {
          const opening = o * HIP_FOLD.opened;
          const { depth } = f.contact.penetration(pose(f, opened(degrees, opening), true));
          expect(depth, `${f.name} at ${degrees}°, opened ${opening}°`).toBeLessThan(0.002);
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

  it("keeps the thigh out of the belly between the openings it is solved at, as far as at the openings themselves", () => {
    // The fold is read between its openings on a line; deep in the flexion that line must not cut
    // through the belly any deeper than the solved openings leave it (`OPENING_SLACK`).
    const openings = [0, 5, 10, 15, 20];
    const solvedAt = (opening: number) =>
      Array.from({ length: FOLD_OPENINGS }, (_, o) => o * HIP_FOLD.opened).includes(opening);
    for (const f of figures) {
      const depths = new Map<number, number>();
      for (const opening of openings) {
        let deepest = 0;
        for (const flexion of [120, 125, 130, 135])
          deepest = Math.max(
            deepest,
            f.contact.penetration(pose(f, opened(flexion, opening), true)).depth,
          );
        depths.set(opening, deepest);
      }
      const keys = Math.max(...openings.filter(solvedAt).map((o) => depths.get(o) as number));
      for (const opening of openings.filter((o) => !solvedAt(o)))
        expect(depths.get(opening), `${f.name} opened ${opening}°`).toBeLessThanOrEqual(
          keys + OPENING_SLACK,
        );
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

  it("moves only the thigh's skin and the trunk's in front of the hips, and by less than the thigh is thick", () => {
    const thigh = boneMass(names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.thigh);
    const trunk = boneMass(names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.trunk);
    for (const f of figures) {
      const front = nearHips(f.rest, f.control, FOLD_TRUNK_REACH, true);
      // Skin neither part holds most of, or behind the hips, stays where the bones put it (its normal turns beside what moves).
      f.fold.vertices.forEach((v, s) => {
        let moved = false;
        const stride = FOLD_OPENINGS * FOLD_KEYS * 3;
        for (let i = 0; i < stride; i++) if (f.fold.vectors[s * stride + i] !== 0) moved = true;
        if (!moved) return;
        expect(front[v], `${f.name} vertex ${v}`).toBe(1);
        const thighs = thigh[v] as number;
        const trunks = trunk[v] as number;
        const thighSkin = thighs >= FOLD_THIGH_HOLD && thighs > trunks;
        const trunkSkin = trunks >= TRUNK_SHARE && trunks >= thighs;
        expect(thighSkin || trunkSkin, `${f.name} vertex ${v}`).toBe(true);
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

  it("presses the trunk's skin in where the thigh meets it, spread over its neighbours", () => {
    const thigh = boneMass(names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.thigh);
    const trunk = boneMass(names, assets.skinIndex, assets.skinWeight, FOLD_BODIES.trunk);
    for (const f of figures) {
      const bare = pose(f, flexed(120), false);
      const folded = pose(f, flexed(120), true);
      const outward = vertexNormals(bare, tris);
      let pressed = 0;
      let inward = 0;
      let deepest = 0;
      for (const v of f.fold.vertices) {
        if ((trunk[v] as number) < (thigh[v] as number)) continue;
        const d = [0, 1, 2].map((k) => (folded[v * 3 + k] as number) - (bare[v * 3 + k] as number));
        const size = Math.hypot(...(d as [number, number, number]));
        if (size < 0.002) continue;
        pressed++;
        deepest = Math.max(deepest, size);
        const along = d.reduce((s, x, k) => s + x * (outward[v * 3 + k] as number), 0);
        if (along < 0) inward++;
      }
      // Many vertices, not a few corners: the press is spread over the belly and the groin.
      expect(pressed, f.name).toBeGreaterThan(40);
      expect(inward / pressed, f.name).toBeGreaterThan(0.9);
      expect(deepest, f.name).toBeGreaterThan(0.005);
    }
  });

  it("presses the belly only where a thigh touches it: hardly at all farther than 3 cm from the thighs' skin, in the squat, the tuck and the seat", () => {
    const rig = rigData(assets);
    for (const f of figures) {
      const reach = new PressReach(f.rest, f.control, assets.skinIndex, assets.skinWeight, tris);
      for (const name of ["squat", "tucked", "seated"]) {
        const rotations = bodyPoseRotations(rig, name);
        const m = reach.measure(pose(f, rotations, false), pose(f, rotations, true), 0.03);
        expect(m.deepest, `${f.name}, ${name}`).toBeGreaterThan(0.003);
        expect(m.apart / m.deepest, `${f.name}, ${name}`).toBeLessThan(PRESS_APART);
      }
    }
  });

  it("adds no flaps to the crease: fewer triangles turned against their normals than the bones leave, in every body and pose that flexes the hips", () => {
    const rig = rigData(assets);
    const poses: [string, Float32Array][] = [
      ["90°", flexed(90)],
      ["120°", flexed(120)],
      ["135°", flexed(135)],
      ["one hip at 120°", flexed(120, ["L"])],
      ["seated", bodyPoseRotations(rig, "seated")],
      ["squat", bodyPoseRotations(rig, "squat")],
      ["tucked", bodyPoseRotations(rig, "tucked")],
    ];
    let bare = 0;
    let folded = 0;
    for (const f of figures) {
      const restNormals = vertexNormals(f.control, tris);
      const flaps = new CreaseFlaps(f.rest, f.control, restNormals, tris);
      const count = (rotations: Float32Array, withFold: boolean) =>
        flaps.count(
          pose(f, rotations, withFold),
          skinNormals(
            f.rest,
            rotations,
            restNormals,
            assets.skinIndex,
            assets.skinWeight,
            new Float32Array(f.control.length),
            withFold ? f.fold : undefined,
          ),
        );
      for (const [name, rotations] of poses) {
        const without = count(rotations, false);
        const with_ = count(rotations, true);
        expect(with_.inverted, `${f.name}, ${name}`).toBeLessThanOrEqual(without.inverted);
        bare += without.inverted;
        folded += with_.inverted;
      }
    }
    expect(folded / bare).toBeLessThan(FLAP_SHARE);
  });

  it("folds one hip alone, and the other at the same figure", () => {
    for (const side of ["L", "R"] as const) {
      const { depth } = average.contact.penetration(pose(average, flexed(120, [side]), true));
      expect(depth, `${side} hip alone`).toBeLessThan(0.002);
    }
  });

  it("leaves the skin the hip that is not flexed drives exactly where the bones put it, and moves every other point", () => {
    const rotations = flexed(120, ["L"]);
    const bare = pose(average, rotations, false);
    const folded = pose(average, rotations, true);
    let kept = 0;
    let moved = 0;
    average.fold.vertices.forEach((v, s) => {
      const same = [0, 1, 2].every((k) => folded[v * 3 + k] === bare[v * 3 + k]);
      if (average.fold.side[s] === 0) {
        expect(same, `vertex ${v}, the right hip's`).toBe(true);
        kept++;
      } else if (!same) moved++;
    });
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
        addFoldNormal(f.fold, v, 120, 0, delta, 0);
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
    const upright = IDENTITY_POSE(names.length);
    upright.set([0, Math.sin(r / 2), 0, Math.cos(r / 2)], root * 4);
    const { depth } = average.contact.penetration(
      pose(average, turned, true),
      pose(average, upright, false),
    );
    expect(depth).toBeLessThan(0.002);
  });
});
