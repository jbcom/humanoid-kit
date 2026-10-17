import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { ANAL_CANAL } from "../scripts/lib/detail/canal.ts";
import { skinOf } from "../scripts/lib/detail/contact.ts";
import {
  ERECT_GIRTH,
  ERECT_LENGTH,
  PHALLUS_GIRTH,
  PHALLUS_KEYS,
  PHALLUS_LENGTH,
  PHALLUS_SIZE,
  SculptedPhallus,
} from "../scripts/lib/detail/phallus.ts";
import { type RootShape, reservoirRoot, restShape } from "../scripts/lib/detail/root.ts";
import { TESTES_SIZE } from "../scripts/lib/detail/scrotum.ts";
import { maleParts } from "../scripts/lib/detail/sculpt.ts";
import { ensureSculptSources } from "../scripts/lib/detail/sculptSources.ts";
import { VULVA_SIZE } from "../scripts/lib/detail/vulva.ts";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { STATE_MORPHS } from "../src/makehuman/stateMorphs.ts";
import { shapeSignalNames } from "../src/model/detailFactors.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import { genitalAlbedo } from "../src/surface/genitalTone.ts";
import { paintStopTable, STOP_TABLE_WIDTH } from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import type { SkinTone } from "../src/surface/skinTone.ts";
import { adultManifest, adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

// The sculpts are fetched and verified, and their cuts regenerated, not committed.
await ensureSculptSources();

const withAdult = loadFixtureAssets(true);
const core = loadFixtureAssets();
const adultModel = new HumanoidModel(withAdult, { subdivision: 1 });
const coreModel = new HumanoidModel(core, { subdivision: 0 });
const adult = createRecipe({ macros: AUTHORING_FIGURE.macros });
/**
 * An adult with no organ and no testes. Left unset, an adult with the pack takes its
 * default anatomy for its gender (`AdultAnatomySpec.defaults`) and has both.
 */
const bare = createRecipe({
  macros: AUTHORING_FIGURE.macros,
  modifiers: { [PHALLUS_SIZE]: 0, [TESTES_SIZE]: 0, [VULVA_SIZE]: 0, [ANAL_CANAL]: 0 },
});
/** The organ's default key: Veale's pooled means, flaccid. */
const DEFAULT_KEY = PHALLUS_KEYS.find((k) => k.length === 0.0916);
if (!DEFAULT_KEY) throw new Error("no default phallus key");
/** An adult with the organ at its default size, and no testes. */
const organ = createRecipe({
  macros: AUTHORING_FIGURE.macros,
  modifiers: { [PHALLUS_SIZE]: DEFAULT_KEY.size, [TESTES_SIZE]: 0 },
});

/**
 * How far the organ's tip stands from where the skin is without it: the largest
 * displacement any vertex of the adult surface has from the figure with no organ.
 */
function reach(signals: Record<string, number>) {
  const a = adultModel.evaluate(bare).positions;
  const b = adultModel.evaluate(organ, signals).positions;
  let far = 0;
  for (let v = 0; v < a.length / 3; v++)
    far = Math.max(
      far,
      Math.hypot(...[0, 1, 2].map((k) => (b[v * 3 + k] as number) - (a[v * 3 + k] as number))),
    );
  return far;
}

/** The same quantity for the authored shapes: the largest move of any vertex from rest. */
function authoredReach(shape: RootShape, rest: RootShape) {
  return Math.max(
    ...shape.map((p, i) => {
      const q = rest[i] as readonly number[];
      return Math.hypot(...[0, 1, 2].map((k) => (p[k] as number) - (q[k] as number)));
    }),
  );
}

describe("engorgement as a drive of the organ's targets", { timeout: 300_000 }, () => {
  it("raises the organ by the measured growth at full arousal: the authored erect shape, not a fixed size", () => {
    // Erect against flaccid, measured: length +43% and circumference +25% (Veale's pooled
    // means, 13.12 / 9.16 and 11.66 / 9.31 cm; docs/research/ADULT-ANATOMY-DATA.md, F).
    // scripts/lib/detail/phallus.ts scales its flaccid and erect sculpts to those numbers,
    // and the surface must show what it built, so the surface's reach grows as the shapes' does.
    const lattice = adultModel.adultDetailLattice(AUTHORING_FIGURE);
    const spec = adultManifest.anatomy?.reservoirs?.find((r) => r.id === "phallic");
    if (!lattice || !spec) throw new Error("no phallic reservoir");
    const root = reservoirRoot(lattice, spec);
    const parts = maleParts(adultModel.assets, adultModel.controlShape(AUTHORING_FIGURE).control);
    const skin = skinOf(
      lattice,
      (adultManifest.anatomy?.reservoirs ?? []).map((r) => r.cap),
    );
    const sculpted = new SculptedPhallus(root, parts.phallus, skin);
    const rest = restShape(root);
    const expected =
      authoredReach(sculpted.shape(DEFAULT_KEY, { state: 1 }), rest) /
      authoredReach(sculpted.shape(DEFAULT_KEY), rest);
    expect(reach({ arousal: 1 }) / reach({})).toBeCloseTo(expected, 3);
    // The numbers the shapes were built from.
    expect(ERECT_LENGTH).toBeCloseTo(1.43, 2);
    expect(ERECT_GIRTH).toBeCloseTo(1.25, 2);
  });

  it("scales with the signal and leaves the figure exactly as it is without one", () => {
    // Half the signal moves the organ, and not to where the full one does. (The tip's
    // straight reach need not grow from midway to erect: the erect shaft rises in a curve
    // from a root that faces down; its length does, phallus.test.ts.)
    const rest = reach({});
    const half = reach({ arousal: 0.5 });
    const full = reach({ arousal: 1 });
    expect(half).toBeGreaterThan(rest);
    expect(full).toBeGreaterThan(rest);
    const at = (arousal: number) => Array.from(adultModel.evaluate(organ, { arousal }).positions);
    expect(at(0.5)).not.toEqual(at(1));
    const a = adultModel.evaluate(organ).positions;
    const b = adultModel.evaluate(organ, { arousal: 0 }).positions;
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("moves no genital skin in a figure that has no organ, whatever the signal", () => {
    // Arousal also fills the lips and raises the nipples (#118): every other vertex stays.
    const swelling = new Set<number>();
    for (const m of adultManifest.anatomy?.stateMorphs ?? [])
      for (const t of m.targets)
        for (const v of withAdult.targets.get(t.name)?.indices ?? []) swelling.add(v);
    expect(swelling.size).toBeGreaterThan(0);
    const rest = adultModel.evaluate(bare).control.slice();
    const aroused = adultModel.evaluate(bare, { arousal: 1 }).control;
    for (let v = 0; v < rest.length / 3; v++) {
      if (swelling.has(v)) continue;
      for (let k = 0; k < 3; k++)
        expect(aroused[v * 3 + k], `control vertex ${v}`).toBe(rest[v * 3 + k]);
    }
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
    // The signal is the adult pack's: the body's own state morphs never name it, the pack's spec does.
    expect(shapeSignalNames(STATE_MORPHS)).not.toContain("arousal");
    expect(shapeSignalNames(STATE_MORPHS, adultManifest.anatomy)).toContain("arousal");
  });

  it("is the adult pack's own: without the pack's spec the signal drives nothing", () => {
    // A pack without `anatomy` has no drives, so arousal has no shape response.
    const { anatomy: _spec, ...bare } = adultManifest;
    const noSpec = new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), { ...adultPackData(), manifest: bare }),
      { subdivision: 0 },
    );
    const rest = noSpec.evaluate(adult).control;
    expect(Array.from(noSpec.evaluate(adult, { arousal: 1 }).control)).toEqual(Array.from(rest));
  });

  it("waits for the adult stage while its targets are pending, for a figure that has the organ", () => {
    // The adult manifest loaded, its targets not yet (the last stage).
    const pending = parseHumanoidAssets(bodyPackData(), { manifest: adultManifest });
    const model = new HumanoidModel(pending, { subdivision: 0 });
    expect([...model.pendingTargetFiles(organ, { arousal: 1 })]).toEqual(["adult"]);
    // A figure without it needs nothing of the adult file for the signal.
    expect([...model.pendingTargetFiles(bare, { arousal: 1 })]).toEqual([]);
    expect([...model.pendingTargetFiles(organ, { cold: 1 })]).toEqual(["adult"]);
    expect(() => model.evaluate(organ, { arousal: 1 })).toThrow(/have not loaded yet/);
  });

  it("drives only adult-pack detail targets, each an adult-only name, from the pack's spec", () => {
    const detail = adultManifest.anatomy?.detail;
    const shipped = new Set(adultManifest.targets.entries.map((e) => e.name));
    const aroused = Object.entries(detail?.drives ?? {}).filter(([, f]) =>
      f.some((x) => x.startsWith("sramp:arousal:")),
    );
    expect(aroused.length).toBeGreaterThan(0);
    for (const [name] of aroused) {
      expect(shipped.has(name), name).toBe(true);
      expect(detail?.targets).toContain(name);
      expect(name.startsWith("genitals/"), name).toBe(true);
    }
    // The body's own state morphs (cold) stay in the body pack, and none is arousal's.
    expect(STATE_MORPHS.some((m) => m.signal === "arousal")).toBe(false);
    for (const m of STATE_MORPHS)
      for (const t of m.targets) expect(shipped.has(t.name), t.name).toBe(false);
  });

  it("offers the controls it scales with, so a size, a length and a girth can be asked for", () => {
    for (const id of [PHALLUS_SIZE, PHALLUS_LENGTH, PHALLUS_GIRTH])
      expect(
        adultManifest.modifiers.some((m) => m.id === id),
        id,
      ).toBe(true);
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
    const shaped = { adult: true, anatomy: { phallus: 1 } };
    expect(stop(at({ arousal: 1 }, shaped))).not.toEqual(stop(at({}, shaped)));
    for (const over of [
      { adult: false, anatomy: { phallus: 1 } },
      { adult: true, anatomy: {} },
    ]) {
      const t = at({ arousal: 1 }, over);
      expect(t[row]).toBe(0);
      expect(stop(t)).toEqual([0, 0, 0]);
    }
  });
});

