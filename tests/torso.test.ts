import { describe, expect, it } from "vitest";
import { groupFaces, jointPosition } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { bodySurface } from "../src/surface/regions/once.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import {
  AREOLA_EDGE_SOFTNESS,
  AREOLA_LAYER,
  AREOLA_REACH,
  AREOLA_RELIEF_LAYER,
  areolaStretch,
  areolaZone,
  CLAVICLE_LAYER,
  CLAVICLE_PERIODS,
  LINEA_ALBA_LAYER,
  LINEA_NIGRA_LAYER,
  MONTGOMERY_LAYER,
  NAVEL_LAYER,
  NAVEL_REACH,
  navelCentre,
  RIB_LAYER,
  RIB_PERIODS,
  STRIAE_LAYER,
} from "../src/surface/regions/torso.ts";
import { orientationAtCoordinate } from "../src/surface/ridges.ts";
import { areolaAlbedo, luminance, type Rgb, skinAlbedo } from "../src/surface/skinTone.ts";
import {
  STRIA_SPACING,
  STRIAE_ORIENTATION_SEAM,
  striaeAmount,
  striaeColour,
  striaeMaturity,
} from "../src/surface/striae.ts";
import { areolaRadius, type FigureBuild, nippleContrast } from "../src/surface/torsoTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = { melanin: 0.6, haemoglobin: 0.5, undertone: 0, override: null };
const paint = (over: Partial<SkinPaintInput> = {}): SkinPaintInput => ({
  tone,
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals: {},
  ...over,
});
/** The layer's stops, as the colours they make of the tone's own skin (the stops are ratios to it). */
function stops(input: SkinPaintInput): Rgb[] {
  const t = paintStopTable([AREOLA_LAYER], input);
  const skin = skinAlbedo(input.tone);
  return Array.from({ length: STOP_COUNT }, (_, k) =>
    [0, 1, 2].map((c) => (t[(k + 1) * 4 + c] as number) * (skin[c] as number)),
  ) as Rgb[];
}
/** The colour at radius `r` metres from the nipple's centre: the stops, read as the shader reads them. */
function colourAt(s: Rgb[], r: number): Rgb {
  const x = Math.min(1, r / AREOLA_REACH) * (STOP_COUNT - 1);
  const i = Math.min(Math.floor(x), STOP_COUNT - 2);
  const f = x - i;
  return [0, 1, 2].map(
    (k) => (s[i]?.[k] as number) * (1 - f) + (s[i + 1]?.[k] as number) * f,
  ) as Rgb;
}
const adultFemale = { age: 30, build: { gender: 0, breastSize: 0.5 } };

describe("the areola zone", () => {
  const assets = loadFixtureAssets();
  const zone = areolaZone(assets);
  const P = assets.positions;
  const n = assets.manifest.vertexCount;

  it("is a disk of the reach round each nipple, solid inside and zero outside", () => {
    const t = assets.targets.get("breast/nipple-size-incr");
    if (!t) throw new Error("no nipple target");
    const centre = (side: number) => {
      const vs = [...t.indices].filter((v) => Math.sign(P[v * 3] as number) === side);
      return [0, 1, 2].map(
        (k) => vs.reduce((acc, v) => acc + (P[v * 3 + k] as number), 0) / vs.length,
      );
    };
    const centres = [centre(1), centre(-1)];
    // A vertex's distance to the nearest nipple.
    const dist = (v: number) =>
      Math.min(
        ...centres.map((c) =>
          Math.hypot(...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (c[k] as number))),
        ),
      );
    let inside = 0;
    for (let v = 0; v < n; v++) {
      const d = dist(v);
      if (d < 0.8 * AREOLA_REACH) {
        expect(zone.mask[v], `vertex ${v} inside`).toBeGreaterThan(0.95);
        inside++;
      }
      if (d > AREOLA_REACH) expect(zone.mask[v], `vertex ${v} outside`).toBe(0);
      // The radial coordinate is the distance in reaches, wherever the mask holds.
      if ((zone.mask[v] as number) > 0.5)
        expect(zone.radial[v], `vertex ${v} radial`).toBeCloseTo(Math.min(1, d / AREOLA_REACH), 5);
    }
    // Both nipples: a few dozen vertices each.
    expect(inside).toBeGreaterThan(40);
  });
});

