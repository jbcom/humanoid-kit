import { describe, expect, it } from "vitest";
import { figureAtRest, posedFigure, poseFigure, triangleNormals } from "../src/bake/figure.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { BODY_REGIONS } from "../src/makehuman/regions.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPoseRotations, IDENTITY_POSE, rigData } from "../src/rig/pose.ts";
import { loadMiniatureAssets } from "./fixtures.ts";

const lowest = (p: Float32Array) => {
  let y = Number.POSITIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) y = Math.min(y, p[i] as number);
  return y;
};

describe("a dressed figure posed whole", { timeout: 120_000 }, () => {
  const assets = loadMiniatureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const rig = rigData(assets);
  const outfit = ["shoes/shoes01", "hats/fedora01", "suits/male_worksuit01"];
  const recipe = createRecipe({ outfit });

  it("gives the body, then every garment in outfit order", () => {
    const fig = posedFigure(model, recipe, bodyPoseRotations(rig, "seated"));
    const order = model.outfit(outfit).order;
    expect(fig.parts.map((p) => p.id)).toEqual(["body", ...order]);
    expect(fig.parts.slice(1).map((p) => p.kind)).toEqual(
      order.map((id) => model.garmentTopology(id).kind),
    );
    for (const p of fig.parts) {
      expect(p.positions.length).toBe(p.rest.length);
      expect(p.bodyRegion.length).toBe(p.rest.length / 3);
      expect(Math.max(...p.bodyRegion)).toBeLessThan(BODY_REGIONS.length);
    }
  });

  it("is the foundation's posed body where they overlap, lifted onto the ground", () => {
    const body = posedSurface(model, createRecipe({}), "seated");
    const fig = posedFigure(model, createRecipe({}), bodyPoseRotations(rig, "seated"));
    const part = fig.parts[0];
    if (!part) throw new Error("no body");
    for (let i = 0; i < body.positions.length; i += 997) {
      const k = i % 3 === 1 ? fig.groundOffset : 0;
      expect(part.positions[i]).toBeCloseTo((body.positions[i] as number) + k, 5);
    }
    expect(lowest(part.positions)).toBeCloseTo(0, 5);
  });

  it("stands the lowest point of body and garments on y = 0 in every pose", () => {
    const rest = figureAtRest(model, recipe);
    for (const pose of [IDENTITY_POSE(rig.bones.length), bodyPoseRotations(rig, "squat")]) {
      const fig = poseFigure(rest, pose);
      expect(Math.min(...fig.parts.map((p) => lowest(p.positions)))).toBeCloseTo(0, 4);
    }
  });

  it("dresses a proxy body the same way, masked by the outfit", () => {
    const fig = posedFigure(model, recipe, bodyPoseRotations(rig, "seated"), { body: "proxy741" });
    expect(fig.body).toBe("proxy741");
    const body = fig.parts[0];
    if (!body) throw new Error("no body");
    expect(body.rest.length).toBe(741 * 3);
    expect(body.index.length / 3).toBeLessThan(1460);
    expect(body.uvs).toBeNull();
    // The head keeps its own region.
    expect(body.bodyRegion).toContain(BODY_REGIONS.indexOf("head"));
  });

  it("gives each garment the body region it covers (coat over the chest, trousers on the legs)", () => {
    const fig = posedFigure(model, recipe, IDENTITY_POSE(rig.bones.length));
    const suit = fig.parts.find((p) => p.id === "suits/male_worksuit01");
    if (!suit) throw new Error("no suit");
    const regions = new Set(suit.bodyRegion);
    for (const r of ["chest", "arms", "legs"] as const)
      expect(regions.has(BODY_REGIONS.indexOf(r))).toBe(true);
  });

  it("computes unit area-weighted normals, up for a flat triangle facing up", () => {
    const n = triangleNormals(
      new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]),
      new Uint32Array([0, 1, 2]),
    );
    expect([...n.slice(0, 3)]).toEqual([0, 1, 0]);
    // A lone vertex has no triangle: it points up rather than nowhere.
    expect([...triangleNormals(new Float32Array(3), new Uint32Array(0))]).toEqual([0, 1, 0]);
  });
});
