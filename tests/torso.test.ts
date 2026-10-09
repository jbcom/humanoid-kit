import { describe, expect, it } from "vitest";
import {
  paintStopTable,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import {
  AREOLA_EDGE_SOFTNESS,
  AREOLA_LAYER,
  AREOLA_REACH,
  areolaZone,
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
/** The layer's stops as colours. */
function stops(input: SkinPaintInput): Rgb[] {
  const t = paintStopTable([AREOLA_LAYER], input);
  return Array.from({ length: STOP_COUNT }, (_, k) => [
    t[(k + 1) * 4] as number,
    t[(k + 1) * 4 + 1] as number,
    t[(k + 1) * 4 + 2] as number,
  ]);
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

  it("is a mix layer at a strength that leaves a tenth of the skin's own colour", () => {
    const t = paintStopTable([AREOLA_LAYER], paint(adultFemale) as never);
    expect(t[0]).toBeCloseTo(0.9, 6);
    expect(t[1]).toBe(0);
    expect(t.length).toBe(STOP_TABLE_WIDTH * 4);
  });

  it("paints with no age and no build, as for the default figure", () => {
    expect(() => stops(paint())).not.toThrow();
  });
});
