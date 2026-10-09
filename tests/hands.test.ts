import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import { PALM_BINS, palmAlbedo, palmLab } from "../src/surface/handTone.ts";
import { paintStopTable, STOP_TABLE_WIDTH } from "../src/surface/layers.ts";
import {
  CREASE_GEOMETRY,
  CREASE_PHASES,
  CREASE_SLOTS,
  HAND_SKIN_LAYERS,
  handFrame,
  PALM_CREASE_LINE_LAYER,
  type PalmLandmarks,
  palmCreaseCurves,
  palmCreaseLine,
  palmCreaseLineFields,
  palmCreaseReliefFields,
  sampleCreases,
} from "../src/surface/regions/hands.ts";
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
const P = assets.positions;
const frame = handFrame(assets);
const zones = skinZones(assets);

/** The body's edges, each once. */
const edges = (() => {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) {
      const a = assets.faceVerts[f * 4 + k] as number;
      const b = assets.faceVerts[f * 4 + ((k + 1) % 4)] as number;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  return out;
})();
const dist = (a: number, b: number) =>
  Math.hypot(
    (P[a * 3] as number) - (P[b * 3] as number),
    (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
    (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
  );

/**
 * The worst rate at which a coordinate changes along an edge, relative to
 * `perMetre`, its rate across a crease, times the stronger of the edge's two
 * masks (the most a false crease there could show). Across a crease the rate is
 * about 1; above 1.5 the coordinate jumps between two creases where they show,
 * and interpolation across that edge would draw a crease that is not there.
 * Where the nearest digit changes, at the webs between fingers, the coordinate
 * does jump, but under masks below a fifth.
 */
function worstJump(
  mask: Float32Array,
  coord: Float32Array | null,
  scale: number,
  perMetre: number,
): number {
  if (!coord) throw new Error("a crease layer needs a coordinate");
  let worst = 0;
  for (const [a, b] of edges) {
    const shows = Math.max(mask[a] as number, mask[b] as number);
    if (shows === 0) continue;
    const rate =
      (Math.abs((coord[a] as number) - (coord[b] as number)) * scale) / (dist(a, b) * perMetre);
    worst = Math.max(worst, rate * shows);
  }
  return worst;
}

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

describe("palmar creases", () => {
  const line = palmCreaseLineFields(assets);
  const relief = palmCreaseReliefFields(assets);

  it("lie only on the palmar side", () => {
    for (const f of [line, relief])
      for (let v = 0; v < assets.manifest.vertexCount; v++)
        if ((f.mask[v] as number) > 0) expect(zones.palm[v] as number).toBeGreaterThan(0);
  });

  it("never jump between two creases where they show", () => {
    // Across a crease the line's coordinate runs at 1/band per metre, the
    // fold's phase at 1/width; a faster change on a masked edge is a jump.
    const band = 1 / Math.min(CREASE_GEOMETRY.palm.band, CREASE_GEOMETRY.finger.band);
    const width = 1 / Math.min(CREASE_GEOMETRY.palm.width, CREASE_GEOMETRY.finger.width);
    expect(worstJump(line.mask, line.coord, 1, band)).toBeLessThan(1.5);
    expect(worstJump(relief.mask, relief.coord, CREASE_PHASES, width)).toBeLessThan(1.5);
  });

  it("draw no line where the nearest crease changes but none lies between", () => {
    // Along an edge whose ends are nearest different creases, the line's
    // coordinate passes the crease stop (3/7) only if one of those creases
    // really lies between the ends: its signed distance changes sign along the
    // edge. Otherwise interpolation would draw a line that is not there.
    const s = sampleCreases(assets);
    const slotOf = (id: number) => (id < 3 ? id : 3 + (id % 10));
    let falseLines = 0;
    const plateau = CREASE_GEOMETRY.finger.plateau;
    for (const [a, b] of edges) {
      const ia = s.id[a] as number;
      const ib = s.id[b] as number;
      if (ia < 0 || ib < 0 || ia === ib) continue;
      // Neighbouring fingers' first creases run into the web between them: a
      // line there is one finger's own, ending where the other's begins.
      if (
        frame.digit[a] !== frame.digit[b] &&
        (Math.abs(s.ds[a] as number) < plateau || Math.abs(s.ds[b] as number) < plateau)
      )
        continue;
      if (Math.max(line.mask[a] as number, line.mask[b] as number) < 0.05) continue;
      const ca = (line.coord?.[a] as number) - 3 / 7;
      const cb = (line.coord?.[b] as number) - 3 / 7;
      if (ca * cb >= 0) continue;
      const separates = (id: number) => {
        if (id >= 10 && Math.floor(id / 10) !== frame.digit[a]) return false;
        if (id >= 10 && Math.floor(id / 10) !== frame.digit[b]) return false;
        const da = s.candidates[a * CREASE_SLOTS + slotOf(id)] as number;
        const db = s.candidates[b * CREASE_SLOTS + slotOf(id)] as number;
        return da * db < 0;
      };
      if (!separates(ia) && !separates(ib)) falseLines++;
    }
    expect(falseLines).toBe(0);
  });

  it("keep the palm's three creases apart, the two that share an origin parting from it", () => {
    // Crossing creases would draw an X; the proximal transverse and thenar
    // creases start together at the radial border and must only part.
    for (const side of [0, 1]) {
      const curves = palmCreaseCurves(
        frame.landmarks[side] as PalmLandmarks,
        frame.joints[side] as number[][],
      );
      const points = curves.map((c) =>
        Array.from({ length: 101 }, (_, i) => {
          const t = i / 100;
          const s = 1 - t;
          return [
            s * s * c[0][0] + 2 * s * t * c[1][0] + t * t * c[2][0],
            s * s * c[0][1] + 2 * s * t * c[1][1] + t * t * c[2][1],
          ] as const;
        }),
      );
      const near = (a: readonly (readonly [number, number])[], b: typeof a) => {
        let closest = Number.POSITIVE_INFINITY;
        // Past the first 5% of each (the shared origin), how close the two come.
        for (const p of a.slice(5))
          for (const q of b.slice(5))
            closest = Math.min(closest, Math.hypot(p[0] - q[0], p[1] - q[1]));
        return closest;
      };
      for (const [i, j] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as const)
        expect(
          near(points[i] as never, points[j] as never),
          `creases ${i} and ${j}`,
        ).toBeGreaterThan(0.003);
    }
  });

  it("are wider than the mesh, so each is interpolated exactly", () => {
    // The fold spans a face and the line's linear band two, wherever a crease shows.
    const lengths = edges
      .filter(([a, b]) => (line.mask[a] as number) > 0.5 && (line.mask[b] as number) > 0.5)
      .map(([a, b]) => dist(a, b))
      .sort((x, y) => x - y);
    const p90 = lengths[Math.floor(lengths.length * 0.9)] as number;
    expect(lengths.length).toBeGreaterThan(100);
    expect((CREASE_GEOMETRY.palm.band * 3) / 7).toBeGreaterThan(p90);
    expect(CREASE_GEOMETRY.palm.width).toBeGreaterThan(p90);
  });

  it("darken toward the skin's own colour on deep skin and only shade fair skin", () => {
    const deep = palmCreaseLine(tone(1));
    const fair = palmCreaseLine(tone(0));
    for (let k = 0; k < 3; k++) {
      expect(deep[k] as number).toBeLessThan(fair[k] as number);
      expect(fair[k] as number).toBeLessThan(1);
    }
    // The line's stop is the crease's (3/7); every other stop leaves the palm.
    const p = PALM_CREASE_LINE_LAYER.paint({
      tone: tone(1),
      flush: 0,
      lips: 0.5,
      areola: 0.5,
      signals: {},
    });
    expect(p.stops[3]).toEqual(deep);
    p.stops.forEach((s, i) => {
      if (i !== 3) expect(s).toEqual([1, 1, 1]);
    });
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
