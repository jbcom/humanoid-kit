import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { planAtlas } from "../src/surface/atlasPlan.ts";
import { ADULT_ONLY_BODY_HAIR, bodyHairCoverage } from "../src/surface/bodyHair.ts";
import { HAIR_COLOURS, hairAlbedo } from "../src/surface/hairTone.ts";
import {
  applyLayers,
  isAdultLayer,
  layerUsesCoordinate,
  MAX_STRAND_COVER,
  paintStopTable,
  type SkinPaintInput,
  STOP_TABLE_WIDTH,
  type StrandLayer,
  strandCover,
} from "../src/surface/layers.ts";
import {
  BEARD_LAYERS,
  BODY_HAIR_LAYERS,
  bodyHairInput,
  bodyHairMasks,
  TERMINAL_HAIR_LAYERS,
  VELLUS_LAYER,
} from "../src/surface/regions/bodyHair.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { LIPS_LAYER } from "../src/surface/regions/rest.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import type { Rgb } from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const P = assets.positions;
const tone = { melanin: 0.35, haemoglobin: 0.5, undertone: 0, override: null };
const input = (
  age: number,
  gender: number,
  extra: Partial<SkinPaintInput> = {},
): SkinPaintInput => ({
  tone,
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
  signals: {},
  age,
  gender,
  adult: age >= 18,
  ...extra,
});
const ADULT_ONLY_LAYERS = TERMINAL_HAIR_LAYERS.filter((l) => l.adultOnly);
/** Layer `l`'s row of a table painted for `layers`. */
const row = (layers: readonly StrandLayer[], l: number, table: Float32Array) => {
  expect(table.length).toBe(layers.length * STOP_TABLE_WIDTH * 4);
  return table.subarray(l * STOP_TABLE_WIDTH * 4, (l + 1) * STOP_TABLE_WIDTH * 4);
};

describe("the body hair layers", () => {
  it("are body layers in the stack, after every other body layer, and read no coordinate", () => {
    const ids = SKIN_LAYERS.filter((l) => !isAdultLayer(l)).map((l) => l.id);
    expect(ids.slice(-BODY_HAIR_LAYERS.length)).toEqual(BODY_HAIR_LAYERS.map((l) => l.id));
    for (const l of BODY_HAIR_LAYERS) {
      expect(isAdultLayer(l)).toBe(false);
      expect(layerUsesCoordinate(l)).toBe(false);
    }
  });

  it("mark exactly the axillary and pubic layers adult-only", () => {
    expect(ADULT_ONLY_LAYERS.map((l) => l.id).sort()).toEqual(["hair-axillary", "hair-pubic"]);
    expect(ADULT_ONLY_BODY_HAIR).toHaveLength(ADULT_ONLY_LAYERS.length);
  });

  it("paint no terminal hair on a child, and vellus at every age", () => {
    const table = paintStopTable(BODY_HAIR_LAYERS, input(8, 1));
    BODY_HAIR_LAYERS.forEach((l, k) => {
      const strength = table[k * STOP_TABLE_WIDTH * 4] as number;
      if (l === VELLUS_LAYER) expect(strength).toBe(1);
      else expect(strength, l.id).toBe(0);
    });
    for (const age of [1, 40, 90])
      expect(paintStopTable([VELLUS_LAYER], input(age, 0.5))[0]).toBe(1);
  });

  it("paint an adult man's chest, legs and stubble from the coverage model", () => {
    const i = input(35, 1);
    const table = paintStopTable(TERMINAL_HAIR_LAYERS, i);
    const chest = TERMINAL_HAIR_LAYERS.findIndex((l) => l.id === "hair-chest");
    expect(row(TERMINAL_HAIR_LAYERS, chest, table)[0]).toBeCloseTo(
      bodyHairCoverage("chest", bodyHairInput(i)),
    );
    const beard = paintStopTable(BEARD_LAYERS, i);
    // Stubble by default: every beard part, a millimetre long.
    BEARD_LAYERS.forEach((_, k) => {
      expect(row(BEARD_LAYERS, k, beard)[0]).toBeGreaterThan(0.9);
      expect(row(BEARD_LAYERS, k, beard)[3]).toBeCloseTo(1);
    });
  });

  it("grow only the parts a beard style names", () => {
    const moustache = paintStopTable(
      BEARD_LAYERS,
      input(35, 1, { bodyHair: { beard: "moustache" } }),
    );
    const strengths = BEARD_LAYERS.map((_, k) => row(BEARD_LAYERS, k, moustache)[0]);
    expect(strengths[0]).toBeGreaterThan(0.9);
    expect(strengths.slice(1)).toEqual([0, 0]);
    const none = paintStopTable(BEARD_LAYERS, input(35, 1, { bodyHair: { beard: "none" } }));
    expect(BEARD_LAYERS.map((_, k) => row(BEARD_LAYERS, k, none)[0])).toEqual([0, 0, 0]);
  });

  it("colour terminal hair from the figure's pigments", () => {
    const black = paintStopTable(
      TERMINAL_HAIR_LAYERS,
      input(30, 1, { hairColour: HAIR_COLOURS.black as never }),
    );
    const blond = paintStopTable(
      TERMINAL_HAIR_LAYERS,
      input(30, 1, { hairColour: HAIR_COLOURS.blonde as never }),
    );
    // Texel 1 of the legs' row is the hair's albedo.
    const legs = TERMINAL_HAIR_LAYERS.findIndex((l) => l.id === "hair-legs");
    const at = (t: Float32Array) => row(TERMINAL_HAIR_LAYERS, legs, t)[4] as number;
    expect(at(black)).toBeLessThan(at(blond));
    expect(at(black)).toBeLessThan((hairAlbedo(HAIR_COLOURS.blonde as never) as Rgb)[0]);
  });
});

