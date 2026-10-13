/**
 * The knee fold (docs/ARCHITECTURE.md, "The knee fold"): a knee bent to a
 * right angle collapses the skin at its back through itself, and bent past it
 * lays the calf into the back of the thigh and through it. The skin there must
 * fold smooth at a right angle and give where calf meets thigh: no triangle
 * of the knee turned over at 90°, far fewer at 135°, and the calf less than
 * 2 mm through the thigh (or the thigh through the calf) at every flexion the
 * fold is solved at, in every body.
 */
import { describe, expect, it } from "vitest";
import { Flaps, KneeContact, kneeZone, vertexNormals } from "../scripts/lib/foldContact.ts";
import { BODY_TYPES } from "../scripts/lib/skinBench.ts";
import { bodyTriangles } from "../scripts/lib/skinMeasure.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { solveKneeFold } from "../src/rig/kneeFoldSolve.ts";
import { IDENTITY_POSE, restBones, skinNormals, skinPositions } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const names = assets.manifest.skeleton.bones.map((b) => b.name);
const tris = bodyTriangles(assets);
const model = new HumanoidModel(assets, { subdivision: 0 });

/** The figure battery's extremes beside the bench's five, as the hip fold's tests take them. */
const BATTERY_EXTREMES: typeof BODY_TYPES = {
  "slim woman": { macros: { age: 25, gender: 0, weight: 0, muscle: 0.3 } },
  "heavy woman": { macros: { age: 25, gender: 0, weight: 1, muscle: 0.3 } },
  "heavy man": { macros: { age: 25, gender: 1, weight: 1, muscle: 0.3 } },
  "elder woman": { macros: { age: 75, gender: 0 } },
};

const figures = Object.entries({ ...BODY_TYPES, ...BATTERY_EXTREMES }).map(([name, recipe]) => {
  const control = model.evaluate(createRecipe(recipe)).control;
  const rest = restBones(assets, control);
  const restNormals = vertexNormals(control, tris);
  return {
    name,
    control,
    rest,
    restNormals,
    fold: solveKneeFold(rest, control, assets.skinIndex, assets.skinWeight, tris),
    contact: new KneeContact(assets, rest, control, tris),
    flaps: new Flaps(control, restNormals, tris, kneeZone(rest, control)),
  };
});
type Figure = (typeof figures)[number];

/** Both knees bent `degrees` (the heel back), every other bone at rest. */
function bent(degrees: number): Float32Array {
  const rotations = IDENTITY_POSE(names.length);
  const r = (degrees * Math.PI) / 360;
  for (const s of ["L", "R"])
    rotations.set([Math.sin(r), 0, 0, Math.cos(r)], names.indexOf(`lowerleg01.${s}`) * 4);
  return rotations;
}

/** The body posed, as it is drawn: the bones, and the knee's fold (none with `bare`). */
const posed = (f: Figure, rotations: Float32Array, bare = false) =>
  skinPositions(
    f.rest,
    rotations,
    f.control,
    assets.skinIndex,
    assets.skinWeight,
    new Float32Array(f.control.length),
    bare ? [] : [f.fold],
  );
const normals = (f: Figure, rotations: Float32Array, bare = false) =>
  skinNormals(
    f.rest,
    rotations,
    f.restNormals,
    assets.skinIndex,
    assets.skinWeight,
    new Float32Array(f.control.length),
    bare ? [] : [f.fold],
  );
/** Its knee's flaps. */
const flaps = (f: Figure, rotations: Float32Array, bare = false) =>
  f.flaps.count(posed(f, rotations, bare), normals(f, rotations, bare));

/**
 * The most of the knee's inverted triangles at 135°, as a share of those the
 * bones alone leave, over every body. Measured bare (2026-10-10): 48 to 72 a
 * body, 540 in all. CHOICE: a quarter; the back of a knee bent so far is a real
 * crease, pressed shut, and some of its skin may turn into it, but most of what
 * the bones crumple must come out.
 */
const INVERTED_SHARE_135 = 0.25;
/** The bones alone at 135°, over the nine bodies (2026-10-10), which the share is of. */
const BARE_INVERTED_135 = 540;

describe("the knee fold", () => {
  it("leaves no triangle of the knee turned over at a right angle, in every body", () => {
    // Bare (2026-10-10): 4 (tall lean man) to 40 (short full woman).
    for (const f of figures) expect(flaps(f, bent(90)).inverted, f.name).toBe(0);
  });

  it("leaves under a quarter of the knee's turned triangles at 135°, and fewer in every body", () => {
    let bare = 0;
    let total = 0;
    for (const f of figures) {
      const without = flaps(f, bent(135), true).inverted;
      const { inverted } = flaps(f, bent(135));
      expect(inverted, f.name).toBeLessThan(without);
      bare += without;
      total += inverted;
    }
    expect(bare).toBe(BARE_INVERTED_135);
    expect(total).toBeLessThanOrEqual(INVERTED_SHARE_135 * BARE_INVERTED_135);
  });

  it("keeps the calf and the thigh less than 2 mm through each other at every flexion it is solved at, in every body", () => {
    // Bare (2026-10-10): 9 to 24 mm at 90° (the back of the knee through itself), 18 to 51 mm from 120° to 150°.
    for (const f of figures)
      for (const degrees of [90, 105, 120, 135, 150]) {
        const rotations = bent(degrees);
        const { depth } = f.contact.penetration(posed(f, rotations), rotations);
        expect(depth, `${f.name} at ${degrees}°`).toBeLessThan(0.002);
      }
  });
});
