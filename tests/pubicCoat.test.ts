/**
 * Pubic hair: a coat region whose area is the adult anatomy pack's data
 * (`AdultAnatomySpec.coatRegions`), painted by the body hair model only for an
 * adult whose recipe asks for it. Without the pack it is nothing at all.
 */
import { describe, expect, it } from "vitest";
import { adultCoatRegions } from "../scripts/lib/adultCoat.ts";
import { buildRefinedSurfaceMesh } from "../src/build/surfaceMesh.ts";
import {
  type AdultCoatRegionSpec,
  groupFaces,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { applyStencil } from "../src/subdiv/catmullClark.ts";
import { COAT_REGION_LIMIT, coatMasks, paintCoat } from "../src/surface/coat.ts";
import type { SkinPaintInput } from "../src/surface/layers.ts";
import { BODY_HAIR_COAT, PUBIC_REGION } from "../src/surface/regions/bodyHairCoat.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const SPEC: AdultCoatRegionSpec = {
  id: PUBIC_REGION.id,
  vertices: [10, 20, 30],
  mask: [1, 0.5, 0.25],
};

/** The shipped packs, the adult manifest's anatomy carrying `coatRegions`. */
function withRegions(coatRegions: unknown): HumanoidAssets {
  const adult = adultPackData();
  const manifest = {
    ...adult.manifest,
    anatomy: { ...adult.manifest.anatomy, coatRegions },
  } as typeof adult.manifest;
  return parseHumanoidAssets(bodyPackData(), { ...adult, manifest });
}