describe("the adult-only gate on axillary and pubic hair", () => {
  it("paints them at zero for any figure under 18, whatever the recipe asks", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 17.999, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (age, gender, m) => {
          const t = paintStopTable(
            ADULT_ONLY_LAYERS,
            input(age, gender, { bodyHair: { density: { axillary: m, pubic: m } } }),
          );
          for (let k = 0; k < ADULT_ONLY_LAYERS.length; k++)
            expect(row(ADULT_ONLY_LAYERS, k, t)[0]).toBe(0);
        },
      ),
    );
  });

  it("fails closed: an input that does not say the figure is an adult paints none, even at 40", () => {
    const { adult: _, ...unsaid } = input(40, 1);
    const t = paintStopTable(ADULT_ONLY_LAYERS, unsaid);
    for (let k = 0; k < ADULT_ONLY_LAYERS.length; k++)
      expect(row(ADULT_ONLY_LAYERS, k, t)[0]).toBe(0);
    const lying = paintStopTable(ADULT_ONLY_LAYERS, { ...input(12, 1), adult: true });
    for (let k = 0; k < ADULT_ONLY_LAYERS.length; k++)
      expect(row(ADULT_ONLY_LAYERS, k, lying)[0]).toBe(0);
  });

  it("paints them for an adult", () => {
    const t = paintStopTable(ADULT_ONLY_LAYERS, input(30, 0));
    for (let k = 0; k < ADULT_ONLY_LAYERS.length; k++)
      expect(row(ADULT_ONLY_LAYERS, k, t)[0]).toBeGreaterThan(0.5);
  });
});

