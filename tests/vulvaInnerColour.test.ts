/**
 * The #118 inner-vulva colour coordinate is generated from the same source-bound
 * engorgement target that marks the folded inner surface. Its two colour stops
 * are a rendering choice, explicitly uncalibrated in ADULT-ANATOMY-DATA.md.
 */
import { describe, expect, it } from "vitest";
import { deltaE2000, labFromLinear } from "../e2e/lib/colour.ts";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { VULVA_ENGORGED, vulvaSkinField } from "../scripts/lib/detail/vulva.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { vulvaAlbedo, vulvaInnerAlbedo } from "../src/surface/genitalTone.ts";
import { VULVA_LAYER } from "../src/surface/regions/adult.ts";
import { DEFAULT_SKIN_TONE } from "../src/surface/skinTone.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const TONES = [0.05, 0.2, 0.35, 0.5, 0.7, 0.9];
const luminance = (c: readonly number[]) =>
  0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
const dE = (a: readonly number[], b: readonly number[]) =>
  deltaE2000(
    labFromLinear(a as [number, number, number]),
    labFromLinear(b as [number, number, number]),
  );

describe("the inner-vulva colour response", () => {
  it("has a distinct, stronger modelled response at every natural skin tone", () => {
    for (const melanin of TONES) {
      const tone = { ...DEFAULT_SKIN_TONE, melanin };
      const outer = vulvaAlbedo(tone);
      const inner = vulvaInnerAlbedo(tone);
      expect(luminance(inner), `melanin ${melanin}`).toBeLessThan(luminance(outer));
      expect(dE(inner, outer), `melanin ${melanin}`).toBeGreaterThan(1);
      expect(dE(inner, outer), `melanin ${melanin}`).toBeLessThan(12);
      expect(
        dE(vulvaInnerAlbedo(tone, 0), vulvaInnerAlbedo(tone, 1)),
        `inner at melanin ${melanin}`,
      ).toBeGreaterThan(dE(vulvaAlbedo(tone, 0), vulvaAlbedo(tone, 1)));
    }
  });

  it("places outer and inner responses at the layer's endpoints", () => {
    const tone = { ...DEFAULT_SKIN_TONE, melanin: 0.3 };
    for (const arousal of [0, 1]) {
      const paint = VULVA_LAYER.paint({ tone, signals: { arousal }, age: 30, gender: 0 } as never);
      if (!("stops" in paint)) throw new Error("the vulva layer paints no stops");
      expect(paint.stops).toEqual([vulvaAlbedo(tone, arousal), vulvaInnerAlbedo(tone, arousal)]);
    }
  });
});

describe("the source-derived inner-vulva coordinate", { timeout: 300_000 }, () => {
  const assets = loadFixtureAssets(true);
  const spec = adultManifest.anatomy?.skinLayers.find((layer) => layer.id === "vulva-skin");

  it("is regenerated from the engorgement target, only inside the colour mask", () => {
    const model = new HumanoidModel(assets, { subdivision: 1 });
    const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
    const engorged = assets.targets.get(VULVA_ENGORGED);
    const field = spec?.vertexCoord;
    if (!lattice || !engorged || !field)
      throw new Error("the pack authors no inner-vulva coordinate");
    const control = model.controlShape(AUTHORING_FIGURE);
    const want = vulvaSkinField(
      lattice,
      {
        name: VULVA_ENGORGED,
        indices: Array.from(engorged.indices),
        xyz: Array.from(engorged.deltas, (delta) => delta * engorged.scale),
      },
      control.control,
      spec.vertexMask?.indices ?? [],
    );
    expect(field.indices).toEqual(want.indices);
    field.values.forEach((value, i) => {
      expect(value).toBeCloseTo(want.values[i] as number, 5);
    });
    const fields = VULVA_LAYER.fields(assets);
    if (!fields.coord) throw new Error("the layer omitted the generated coordinate");
    const inMask = new Set(spec.vertexMask?.indices ?? []);
    for (let v = 0; v < fields.coord.length; v++) {
      const value = fields.coord[v] as number;
      expect(value, `vertex ${v}`).toBeGreaterThanOrEqual(0);
      expect(value, `vertex ${v}`).toBeLessThanOrEqual(1);
      if (value > 0) expect(inMask.has(v), `coordinate outside mask at ${v}`).toBe(true);
    }
    expect(Math.max(...field.values)).toBeGreaterThan(0.8);
  });
});