const input = (age: number, extra: Partial<SkinPaintInput> = {}): SkinPaintInput => ({
  tone: { melanin: 0.35, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
  signals: {},
  age,
  adult: age >= 18,
  ...extra,
});
const asked = { bodyHair: { density: { pubic: 1 } } };
const k = BODY_HAIR_COAT.indexOf(PUBIC_REGION);
const cover = (table: Float32Array) => table[k * 8] as number;

describe("pubic hair's coat region", () => {
  it("is the body hair coat's last region, and the coat holds no more", () => {
    expect(k).toBe(BODY_HAIR_COAT.length - 1);
    expect(BODY_HAIR_COAT.length).toBe(COAT_REGION_LIMIT);
    expect(PUBIC_REGION.adultOnly).toBe(true);
    expect(PUBIC_REGION.targets).toEqual([]);
  });

  it("has no area without the adult pack, or with a pack that gives it none", () => {
    expect(PUBIC_REGION.mask(loadFixtureAssets()).every((m) => m === 0)).toBe(true);
    expect(PUBIC_REGION.mask(withRegions([])).every((m) => m === 0)).toBe(true);
  });

  it("has, with the shipped adult pack, exactly the area the packer measures", () => {
    const shipped = loadFixtureAssets(true);
    expect(shipped.adultAnatomyManifest?.anatomy?.coatRegions).toEqual(
      adultCoatRegions(loadFixtureAssets()),
    );
    expect(PUBIC_REGION.mask(shipped).some((m) => m > 0.9)).toBe(true);
  });

  it("takes its area from the pack: the spec's vertices at their mask, nothing elsewhere", () => {
    const assets = withRegions([SPEC]);
    const mask = PUBIC_REGION.mask(assets);
    expect(mask.length).toBe(assets.manifest.vertexCount);
    SPEC.vertices.forEach((v, i) => {
      expect(mask[v]).toBeCloseTo(SPEC.mask[i] as number, 6);
    });
    expect(mask.reduce((s, m) => s + m, 0)).toBeCloseTo(1.75, 6);
    const bytes = coatMasks(assets, BODY_HAIR_COAT);
    expect(bytes[10 * COAT_REGION_LIMIT + k]).toBe(255);
  });

  it("is painted only for an adult whose recipe asks for it", () => {
    expect(cover(paintCoat(BODY_HAIR_COAT, input(30, asked)))).toBeGreaterThan(0);
    // An adult whose recipe says nothing of it, a minor asking for it, and an
    // input that does not say the figure is an adult: none.
    expect(cover(paintCoat(BODY_HAIR_COAT, input(30)))).toBe(0);
    expect(cover(paintCoat(BODY_HAIR_COAT, input(16, asked)))).toBe(0);
    const { adult: _, ...unsaid } = input(30, asked);
    expect(cover(paintCoat(BODY_HAIR_COAT, unsaid as SkinPaintInput))).toBe(0);
  });

  it("reaches the adult surface's coat fields, through its refinement, at the pack's area", {
    timeout: 300_000,
  }, () => {
    // The area the packer measures, carried as the shipped pack will carry it.
    const assets = withRegions(adultCoatRegions(loadFixtureAssets(true)));
    const model = new HumanoidModel(assets, { subdivision: 1 });
    model.evaluate(createRecipe({ macros: { age: 30 } }));
    const surface = model.adultSurface();
    expect(surface).not.toBeNull();
    const { masks, regions } = (surface as NonNullable<typeof surface>).coat;
    expect(regions[k]).toBe(PUBIC_REGION.id);
    let full = 0;
    for (let r = 0; r < masks.length / COAT_REGION_LIMIT; r++)
      if ((masks[r * COAT_REGION_LIMIT + k] as number) > 230) full++;
    expect(full).toBeGreaterThan(100);
  });

  it("refuses a pack whose regions are malformed", () => {
    const bad: [string, unknown][] = [
      ["unknown id", [{ ...SPEC, id: "hair-elsewhere" }]],
      ["lengths differ", [{ ...SPEC, mask: [1, 0.5] }]],
      ["not ascending", [{ ...SPEC, vertices: [20, 10, 30] }]],
      ["out of range", [{ ...SPEC, vertices: [10, 20, 1e9] }]],
      ["mask past 1", [{ ...SPEC, mask: [1, 0.5, 1.5] }]],
      ["twice", [SPEC, SPEC]],
    ];
    for (const [label, regions] of bad)
      expect(() => withRegions(regions), label).toThrow(/coat region/);
    expect(() => withRegions([SPEC])).not.toThrow();
  });
});

describe("pubic coat placement on the refined adult surface", () => {
  const adultAssets = loadFixtureAssets(true);
  const model = new HumanoidModel(adultAssets, { subdivision: 1 });
  const topology = model.adultSurface();
  const refinement = adultManifest.anatomy?.surface;
  if (!topology || !refinement)
    throw new Error("the shipped adult fixture needs its refined surface");
  const mesh = buildRefinedSurfaceMesh(
    { ...adultAssets, vertexCount: adultAssets.manifest.vertexCount },
    groupFaces(adultAssets, "body"),
    refinement,
    1,
    adultManifest.anatomy?.reservoirs ?? [],
  );
  const pubicIndex = BODY_HAIR_COAT.indexOf(PUBIC_REGION);
  const maskAt = (render: number) =>
    topology.coat.masks[render * COAT_REGION_LIMIT + pubicIndex] as number;
  const reservoirSurface = new Set(
    mesh.lattice?.reservoirs.flatMap((reservoir) => [
      ...reservoir.copies,
      ...reservoir.capVertices,
    ]) ?? [],
  );
  const inheritedPubic = () => {
    const base = coatMasks(adultAssets, BODY_HAIR_COAT);
    const field = new Float32Array(adultAssets.manifest.vertexCount * 3);
    for (let vertex = 0; vertex < adultAssets.manifest.vertexCount; vertex++)
      field[vertex * 3] = (base[vertex * COAT_REGION_LIMIT + pubicIndex] as number) / 255;
    const surface = new Float32Array(mesh.topology.vertexCount * 3);
    applyStencil(mesh.stencil, field, surface);
    return Float32Array.from(mesh.renderToSurface, (vertex) => surface[vertex * 3] as number);
  };

  it("keeps mons coverage on the original surface while leaving reservoir walls and caps uncoated", () => {
    expect(topology.vertexCount).toBe(mesh.renderToSurface.length);
    const inherited = inheritedPubic();
    let mons = 0;
    let reservoir = 0;
    mesh.renderToSurface.forEach((surface, render) => {
      const mask = maskAt(render);
      if (reservoirSurface.has(surface)) {
        reservoir++;
        expect(mask, `reservoir surface ${surface}`).toBe(0);
      } else {
        expect(mask / 255, `mons surface ${surface}`).toBeCloseTo(inherited[render] as number, 2);
        if (mask > 0) mons++;
      }
    });
    expect(reservoir).toBeGreaterThan(0);
    expect(mons).toBeGreaterThan(0);
  });
});
