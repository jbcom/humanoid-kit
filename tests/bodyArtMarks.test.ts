import { describe, expect, it } from "vitest";
import type { PlacedMark } from "../src/bodyArt/decals.ts";
import { inkSeen } from "../src/bodyArt/ink.ts";
import {
  CAFE_AU_LAIT_MELANIN,
  markChannels,
  markedAlbedo,
  markMelaninSpan,
  markRatios,
  NAEVUS_MELANIN,
  SCAR_ERYTHEMA_RATIO,
  SCAR_HAEMOGLOBIN,
  SCAR_REFERENCE_TONE,
  vitiligoAlbedo,
} from "../src/bodyArt/marks.ts";
import { VITILIGO_PATCHES, vitiligoPatches } from "../src/bodyArt/vitiligo.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import {
  melaninDensity,
  melaninDensityAlbedo,
  melaninFreeAlbedo,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = (melanin: number): SkinTone => ({
  melanin,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
});
const TONES = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1];
const lab = (c: Rgb) => labFromLinear(c);
const dE = (a: Rgb, b: Rgb) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const mark = (kind: PlacedMark["kind"], more: Partial<PlacedMark> = {}): PlacedMark => ({
  centre: [0, 0, 0],
  normal: [0, 0, 1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  kind,
  length: 0.03,
  width: 0.03,
  maturity: 1,
  raised: 0,
  seed: 0,
  ...more,
});

describe("melanin below the lightest measured skin", () => {
  it("goes on to the melanin-free albedo, continuous where the measured axis ends", () => {
    for (const m of TONES) {
      const t = tone(m);
      const free = melaninDensityAlbedo(t, 0, 0.5);
      melaninFreeAlbedo(t).forEach((c, k) => {
        expect(free[k]).toBeCloseTo(c, 6);
      });
    }
    // At the lightest anchor's own density the two branches meet.
    const fairest = skinAlbedo(tone(0));
    melaninDensityAlbedo(tone(0), 1 - 1e-9, 0.5).forEach((c, k) => {
      expect(c).toBeCloseTo(fairest[k] as number, 5);
    });
  });
});

describe("vitiligo", () => {
  it("is lighter than the skin round it at every tone, and less yellow where measured (Brazzelli 2008)", () => {
    for (const m of TONES.slice(1)) {
      const [skin, patch] = [lab(skinAlbedo(tone(m))), lab(vitiligoAlbedo(tone(m)))];
      expect(patch[0], `melanin ${m}`).toBeGreaterThan(skin[0]);
      // The cohort was fair skin; the deepest skin's own b* falls below a patch's.
      if (m <= 0.5) expect(patch[2], `melanin ${m}`).toBeLessThan(skin[2]);
    }
  });

  it("keeps an absolute residual of melanin, so patches are about as light on any skin", () => {
    const L = TONES.map((m) => lab(vitiligoAlbedo(tone(m)))[0]);
    expect(Math.max(...L) - Math.min(...L)).toBeLessThan(6);
  });

  it("differs from fair-to-medium skin by the measured ΔE, and by more on deeper skin", () => {
    // Toriyama et al. 2021: ΔE*ab mostly 9 to 13 in a Japanese cohort.
    for (const m of [0.12, 0.2]) {
      const d = dE(skinAlbedo(tone(m)), vitiligoAlbedo(tone(m)));
      expect(d, `melanin ${m}`).toBeGreaterThan(8);
      expect(d, `melanin ${m}`).toBeLessThan(15);
    }
    let last = 0;
    for (const m of TONES) {
      const d = dE(skinAlbedo(tone(m)), vitiligoAlbedo(tone(m)));
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe("a mark's change to the skin", () => {
  it("moves melanin and haemoglobin through the shader's ratios as the skin model does", () => {
    for (const m of TONES) {
      const t = tone(m);
      markedAlbedo(t, { melanin: -1, haemoglobin: 0 }).forEach((c, k) => {
        expect(c).toBeCloseTo(vitiligoAlbedo(t)[k] as number, 6);
      });
      const own = melaninDensity(t);
      const added = melaninDensityAlbedo(t, (own + markMelaninSpan()) / own, 0.5);
      markedAlbedo(t, { melanin: 1, haemoglobin: 0 }).forEach((c, k) => {
        expect(c).toBeCloseTo(added[k] as number, 6);
      });
      const r = markRatios(t);
      for (const x of r.blood.slice(1)) expect(x).toBeLessThan(1);
    }
  });

  it("darkens with café-au-lait less than with a naevus, at every tone", () => {
    expect(NAEVUS_MELANIN).toBeGreaterThan(CAFE_AU_LAIT_MELANIN);
    for (const m of TONES) {
      const y = (melanin: number) => lab(markedAlbedo(tone(m), { melanin, haemoglobin: 0 }))[0];
      const cafe = markChannels(mark("cafe-au-lait")).melanin;
      const naevus = markChannels(mark("naevus")).melanin;
      expect(y(cafe)).toBeLessThan(y(0));
      expect(y(naevus)).toBeLessThan(y(cafe));
      // Melanin is added, not multiplied: a naevus on the deepest skin is dark, not black.
      expect(y(naevus), `melanin ${m}`).toBeGreaterThan(8);
    }
  });

  it("reddens a port-wine stain, and reads dermal melanin blue-grey through the skin", () => {
    for (const m of TONES) {
      const skin = lab(skinAlbedo(tone(m)));
      const stain = lab(markedAlbedo(tone(m), { melanin: 0, haemoglobin: 1 }));
      expect(stain[1]).toBeGreaterThan(skin[1]);
      const spot = markChannels(mark("dermal-melanocytosis")).ink;
      expect(spot).not.toBeNull();
      const seen = lab(inkSeen(tone(m), spot?.colour as Rgb));
      expect(seen[2], `melanin ${m}`).toBeLessThan(skin[2]);
    }
  });

  it("gives a fresh or raised scar the keloids' erythema ratio, and a mature flat one a paler skin", () => {
    const t = SCAR_REFERENCE_TONE;
    const ratio = (c: Rgb) => Math.log((c[0] as number) / (c[1] as number));
    const red = markedAlbedo(t, { melanin: 0, haemoglobin: SCAR_HAEMOGLOBIN });
    expect(ratio(red) / ratio(skinAlbedo(t))).toBeCloseTo(SCAR_ERYTHEMA_RATIO, 6);
    const fresh = markChannels(mark("scar", { maturity: 0 }));
    expect(fresh.haemoglobin).toBeCloseTo(SCAR_HAEMOGLOBIN, 9);
    expect(fresh).toMatchObject({ smooth: 1, raise: 0 });
    const mature = markChannels(mark("scar", { maturity: 1 }));
    expect(mature.haemoglobin).toBe(0);
    expect(mature.melanin).toBeLessThan(0);
    const raised = markChannels(mark("scar", { maturity: 1, raised: 1 }));
    expect(raised.haemoglobin).toBeCloseTo(SCAR_HAEMOGLOBIN, 9);
    expect(raised.melanin).toBeGreaterThan(0); // keloids carry more melanin (Aoki et al. 2016)
    expect(raised.raise).toBe(1);
  });
});

describe("vitiligo's patches", () => {
  const assets = loadFixtureAssets();
  const P = assets.positions;

  it("are the same for the same seed, and pair each left patch with its mirror", () => {
    const a = vitiligoPatches(assets, { extent: 0.5, seed: 7 });
    expect(vitiligoPatches(assets, { extent: 0.5, seed: 7 })).toEqual(a);
    expect(vitiligoPatches(assets, { extent: 0.5, seed: 8 })).not.toEqual(a);
    for (const p of a) {
      const [l, r] = p.vertices;
      expect(P[l * 3]).toBeGreaterThan(0);
      expect(P[r * 3]).toBeCloseTo(-(P[l * 3] as number), 5);
      expect(P[r * 3 + 1]).toBeCloseTo(P[l * 3 + 1] as number, 5);
    }
  });

  it("grow in number and size with extent", () => {
    const few = vitiligoPatches(assets, { extent: 0, seed: 1 });
    const many = vitiligoPatches(assets, { extent: 1, seed: 1 });
    expect(few.length).toBeLessThanOrEqual(VITILIGO_PATCHES[0]);
    expect(many.length).toBeGreaterThan(few.length);
    const mean = (ps: typeof few) => ps.reduce((s, p) => s + p.size, 0) / ps.length;
    expect(mean(many)).toBeGreaterThan(mean(few));
  });
});
