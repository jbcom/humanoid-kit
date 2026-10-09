import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { buildFeatureMap } from "../src/makehuman/features.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../src/rig/occlusionKeys.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const withAdult = loadFixtureAssets(true);
const core = loadFixtureAssets();
const adultModel = new HumanoidModel(withAdult, { subdivision: 1 });
const coreModel = new HumanoidModel(core, { subdivision: 1 });
const adult = createRecipe({ macros: { age: 30 } });
const minor = createRecipe({ macros: { age: 15 } });

// Each surface build takes seconds, and the subdivision-2 one tens on a busy machine.
describe("the adult surface in the model", { timeout: 300_000 }, () => {
  it("is the base surface for every figure under 18, vertex for vertex", () => {
    // The structural guarantee: a minor's evaluation has exactly the base
    // body's vertices, so there is no adult vertex in it to leak.
    for (const age of [1, 11, 15, 17.99]) {
      const recipe = createRecipe({ macros: { age } });
      const a = adultModel.evaluate(recipe);
      const b = coreModel.evaluate(recipe);
      expect(a.surface).toBe("base");
      expect(a.positions.length).toBe(b.positions.length);
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
      expect(a.curvature.length).toBe(b.curvature.length);
    }
  });

  it("darkens the body's cavities on the adult surface as on the base", () => {
    // The refinement is at the pelvis; the mouth, nostrils, ear canals and eye
    // sockets keep their geometry, so their occlusion must come through intact.
    const corners = occlusionCorners(OCCLUSION_KEYS.length);
    const base = adultModel.topology().body;
    const s = adultModel.adultSurface() as NonNullable<ReturnType<HumanoidModel["adultSurface"]>>;
    expect(s.occlusion.length).toBe(s.vertexCount * corners);
    for (let c = 0; c < corners; c++) {
      const dark = (o: Uint8Array, n: number) => {
        let count = 0;
        let min = 255;
        for (let v = 0; v < n; v++) {
          const x = o[v * corners + c] as number;
          if (x < 250) count++;
          min = Math.min(min, x);
        }
        return { count, min };
      };
      const a = dark(base.occlusion, base.vertexCount);
      const b = dark(s.occlusion, s.vertexCount);
      expect(a.count, `corner ${c}`).toBeGreaterThan(0);
      expect(b.min, `corner ${c}`).toBe(a.min);
      expect(Math.abs(b.count - a.count) / a.count, `corner ${c}`).toBeLessThan(0.05);
    }
  });

  it("is the refined surface for an adult, with every per-vertex array its size", () => {
    const base = adultModel.topology().body;
    const surface = adultModel.adultSurface();
    expect(surface).not.toBeNull();
    const s = surface as NonNullable<typeof surface>;
    expect(s.vertexCount).toBeGreaterThan(base.vertexCount + 2000);
    expect(s.uvs.length).toBe(s.vertexCount * 2);
    expect(s.skinIndex.length).toBe(s.vertexCount * 4);
    expect(s.skinWeight.length).toBe(s.vertexCount * 4);
    expect(s.uvScale.length).toBe(s.vertexCount);
    expect(s.uvScale.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    const ev = adultModel.evaluate(adult);
    expect(ev.surface).toBe("adult");
    expect(ev.positions.length).toBe(s.vertexCount * 3);
    expect(ev.normals.length).toBe(s.vertexCount * 3);
    expect(ev.curvature.length).toBe(s.vertexCount);
    expect(ev.positions.every(Number.isFinite)).toBe(true);
    expect(ev.curvature.every(Number.isFinite)).toBe(true);
    // Triangles index real vertices.
    for (const i of s.index) if (i >= s.vertexCount) throw new Error(`index ${i} out of range`);
  });

  it("builds once and shares it", () => {
    expect(adultModel.adultSurface()).toBe(adultModel.adultSurface());
  });

  it("follows the same figure as the base surface: same ground, same extent, within a few millimetres", () => {
    for (const macros of [
      { age: 30 },
      { age: 90, gender: 0 },
      { age: 18, gender: 1, weight: 1 },
      { age: 40, gender: 0.5, weight: 0, muscle: 1 },
    ]) {
      const recipe = createRecipe({ macros });
      const a = adultModel.evaluate(recipe);
      const b = coreModel.evaluate(recipe);
      expect(a.surface).toBe("adult");
      expect(a.groundOffset).toBe(b.groundOffset);
      expect(Array.from(a.control)).toEqual(Array.from(b.control));
      const box = (p: Float32Array) => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i += 3)
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k] as number, p[i + k] as number);
            hi[k] = Math.max(hi[k] as number, p[i + k] as number);
          }
        return [...lo, ...hi];
      };
      const ba = box(a.positions);
      const bb = box(b.positions);
      for (let k = 0; k < 6; k++)
        expect(Math.abs((ba[k] as number) - (bb[k] as number))).toBeLessThan(0.003);
    }
  });

  it("is the base surface without an adult pack, and with a pack that names no surface", () => {
    expect(coreModel.adultSurface()).toBeNull();
    expect(coreModel.evaluate(adult).surface).toBe("base");
    const spec = adultManifest.anatomy as NonNullable<typeof adultManifest.anatomy>;
    const { surface: _surface, ...withoutSurface } = spec;
    const noSurface = new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), {
        ...adultPackData(),
        manifest: { ...adultManifest, anatomy: withoutSurface },
      }),
      { subdivision: 1 },
    );
    expect(noSurface.adultSurface()).toBeNull();
    expect(noSurface.evaluate(adult).surface).toBe("base");
  });

  it("needs subdivision 1 or more: at 0 an adult keeps the base surface, at 2 it has the refined one", () => {
    const flat = new HumanoidModel(withAdult, { subdivision: 0 });
    expect(flat.adultSurface()).toBeNull();
    expect(flat.evaluate(adult).surface).toBe("base");
    const smooth = new HumanoidModel(withAdult, { subdivision: 2 });
    const ev = smooth.evaluate(adult);
    expect(ev.surface).toBe("adult");
    expect(ev.positions.every(Number.isFinite)).toBe(true);
    expect(ev.normals.every(Number.isFinite)).toBe(true);
  });

  it("maps the refined surface's vertices to the controls that shape them, for picking", () => {
    const { vertexFeature } = buildFeatureMap(adultModel.assets);
    const render = adultModel.renderFeatures(vertexFeature);
    const surface = adultModel.adultSurface() as NonNullable<
      ReturnType<typeof adultModel.adultSurface>
    >;
    expect(render.adultBody?.length).toBe(surface.vertexCount);
    expect(coreModel.renderFeatures(vertexFeature).adultBody).toBeUndefined();
    expect(minor.macros.age).toBeLessThan(18);
  });
});
