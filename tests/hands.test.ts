import { describe, expect, it } from "vitest";
import { labFromLinear } from "../src/surface/cielab.ts";
import { PALM_BINS, palmAlbedo, palmLab } from "../src/surface/handTone.ts";
import { paintStopTable, STOP_TABLE_WIDTH } from "../src/surface/layers.ts";
import { HAND_SKIN_LAYERS, handFrame } from "../src/surface/regions/hands.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { GOOSEBUMP_LAYER } from "../src/surface/regions/states.ts";
import {
  measuredSkinLightness,
  type Rgb,
  SKIN_F0,
  type SkinTone,
  skinAlbedo,
} from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = (melanin: number, more: Partial<SkinTone> = {}): SkinTone => ({
  melanin,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
  ...more,
});
/** CIELAB of an albedo as a colorimeter reads it (surface reflection included). */
const measured = (rgb: Rgb) => labFromLinear(rgb.map((c) => c + SKIN_F0) as Rgb);
const TONES = Array.from({ length: 11 }, (_, i) => i / 10);

/**
 * Phan et al. 2022 (J Biomed Opt 27:036002, CC BY), Table 1: each person's
 * ventral forearm L* and palm L* (colorimeter, Fitzpatrick I to VI).
 */
const FOREARM_PALM: readonly [number, number][] = [
  [36.74, 52.53],
  [39.14, 60.97],
  [42.26, 62.2],
  [43.89, 56.93],
  [46.24, 54.28],
  [56.22, 62.99],
  [56.96, 62.87],
  [57.69, 54.61],
  [59.85, 65.95],
  [61.5, 65.78],
  [62.07, 59.4],
  [63.35, 59.68],
  [63.48, 61.42],
  [63.74, 67.87],
  [66.38, 64.89],
];

/** The tone whose measured skin lightness is `L` (bisection on the melanin axis). */
function toneAtLightness(L: number): SkinTone {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (measuredSkinLightness(tone(mid)) > L) lo = mid;
    else hi = mid;
  }
  return tone((lo + hi) / 2);
}

const assets = loadFixtureAssets();
const frame = handFrame(assets);
const zones = skinZones(assets);

describe("the hands' frame", () => {
  it("puts every hand vertex on a digit, with the joints in order", () => {
    const hand = zones.zone("hand");
    for (let v = 0; v < assets.manifest.vertexCount; v++)
      if ((hand[v] as number) > 0.5) expect(frame.digit[v], `vertex ${v}`).toBeGreaterThan(0);
    for (const side of frame.joints)
      for (const joints of side.slice(1)) {
        expect(joints[0]).toBe(0);
        for (let k = 1; k < joints.length; k++)
          expect(joints[k] as number).toBeGreaterThan(joints[k - 1] as number);
      }
  });
});

describe("palm colour: measured against the archive's paired palms", () => {
  it("reproduces each bin's palm, lightness and its a* and b* above the back of the hand", () => {
    for (const [dL, da, db, pL, pa, pb] of PALM_BINS) {
      // A figure whose skin is the bin's back of hand, inside the tone axis (L* 30 to 68).
      const t = toneAtLightness(dL);
      const skin = measured(skinAlbedo(t));
      const palm = measured(palmAlbedo(t));
      expect(palm[0], `bin ${dL}`).toBeCloseTo(pL, 1);
      expect(palm[1] - skin[1], `bin ${dL}`).toBeCloseTo(pa - da, 1);
      expect(palm[2] - skin[2], `bin ${dL}`).toBeCloseTo(pb - db, 1);
      expect(palmLab(t)[0]).toBeCloseTo(pL, 6);
    }
  });

  it("agrees with an independent cohort's palms (Fitzpatrick I to VI, forearm against palm)", () => {
    // Phan et al. 2022: its dark group (forearm < 50) and its light group. The
    // forearm stands in for the back of the hand, a little lighter than it,
    // so within 4 L*.
    for (const dark of [true, false]) {
      const g = FOREARM_PALM.filter(([x]) => x < 50 === dark);
      const forearm = g.reduce((s, [x]) => s + x, 0) / g.length;
      const palm = g.reduce((s, [, y]) => s + y, 0) / g.length;
      expect(Math.abs(palmLab(toneAtLightness(forearm))[0] - palm)).toBeLessThan(4);
    }
  });

  it("lightens the palm far more on deep skin than on fair (the fairness case)", () => {
    const gap = (m: number) => measured(palmAlbedo(tone(m)))[0] - measuredSkinLightness(tone(m));
    // Fair: about the body's lightness, a little darker, as measured.
    expect(Math.abs(gap(0))).toBeLessThan(5);
    // The archive's darkest backs of hands (L* < 35): palms +16.4 L*.
    expect(gap(1)).toBeGreaterThan(15);
    for (let i = 1; i < TONES.length; i++)
      expect(gap(TONES[i] as number)).toBeGreaterThan(gap(TONES[i - 1] as number) - 0.5);
  });

  it("keeps the figure's haemoglobin and undertone, and lightens a non-natural colour", () => {
    const warm = measured(palmAlbedo(tone(0.8, { undertone: 1 })));
    const cool = measured(palmAlbedo(tone(0.8, { undertone: -1 })));
    expect(warm[2]).toBeGreaterThan(cool[2]);
    const green: Rgb = [0.1, 0.4, 0.1];
    const palm = palmAlbedo(tone(0.5, { override: green }));
    for (let k = 0; k < 3; k++) expect(palm[k]).toBeGreaterThan(green[k] as number);
  });
});

describe("the hands' layers in the stack", () => {
  it("paint at every tone and age, and come before the state layers", () => {
    const first = SKIN_LAYERS.indexOf(HAND_SKIN_LAYERS[0]);
    const goose = SKIN_LAYERS.indexOf(GOOSEBUMP_LAYER);
    expect(first).toBeGreaterThan(SKIN_LAYERS.findIndex((l) => l.id === "areola"));
    expect(goose).toBeGreaterThan(first + HAND_SKIN_LAYERS.length - 1);
    for (const adult of [true, false]) {
      const table = paintStopTable(SKIN_LAYERS, {
        tone: tone(0.9),
        flush: 0.4,
        lips: 0.5,
        areola: 0.5,
        signals: {},
        adult,
      });
      for (const layer of HAND_SKIN_LAYERS) {
        const row = SKIN_LAYERS.indexOf(layer) * STOP_TABLE_WIDTH * 4;
        expect(table[row], layer.id).toBe(1);
      }
    }
  });
});
