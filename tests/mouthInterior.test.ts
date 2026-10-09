import { describe, expect, it } from "vitest";
import { type BodyManifest, groupFaces, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { labFromLinear, lchFromLab } from "../src/surface/cielab.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { MOUTH_INTERIOR_LAYER } from "../src/surface/regions/mouth.ts";
import { luminance, skinAlbedo } from "../src/surface/skinTone.ts";
import { bodyManifest, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const mask = MOUTH_INTERIOR_LAYER.fields(assets).mask;
const rest = new HumanoidModel(assets, { subdivision: 0 }).evaluate(createRecipe()).control;
const sparse = assets.bodyOcclusion;
/** The vertices the body's faces use: the helper meshes (teeth, tongue, joints) are never drawn. */
const visible = new Set<number>();
for (const f of groupFaces(assets, "body"))
  for (let k = 0; k < 4; k++) visible.add(assets.faceVerts[f * 4 + k] as number);
const restValue = (v: number) => {
  const i = sparse?.vertices.indexOf(v) ?? -1;
  return i < 0 || !sparse ? 1 : (sparse.values[i] as number) / 255;
};
const at = (v: number) =>
  [rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]] as [number, number, number];
/** A generous box round the mouth: its lining, and the lips and skin beside it. */
const nearMouth = (v: number) => {
  const [x, y, z] = at(v);
  // Up to the lips' corners (a little above 0.69); the nostrils lie beyond them, forward of 0.14.
  const mouth =
    Math.abs(x) < 0.045 && y > 0.58 && y < 0.7 && z > 0 && z < 0.17 && (y < 0.69 || z < 0.135);
  // The far end's roof, where the mouth meets the nasal passage behind the palate.
  const roof = Math.abs(x) < 0.02 && y >= 0.69 && y < 0.72 && z < 0.09;
  return mouth || roof;
};
/** The default figure's mouth: between the lips and behind them. */
const inMouth = (v: number) => {
  const [x, y, z] = at(v);
  return Math.abs(x) < 0.03 && y > 0.645 && y < 0.685 && z > 0.1 && z < 0.16;
};

describe("the mouth's lining", () => {
  it("is a layer of the stack, after the lips", () => {
    const ids = SKIN_LAYERS.map((l) => l.id);
    expect(ids).toContain("mouth-interior");
    expect(ids.indexOf("mouth-interior")).toBeGreaterThan(ids.indexOf("lips"));
  });

  it("covers what the closed lips enclose, and only there", () => {
    let deep = 0;
    let deepCovered = 0;
    let elsewhere = 0;
    for (const v of sparse?.vertices ?? []) {
      const m = mask[v] as number;
      if (inMouth(v) && restValue(v) < 0.3) {
        deep++;
        if (m > 0.9) deepCovered++;
      } else if (!nearMouth(v)) {
        elsewhere++;
        // Enclosed, but not the mouth's: the nostrils, ear canals and eye sockets.
        expect(m, `vertex ${v}`).toBeLessThan(0.01);
      }
    }
    expect(deep).toBeGreaterThan(30);
    expect(deepCovered / deep).toBeGreaterThan(0.9);
    expect(elsewhere).toBeGreaterThan(500);
  });

  it("does not touch the lips' own skin, the nostrils or the chin", () => {
    for (const v of visible) {
      const [, y, z] = at(v);
      // Outer lips and the skin round them (not the mouth's far end): open to the world at rest.
      if (nearMouth(v) && z > 0.125 && restValue(v) > 0.9)
        expect(mask[v], `vertex ${v}`).toBeLessThan(0.1);
      // The region is placed by the base mesh's lip joints and the figure's mouth sits a
      // centimetre higher, so the fade at its top edge reaches a little way in.
      if (y > 0.72 || y < 0.58 || z > 0.17) expect(mask[v], `vertex ${v}`).toBeLessThan(0.01);
      // The nostrils (up and forward of the lips) are never the mouth's.
      if (y > 0.694 && z > 0.14) expect(mask[v], `vertex ${v}`).toBeLessThan(0.01);
    }
  });

  it("is open without body occlusion data, which seeds it", () => {
    const old = { ...bodyManifest } as BodyManifest;
    delete old.bodyOcclusion;
    const bare = parseHumanoidAssets({ ...bodyPackData(), manifest: old });
    expect(MOUTH_INTERIOR_LAYER.fields(bare).mask.every((m) => m === 0)).toBe(true);
  });

  it("spreads from the lips' inner edge to the mouth's far end, where no ray measures it", () => {
    // The far end: well behind the lips, in the pocket's open end, where the pack's
    // enclosure is partial (the rays leave through the open end) yet the surface is lining.
    const far = [...visible].filter((v) => {
      const [x, y, z] = at(v);
      return Math.abs(x) < 0.01 && y > 0.63 && y < 0.67 && z > 0.085 && z < 0.12;
    });
    expect(far.length).toBeGreaterThan(5);
    expect(far.filter((v) => (mask[v] as number) > 0.9).length / far.length).toBeGreaterThan(0.6);
    // Its enclosure alone does not mark it: spreading is what reaches it.
    expect(far.filter((v) => restValue(v) > 0.6).length).toBeGreaterThan(0);
    // The back wall the open jaw shows, a hand's breadth behind the lips, is lining too.
    const wall = [...visible].filter((v) => {
      const [x, y, z] = at(v);
      return Math.abs(x) < 0.015 && y > 0.64 && y < 0.67 && z > 0.03 && z < 0.065;
    });
    expect(wall.length).toBeGreaterThan(3);
    expect(wall.every((v) => (mask[v] as number) > 0.9)).toBe(true);
  });

  it("paints a colour redder than the skin at every tone, and darker on deeper skin", () => {
    const albedos = [0, 0.25, 0.5, 0.75, 1].map((melanin) => {
      const tone = { melanin, haemoglobin: 0.5, undertone: 0, override: null };
      const paint = MOUTH_INTERIOR_LAYER.paint({
        tone,
        flush: 0.45,
        lips: 0.55,
        areola: 0.5,
        signals: {},
      });
      expect(paint.strength).toBeGreaterThan(0.8);
      const [r, g, b] = paint.stops[0] as [number, number, number];
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThanOrEqual(b * 0.9);
      // Redder than the skin in CIELAB: its a* above the skin's and its hue turned toward red.
      const mucosa = lchFromLab(labFromLinear([r, g, b]));
      const skin = lchFromLab(labFromLinear(skinAlbedo(tone)));
      expect(mucosa[2]).toBeLessThan(skin[2] - 8);
      expect(labFromLinear([r, g, b])[1]).toBeGreaterThan(labFromLinear(skinAlbedo(tone))[1] + 3);
      return luminance([r, g, b]);
    });
    expect(albedos[4]).toBeLessThan(albedos[0] as number);
  });
});
