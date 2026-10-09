import { describe, expect, it } from "vitest";
import {
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import {
  AREOLA_EDGE_SOFTNESS,
  AREOLA_LAYER,
  AREOLA_REACH,
  AREOLA_RELIEF_LAYER,
  areolaZone,
  MONTGOMERY_LAYER,
} from "../src/surface/regions/torso.ts";
import { areolaAlbedo, luminance, type Rgb, skinAlbedo } from "../src/surface/skinTone.ts";
import { areolaRadius, nippleContrast } from "../src/surface/torsoTone.ts";
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

  it("reaches farther than the largest areola the figures paint", () => {
    expect(AREOLA_REACH).toBeGreaterThan(areolaRadius(30, 0, 1) * (1 + AREOLA_EDGE_SOFTNESS));
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
      // Header: strength, kind 6, height, spacing.
      expect(t[1]).toBe(6);
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
      expect(t[1]).toBe(7);
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
