/**
 * A closed canal's slit shades as one crease (#77). Closed to a line, each side's lips
 * met on the centreline at their own place front to back, and each lip vertex took its
 * normal from its own side's faces only, facing across the slit: along it the normals
 * alternated side to side, up to 175 degrees apart, a beaded rope of glints in every
 * lit and matte sheet of a woman.
 *
 * Measured on the drawn surface, as the renderer shades it, at rest and posed (the
 * lips keep their own side's hip fold, which turns their normals per side): the
 * normal of every vertex on a canal's closed loop against its nearest neighbour's on
 * the loop, which on a closed slit is the other lip's vertex beside it.
 */
import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { posedSurface, surfacePoser } from "../src/foundation/posed.ts";
import { LIP } from "../src/model/canalClosure.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import type { ReservoirSkinning } from "../src/model/reservoirSkin.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { jointChannelRotations, rigData } from "../src/rig/pose.ts";
import { adultPackData, bodyPackData } from "./fixtures.ts";

const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
  subdivision: 1,
});
const rig = rigData(model.assets);
/** The model's canal closure skinning, which it builds with its first adult figure. */
const closureOf = () =>
  (model as unknown as { adultBody: { skinning: ReservoirSkinning } | null }).adultBody?.skinning
    .closure;

/** The lithotomy position of the anatomy sheets (e2e/sheets/anatomy-poses.sheet.ts). */
const LITHOTOMY = {
  root: { Xrotation: -90 },
  "upperleg01.L": { Xrotation: -95, Yrotation: -40 },
  "upperleg01.R": { Xrotation: -95, Yrotation: 40 },
  "lowerleg01.L": { Xrotation: 90 },
  "lowerleg01.R": { Xrotation: 90 },
};

const FIGURES = {
  "f-average": { gender: 0 },
  "f-slim": { gender: 0, weight: 0.2 },
  "f-heavy": { gender: 0, weight: 1 },
  "f-elder": { gender: 0, age: 85 },
  "m-average": { gender: 1 },
} as const;

/** A drawn body's positions and normals in a pose of the sheets', or at rest. */
const POSES: Record<string, (recipe: Recipe) => { P: Float32Array; N: Float32Array }> = {
  rest: (recipe) => {
    const body = model.evaluate(recipe);
    if (body.surface !== "adult") throw new Error("not the adult surface");
    return { P: body.positions, N: body.normals };
  },
  seated: (recipe) => {
    const body = posedSurface(model, recipe, "seated");
    return { P: body.positions, N: body.normals };
  },
  squat: (recipe) => {
    const body = posedSurface(model, recipe, "squat");
    return { P: body.positions, N: body.normals };
  },
  lithotomy: (recipe) => {
    const body = surfacePoser(model, recipe)(jointChannelRotations(rig, LITHOTOMY));
    return { P: body.positions, N: body.normals };
  },
};

describe("a closed canal's slit", { timeout: 900_000 }, () => {
  for (const [name, macros] of Object.entries(FIGURES))
    for (const [pose, draw] of Object.entries(POSES))
      it(`shades as one crease, each lip's normal with the lip beside it: ${name}, ${pose}`, () => {
        const { P, N } = draw(createRecipe({ macros: { age: 30, ...macros } }));
        const closure = closureOf();
        if (!closure) throw new Error("no canal closure on the adult surface");
        const loops = new Map<number, number[]>();
        for (let v = 0; v < P.length / 3; v++) {
          const c = closure.canal[v] as number;
          if (c < 0 || (closure.follows[v] as number) < LIP) continue;
          loops.set(c, [...(loops.get(c) ?? []), v]);
        }
        // The vaginal and anal openings, so the check is not vacuous.
        expect(loops.size).toBe(2);
        const worst: Record<string, number> = {};
        for (const [c, vs] of loops) {
          let far = 0;
          for (const v of vs) {
            let near = -1;
            let d = Number.POSITIVE_INFINITY;
            for (const u of vs) {
              if (u === v) continue;
              const e = Math.hypot(
                (P[u * 3] as number) - (P[v * 3] as number),
                (P[u * 3 + 1] as number) - (P[v * 3 + 1] as number),
                (P[u * 3 + 2] as number) - (P[v * 3 + 2] as number),
              );
              if (e < d) [near, d] = [u, e];
            }
            const dot = [0, 1, 2].reduce(
              (s, k) => s + (N[v * 3 + k] as number) * (N[near * 3 + k] as number),
              0,
            );
            far = Math.max(far, (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI);
          }
          worst[`canal ${c} (${vs.length} lip vertices)`] = Math.round(far);
        }
        console.log(name, pose, worst);
        for (const [canal, deg] of Object.entries(worst))
          expect(
            deg,
            `${name}, ${pose}, ${canal}: degrees between neighbouring lips' normals`,
          ).toBeLessThan(30);
      });
});