describe("the areola's colour", () => {
  const skin = skinAlbedo(tone);
  const lum = (c: Rgb) => luminance(c);

  it("is the skin's at the reach, the areola's inside its radius and the nipple's at the centre", () => {
    const s = stops(paint(adultFemale));
    const R = areolaRadius(30, 0, 0.5);
    const outer = s[STOP_COUNT - 1] as Rgb;
    for (let k = 0; k < 3; k++) expect(outer[k]).toBeCloseTo(skin[k] as number, 6);
    const areola = areolaAlbedo(tone, 0.5);
    const mid = colourAt(s, 0.55 * R);
    for (let k = 0; k < 3; k++) expect(mid[k]).toBeCloseTo(areola[k] as number, 2);
    // At the centre the nipple: darker than the areola in an adult woman, by the measured ratio.
    expect(lum(s[0] as Rgb)).toBeLessThan(lum(areola));
    expect(lum(s[0] as Rgb) / lum(areola)).toBeCloseTo(nippleContrast(30, 0), 1);
  });

  it("makes the nipple lighter than the areola in a man", () => {
    const s = stops(paint({ age: 30, build: { gender: 1 } }));
    expect(lum(s[0] as Rgb)).toBeGreaterThan(lum(colourAt(s, 0.55 * areolaRadius(30, 1, 0.5))));
  });

  it("follows the figure's areola radius: the edge is farther out on an adult than on a child", () => {
    /** The radius at which the colour is half way from the areola's to the skin's. */
    const edge = (input: SkinPaintInput) => {
      const s = stops(input);
      const b = input.build as { gender: number };
      const inner = colourAt(s, 0.35 * areolaRadius(input.age as number, b.gender, 0.5));
      let r = 0.35 * areolaRadius(input.age as number, b.gender, 0.5);
      while (r < AREOLA_REACH && lum(colourAt(s, r)) < (lum(inner) + lum(skin)) / 2) r += 0.0001;
      return r;
    };
    const child = edge(paint({ age: 6, build: { gender: 0 } }));
    const teen = edge(paint({ age: 12.5, build: { gender: 0 } }));
    const adult = edge(paint(adultFemale));
    expect(child).toBeLessThan(teen);
    expect(teen).toBeLessThan(adult);
    // To within the resolution of eight stops across the reach.
    const resolution = AREOLA_REACH / (STOP_COUNT - 1);
    expect(Math.abs(adult - areolaRadius(30, 0, 0.5))).toBeLessThan(resolution);
    expect(Math.abs(child - areolaRadius(6, 0, 0.5))).toBeLessThan(resolution);
  });

  it("is paler before puberty than after, at the same areola setting", () => {
    const child = stops(paint({ age: 6, build: { gender: 0 } }));
    const adult = stops(paint(adultFemale));
    expect(lum(colourAt(child, 0.004))).toBeGreaterThan(lum(colourAt(adult, 0.004)));
  });

  it("multiplies the skin it sits on, so it leaves any skin's own colour at its edge", () => {
    const t = paintStopTable([AREOLA_LAYER], paint(adultFemale));
    expect(t[0]).toBe(1);
    expect(t[1]).toBe(1); // multiply
    expect(t.length).toBe(STOP_TABLE_WIDTH * 4);
    // The outer stop is the identity: nothing is done to the skin beyond the areola.
    for (let c = 0; c < 3; c++) expect(t[STOP_COUNT * 4 + c]).toBeCloseTo(1, 6);
    // Inside, the ratio darkens it.
    expect(t[4 + 1]).toBeLessThan(1);
  });

  it("paints with no age and no build, as for the default figure", () => {
    expect(() => stops(paint())).not.toThrow();
  });
});

describe("the areola's relief", () => {
  const assets = loadFixtureAssets();
  const zone = areolaZone(assets);
  const profile = (layer: SkinLayer, input: SkinPaintInput) => {
    const t = paintStopTable([layer], input);
    return Array.from({ length: STOP_COUNT }, (_, k) => t[(k + 1) * 4] as number);
  };
  /** The profile read at radius `r` metres, as the shader reads it. */
  const at = (p: number[], r: number) => {
    const x = Math.min(1, r / AREOLA_REACH) * (STOP_COUNT - 1);
    const i = Math.min(Math.floor(x), STOP_COUNT - 2);
    return (p[i] as number) * (1 - (x - i)) + (p[i + 1] as number) * (x - i);
  };

  it("shares the areola colour's fields: the zone's mask and its radial coordinate", () => {
    for (const layer of [AREOLA_RELIEF_LAYER, MONTGOMERY_LAYER]) {
      const f = layer.fields(assets);
      expect(Array.from(f.mask)).toEqual(Array.from(zone.mask));
      expect(Array.from(f.coord as Float32Array)).toEqual(Array.from(zone.radial));
    }
  });

  describe("the texture of the nipple and areola", () => {
    it("is bumps with a profile, strongest on the nipple, half as strong over the areola, none beyond it", () => {
      expect(AREOLA_RELIEF_LAYER.kind).toBe("detail");
      expect(AREOLA_RELIEF_LAYER.pattern).toBe("bumps");
      expect(AREOLA_RELIEF_LAYER.profiled).toBe(true);
      const p = profile(AREOLA_RELIEF_LAYER, paint(adultFemale));
      const R = areolaRadius(30, 0, 0.5);
      expect(at(p, 0.0005)).toBeGreaterThan(0.9);
      expect(at(p, 0.55 * R)).toBeGreaterThan(0.4);
      expect(at(p, 0.55 * R)).toBeLessThan(0.6);
      expect(at(p, R + 3 * AREOLA_EDGE_SOFTNESS * R)).toBeLessThan(0.02);
    });

    it("follows the areola's own radius, a child's being smaller", () => {
      const child = profile(AREOLA_RELIEF_LAYER, paint({ age: 6, build: { gender: 0 } }));
      const adult = profile(AREOLA_RELIEF_LAYER, paint(adultFemale));
      const r = 0.012; // inside an adult's areola, outside a child's
      expect(at(adult, r)).toBeGreaterThan(0.4);
      expect(at(child, r)).toBeLessThan(0.05);
    });

    it("is finer-grained and fainter than the relief of any hair-bearing skin, and gentler in a child", () => {
      const t = paintStopTable([AREOLA_RELIEF_LAYER], paint(adultFemale));
      const child = paintStopTable([AREOLA_RELIEF_LAYER], paint({ age: 6, build: { gender: 0 } }));
      // Header: strength, kind 7, height, spacing.
      expect(t[1]).toBe(7);
      expect(t[2]).toBeGreaterThan(0.00005);
      expect(t[2]).toBeLessThan(0.0003);
      expect(t[3]).toBeGreaterThan(0.0005);
      expect(t[3]).toBeLessThan(0.0015);
      expect(child[0]).toBeLessThan(t[0] as number);
      expect(child[0]).toBeGreaterThan(0);
    });
  });

  describe("the Montgomery tubercles", () => {
    /** Expected tubercles on one areola: the cells of the ring, each at its occupancy. */
    function tubercles(input: SkinPaintInput): number {
      const t = paintStopTable([MONTGOMERY_LAYER], input);
      const p = profile(MONTGOMERY_LAYER, input);
      const spacing = t[3] as number;
      let n = 0;
      const dr = 0.00005;
      for (let r = dr / 2; r < AREOLA_REACH; r += dr)
        n += (at(p, r) * 2 * Math.PI * r * dr) / spacing ** 2;
      return n;
    }

    it("is a layer of tubercles, 1 to 2 mm across", () => {
      expect(MONTGOMERY_LAYER.kind).toBe("detail");
      expect(MONTGOMERY_LAYER.pattern).toBe("tubercles");
      const t = paintStopTable([MONTGOMERY_LAYER], paint(adultFemale));
      expect(t[1]).toBe(8);
      // A bump spans 0.7 of a cell: its diameter is that of the measured tubercle.
      expect(0.7 * (t[3] as number)).toBeGreaterThan(0.001);
      expect(0.7 * (t[3] as number)).toBeLessThan(0.002);
      expect(t[2]).toBeGreaterThan(0.0003);
      expect(t[2]).toBeLessThan(0.0012);
    });

    it("counts within what pregnant women show, two to 28 on an areola, fewer in a man", () => {
      const woman = tubercles(paint(adultFemale));
      const man = tubercles(paint({ age: 30, build: { gender: 1 } }));
      expect(woman).toBeGreaterThan(6);
      expect(woman).toBeLessThan(28);
      expect(man).toBeGreaterThan(1);
      expect(man).toBeLessThan(woman);
    });

    it("rings the areola: none at the nipple, none beyond the areola's edge", () => {
      const p = profile(MONTGOMERY_LAYER, paint(adultFemale));
      const R = areolaRadius(30, 0, 0.5);
      expect(at(p, 0.0005)).toBe(0);
      expect(at(p, 0.6 * R)).toBeGreaterThan(0);
      expect(at(p, R + 3 * AREOLA_EDGE_SOFTNESS * R)).toBe(0);
    });

    it("appears with puberty, not before it", () => {
      expect(tubercles(paint({ age: 6, build: { gender: 0 } }))).toBe(0);
      const teen = tubercles(paint({ age: 12.5, build: { gender: 0 } }));
      expect(teen).toBeGreaterThan(0);
      expect(teen).toBeLessThan(tubercles(paint(adultFemale)));
    });
  });

  it("is in the stack, after the areola's colour", () => {
    const ids = SKIN_LAYERS.map((l) => l.id);
    expect(ids).toContain("areola-relief");
    expect(ids).toContain("montgomery");
    expect(ids.indexOf("areola-relief")).toBeGreaterThan(ids.indexOf("areola"));
  });
});

