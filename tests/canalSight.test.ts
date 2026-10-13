import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultPackData, bodyPackData } from "./fixtures.ts";

/**
 * The canals' openings closed at the skin (coordinator ruling, 2026-10-10): from the
 * sheets' front-low and below cameras at rest, no wall of a canal past its opening's
 * closure is seen. A vertex is past the closure where the canal's own target moved it
 * (against the same figure without the canals' targets, their closures kept); it is
 * seen where its line toward the camera leaves the body without meeting skin.
 */
const VIEWS = { frontlow: [0, -0.5, 1], below: [0, -1, 0.35] } as const;
const CANAL_TARGETS = ["genitals/vagina-k1", "genitals/anus-k1"];
const PAST = 0.0005;

const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adultPackData()), {
  subdivision: 1,
});
const bare = adultPackData();
// The fixture manifest is shared. Keep the comparison's drive removal local to
// its own model so importing this test cannot alter another fixture consumer.
bare.manifest = structuredClone(bare.manifest);
const drives = bare.manifest.anatomy?.detail?.drives ?? {};
for (const t of CANAL_TARGETS) delete drives[t];
const closedOnly = new HumanoidModel(parseHumanoidAssets(bodyPackData(), bare), {
  subdivision: 1,
});

const FIGURES = {
  "f-slim": { gender: 0, weight: 0.2 },
  "f-heavy": { gender: 0, weight: 1 },
  "f-elder": { gender: 0, age: 85 },
  "gender 0.5": { gender: 0.5 },
  "gender 0.75": { gender: 0.75 },
  man: { gender: 1 },
} as const;

describe("a canal's opening, closed at the skin", { timeout: 600_000 }, () => {
  for (const [name, macros] of Object.entries(FIGURES))
    it(`shows no wall past its closure from below or front-low at rest: ${name}`, () => {
      const recipe = createRecipe({ macros: { age: 30, ...macros } });
      // At rest the evaluated surface is the drawn surface. No hip corrective
      // is active, so this closure test need not solve every flexion and opening.
      const body = model.evaluate(recipe);
      const P = Float32Array.from(body.positions);
      const without = closedOnly.evaluate(recipe).positions;
      const topology = model.adultSurface();
      if (body.surface !== "adult" || !topology)
        throw new Error("an adult evaluation without its canal surface");
      const canals = topology.canals;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(P, 3));
      geometry.setIndex(new BufferAttribute(Uint32Array.from(topology.index), 1));
      const bvh = new MeshBVH(geometry, { verbose: false });
      const p = new Vector3();
      const ray = new Ray();
      const seen: string[] = [];
      let past = 0;
      for (let v = 0; v < topology.vertexCount; v++) {
        if ((canals.of[v] as number) < 0) continue;
        const drawn = Math.hypot(
          (P[v * 3] as number) - (without[v * 3] as number),
          (P[v * 3 + 1] as number) - (without[v * 3 + 1] as number),
          (P[v * 3 + 2] as number) - (without[v * 3 + 2] as number),
        );
        if (drawn < PAST) continue;
        past++;
        p.set(P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number);
        for (const [view, d] of Object.entries(VIEWS)) {
          ray.direction.set(d[0], d[1], d[2]).normalize();
          ray.origin.copy(p).addScaledVector(ray.direction, 2e-4);
          if (!bvh.raycastFirst(ray, DoubleSide)) seen.push(`${view} v${v}`);
        }
      }
      geometry.dispose();
      // Every figure has its anal canal drawn, so the check is not vacuous.
      expect(past).toBeGreaterThan(100);
      expect(seen, "canal walls seen past the closure").toEqual([]);
    });
});
