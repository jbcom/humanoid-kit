import { describe, expect, it } from "vitest";
import { densePlan, planAtlas } from "../src/surface/atlasPlan.ts";
import { layerUsesCoordinate, type SkinLayer } from "../src/surface/layers.ts";
import { CREASE_LAYERS, SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const none = new Float32Array(0);
/** A layer of `kind` that measures nothing, for the plan's sake. */
const stub = (id: string, kind: "colour" | "bumps" | "creases" | "surface", coordGroup?: string) =>
  ({
    id,
    targets: [],
    fields: () => ({ mask: none, coord: null }),
    ...(coordGroup !== undefined && { coordGroup }),
    ...(kind === "colour" && { blend: "mix", paint: () => ({ strength: 0, stops: [] }) }),
    ...(kind === "bumps" && { kind: "detail", pattern: "bumps" }),
    ...(kind === "creases" && { kind: "detail", pattern: "creases" }),
    ...(kind === "surface" && { kind: "surface" }),
  }) as unknown as SkinLayer;

describe("the atlas plan", () => {
  it("gives every layer a channel of its own for its mask", () => {
    const plan = planAtlas(SKIN_LAYERS);
    expect(new Set(plan.mask).size).toBe(SKIN_LAYERS.length);
  });

  it("gives a coordinate only to the layers the shader reads one for", () => {
    const layers = [
      stub("a", "colour"),
      stub("b", "bumps"),
      stub("c", "creases"),
      stub("d", "surface"),
    ];
    const plan = planAtlas(layers);
    expect(Array.from(plan.coord).map((c) => c >= 0)).toEqual([true, false, true, false]);
    expect(layers.map(layerUsesCoordinate)).toEqual([true, false, true, false]);
    // Two masks and two coordinates, and the bumps' and surface's masks: six channels in two pages.
    expect(plan.channels).toBe(6);
    expect(plan.pages).toBe(2);
  });

  it("shares one coordinate channel among the layers of a group, and none with another group", () => {
    const plan = planAtlas([
      stub("a", "creases", "g"),
      stub("b", "creases", "g"),
      stub("c", "creases", "h"),
      stub("d", "creases"),
    ]);
    expect(plan.coord[0]).toBe(plan.coord[1]);
    expect(new Set([plan.coord[0], plan.coord[2], plan.coord[3]]).size).toBe(3);
    expect(plan.channels).toBe(4 + 3);
  });

  it("packs the shipped stack into fewer pages than two layers a page, whichever channels are shared", () => {
    const plan = planAtlas(SKIN_LAYERS);
    expect(plan.pages).toBeLessThan(densePlan(SKIN_LAYERS.length).pages);
    // Every channel is used once as a mask or shared as a coordinate: none is left empty.
    const used = new Set([...plan.mask, ...Array.from(plan.coord).filter((c) => c >= 0)]);
    expect(used.size).toBe(plan.channels);
  });

  it("costs the crease layers one coordinate channel in all, not one each", () => {
    const creaseIds = new Set(CREASE_LAYERS.map((l) => l.id));
    const without = planAtlas(SKIN_LAYERS.filter((l) => !creaseIds.has(l.id)));
    const plan = planAtlas(SKIN_LAYERS);
    expect(plan.channels - without.channels).toBe(CREASE_LAYERS.length + 1);
  });

  it("is two channels a layer, mask then coordinate, when dense", () => {
    const plan = densePlan(3);
    expect(Array.from(plan.mask)).toEqual([0, 2, 4]);
    expect(Array.from(plan.coord)).toEqual([1, 3, 5]);
    expect(plan.pages).toBe(2);
  });

  it("shares a group's coordinate only where the layers' coordinates agree on the mesh", () => {
    // The shared channel holds one value per texel: the crease layers' coordinates must
    // be the same wherever two of their masks both reach.
    const fields = CREASE_LAYERS.map((l) => l.fields(assets));
    const n = assets.manifest.vertexCount;
    let overlaps = 0;
    for (let v = 0; v < n; v++) {
      const reaching = fields.filter((f) => (f.mask[v] as number) > 0.01);
      for (const f of reaching) {
        overlaps++;
        expect(f.coord?.[v]).toBeCloseTo(reaching[0]?.coord?.[v] as number, 6);
      }
    }
    expect(overlaps).toBeGreaterThan(0);
  });
});