describe("the collarbones' and ribs' relief", () => {
  const assets = loadFixtureAssets();
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const joint = (name: string) => {
    const out = new Float32Array(3);
    jointPosition(assets, P, name, out, 0);
    return Array.from(out);
  };
  const lean: FigureBuild = {
    gender: 0,
    age: 25,
    weight: 0,
    height: 0.5,
    muscle: 0.5,
    breastSize: 0.5,
  };

  describe("collarbones", () => {
    const f = CLAVICLE_LAYER.fields(assets);
    const coord = f.coord as Float32Array;
    /** Distance from the segment head-tail, and the vertex's height over the axis in the plane facing up. */
    const along = (side: "L" | "R", v: number) => {
      const h = joint(`clavicle.${side}____head`);
      const t = joint(`clavicle.${side}____tail`);
      const axis = [0, 1, 2].map((k) => (t[k] as number) - (h[k] as number));
      const len = Math.hypot(...axis);
      const p = [0, 1, 2].map((k) => (P[v * 3 + k] as number) - (h[k] as number));
      const s = Math.min(
        1,
        Math.max(0, p.reduce((a, x, k) => a + x * (axis[k] as number), 0) / len ** 2),
      );
      const closest = axis.map((x) => x * s);
      const off = p.map((x, k) => x - (closest[k] as number));
      return { dist: Math.hypot(...off), s, up: off[1] as number };
    };

    it("is a creases layer of two periods: a ridge between two grooves, by the collarbone", () => {
      expect(CLAVICLE_LAYER.kind).toBe("detail");
      expect(CLAVICLE_LAYER.pattern).toBe("creases");
      const t = paintStopTable([CLAVICLE_LAYER], paint({ build: lean }));
      expect(t[1]).toBe(3);
      expect(t[3]).toBe(CLAVICLE_PERIODS);
    });

    it("lies along each collarbone and nowhere else, mirrored", () => {
      let count = 0;
      for (let v = 0; v < n; v++) {
        if ((f.mask[v] as number) < 0.05) continue;
        count++;
        const side = (P[v * 3] as number) >= 0 ? "L" : "R";
        const a = along(side, v);
        expect(a.dist, `vertex ${v}`).toBeLessThan(0.03);
        expect(a.s, `vertex ${v}`).toBeGreaterThan(0.02);
        expect(a.s, `vertex ${v}`).toBeLessThan(0.98);
      }
      expect(count).toBeGreaterThan(10);
      const left = [...Array(n).keys()].filter(
        (v) => (f.mask[v] as number) > 0.05 && (P[v * 3] as number) > 0,
      ).length;
      const right = [...Array(n).keys()].filter(
        (v) => (f.mask[v] as number) > 0.05 && (P[v * 3] as number) < 0,
      ).length;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
    });

    it("runs its coordinate across the bone: higher on the chest is greater, and a ridge lies between grooves", () => {
      const head = joint("clavicle.L____head");
      const tail = joint("clavicle.L____tail");
      const vs = [...Array(n).keys()].filter(
        (v) => (f.mask[v] as number) > 0.3 && (P[v * 3] as number) > 0,
      );
      expect(vs.length).toBeGreaterThan(5);
      // Each vertex's height over the bone's own height at its place along it.
      const rise = vs.map((v) => {
        const s = along("L", v).s;
        return (
          (P[v * 3 + 1] as number) -
          ((head[1] as number) + s * ((tail[1] as number) - (head[1] as number)))
        );
      });
      const c = vs.map((v) => coord[v] as number);
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const [mr, mc] = [mean(rise), mean(c)];
      const corr =
        rise.reduce((a, r, i) => a + (r - mr) * ((c[i] as number) - mc), 0) /
        Math.sqrt(
          rise.reduce((a, r) => a + (r - mr) ** 2, 0) * c.reduce((a, x) => a + (x - mc) ** 2, 0),
        );
      expect(corr).toBeGreaterThan(0.7);
      // Grooves either side of the ridge at 0.5: the coordinate reaches both.
      expect(Math.min(...c)).toBeLessThan(0.42);
      expect(Math.max(...c)).toBeGreaterThan(0.58);
    });

    it("shows by the figure's body fat: none on a heavy figure, the full relief on a lean one", () => {
      const heavy = paintStopTable([CLAVICLE_LAYER], paint({ build: { ...lean, weight: 1 } }));
      const thin = paintStopTable([CLAVICLE_LAYER], paint({ build: lean }));
      expect(thin[0]).toBeGreaterThan(0.95);
      expect(heavy[0]).toBeLessThan(0.3);
      // A depth of a millimetre or two (CHOICE: a collarbone's relief on a lean figure).
      expect(thin[2]).toBeGreaterThan(0.0005);
      expect(thin[2]).toBeLessThan(0.003);
    });
  });

  describe("ribs", () => {
    const f = RIB_LAYER.fields(assets);
    const coord = f.coord as Float32Array;
    const nipple = [joint("breast.L____tail"), joint("breast.R____tail")];

    it("is a creases layer, a groove between each pair of ribs", () => {
      expect(RIB_LAYER.kind).toBe("detail");
      expect(RIB_LAYER.pattern).toBe("creases");
      const t = paintStopTable([RIB_LAYER], paint({ build: lean }));
      expect(t[1]).toBe(3);
      // Eight or nine intercostal spaces from the second rib to the tenth.
      expect(t[3]).toBeGreaterThanOrEqual(8);
      expect(t[3]).toBeLessThanOrEqual(9);
    });

    it("is on the front and flanks of the chest and not the back, the arms or the head", () => {
      let count = 0;
      for (let v = 0; v < n; v++) {
        if ((f.mask[v] as number) < 0.05) continue;
        count++;
        expect(P[v * 3 + 2] as number, `vertex ${v} depth`).toBeGreaterThan(-0.08);
        expect(P[v * 3 + 1] as number, `vertex ${v} height`).toBeLessThan(0.52);
        expect(P[v * 3 + 1] as number, `vertex ${v} height`).toBeGreaterThan(0.1);
        expect(Math.abs(P[v * 3] as number), `vertex ${v} width`).toBeLessThan(0.22);
      }
      expect(count).toBeGreaterThan(100);
    });

    it("leaves the breast out, where tissue lies over the ribs", () => {
      for (let v = 0; v < n; v++) {
        const d = Math.min(
          ...nipple.map((c) =>
            Math.hypot(...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (c[k] as number))),
          ),
        );
        if (d < 0.025) expect(f.mask[v], `vertex ${v} at the nipple`).toBeLessThan(0.05);
      }
    });

    it("runs its coordinate down the chest and along each rib: a rib is a line of constant coordinate", () => {
      // Down: lower is greater, at a given distance from the midline.
      const col = (x: number) =>
        [...Array(n).keys()].filter(
          (v) => (f.mask[v] as number) > 0.5 && Math.abs((P[v * 3] as number) - x) < 0.003,
        );
      let checked = 0;
      for (const x of [0.04, 0.07, 0.1, 0.13]) {
        const vs = col(x).sort((a, b) => (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number));
        for (let i = 1; i < vs.length; i++) {
          const a = vs[i - 1] as number;
          const b = vs[i] as number;
          if ((P[a * 3 + 1] as number) - (P[b * 3 + 1] as number) < 0.004) continue;
          expect(coord[b], `x ${x}`).toBeGreaterThan(coord[a] as number);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10);
      // Along: a rib falls away from the breastbone, so at one height the ribs farther out are the
      // ones that start higher up the breastbone: a smaller coordinate.
      const vs = [...Array(n).keys()].filter(
        (v) => (f.mask[v] as number) > 0.5 && Math.abs((P[v * 3 + 1] as number) - 0.3) < 0.01,
      );
      const near = vs.filter((v) => Math.abs(P[v * 3] as number) < 0.06);
      const far = vs.filter((v) => Math.abs(P[v * 3] as number) > 0.1);
      expect(near.length).toBeGreaterThan(0);
      expect(far.length).toBeGreaterThan(0);
      const mean = (a: number[]) => a.reduce((s, v) => s + (coord[v] as number), 0) / a.length;
      expect(mean(far)).toBeLessThan(mean(near));
    });

    it("shows by the figure's body fat, ribs only on a lean figure", () => {
      const thin = paintStopTable([RIB_LAYER], paint({ build: lean }));
      const average = paintStopTable([RIB_LAYER], paint({ build: { ...lean, weight: 0.5 } }));
      expect(thin[0]).toBeGreaterThan(0.9);
      expect(average[0]).toBe(0);
      expect(thin[2]).toBeGreaterThan(0.0004);
      expect(thin[2]).toBeLessThan(0.002);
    });
  });

  it("is in the stack", () => {
    const ids = SKIN_LAYERS.map((l) => l.id);
    expect(ids).toContain("clavicles");
    expect(ids).toContain("ribs");
  });
});

