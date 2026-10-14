import { describe, expect, it } from "vitest";
import { SKIN_INFLUENCES } from "../src/format/assetFormat.ts";
import { measureInvariants } from "../src/foundation/invariants.ts";
import { foundationPermutations } from "../src/foundation/permutations.ts";
import { type PosedBody, posedSurface } from "../src/foundation/posed.ts";
import { foundationRecipe } from "../src/foundation/recipe.ts";
import { smokeModelOptions } from "../src/foundation/smoke.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { IDENTITY_POSE, restBonesFrom } from "../src/rig/pose.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/** A narrow closed slab beside the sampled vertex, with its own surface at the origin. */
function narrowSurface(inside: boolean, sign: number): PosedBody {
  const entry = 0.0000858222571387;
  const exit = 0.0001387364324913;
  const z = inside ? 0.0001 : 0;
  const points = [
    [0, 0, z],
    [-0.001, -0.001, z],
    [0.001, -0.001, z],
    // A split UV vertex and a distinct coincident vertex both produce origin hits.
    [0, 0, z],
    [0, 0, z],
    [-0.01, -0.012, entry],
    [0.013, -0.012, entry],
    [0.013, 0.01, entry],
    [-0.01, 0.01, entry],
    [-0.01, -0.012, exit],
    [0.013, -0.012, exit],
    [0.013, 0.01, exit],
    [-0.01, 0.01, exit],
    // Non-neighbour skin is within REACH, off both rays. It must not turn an
    // outside point into a penetration just because a shifted origin is inside.
    [0.01, -0.01, -0.01],
    [0.01, 0.02, -0.01],
    [0.01, 0, 0.02],
  ];
  const positions = Float32Array.from(
    points.flatMap(([x, y, pz]) => [x ?? 0, y ?? 0, sign * (pz ?? 0)]),
  );
  const rest = positions.slice();
  for (let v = 13; v < 16; v++) rest[v * 3] = 0.2;
  const index = Uint32Array.of(
    0,
    1,
    2,
    3,
    1,
    2,
    4,
    1,
    2,
    5,
    7,
    6,
    5,
    8,
    7,
    9,
    10,
    11,
    9,
    11,
    12,
    5,
    6,
    10,
    5,
    10,
    9,
    6,
    7,
    11,
    6,
    11,
    10,
    7,
    8,
    12,
    7,
    12,
    11,
    8,
    5,
    9,
    8,
    9,
    12,
    13,
    14,
    15,
  );
  const vertexCount = points.length;
  const normals = new Float32Array(positions.length);
  const skinWeight = new Float32Array(vertexCount * SKIN_INFLUENCES);
  for (let v = 0; v < vertexCount; v++) {
    normals[v * 3 + 2] = sign;
    skinWeight[v * SKIN_INFLUENCES] = 1;
  }
  const weld = Uint32Array.from({ length: vertexCount }, (_, v) => v);
  weld[3] = 0;
  const bones = restBonesFrom(["root"], Int16Array.of(-1), new Float32Array(3));
  return {
    surface: "base",
    index,
    rest,
    restNormals: normals,
    positions,
    normals,
    weld,
    vertexCount,
    skinIndex: new Uint16Array(vertexCount * SKIN_INFLUENCES),
    skinWeight,
    bones,
    rotations: IDENTITY_POSE(1),
    heads: new Float32Array(3),
    control: rest,
    canals: null,
  };
}

describe("penetration rays start at the measured vertex", () => {
  it.each([-1, 1])("does not jump into nearby skin in direction %s", (sign) => {
    const body = narrowSurface(false, sign);
    const result = measureInvariants(body, new Float32Array(body.vertexCount), body.vertexCount);
    expect(result.penetrating).toBe(0);
    expect(result.contacts).toBe(0);
    expect(result.lumen).toBe(0);
  });

  it.each([-1, 1])("does not jump out of nearby skin in direction %s", (sign) => {
    const body = narrowSurface(true, sign);
    const result = measureInvariants(body, new Float32Array(body.vertexCount), body.vertexCount);
    expect(result.penetrating).toBe(1);
    expect(result.deepest).toBeCloseTo(0.01, 7);
  });

  it("keeps the two closed lip vertices outside the adjacent narrow wall", {
    timeout: 300_000,
  }, () => {
    const permutation = foundationPermutations("smoke").find(
      (p) => p.body.name === "m-muscular" && p.pose.name === "squat",
    );
    if (!permutation) throw new Error("missing muscular squat fixture");
    const model = new HumanoidModel(loadFixtureAssets(true), smokeModelOptions);
    const body = posedSurface(model, foundationRecipe(permutation, adultManifest), "squat");
    const crease = new Float32Array(body.vertexCount);
    // Each stride samples the named lip plus vertex 0 and one unaffected body
    // vertex; all three are outside. The original query falsely counts the lip.
    for (const vertex of [31285, 31286])
      expect(measureInvariants(body, crease, vertex).penetrating, `lip ${vertex}`).toBe(0);
  });
});
