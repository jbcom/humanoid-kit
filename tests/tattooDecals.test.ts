import { describe, expect, it } from "vitest";
import {
  TATTOO_LAYERS_MAX,
  TATTOO_MARGIN,
  tattooLayers,
  tattooSize,
} from "../src/render/tattooDecals.ts";

const at = (x: number, size: [number, number] = [0.1, 0.1]) => ({ centre: [x, 0, 0], size });

describe("a tattoo's decal", () => {
  it("takes its height from its image's aspect", () => {
    expect(tattooSize({ width: 0.1 }, { width: 200, height: 100 })).toEqual([0.1, 0.05]);
  });

  it("shares a layer with tattoos it does not overlap", () => {
    // Discs of radius √2 × 0.05 + margin: apart beyond twice that.
    const apart = 2 * (Math.SQRT2 * 0.05 + TATTOO_MARGIN) + 0.001;
    expect(tattooLayers([at(0), at(apart), at(2 * apart)])).toEqual([0, 0, 0]);
  });

  it("goes above every earlier tattoo it overlaps, so a later one is drawn over", () => {
    // B overlaps A; C overlaps B only, yet must still go above B.
    expect(tattooLayers([at(0), at(0.1), at(0.2)])).toEqual([0, 1, TATTOO_LAYERS_MAX - 1]);
    expect(tattooLayers([at(0), at(0.3), at(0.15, [0.3, 0.02])])).toEqual([0, 0, 1]);
  });

  it("stops at the top layer", () => {
    expect(Math.max(...tattooLayers([at(0), at(0), at(0), at(0)]))).toBe(TATTOO_LAYERS_MAX - 1);
  });
});