describe("the areola's stretch on a figure", () => {
  const assets = loadFixtureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const stretch = (macros: Record<string, number>) =>
    areolaStretch(assets, model.evaluate(createRecipe({ macros })).control);

  it("is 1 on the base mesh itself and what the morph makes of the skin round the nipple elsewhere", () => {
    expect(areolaStretch(assets, assets.positions)).toBeCloseTo(1, 6);
    // Measured on the evaluated control mesh (the probe in the commit that added it):
    // a small child's skin is two thirds of the base mesh's size, a large breast's twice.
    expect(stretch({ age: 7, gender: 0 })).toBeCloseTo(0.68, 1);
    expect(stretch({ gender: 0, breastSize: 1 })).toBeCloseTo(2.09, 1);
    expect(stretch({ gender: 0, breastSize: 0 })).toBeCloseTo(1.25, 1);
  });

  it("is what a model evaluation reports", () => {
    const ev = model.evaluate(createRecipe({ macros: { age: 12, gender: 0 } }));
    expect(ev.areolaScale).toBeCloseTo(stretch({ age: 12, gender: 0 }), 9);
  });

  it("makes the areola the size it is in metres, whatever the figure's stretch", () => {
    // The paint's lengths are the figure's own; the field's, the base mesh's: divide by the stretch.
    const at = (areolaScale: number) => {
      const t = paintStopTable([AREOLA_LAYER], paint({ ...adultFemale, areolaScale }));
      const s = Array.from({ length: STOP_COUNT }, (_, k) => t[(k + 1) * 4 + 1] as number);
      // The radius (in field metres) at which the ratio is half way to 1.
      const inner = s[2] as number;
      let r = 0.004;
      while (r < AREOLA_REACH) {
        const x = (r / AREOLA_REACH) * (STOP_COUNT - 1);
        const i = Math.min(Math.floor(x), STOP_COUNT - 2);
        const v = (s[i] as number) * (1 - (x - i)) + (s[i + 1] as number) * (x - i);
        if (v > (inner + 1) / 2) return r;
        r += 0.0001;
      }
      return r;
    };
    const single = at(1);
    const doubled = at(2);
    expect(doubled / single).toBeCloseTo(0.5, 1);
    // Absent, it is the base mesh's own.
    expect(at(1)).toBeCloseTo(single, 9);
  });

  it("keeps every figure's areola, and its soft edge, inside the field's reach", () => {
    // The largest areola in field metres over the macro range: the figure's own size, over its stretch.
    for (const macros of [
      { age: 25, gender: 0, breastSize: 0 },
      { age: 25, gender: 1, height: 0 },
      { age: 60, gender: 1, height: 0 },
      { age: 25, gender: 0, height: 0, breastSize: 0 },
      { age: 12, gender: 0, height: 0 },
    ]) {
      const k = stretch(macros);
      const b = { gender: macros.gender, breastSize: macros.breastSize ?? 0.5 };
      const edge = areolaRadius(macros.age, b.gender, b.breastSize) / k;
      expect(edge * (1 + AREOLA_EDGE_SOFTNESS), JSON.stringify(macros)).toBeLessThan(AREOLA_REACH);
    }
  });
});