describe("the lips and nipples under arousal (#118)", { timeout: 300_000 }, () => {
  const woman = createRecipe({ macros: { age: 30, gender: 0 } });
  /** The largest move arousal makes at the vertices one body target moves. */
  const swell = (model: HumanoidModel, assets: typeof withAdult, target: string) => {
    const t = assets.targets.get(target);
    if (!t) throw new Error(`no target ${target}`);
    const a = model.evaluate(woman).control.slice();
    const b = model.evaluate(woman, { arousal: 1 }).control;
    let far = 0;
    for (const v of t.indices)
      far = Math.max(
        far,
        Math.hypot(...[0, 1, 2].map((k) => (b[v * 3 + k] as number) - (a[v * 3 + k] as number))),
      );
    return far;
  };

  it("fills the lips and raises the nipples, through the adult pack's own state morphs", () => {
    const morph = adultManifest.anatomy?.stateMorphs.find((m) => m.signal === "arousal");
    const names = morph?.targets.map((t) => t.name) ?? [];
    for (const n of [
      "mouth/mouth-upperlip-volume-incr",
      "mouth/mouth-lowerlip-volume-incr",
      "breast/nipple-point-incr",
    ])
      expect(names, n).toContain(n);
    // A visible change at full arousal: a fraction of a millimetre at the lips, more at the nipple.
    expect(swell(adultModel, withAdult, "mouth/mouth-upperlip-volume-incr")).toBeGreaterThan(3e-4);
    expect(swell(adultModel, withAdult, "mouth/mouth-lowerlip-volume-incr")).toBeGreaterThan(3e-4);
    expect(swell(adultModel, withAdult, "breast/nipple-point-incr")).toBeGreaterThan(5e-4);
  });

  it("leaves them still without the adult pack, and never names arousal in the body's morphs", () => {
    expect(swell(coreModel, core, "mouth/mouth-upperlip-volume-incr")).toBe(0);
    expect(shapeSignalNames(STATE_MORPHS)).not.toContain("arousal");
  });
});
