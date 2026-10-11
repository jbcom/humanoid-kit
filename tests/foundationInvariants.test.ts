/**
 * The foundation's invariants (src/foundation/invariants.ts) measure what they
 * claim: an average body at rest passes them all, and each one fails when its
 * defect is put there on purpose.
 */
import { describe, expect, it } from "vitest";
import {
  isContact,
  isLumenContact,
  measureInvariants,
  partOfBone,
} from "../src/foundation/invariants.ts";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { type PosedBody, posedSurface } from "../src/foundation/posed.ts";
import { creaseMask } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
const atRest = posedSurface(model, createRecipe({ macros: { age: 25, gender: 1 } }), REST_POSE);
const crease = creaseMask(model, "base");
const rest = measureInvariants(atRest, crease, 2);

/** `body` with its posed positions changed by `move`, the rest left as it is. */
const moved = (body: PosedBody, move: (p: Float32Array) => void): PosedBody => {
  const positions = Float32Array.from(body.positions);
  move(positions);
  return { ...body, positions };
};

describe("the foundation's invariants", () => {
  it("all pass on an average man at rest", () => {
    expect(rest.penetrating).toBe(0);
    expect(rest.inverted).toBe(0);
    expect(rest.squashed).toBe(0);
    expect(rest.volumeOut).toEqual([]);
    expect(rest.folds).toBe(0);
    expect(rest.seamGap).toBe(0);
  });

  it("find skin pushed through other skin, and name the parts", () => {
    // The left hand, pushed 4 cm into the left thigh's side... is a named contact;
    // the left forearm pushed into the head is not.
    const parts = atRest.bones.names.map(partOfBone);
    const owner = (v: number) => parts[atRest.skinIndex[v * 4] as number];
    let headX = 0;
    let headZ = 0;
    let count = 0;
    for (let v = 0; v < atRest.vertexCount; v++)
      if (owner(v) === "head") {
        headX += atRest.rest[v * 3] as number;
        headZ += atRest.rest[v * 3 + 2] as number;
        count++;
      }
    let headY = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < atRest.vertexCount; v++)
      if (owner(v) === "head") headY = Math.max(headY, atRest.rest[v * 3 + 1] as number);
    // Move the left forearm so its middle sits in the middle of the head.
    const forearm: number[] = [];
    for (let v = 0; v < atRest.vertexCount; v++) if (owner(v) === "forearm.L") forearm.push(v);
    const c = [0, 0, 0];
    for (const v of forearm)
      for (let k = 0; k < 3; k++)
        c[k] = (c[k] as number) + (atRest.rest[v * 3 + k] as number) / forearm.length;
    const target = [headX / count, headY - 0.1, headZ / count];
    const body = moved(atRest, (p) => {
      for (const v of forearm)
        for (let k = 0; k < 3; k++)
          p[v * 3 + k] = (p[v * 3 + k] as number) + (target[k] as number) - (c[k] as number);
    });
    const m = measureInvariants(body, crease, 2);
    expect(m.penetrating).toBeGreaterThan(10);
    expect(m.deepest).toBeGreaterThan(0.01);
    expect(m.deepestParts).toMatch(/forearm\.L|head/);
    expect(isContact("forearm.L", "head")).toBe(false);
    expect(isContact("thigh.L", "shin.L")).toBe(true);
  });

  it("count a canal's walls closing on each other as lumen self-contact, inside the canal only", () => {
    // Vertices 0..5 are canal 1 (gap 2 mm), 6..8 canal 2, 9..11 skin. Triangles: 0 the
    // canal's own (3, 4, 5); 1 a mix of canal 1 and skin (3, 4, 9); 2 canal 2's (6, 7, 8).
    const canals = {
      of: Int16Array.of(1, 1, 1, 1, 1, 1, 2, 2, 2, -1, -1, -1),
      gap: [0, 0.002, 0.003],
    };
    const index = Uint32Array.of(3, 4, 5, 3, 4, 9, 6, 7, 8);
    // Its own canal's wall within the gap: contact.
    expect(isLumenContact(canals, index, 0, 0, 0.0015)).toBe(true);
    // Past the gap, it has crossed out of the canal: penetration.
    expect(isLumenContact(canals, index, 0, 0, 0.0025)).toBe(false);
    // Out through skin beside the canal, or another canal: penetration.
    expect(isLumenContact(canals, index, 0, 1, 0.001)).toBe(false);
    expect(isLumenContact(canals, index, 0, 2, 0.001)).toBe(false);
    // Skin into a canal, and a surface without canals: penetration.
    expect(isLumenContact(canals, index, 9, 0, 0.001)).toBe(false);
    expect(isLumenContact(null, index, 0, 0, 0.001)).toBe(false);
    // The base surface has none.
    expect(atRest.canals).toBeNull();
  });

  it("find a triangle turned inside out and one crushed flat", () => {
    const [i, j, k] = [atRest.index[300], atRest.index[301], atRest.index[302]] as [
      number,
      number,
      number,
    ];
    const swapped = moved(atRest, (p) => {
      // Reflect the triangle's first corner through the opposite edge: the face flips.
      for (let d = 0; d < 3; d++) {
        const mid = ((p[j * 3 + d] as number) + (p[k * 3 + d] as number)) / 2;
        p[i * 3 + d] = 2 * mid - (p[i * 3 + d] as number);
      }
    });
    expect(measureInvariants(swapped, crease, 1000).inverted).toBeGreaterThan(0);
    const crushed = moved(atRest, (p) => {
      for (let d = 0; d < 3; d++)
        p[i * 3 + d] = ((p[j * 3 + d] as number) + (p[k * 3 + d] as number)) / 2;
    });
    expect(measureInvariants(crushed, crease, 1000).squashed).toBeGreaterThan(0);
  });

  it("find a seam torn open", () => {
    let seam = -1;
    for (let v = 0; v < atRest.vertexCount && seam < 0; v++) if (atRest.weld[v] !== v) seam = v;
    const torn = moved(atRest, (p) => {
      p[seam * 3] = (p[seam * 3] as number) + 0.001;
    });
    expect(measureInvariants(torn, crease, 1000).seamGap).toBeCloseTo(0.001, 6);
  });
});
