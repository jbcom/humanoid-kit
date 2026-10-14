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
import { CANAL_DARK, LIP } from "../src/model/canalClosure.ts";
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

describe("a closed canal's crease shade (canalShade)", { timeout: 600_000 }, () => {
  /** The largest shade on each canal's lips, by canal. */
  const onLips = (recipe: ReturnType<typeof createRecipe>) => {
    const body = model.evaluate(recipe);
    const closure = closureOf();
    if (!closure) throw new Error("no canal closure on the adult surface");
    const most = new Map<number, number>();
    for (let v = 0; v < body.canalShade.length; v++) {
      const c = closure.canal[v] as number;
      if (c < 0 || (closure.follows[v] as number) < LIP) continue;
      most.set(c, Math.max(most.get(c) ?? 0, body.canalShade[v] as number));
    }
    return { most, shade: body.canalShade };
  };

  it("darkens a woman's closed vulva and anus along their lips, a line, not a patch", () => {
    const { most, shade } = onLips(createRecipe({ macros: { age: 30, gender: 0 } }));
    expect(most.size).toBe(2);
    for (const [c, s] of most) expect(s, `canal ${c}`).toBeCloseTo(CANAL_DARK.lips, 3);
    // Most of the skin round them is barely shaded: the dark is the line where the lips meet.
    // (The canals' walls, inside, are darker still and not skin: `walls` below.)
    const closure = closureOf();
    const skin = [...shade].filter((_, v) => (closure?.canal[v] ?? -1) >= 0);
    const shaded = skin.filter((s) => s > CANAL_DARK.lips / 2).length;
    const touched = skin.filter((s) => s > 0).length;
    expect(shaded).toBeLessThan(touched / 2);
  });

  it("darkens the canals' own walls more than their lips", () => {
    const body = model.evaluate(createRecipe({ macros: { age: 30, gender: 0 } }));
    const walls = model.adultSurface()?.canals.of;
    if (!walls) throw new Error("no canals on the adult surface");
    let n = 0;
    walls.forEach((c, v) => {
      if (c < 0) return;
      n++;
      expect(body.canalShade[v] as number).toBeCloseTo(CANAL_DARK.walls, 3);
    });
    expect(n).toBeGreaterThan(0);
  });

  it("leaves a man's undrawn vaginal loop as skin, and shades his anus", () => {
    const { most } = onLips(createRecipe({ macros: { age: 30, gender: 1 } }));
    const values = [...most.values()].sort((a, b) => a - b);
    expect(values[0]).toBe(0);
    expect(values[1]).toBeCloseTo(CANAL_DARK.lips, 3);
  });

  it("is none on a child, whose surface is the base body's", () => {
    const body = model.evaluate(createRecipe({ macros: { age: 8 } }));
    expect(body.surface).toBe("base");
    expect(body.canalShade.every((s) => s === 0)).toBe(true);
  });
});