describe("the navel and the midline", () => {
  const assets = loadFixtureAssets();
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const onBody = bodySurface(assets);
  const navel = navelCentre(assets);
  const lean: FigureBuild = {
    gender: 1,
    age: 25,
    weight: 0,
    height: 0.5,
    muscle: 0.8,
    breastSize: 0.5,
  };
  const ratio = (layer: SkinLayer, input: SkinPaintInput) => {
    const t = paintStopTable([layer], input);
    return Array.from({ length: STOP_COUNT }, (_, k) => [
      t[(k + 1) * 4] as number,
      t[(k + 1) * 4 + 1] as number,
      t[(k + 1) * 4 + 2] as number,
    ]);
  };

  describe("the navel", () => {
    const f = NAVEL_LAYER.fields(assets);

    it("is found at the spine's third joint's height on the midline, in the dimple", () => {
      const spine = new Float32Array(3);
      jointPosition(assets, P, "spine03____head", spine, 0);
      expect(navel[1]).toBeGreaterThan((spine[1] as number) - 0.02);
      expect(navel[1]).toBeLessThan((spine[1] as number) + 0.02);
      expect(Math.abs(navel[0])).toBeLessThan(0.006);
      // In the dimple: the skin is deeper than the belly an inch above and below it.
      const at = (y: number) => {
        let best = Number.POSITIVE_INFINITY;
        let z = 0;
        for (let v = 0; v < n; v++) {
          if (!onBody[v] || Math.abs(P[v * 3] as number) > 0.006 || (P[v * 3 + 2] as number) < 0.05)
            continue;
          const d = Math.abs((P[v * 3 + 1] as number) - y);
          if (d < best) {
            best = d;
            z = P[v * 3 + 2] as number;
          }
        }
        return z;
      };
      expect(navel[2]).toBeLessThan(at(navel[1] + 0.06));
      expect(navel[2]).toBeLessThan(at(navel[1] - 0.04));
    });

    it("is a small disc round the navel and nowhere else, its coordinate the distance from the centre", () => {
      let count = 0;
      for (let v = 0; v < n; v++) {
        const d = Math.hypot(
          ...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (navel[k] as number)),
        );
        if ((f.mask[v] as number) > 0.05) {
          count++;
          expect(onBody[v], `vertex ${v}`).toBe(1);
          expect(d, `vertex ${v}`).toBeLessThan(NAVEL_REACH * 1.2);
        }
        if (onBody[v] === 1 && d < 0.5 * NAVEL_REACH)
          expect(f.mask[v], `vertex ${v} inside`).toBeGreaterThan(0.9);
      }
      expect(count).toBeGreaterThan(3);
    });

    it("multiplies the skin: the navel's hollow darker and pinker, the skin round it as it is", () => {
      const s = ratio(NAVEL_LAYER, paint({ age: 30 }));
      const t = paintStopTable([NAVEL_LAYER], paint({ age: 30 }));
      expect(t[1]).toBe(1);
      const centre = s[0] as number[];
      const rim = s[STOP_COUNT - 1] as number[];
      expect(rim).toEqual([1, 1, 1]);
      // Darker, and redder than it is darker in the green: more blood in thin skin.
      expect(luminance(centre as Rgb)).toBeLessThan(0.98);
      expect((centre[0] as number) / (centre[1] as number)).toBeGreaterThan(1);
      for (const c of centre) expect(c).toBeLessThanOrEqual(1);
    });
  });

  describe("the linea nigra", () => {
    const f = LINEA_NIGRA_LAYER.fields(assets);
    const coord = f.coord as Float32Array;

    it("runs up the midline from the pubic bone past the navel, a few centimetres wide", () => {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let count = 0;
      for (let v = 0; v < n; v++) {
        if ((f.mask[v] as number) < 0.05) continue;
        count++;
        expect(onBody[v], `vertex ${v}`).toBe(1);
        expect(Math.abs(P[v * 3] as number), `vertex ${v}`).toBeLessThan(0.04);
        expect(P[v * 3 + 2] as number, `vertex ${v} front`).toBeGreaterThan(0.05);
        lo = Math.min(lo, P[v * 3 + 1] as number);
        hi = Math.max(hi, P[v * 3 + 1] as number);
      }
      expect(count).toBeGreaterThan(10);
      expect(lo).toBeLessThan((navel[1] as number) - 0.1);
      expect(hi).toBeGreaterThan((navel[1] as number) + 0.05);
    });

    it("runs its coordinate across the line, the middle at 0.5 and the same either side", () => {
      for (let v = 0; v < n; v++) {
        if ((f.mask[v] as number) < 0.3) continue;
        const x = P[v * 3] as number;
        if (x > 0.004) expect(coord[v], `vertex ${v}`).toBeGreaterThan(0.5);
        if (x < -0.004) expect(coord[v], `vertex ${v}`).toBeLessThan(0.5);
        if (Math.abs(x) < 0.002) expect(coord[v], `vertex ${v}`).toBeCloseTo(0.5, 1);
      }
    });

    it("darkens the middle of the line and leaves its edges, as the skin's own melanin does", () => {
      const s = ratio(LINEA_NIGRA_LAYER, paint({ age: 30 }));
      expect(s[0]).toEqual([1, 1, 1]);
      expect(s[STOP_COUNT - 1]).toEqual([1, 1, 1]);
      const mid = s[(STOP_COUNT - 1) / 2 - 0.5 > 0 ? Math.floor(STOP_COUNT / 2) : 3] as number[];
      for (const c of mid) expect(c).toBeLessThan(1);
      // A deeper tone darkens by a visible amount too.
      const deep = ratio(LINEA_NIGRA_LAYER, paint({ age: 30, tone: { ...tone, melanin: 0.9 } }));
      for (const c of deep[3] as number[]) expect(c).toBeLessThan(1);
    });

    it("is faint at rest, a mix of strength by the stage, and absent before puberty", () => {
      const adult = paintStopTable([LINEA_NIGRA_LAYER], paint({ age: 30 }));
      const child = paintStopTable([LINEA_NIGRA_LAYER], paint({ age: 6 }));
      expect(adult[1]).toBe(1);
      expect(adult[0]).toBeGreaterThan(0);
      expect(adult[0]).toBeLessThan(0.3);
      expect(child[0]).toBe(0);
    });
  });

  describe("the linea alba", () => {
    const f = LINEA_ALBA_LAYER.fields(assets);

    it("is a single furrow in a crease layer, down the midline from below the breastbone to the pubic bone", () => {
      expect(LINEA_ALBA_LAYER.kind).toBe("detail");
      expect(LINEA_ALBA_LAYER.pattern).toBe("creases");
      const t = paintStopTable([LINEA_ALBA_LAYER], paint({ build: lean }));
      expect(t[1]).toBe(3);
      expect(t[3]).toBe(1);
      expect(t[2]).toBeGreaterThan(0.0002);
      expect(t[2]).toBeLessThan(0.001);
      for (let v = 0; v < n; v++) {
        if ((f.mask[v] as number) < 0.05) continue;
        expect(Math.abs(P[v * 3] as number), `vertex ${v}`).toBeLessThan(0.03);
      }
    });

    it("is gone across the navel", () => {
      for (let v = 0; v < n; v++) {
        const d = Math.hypot(
          ...[0, 1, 2].map((k) => (P[v * 3 + k] as number) - (navel[k] as number)),
        );
        if (onBody[v] === 1 && d < 0.5 * NAVEL_REACH)
          expect(f.mask[v], `vertex ${v}`).toBeLessThan(0.1);
      }
    });

    it("shows by the figure's body fat and muscle", () => {
      const thin = paintStopTable([LINEA_ALBA_LAYER], paint({ build: lean }));
      const heavy = paintStopTable([LINEA_ALBA_LAYER], paint({ build: { ...lean, weight: 1 } }));
      expect(thin[0]).toBeGreaterThan(0.9);
      expect(heavy[0]).toBe(0);
    });
  });

  it("are in the stack", () => {
    const ids = SKIN_LAYERS.map((l) => l.id);
    for (const id of ["navel", "linea-nigra", "linea-alba"]) expect(ids).toContain(id);
  });
});

