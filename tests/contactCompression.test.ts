/**
 * Contact compression (docs/ARCHITECTURE.md, "Contact compression"): where a
 * joint fold presses one part's skin against another's (the thigh on the
 * belly, the calf on the thigh), the flesh it presses in must go somewhere, and
 * goes out to the sides of the contact. Measured as the flesh the skin encloses
 * round the joint (`jointVolume`), the folds may take no more than
 * `VOLUME_SLACK` of what the bones leave there, at the hips and the knees, in
 * every body and pose that bends them; and seated, where the bones leave the
 * knee within the foundation's band, it stays within it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BODY_TYPES } from "../scripts/lib/skinBench.ts";
import { bodyTriangles } from "../scripts/lib/skinMeasure.ts";
import { jointVolume, VOLUME_BAND, VOLUME_JOINTS } from "../src/foundation/invariants.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { SolidWinding } from "../src/rig/contact.ts";
import { solveHipFold } from "../src/rig/hipFoldSolve.ts";
import type { JointFold } from "../src/rig/jointFold.ts";
import { solveKneeFold } from "../src/rig/kneeFoldSolve.ts";
import {
  bodyPoseRotations,
  posedBoneHeads,
  type RestBones,
  restBones,
  rigData,
  skinPositions,
} from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const tris = bodyTriangles(assets);
const model = new HumanoidModel(assets, { subdivision: 0 });
const rig = rigData(assets);

/** The battery's extremes beside the bench's five, as the folds' tests take them. */
const BATTERY_EXTREMES: typeof BODY_TYPES = {
  "slim woman": { macros: { age: 25, gender: 0, weight: 0, muscle: 0.3 } },
  "heavy woman": { macros: { age: 25, gender: 0, weight: 1, muscle: 0.3 } },
  "heavy man": { macros: { age: 25, gender: 1, weight: 1, muscle: 0.3 } },
  "elder woman": { macros: { age: 75, gender: 0 } },
};

/** The poses that bend the hips and the knees together: seated (90°, 90°), tucked (120°, 130°), the squat (125°, 150°). */
const POSES = ["seated", "tucked", "squat"] as const;
/** The joints the folds press at. */
const JOINTS = VOLUME_JOINTS.filter((j) => /^(hip|knee)\./.test(j.name));

/**
 * How much of the flesh the bones leave round a joint the folds may take, as a
 * share of it. CHOICE: 0.01, above the measure's own noise (a body moved
 * rigidly reads within 0.008 of itself) and under every loss a press that
 * bulges nothing leaves where it presses (2026-10-10, the nine bodies, before
 * contact compression: the knee squatting 0.08 to 0.19, tucked 0.04 to 0.07,
 * the hips 0.01 to 0.03).
 */
const VOLUME_SLACK = 0.01;

/** Whether the folds keep the flesh: `folded` no less than `bones` less `VOLUME_SLACK` of it. */
const keeps = (bones: number, folded: number) => folded >= bones * (1 - VOLUME_SLACK);

interface Figure {
  name: string;
  control: Float32Array;
  rest: RestBones;
  restSolid: { solid: SolidWinding; heads: Float32Array };
  folds: JointFold[];
}
let figures: Figure[] = [];

beforeAll(() => {
  figures = Object.entries({ ...BODY_TYPES, ...BATTERY_EXTREMES }).map(([name, recipe]) => {
    const control = model.evaluate(createRecipe(recipe)).control;
    const rest = restBones(assets, control);
    const folds = [
      solveHipFold(rest, control, assets.skinIndex, assets.skinWeight, tris),
      solveKneeFold(rest, control, assets.skinIndex, assets.skinWeight, tris),
    ];
    return {
      name,
      control,
      rest,
      restSolid: { solid: new SolidWinding(control, tris), heads: rest.heads },
      folds,
    };
  });
}, 900_000);

/** Figure `f` in `pose`: its vertices by the bones alone and with the folds, and its posed bones' heads. */
function posed(f: Figure, pose: string) {
  const rotations = bodyPoseRotations(rig, pose);
  const skin = (folds?: JointFold[]) =>
    skinPositions(
      f.rest,
      rotations,
      f.control,
      assets.skinIndex,
      assets.skinWeight,
      new Float32Array(f.control.length),
      folds,
    );
  return { bones: skin(), folded: skin(f.folds), heads: posedBoneHeads(f.rest, rotations) };
}

/** Joint `joint`'s flesh in figure `f` with its vertices at `positions` and its bones' heads at `heads`. */
const flesh = (
  f: Figure,
  joint: (typeof JOINTS)[number],
  positions: Float32Array,
  heads: Float32Array,
): number => {
  const got = jointVolume(f.rest.names, joint, f.restSolid, {
    solid: new SolidWinding(positions, tris),
    heads,
  });
  if (got === null) throw new Error(`${joint.name}: no bones`);
  return got;
};

describe("contact compression", () => {
  it("takes no more flesh round a hip or a knee than the bones leave it, but for the measure's noise, in every body and pose that bends them", () => {
    for (const f of figures)
      for (const pose of POSES) {
        const { bones, folded, heads } = posed(f, pose);
        for (const joint of JOINTS) {
          const b = flesh(f, joint, bones, heads);
          const got = flesh(f, joint, folded, heads);
          expect(
            keeps(b, got),
            `${f.name} ${pose} ${joint.name}: ${got.toFixed(3)} of rest, the bones ${b.toFixed(3)}`,
          ).toBe(true);
        }
      }
  });

  it("keeps the knee within the foundation's band seated, where the bones leave it there", () => {
    // Tucked and squatting the bones alone leave the knee out of the band (0.68 to 0.75 and 0.57 to 0.64 of
    // rest): thigh and shin, 50° and 30° apart, overlap within the ball, so the gate there is the bones'.
    for (const f of figures) {
      const { bones, folded, heads } = posed(f, "seated");
      for (const joint of JOINTS.filter((j) => j.name.startsWith("knee"))) {
        expect(
          flesh(f, joint, bones, heads),
          `${f.name} ${joint.name} by the bones`,
        ).toBeGreaterThanOrEqual(VOLUME_BAND[0]);
        expect(flesh(f, joint, folded, heads), `${f.name} ${joint.name}`).toBeGreaterThanOrEqual(
          VOLUME_BAND[0],
        );
      }
    }
  });

  it("fails a fold that flattens the flesh round a joint by a fifth", () => {
    // The average figure squatting, its knee's posed skin within a thigh's 0.3 of the knee pulled a fifth of the
    // way toward the knee's head: the flesh pressed flat with nowhere to go.
    const f = figures[0] as Figure;
    const knee = JOINTS.find((j) => j.name === "knee.L") as (typeof JOINTS)[number];
    const { bones, heads } = posed(f, "squat");
    const k = f.rest.names.indexOf(knee.head);
    const h = [0, 1, 2].map((c) => heads[k * 3 + c] as number);
    const flattened = Float32Array.from(bones);
    for (let v = 0; v < flattened.length / 3; v++) {
      const d = [0, 1, 2].map((c) => (flattened[v * 3 + c] as number) - (h[c] as number));
      if (Math.hypot(...d) > 0.15) continue;
      for (let c = 0; c < 3; c++) flattened[v * 3 + c] = (h[c] as number) + 0.8 * (d[c] as number);
    }
    expect(keeps(flesh(f, knee, bones, heads), flesh(f, knee, flattened, heads))).toBe(false);
  });
});
