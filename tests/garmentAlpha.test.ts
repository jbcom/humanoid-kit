import { describe, expect, it } from "vitest";
import { alphaUseOf } from "../scripts/lib/textureAlpha.ts";
import { GARMENT_CUTOUT, garmentAlpha } from "../src/render/attachmentLook.ts";
import { clothingManifest } from "./fixtures.ts";

describe("a garment texture's alpha", () => {
  const texture = (alpha: (i: number) => number, n = 10000) =>
    Uint8Array.from({ length: n }, (_, i) => alpha(i));

  it("is opaque with no see-through texels, or too few to matter", () => {
    expect(alphaUseOf(texture(() => 255))).toBe("opaque");
    expect(alphaUseOf(texture((i) => (i < 10 ? 0 : 255)))).toBe("opaque");
  });

  it("is a cutout where its holes are clean, and sheer where much of it is part see-through", () => {
    // A fishnet: a third holes, the rest solid.
    expect(alphaUseOf(texture((i) => (i % 3 === 0 ? 0 : 255)))).toBe("cutout");
    // Tights: most of it at 60% alpha.
    expect(alphaUseOf(texture((i) => (i % 10 === 0 ? 255 : 150)))).toBe("sheer");
  });

  it("reads one channel of interleaved texels", () => {
    // RGBA, alpha every fourth byte from the fourth.
    const rgba = Uint8Array.from({ length: 4000 }, (_, i) =>
      i % 4 === 3 ? (i % 8 === 3 ? 0 : 255) : 128,
    );
    expect(alphaUseOf(rgba, 4, 3)).toBe("cutout");
  });
});

describe("a garment material's alpha", () => {
  it("cuts a cutout's holes, blends a sheer cloth and leaves the rest opaque", () => {
    expect(garmentAlpha({ transparent: false, alphaToCoverage: true })).toEqual({
      alphaToCoverage: true,
      alphaTest: GARMENT_CUTOUT,
      transparent: false,
    });
    expect(garmentAlpha({ transparent: true, alphaToCoverage: false })).toEqual({
      alphaToCoverage: false,
      alphaTest: 0,
      transparent: true,
    });
    expect(garmentAlpha({ transparent: false, alphaToCoverage: false })).toEqual({
      alphaToCoverage: false,
      alphaTest: 0,
      transparent: false,
    });
  });

  it("is what the pack measured: tights sheer, fishnets and lace cut out, and never both", () => {
    const material = (id: string) =>
      clothingManifest.garments.entries.find((e: { id: string }) => e.id === id)?.material;
    expect(material("hosiery/kwnet_at_pantyhose01")?.transparent).toBe(true);
    expect(material("hosiery/v0rt3x_stockings_black_fishnet_large")?.alphaToCoverage).toBe(true);
    expect(material("underwear/punkduck_strappy_lace_thong")?.alphaToCoverage).toBe(true);
    for (const e of clothingManifest.garments.entries)
      expect(e.material.transparent && e.material.alphaToCoverage, e.id).toBe(false);
  });
});