describe("strand layers in the stop table", () => {
  const layer = TERMINAL_HAIR_LAYERS.find((l) => l.id === "hair-legs") as StrandLayer;
  const i = input(30, 1);
  const p = layer.paint(i);
  const t = paintStopTable([layer], i);

  it("store density per cm², length and width in mm and the hair's albedo", () => {
    expect([...t.subarray(0, 4)]).toEqual([
      expect.closeTo(p.strength, 6),
      6,
      expect.closeTo(p.density, 6),
      expect.closeTo(p.length * 1e3, 6),
    ]);
    expect([...t.subarray(4, 8)].map((x) => +x.toFixed(6))).toEqual(
      [...p.colour, p.width * 1e3].map((x) => +x.toFixed(6)),
    );
    expect(t[8]).toBeCloseTo(p.height * 1e3, 6);
  });

  it("apply, seen from afar, their mean cover toward the hair's colour", () => {
    const base: Rgb = [0.5, 0.4, 0.3];
    const cover = strandCover(p);
    expect(cover).toBeGreaterThan(0.02);
    expect(cover).toBeLessThanOrEqual(MAX_STRAND_COVER);
    const out = applyLayers(base, t, [[1, 0]]);
    out.forEach((c, k) => {
      const b = base[k] as number;
      expect(c).toBeCloseTo(b + ((p.colour[k] as number) - b) * cover, 5);
    });
    expect(applyLayers(base, t, [[0, 0]])).toEqual(base);
  });

  it("add no mean cover for vellus, which the measured skin albedo already holds", () => {
    const base: Rgb = [0.5, 0.4, 0.3];
    const vellus = paintStopTable([VELLUS_LAYER], i);
    expect(vellus[9]).toBe(1);
    expect(strandCover(VELLUS_LAYER.paint(i))).toBeGreaterThan(0);
    expect(applyLayers(base, vellus, [[1, 0]])).toEqual(base);
    expect(t[9]).toBe(0);
  });

  it("refuse a strand of no length, width or density", () => {
    const bad: StrandLayer = { ...layer, paint: () => ({ ...p, width: 0 }) };
    expect(() => paintStopTable([bad], i)).toThrow(RangeError);
  });
});

describe("the field atlas", () => {
  it("gives vellus, on all the skin, no channel", () => {
    const body = new HumanoidModel(assets, { subdivision: 1 }).topology().body;
    const plan = body.plan;
    const v = SKIN_LAYERS.indexOf(VELLUS_LAYER);
    expect(plan.value[v]).toBe(-1);
    expect(plan.coord[v]).toBe(-1);
    // And a plan without a surface agrees.
    expect(planAtlas([VELLUS_LAYER]).channels).toBe(0);
  });
});

describe("the body hair masks", () => {
  const masks = bodyHairMasks(assets);
  const zones = skinZones(assets);
  const lips = LIPS_LAYER.fields(assets).mask;
  const centroid = (m: Float32Array) => {
    const c = [0, 0, 0];
    let w = 0;
    m.forEach((x, v) => {
      for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + x * (P[v * 3 + k] as number);
      w += x;
    });
    return c.map((s) => s / w);
  };

  it("keep hair off the lips, palms and soles", () => {
    for (const [name, m] of Object.entries(masks))
      m.forEach((x, v) => {
        if (
          (lips[v] as number) > 0.99 ||
          (zones.palm[v] as number) > 0.99 ||
          (zones.sole[v] as number) > 0.99
        )
          expect(x, `${name} at ${v}`).toBeLessThan(0.05);
      });
  });

  it("put the beard below the eyes and the pubic hair low on the front midline", () => {
    const eyeY = 0.728;
    for (const part of ["moustache", "chin", "cheeks"] as const) {
      const c = centroid(masks[part]);
      expect(c[1], part).toBeLessThan(eyeY);
    }
    const pubic = centroid(masks.pubic);
    expect(Math.abs(pubic[0] as number)).toBeLessThan(0.01);
    expect(pubic[2]).toBeGreaterThan(0.05);
    // Below the navel (y ≈ 0.18) and above the knees.
    expect(pubic[1]).toBeLessThan(0.12);
    expect(pubic[1]).toBeGreaterThan(-0.1);
  });

  it("put axillary hair in each armpit, not on the chest's front", () => {
    let left = 0;
    let right = 0;
    masks.axillary.forEach((x, v) => {
      if (x < 0.5) return;
      if ((P[v * 3] as number) > 0) left++;
      else right++;
      expect(Math.abs(P[v * 3] as number)).toBeGreaterThan(0.09);
    });
    expect(left).toBeGreaterThan(10);
    expect(right).toBeGreaterThan(10);
  });

  it("keep the adult-only regions out of every other group's mask", () => {
    for (const name of ["chest", "abdomen", "back", "buttocks", "arms", "legs"] as const)
      masks[name].forEach((x, v) => {
        if ((masks.pubic[v] as number) > 0.99 || (masks.axillary[v] as number) > 0.99)
          expect(x, `${name} at ${v}`).toBeLessThan(0.02);
      });
  });
});
