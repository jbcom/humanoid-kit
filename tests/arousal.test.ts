import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { STATE_MORPHS, stateContributions } from "../src/makehuman/stateMorphs.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import { genitalAlbedo } from "../src/surface/genitalTone.ts";
import { paintStopTable, STOP_TABLE_WIDTH } from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import type { SkinTone } from "../src/surface/skinTone.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const withAdult = loadFixtureAssets(true);
const core = loadFixtureAssets();
const adultModel = new HumanoidModel(withAdult, { subdivision: 0 });
const coreModel = new HumanoidModel(core, { subdivision: 0 });
const adult = createRecipe({ macros: { age: 30, gender: 0.5 } });

/**
 * The shaft as the length target sees it: the vertices that target moves, along
 * its mean displacement direction. Length is their extent along that axis and
 * radius their mean distance from the axis through their rest centroid, so a
 * circumference change reads as the same relative change in radius.
 */
function shaft() {
  const t = withAdult.targets.get("genitals/penis-length-incr");
  if (!t) throw new Error("no length target");
  const verts = [...t.indices];
  const d = [0, 0, 0];
  for (let i = 0; i < verts.length; i++)
    for (let k = 0; k < 3; k++) d[k] = (d[k] as number) + (t.deltas[i * 3 + k] as number);
  const norm = Math.hypot(...d);
  const axis = d.map((x) => x / norm);
  const rest = adultModel.evaluate(adult).control;
  const centre = [0, 1, 2].map(
    (k) => verts.reduce((s, v) => s + (rest[v * 3 + k] as number), 0) / verts.length,
  );
  return (control: Float32Array) => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let radius = 0;
    for (const v of verts) {
      const q = [0, 1, 2].map((k) => (control[v * 3 + k] as number) - (centre[k] as number));
      const s = q.reduce((sum, x, k) => sum + x * (axis[k] as number), 0);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
      radius += Math.hypot(...q.map((x, k) => x - s * (axis[k] as number))) / verts.length;
    }
    return { length: hi - lo, radius };
  };
}

describe("engorgement as a state morph", () => {
  it("raises the shaft's circumference by about 25% and its length by about 43% at full arousal", () => {
    // Erect against flaccid, measured: circumference +25% (Rigiscan, N=803,
    // +25.3%; Veale's nomograms, 11.66 / 9.31 cm), length +43% (13.12 / 9.16 cm)
    // (docs/research/SKIN-STATES.md, B4).
    const measure = shaft();
    const rest = measure(adultModel.evaluate(adult).control);
    const erect = measure(adultModel.evaluate(adult, { arousal: 1 }).control);
    const girth = erect.radius / rest.radius - 1;
    const length = erect.length / rest.length - 1;
    expect(girth).toBeGreaterThan(0.22);
    expect(girth).toBeLessThan(0.28);
    expect(length).toBeGreaterThan(0.39);
    expect(length).toBeLessThan(0.47);
  });

  it("scales with the signal and leaves the figure exactly as it is without one", () => {
    const measure = shaft();
    const rest = measure(adultModel.evaluate(adult).control);
    const half = measure(adultModel.evaluate(adult, { arousal: 0.5 }).control);
    const full = measure(adultModel.evaluate(adult, { arousal: 1 }).control);
    expect(half.radius).toBeGreaterThan(rest.radius);
    expect(half.radius).toBeLessThan(full.radius);
    const a = adultModel.evaluate(adult).control;
    const b = adultModel.evaluate(adult, { arousal: 0 }).control;
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("changes no rendered vertex today, since the targets deform helper-genital only", () => {
    // The penis targets move the helper-genital group, which the surface leaves
    // out (docs/ARCHITECTURE.md, "What phase 1 can show"): the drawn body is the same.
    const rest = adultModel.evaluate(adult);
    const erect = adultModel.evaluate(adult, { arousal: 1 });
    expect(Array.from(erect.positions)).toEqual(Array.from(rest.positions));
    expect(Array.from(erect.control)).not.toEqual(Array.from(rest.control));
  });

  it("is refused under 18 with or without the adult pack, and never reaches a target there", () => {
    const teen = createRecipe({ macros: { age: 15 } });
    for (const m of [adultModel, coreModel]) {
      expect(() => m.evaluate(teen, { arousal: 0.2 })).toThrow(AgePolicyError);
      expect(() => m.pendingTargetFiles(teen, { arousal: 0.2 })).toThrow(AgePolicyError);
      expect(() => m.evaluate(teen, { arousal: 0, cold: 1 })).not.toThrow();
    }
  });

  it("applies only where the targets exist: with no adult pack the figure is simply unchanged", () => {
    const rest = coreModel.evaluate(adult).control;
    const aroused = coreModel.evaluate(adult, { arousal: 1 }).control;
    expect(Array.from(aroused)).toEqual(Array.from(rest));
    // Names only targets the loaded packs know, so nothing unknown reaches the evaluation.
    const morphs = [...STATE_MORPHS, ...(adultManifest.anatomy?.stateMorphs ?? [])];
    expect(
      stateContributions({ arousal: 1 }, morphs, (name) => core.targetFileOf.has(name)),
    ).toEqual([]);
    expect(
      stateContributions({ arousal: 1 }, morphs, (name) => withAdult.targetFileOf.has(name)).map(
        (c) => c.target,
      ),
    ).toEqual(["genitals/penis-circ-incr", "genitals/penis-length-incr"]);
  });

  it("is the adult pack's own state morph: without the pack's spec the signal drives nothing", () => {
    // A pack without `anatomy` adds no state morphs, so arousal has no shape response.
    const { anatomy: _spec, ...bare } = adultManifest;
    const noSpec = new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), { ...adultPackData(), manifest: bare }),
      { subdivision: 0 },
    );
    const rest = noSpec.evaluate(adult).control;
    expect(Array.from(noSpec.evaluate(adult, { arousal: 1 }).control)).toEqual(Array.from(rest));
  });

  it("waits for the adult stage while its targets are pending", () => {
    // The adult manifest loaded, its targets not yet (the last stage).
    const pending = parseHumanoidAssets(bodyPackData(), { manifest: adultManifest });
    const model = new HumanoidModel(pending, { subdivision: 0 });
    expect([...model.pendingTargetFiles(adult, { arousal: 1 })]).toEqual(["adult"]);
    expect([...model.pendingTargetFiles(adult, { cold: 1 })]).toEqual([]);
    expect(() => model.evaluate(adult, { arousal: 1 })).toThrow(/have not loaded yet/);
  });

  it("drives only adult-pack targets, each of them an adult-only target, from the pack's spec", () => {
    const arousal = adultManifest.anatomy?.stateMorphs.find((m) => m.signal === "arousal");
    expect(arousal?.targets.length).toBeGreaterThan(0);
    const shipped = new Set(adultManifest.targets.entries.map((e) => e.name));
    for (const t of arousal?.targets ?? []) expect(shipped.has(t.name), t.name).toBe(true);
    // The body's own state morphs (cold) stay in the body pack, and none is arousal's.
    expect(STATE_MORPHS.some((m) => m.signal === "arousal")).toBe(false);
    for (const m of STATE_MORPHS)
      for (const t of m.targets) expect(shipped.has(t.name), t.name).toBe(false);
  });
});

