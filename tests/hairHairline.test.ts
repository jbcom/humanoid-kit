import { describe, expect, it } from "vitest";
import { HAIR_EDGE_PX, HAIR_HAIRLINE } from "../src/render/hairMaterial.ts";

describe("the hairline's constants", () => {
  it("never thin a card at full fade: wisp + taper + wander + slow is at most 1", () => {
    // A strand is kept whole where `fade - wander*n1 - slow*n2 >= wisp*h + taper` for any noise
    // (n1, n2, h in [0, 1]); at fade 1 that needs the sum below to be at most 1.
    const { wisp, taper, wander, slow } = HAIR_HAIRLINE;
    expect(wisp + taper + wander + slow).toBeLessThanOrEqual(1);
  });

  it("smooths a strand cell's edge over more than a pixel, and less than a 2 px strand", () => {
    // A box exactly 1 px wide leaves an empty and a whole pixel either side of an edge on a pixel boundary.
    expect(HAIR_EDGE_PX).toBeGreaterThan(1);
    expect(HAIR_EDGE_PX).toBeLessThan(2);
  });

  it("makes strands millimetres wide", () => {
    expect(1 / HAIR_HAIRLINE.strands).toBeLessThan(0.003);
  });
});
