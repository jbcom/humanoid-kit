import { describe, expect, it } from "vitest";
import type { PlacedMark, PlacedTattoo } from "../src/bodyArt/decals.ts";
import {
  DECAL_LAYERS_MAX,
  DECAL_MARGIN,
  decalLayers,
  naevusDecal,
  tattooDecal,
  tattooSize,
} from "../src/render/bodyArtDecals.ts";

const at = (x: number, size: [number, number] = [0.1, 0.1]) => ({ centre: [x, 0, 0], size });
const frame = {
  centre: [0, 1, 0],
  normal: [0, 0, 1],
  right: [1, 0, 0],
  up: [0, 1, 0],
} as const satisfies Omit<PlacedTattoo, "image" | "width" | "density">;

describe("a decal", () => {
  it("is a tattoo its image's aspect tall, or a naevus as round as it is wide", () => {
    expect(tattooSize({ width: 0.1 }, { width: 200, height: 100 })).toEqual([0.1, 0.05]);
    const t: PlacedTattoo = { ...frame, image: "a", width: 0.1, density: 0.8 };
    expect(tattooDecal(t, { width: 200, height: 100 })).toEqual({
      ...frame,
      size: [0.1, 0.05],
      density: 0.8,
      image: "a",
    });
    const m: PlacedMark = {
      ...frame,
      kind: "naevus",
      length: 0.004,
      width: -0.004,
      maturity: 1,
      raised: 0,
      seed: 1,
    };
    expect(naevusDecal(m)).toEqual({ ...frame, size: [0.004, 0.004], density: 1, image: null });
  });

  it("shares a layer with decals it does not overlap", () => {
    // Discs of radius √2 × 0.05 + margin: apart beyond twice that.
    const apart = 2 * (Math.SQRT2 * 0.05 + DECAL_MARGIN) + 0.001;
    expect(decalLayers([at(0), at(apart), at(2 * apart)])).toEqual([0, 0, 0]);
  });

  it("goes above every earlier decal it overlaps, so a later one is drawn over", () => {
    // B overlaps A; C overlaps B only, yet must still go above B.
    expect(decalLayers([at(0), at(0.1), at(0.2)])).toEqual([0, 1, DECAL_LAYERS_MAX - 1]);
    expect(decalLayers([at(0), at(0.3), at(0.15, [0.3, 0.02])])).toEqual([0, 0, 1]);
  });

  it("stops at the top layer", () => {
    expect(Math.max(...decalLayers([at(0), at(0), at(0), at(0)]))).toBe(DECAL_LAYERS_MAX - 1);
  });
});