describe("colour deepening with arousal (modelled, not calibrated)", () => {
  const tones: SkinTone[] = [0, 0.25, 0.5, 0.75, 1].map((melanin) => ({
    melanin,
    haemoglobin: 0.5,
    undertone: 0,
    override: null,
  }));

  it("reddens every natural tone at the sites that carry blood, and moves nothing at the mound", () => {
    const a = (rgb: [number, number, number]) => labFromLinear(rgb)[1];
    for (const tone of tones) {
      for (const site of ["shaft", "glans", "scrotum"] as const) {
        const rest = a(genitalAlbedo(tone, site, 0));
        const aroused = a(genitalAlbedo(tone, site, 1));
        expect(aroused, `${site} at melanin ${tone.melanin}`).toBeGreaterThan(rest);
      }
      expect(genitalAlbedo(tone, "mound", 1)).toEqual(genitalAlbedo(tone, "mound", 0));
    }
  });

  it("deepens by a visible amount at every tone, never pinned by the haemoglobin ceiling", () => {
    // A site whose rest colour already sat at the ceiling would not deepen at
    // all; the deepening is a fraction of the headroom, so it always shows.
    for (const tone of tones)
      for (const site of ["shaft", "glans", "scrotum"] as const) {
        const d =
          labFromLinear(genitalAlbedo(tone, site, 1))[1] -
          labFromLinear(genitalAlbedo(tone, site, 0))[1];
        expect(d, `${site} at melanin ${tone.melanin}`).toBeGreaterThan(0.3);
      }
  });

  it("reddens a non-natural colour by lowering green and blue, and clamps the signal", () => {
    const tone: SkinTone = {
      melanin: 0.5,
      haemoglobin: 0.5,
      undertone: 0,
      override: [0.2, 0.5, 0.3],
    };
    const rest = genitalAlbedo(tone, "glans", 0);
    const aroused = genitalAlbedo(tone, "glans", 1);
    expect(aroused[0]).toBeCloseTo(rest[0], 9);
    expect(aroused[1]).toBeLessThan(rest[1]);
    expect(aroused[2]).toBeLessThan(rest[2]);
    expect(genitalAlbedo(tone, "glans", 5)).toEqual(aroused);
    expect(genitalAlbedo(tone, "glans", -1)).toEqual(rest);
  });

  it("reaches the stop table only for an adult who applies the anatomy", () => {
    const tone = tones[1] as SkinTone;
    const base = { tone, flush: 0.4, lips: 0.5, areola: 0.5 };
    const row = SKIN_LAYERS.findIndex((l) => l.id === "penis-skin") * STOP_TABLE_WIDTH * 4;
    const stop = (t: Float32Array) => Array.from(t.slice(row + 4, row + 7));
    const at = (signals: Record<string, number>, over: object) =>
      paintStopTable(SKIN_LAYERS, { ...base, signals, ...over });
    const shaped = { adult: true, anatomy: { penis: 1 } };
    expect(stop(at({ arousal: 1 }, shaped))).not.toEqual(stop(at({}, shaped)));
    for (const over of [
      { adult: false, anatomy: { penis: 1 } },
      { adult: true, anatomy: {} },
    ]) {
      const t = at({ arousal: 1 }, over);
      expect(t[row]).toBe(0);
      expect(stop(t)).toEqual([0, 0, 0]);
    }
  });
});
