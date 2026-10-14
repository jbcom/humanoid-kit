/**
 * A canal's opening, closed at the skin at rest (tests/canalSight.test.ts), stays
 * closed when the figure is posed (#77, #73). In the lithotomy sheet the vaginal
 * opening showed its canal's walls through a slit pulled open, and the anal opening
 * its ring, on every body, where at rest the same cameras saw a closed slit.
 *
 * The same measure as at rest, on the posed body: a canal vertex past its opening's
 * closure (moved by the canal's own target, against the same figure without the
 * canals' targets, their closures kept) is seen where its line toward a camera of the
 * sheet leaves the body without meeting skin. The pose is the sheets' lithotomy,
 * skinned by the CPU reference, which is the renderer's.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { surfacePoser } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { jointChannelRotations, rigData } from "../src/rig/pose.ts";
import { adultPackData, bodyPackData } from "./fixtures.ts";

const CANAL_TARGETS = ["genitals/vagina-k1", "genitals/anus-k1"];
const PAST = 0.0005;

const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
  subdivision: 1,
});
const bare = adultPackData();
// The fixture manifest is shared: the comparison's drive removal stays on its own copy.
bare.manifest = structuredClone(bare.manifest);
const drives = bare.manifest.anatomy?.detail?.drives ?? {};
for (const t of CANAL_TARGETS) delete drives[t];
const closedOnly = new HumanoidModel(parseHumanoidAssets(bodyPackData(), bare), {
  subdivision: 1,
});
const rig = rigData(model.assets);

/** The lithotomy position of the anatomy sheets (e2e/sheets/anatomy-poses.sheet.ts). */
const LITHOTOMY = {
  root: { Xrotation: -90 },
  "upperleg01.L": { Xrotation: -95, Yrotation: -40 },
  "upperleg01.R": { Xrotation: -95, Yrotation: 40 },
  "lowerleg01.L": { Xrotation: 90 },
  "lowerleg01.R": { Xrotation: 90 },
};
/** The lithotomy sheet's close cameras, model space: the perineum faces the foot end (+z). */
const VIEWS = {
  "foot end": [0, 0.25, 1],
  below: [0, -0.35, 1],
  oblique: [0.6, 0.45, 0.65],
} as const;

const FIGURES = {
  "f-average": { gender: 0 },
  "f-slim": { gender: 0, weight: 0.2 },
  "f-heavy": { gender: 0, weight: 1 },
  "f-elder": { gender: 0, age: 85 },
} as const;

describe("a canal's opening, closed at the skin, in the lithotomy position", {
  timeout: 600_000,
}, () => {
  for (const [name, macros] of Object.entries(FIGURES))
    it(`shows no wall past its closure from the sheet's cameras: ${name}`, () => {
      const recipe = createRecipe({ macros: { age: 30, ...macros } });
      const rotations = jointChannelRotations(rig, LITHOTOMY);
      const body = surfacePoser(model, recipe)(rotations);
      const without = closedOnly.evaluate(recipe).positions;
      const { canals } = body;
      if (body.surface !== "adult" || !canals)
        throw new Error("an adult figure without its canals");
      const P = body.positions;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(Float32Array.from(P), 3));
      geometry.setIndex(new BufferAttribute(Uint32Array.from(body.index), 1));
      const bvh = new MeshBVH(geometry, { verbose: false });
      const p = new Vector3();
      const ray = new Ray();
      const seen = new Map<string, number>();
      let past = 0;
      for (let v = 0; v < body.vertexCount; v++) {
        if ((canals.of[v] as number) < 0) continue;
        // Past the closure at rest: the canal's own target moved it.
        const drawn = Math.hypot(
          (body.rest[v * 3] as number) - (without[v * 3] as number),
          (body.rest[v * 3 + 1] as number) - (without[v * 3 + 1] as number),
          (body.rest[v * 3 + 2] as number) - (without[v * 3 + 2] as number),
        );
        if (drawn < PAST) continue;
        past++;
        p.set(P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number);
        for (const [view, d] of Object.entries(VIEWS)) {
          ray.direction.set(d[0], d[1], d[2]).normalize();
          ray.origin.copy(p).addScaledVector(ray.direction, 2e-4);
          if (!bvh.raycastFirst(ray, DoubleSide)) seen.set(view, (seen.get(view) ?? 0) + 1);
        }
      }
      geometry.dispose();
      // Every figure has its canals drawn, so the check is not vacuous.
      expect(past).toBeGreaterThan(0);
      expect(Object.fromEntries(seen), `of ${past} wall vertices past the closure`).toEqual({});
    });
});