describe("the stretch marks", () => {
  const assets = loadFixtureAssets();
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const onBody = bodySurface(assets);
  const zones = skinZones(assets);
  const f = STRIAE_LAYER.fields(assets);
  const coord = f.coord as Float32Array;
  const heavy: FigureBuild = {
    gender: 0,
    age: 25,
    weight: 1,
    height: 0.5,
    muscle: 0.5,
    breastSize: 0.5,
  };

  it("is a striae layer with the figure's amount and the colour of marks of its age", () => {
    expect(STRIAE_LAYER.kind).toBe("detail");
    expect(STRIAE_LAYER.pattern).toBe("striae");
    const t = paintStopTable([STRIAE_LAYER], paint({ age: 25, build: heavy }));
    expect(t[1]).toBe(9);
    expect(t[2]).toBeGreaterThan(0.00005);
    expect(t[2]).toBeLessThan(0.0004);
    expect(t[3]).toBeCloseTo(STRIA_SPACING, 9);
    // The amount is the figure's.
    expect(t[8]).toBeCloseTo(striaeAmount({ ...heavy }), 6);
    // The ratio is the marks' colour at that age and tone.
    const ratio = striaeColour(tone, striaeMaturity(25));
    for (let c = 0; c < 3; c++) expect(t[4 + c]).toBeCloseTo(ratio[c] as number, 6);
    // None on the default figure.
    expect(paintStopTable([STRIAE_LAYER], paint({ age: 25 }))[8]).toBe(0);
  });

  it("lies on the lower trunk, hips, buttocks and outer thighs, and nowhere else", () => {
    let count = 0;
    for (let v = 0; v < n; v++) {
      if ((f.mask[v] as number) < 0.2) continue;
      count++;
      expect(onBody[v], `vertex ${v}`).toBe(1);
      const sites =
        (zones.zone("lowerTrunk")[v] as number) +
        (zones.zone("pelvis")[v] as number) +
        (zones.zone("thigh")[v] as number);
      expect(sites, `vertex ${v} zone`).toBeGreaterThan(0.2);
      // Never on the breast.
      expect(zones.zone("breast")[v] as number, `vertex ${v} breast`).toBeLessThan(0.5);
    }
    expect(count).toBeGreaterThan(100);
  });

  it("leaves out the groin, the inner thigh and any skin that faces up or down", () => {
    for (let v = 0; v < n; v++) {
      if (!onBody[v]) continue;
      const x = P[v * 3] as number;
      const y = P[v * 3 + 1] as number;
      const z = P[v * 3 + 2] as number;
      // The pubic region, central and low in front.
      if (Math.abs(x) < 0.03 && y < 0.05 && z > 0.1)
        expect(f.mask[v], `vertex ${v} groin`).toBeLessThan(0.1);
      const ny = zones.normals[v * 3 + 1] as number;
      if (Math.abs(ny) > 0.9) expect(f.mask[v], `vertex ${v} faces ${ny}`).toBeLessThan(0.1);
      // Inner thigh: a thigh vertex that faces the other leg.
      if ((zones.zone("thigh")[v] as number) > 0.8 && Math.abs(x) > 0.02) {
        const inner = -Math.sign(x) * (zones.normals[v * 3] as number);
        if (inner > 0.6) expect(f.mask[v], `vertex ${v} inner thigh`).toBeLessThan(0.1);
      }
    }
  });

  it("is the same on both sides of the body", () => {
    const left = [...Array(n).keys()].filter(
      (v) => (f.mask[v] as number) > 0.05 && (P[v * 3] as number) > 0.01,
    ).length;
    const right = [...Array(n).keys()].filter(
      (v) => (f.mask[v] as number) > 0.05 && (P[v * 3] as number) < -0.01,
    ).length;
    expect(Math.abs(left - right) / (left + right)).toBeLessThan(0.05);
  });

  it("orients the marks round the body: horizontal on the skin, whatever way its UV map turns", () => {
    // Carry each marked vertex's stored UV angle back through one of its faces' UV maps to the
    // skin. It is the direction of the waves of the noise, across the streaks: for streaks that run
    // round the body (across the stretch) it is vertical in the skin's plane.
    const faces = groupFaces(assets, "body");
    const faceOf = new Map<number, number>();
    for (const q of faces)
      for (let k = 0; k < 4; k++) faceOf.set(assets.faceVerts[q * 4 + k] as number, q);
    const off: number[] = [];
    let checked = 0;
    for (let v = 0; v < n; v++) {
      if ((f.mask[v] as number) < 0.5) continue;
      const q = faceOf.get(v);
      if (q === undefined) continue;
      const corner = [0, 1, 2, 3].map((k) => assets.faceVerts[q * 4 + k] as number);
      const at = (w: number) => [0, 1, 2].map((k) => P[w * 3 + k] as number);
      const uvOf = (k: number) => [
        assets.uvs[(assets.faceUvs[q * 4 + k] as number) * 2] as number,
        assets.uvs[(assets.faceUvs[q * 4 + k] as number) * 2 + 1] as number,
      ];
      const p0 = at(corner[0] as number);
      const e1 = at(corner[1] as number).map((x, k) => x - (p0[k] as number));
      const e2 = at(corner[3] as number).map((x, k) => x - (p0[k] as number));
      const b1 = uvOf(1).map((x, k) => x - (uvOf(0)[k] as number));
      const b2 = uvOf(3).map((x, k) => x - (uvOf(0)[k] as number));
      const det = (b1[0] as number) * (b2[1] as number) - (b1[1] as number) * (b2[0] as number);
      if (Math.abs(det) < 1e-12) continue;
      const theta = orientationAtCoordinate(coord[v] as number, STRIAE_ORIENTATION_SEAM);
      const d = [Math.cos(theta), Math.sin(theta)];
      // d = alpha b1 + beta b2, then the same combination of the edges.
      const alpha =
        ((d[0] as number) * (b2[1] as number) - (d[1] as number) * (b2[0] as number)) / det;
      const beta =
        ((b1[0] as number) * (d[1] as number) - (b1[1] as number) * (d[0] as number)) / det;
      const dir = [0, 1, 2].map((k) => alpha * (e1[k] as number) + beta * (e2[k] as number));
      const len = Math.hypot(...dir);
      if (len < 1e-9) continue;
      // Across the horizontal of the skin's plane (up x normal): perpendicular to it.
      const nrm = [0, 1, 2].map((k) => zones.normals[v * 3 + k] as number);
      const h = [nrm[2] as number, 0, -(nrm[0] as number)];
      const hl = Math.hypot(...h);
      if (hl < 1e-6) continue;
      const along = (dir as number[]).reduce((a, x, k) => a + (x * (h[k] as number)) / hl, 0);
      // One face's map stands for the vertex, so a few on a curved edge are off by a little more.
      off.push(Math.abs(along) / len);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(off.filter((x) => x < 0.3).length / off.length).toBeGreaterThan(0.95);
    expect(Math.max(...off)).toBeLessThan(0.6);
  });

  it("stores its orientation so that neighbours straddle the seam rarely", () => {
    // Bilinear filtering between two stored angles either side of the seam passes through every
    // angle between them the long way round: the seam sits where the fewest marks point.
    let pairs = 0;
    let wraps = 0;
    for (const q of groupFaces(assets, "body"))
      for (let k = 0; k < 4; k++) {
        const a = assets.faceVerts[q * 4 + k] as number;
        const b = assets.faceVerts[q * 4 + ((k + 1) % 4)] as number;
        if ((f.mask[a] as number) < 0.3 || (f.mask[b] as number) < 0.3) continue;
        pairs++;
        if (Math.abs((coord[a] as number) - (coord[b] as number)) > 0.5) wraps++;
      }
    expect(pairs).toBeGreaterThan(200);
    expect(wraps / pairs).toBeLessThan(0.03);
  });

  it("is in the stack", () => {
    expect(SKIN_LAYERS.map((l) => l.id)).toContain("striae");
  });
});

describe("the relief layers' coordinates are continuous", () => {
  // A crease layer draws a groove at every period of its coordinate, so a coordinate that jumps
  // between neighbouring vertices (zero outside a window, say) sweeps every groove it skips through
  // the triangles between them. Each is a linear function of position (clamped at its ends), so
  // across any edge it changes by no more than its gradient times the edge's length.
  const assets = loadFixtureAssets();
  const P = assets.positions;
  const faces = groupFaces(assets, "body");
  const edges: [number, number][] = [];
  for (const q of faces)
    for (let k = 0; k < 4; k++)
      edges.push([
        assets.faceVerts[q * 4 + k] as number,
        assets.faceVerts[q * 4 + ((k + 1) % 4)] as number,
      ]);

  /** Per layer, the steepest the coordinate runs, per metre. */
  const GRADIENT = [
    // Up the bone's cross-section, one period of 16 mm per period of the coordinate.
    [CLAVICLE_LAYER, 1 / (CLAVICLE_PERIODS * 0.016)],
    // Down the window of nine periods of 3 cm, along a line that falls 0.47 per metre outward.
    [RIB_LAYER, Math.hypot(1, 0.47) / (RIB_PERIODS * 0.03)],
    // Across the strip, its width.
    [LINEA_ALBA_LAYER, 1 / (2 * 0.012)],
  ] as const;

  for (const [layer, gradient] of GRADIENT) {
    it(`${layer.id}: no edge changes it faster than its gradient where it shows`, () => {
      const f = layer.fields(assets);
      const coord = f.coord as Float32Array;
      let checked = 0;
      for (const [a, b] of edges) {
        if ((f.mask[a] as number) < 0.02 && (f.mask[b] as number) < 0.02) continue;
        checked++;
        const length = Math.hypot(
          ...[0, 1, 2].map((k) => (P[a * 3 + k] as number) - (P[b * 3 + k] as number)),
        );
        expect(
          Math.abs((coord[a] as number) - (coord[b] as number)),
          `edge ${a}-${b}`,
        ).toBeLessThanOrEqual(1.02 * gradient * length + 1e-6);
      }
      expect(checked).toBeGreaterThan(20);
    });
  }
});
