import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import {
  KNUCKLE_MELANIN_FACTOR,
  knuckleAlbedo,
  NAIL_F0,
  nailColours,
  nailStops,
  PALM_BINS,
  palmAlbedo,
  palmLab,
} from "../src/surface/handTone.ts";
import {
  applyLayers,
  type ColourLayer,
  paintStopTable,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import {
  CREASE_GEOMETRY,
  CREASE_PHASES,
  CREASE_SLOTS,
  DIGIT_LAYER,
  digitFields,
  HAND_RELIEF_LAYER,
  HAND_RELIEF_PHASES,
  HAND_SKIN_LAYERS,
  handFrame,
  KNUCKLE_PHASES,
  KNUCKLE_WRINKLE_DEPTH,
  KNUCKLE_WRINKLE_SPACING,
  knuckleFields,
  nailFields,
  PALM_CREASE_DEPTH,
  PALM_CREASE_LINE_LAYER,
  PALM_CREASE_LIP,
  PALMOPLANTAR_FLOOR,
  PALMOPLANTAR_LAYER,
  type PalmLandmarks,
  palmarBorderDistance,
  palmarMask,
  palmCreaseCurves,
  palmCreaseLine,
  palmCreaseLineFields,
  palmCreaseReliefFields,
  sampleCreases,
} from "../src/surface/regions/hands/index.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { GOOSEBUMP_LAYER } from "../src/surface/regions/states.ts";
import {
  luminance,
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
    const border = palmarBorderDistance(assets);
    for (const f of [line, relief])
      for (let v = 0; v < assets.manifest.vertexCount; v++)
        if ((f.mask[v] as number) > 0) expect(border[v] as number).toBeGreaterThan(0);
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
    // Every edge that crosses a crease where it shows has both ends within the
    // line's linear reach (3/7 of its band) and the fold's (half its width and
    // its fade), so across that face both interpolate exactly.
    const s = sampleCreases(assets);
    for (const [kind, g] of [
      [0, CREASE_GEOMETRY.palm],
      [1, CREASE_GEOMETRY.finger],
    ] as const) {
      const reach = edges
        .filter(
          ([a, b]) =>
            s.kind[a] === kind &&
            s.kind[b] === kind &&
            s.id[a] === s.id[b] &&
            Math.sign(s.ds[a] as number) !== Math.sign(s.ds[b] as number) &&
            (line.mask[a] as number) > 0.5 &&
            (line.mask[b] as number) > 0.5,
        )
        .map(([a, b]) => Math.max(Math.abs(s.ds[a] as number), Math.abs(s.ds[b] as number)));
      expect(reach.length, `kind ${kind}`).toBeGreaterThan(10);
      const worst = Math.max(...reach);
      expect((g.band * 3) / 7, `kind ${kind}`).toBeGreaterThan(worst);
      expect(g.width / 2 + g.fade, `kind ${kind}`).toBeGreaterThan(worst);
    }
  });

  it("darken toward the skin's own colour on deep skin and only shade fair skin", () => {
    const deep = palmCreaseLine(tone(1));
    const fair = palmCreaseLine(tone(0));
    for (let k = 0; k < 3; k++) {
      expect(deep[k] as number).toBeLessThan(fair[k] as number);
      expect(fair[k] as number).toBeLessThan(1);
    }
    // The line's stop is the crease's (3/7), its neighbours the lips, a
    // little lighter; every other stop leaves the palm.
    const p = PALM_CREASE_LINE_LAYER.paint({
      tone: tone(1),
      flush: 0,
      lips: 0.5,
      areola: 0.5,
      signals: {},
    });
    expect(p.stops[3]).toEqual(deep);
    p.stops.forEach((s, i) => {
      if (i === 2 || i === 4)
        expect(s).toEqual([PALM_CREASE_LIP, PALM_CREASE_LIP, PALM_CREASE_LIP]);
      else if (i !== 3) expect(s).toEqual([1, 1, 1]);
    });
    expect(PALM_CREASE_LIP).toBeGreaterThan(1);
  });
});

describe("knuckles: more melanin, multiplied, so deeper skin darkens more", () => {
  const k = knuckleFields(assets);

  it("darkens every tone, and deep skin by far more than fair", () => {
    // The fraction of the skin's luminance the knuckle loses: contrast, as the eye reads it.
    const loss = (m: number) =>
      1 - luminance(knuckleAlbedo(tone(m))) / luminance(skinAlbedo(tone(m)));
    for (const m of TONES) expect(loss(m), `melanin ${m}`).toBeGreaterThan(0);
    expect(loss(0.8)).toBeGreaterThan(2 * loss(0.05));
    for (let i = 1; i < TONES.length; i++)
      expect(loss(TONES[i] as number)).toBeGreaterThan(loss(TONES[i - 1] as number));
  });

  it("reddens fair skin's knuckles (extended joints measure redder)", () => {
    const a = (rgb: Rgb) => measured(rgb)[1];
    expect(a(knuckleAlbedo(tone(0.05)))).toBeGreaterThan(a(skinAlbedo(tone(0.05))));
  });

  it("stays below the measured exposed-to-protected melanin ratio", () => {
    // Alaluf 2001/2002: 1.6 in Fitzpatrick V to VI, up to 2 across groups.
    expect(KNUCKLE_MELANIN_FACTOR).toBeGreaterThan(1);
    expect(KNUCKLE_MELANIN_FACTOR).toBeLessThan(1.6);
  });

  it("lie on the back of the digits, where goosebumps can still rise", () => {
    const bumps = GOOSEBUMP_LAYER.fields(assets).mask;
    for (const mask of [k.pigment, k.wrinkles.mask])
      for (let v = 0; v < assets.manifest.vertexCount; v++)
        if ((mask[v] as number) > 0.5) {
          expect(frame.volar[v] as number).toBeLessThan(0.3);
          expect(bumps[v] as number).toBeGreaterThan(0);
        }
  });

  it("draw the wrinkles without jumps", () => {
    // Across the wrinkles the phase runs at 1/spacing per metre, a little more where they bow.
    const rate = 1.3 / KNUCKLE_WRINKLE_SPACING;
    expect(worstJump(k.wrinkles.mask, k.wrinkles.coord, KNUCKLE_PHASES, rate)).toBeLessThan(1.5);
  });
});

describe("nails: a bed nearly free of melanin under keratin", () => {
  const nails = nailFields(assets);
  /** The bed as a colorimeter reads it: the plate's surface reflection added back. */
  const bedLab = (t: SkinTone) => labFromLinear(nailColours(t).bed.map((c) => c + NAIL_F0) as Rgb);

  it("is the measured nail on the measured cohort's skin", () => {
    // Horibata 2025: L* 54.3, a* 4.9, b* 10.1 on skin like the archive's Japanese back of hand (L* 62).
    const lab = bedLab(toneAtLightness(62));
    expect(lab[0]).toBeCloseTo(54.3, 1);
    expect(lab[1]).toBeCloseTo(4.9, 1);
    expect(lab[2]).toBeCloseTo(10.1, 1);
    // Darker and less saturated than the palm on that skin (palm 61.2, 8.0, 15.3).
    expect(lab[0]).toBeLessThan(measured(palmAlbedo(toneAtLightness(62)))[0]);
  });

  it("varies far less across tones than the skin does", () => {
    const L = (m: number) => bedLab(tone(m))[0];
    const skinSpread = measuredSkinLightness(tone(0)) - measuredSkinLightness(tone(1));
    expect(L(0) - L(1)).toBeLessThan(0.25 * skinSpread);
    // Leeb 2024: the darkest nails are near L* 48, not the skin's 30.
    expect(L(1)).toBeGreaterThan(47);
    expect(L(1) - measuredSkinLightness(tone(1))).toBeGreaterThan(15);
  });

  it("orders the free edge and lunula lighter than the bed, the fold darker than the skin", () => {
    for (const m of [0, 0.5, 1]) {
      const c = nailColours(tone(m));
      const lum = (rgb: Rgb) => measured(rgb)[0];
      expect(lum(c.freeEdge)).toBeGreaterThan(lum(c.bed));
      expect(lum(c.lunula)).toBeGreaterThan(lum(c.bed));
      expect(lum(c.fold)).toBeLessThan(measuredSkinLightness(tone(m)));
    }
  });

  it("lie on the back of the last segment of each digit, ten of them", () => {
    for (const mask of [nails.colour.mask, nails.gloss])
      for (let v = 0; v < assets.manifest.vertexCount; v++)
        if ((mask[v] as number) > 0.5) expect(frame.volar[v] as number).toBeLessThan(0.3);
    for (let v = 0; v < assets.manifest.vertexCount; v++) {
      if ((nails.colour.mask[v] as number) <= 0.1) continue;
      const joints = (frame.joints[frame.side[v] as number] as number[][])[
        frame.digit[v] as number
      ] as number[];
      expect(frame.along[v] as number).toBeGreaterThan(joints[2] as number);
    }
    // A few vertices on each of the ten nails.
    const count = Array.from(nails.colour.mask).filter((m) => m > 0.5).length;
    expect(count).toBeGreaterThan(10 * 8);
  });
});

describe("layers shared by features that never meet", () => {
  const input = (m: number) => ({ tone: tone(m), flush: 0, lips: 0.5, areola: 0.5, signals: {} });

  it("ease the palm's colour into the back of the hand and the forearm, with no polygon in the palm", () => {
    const palm = palmarMask(assets);
    const frame = handFrame(assets);
    const P = assets.positions;
    // Across any edge of the hand's mesh the palm's mask changes by at most
    // a fraction: a mask that turns from 1 to 0 within a face draws that
    // face's outline (the palm zone of the skin states does: kept to show it).
    const steepest = (m: ArrayLike<number>) => {
      let worst = 0;
      for (let f = 0; f < assets.faceVerts.length; f += 4)
        for (let k = 0; k < 4; k++) {
          const a = assets.faceVerts[f + k] as number;
          const b = assets.faceVerts[f + ((k + 1) % 4)] as number;
          if (!frame.digit[a] || !frame.digit[b]) continue;
          const len = Math.hypot(
            (P[a * 3] as number) - (P[b * 3] as number),
            (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
            (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
          );
          worst = Math.max(worst, Math.abs((m[a] as number) - (m[b] as number)) / len);
        }
      return worst;
    };
    // Per metre: no steeper than the border's 1.6 cm blend allows (smoothstep's slope peaks at 1.5 / width).
    expect(steepest(palm)).toBeLessThan(1.5 / 0.016 + 1);
    expect(steepest(zones.palm)).toBeGreaterThan(2 * (1.5 / 0.016));
    // The palm's middle is palmar, the back of the hand is not (between the
    // wrist and the knuckles: the fingers are too narrow to reach either fully).
    let middle = 0;
    let back = 1;
    for (let v = 0; v < assets.manifest.vertexCount; v++) {
      const along = frame.palm[v * 2 + 1] as number;
      if (!frame.digit[v] || along < 0.03 || along > 0.07) continue;
      if ((frame.volar[v] as number) > 0.95) middle = Math.max(middle, palm[v] as number);
      if ((frame.volar[v] as number) < -0.95) back = Math.min(back, 1 - (palm[v] as number));
    }
    expect(middle).toBe(1);
    expect(back).toBe(1);
  });

  it("paint the palm's colour over the palms and the soles, nowhere else", () => {
    const { mask } = PALMOPLANTAR_LAYER.fields(assets);
    const palm = palmarMask(assets);
    for (let v = 0; v < assets.manifest.vertexCount; v++) {
      const m = Math.max(palm[v] as number, zones.sole[v] as number);
      // What the 8-bit atlas would round to 0 is dropped, so the mask lies only where it paints.
      expect(mask[v]).toBe(m < PALMOPLANTAR_FLOOR ? 0 : m);
      if (m < PALMOPLANTAR_FLOOR) expect(Math.round(m * 255)).toBe(0);
      // Palm and sole are apart: no vertex is both.
      expect(Math.min(palm[v] as number, zones.sole[v] as number)).toBe(0);
    }
    for (const m of [0, 0.5, 1])
      expect(PALMOPLANTAR_LAYER.paint(input(m)).stops).toEqual([palmAlbedo(tone(m))]);
  });

  it("paint the knuckles and the nails as the two did layered, knuckles under nails", () => {
    const k = knuckleFields(assets).pigment;
    const nails = nailFields(assets).colour;
    const d = digitFields(assets);
    for (const m of [0.05, 0.35, 0.7, 1]) {
      const t = tone(m);
      const stops = DIGIT_LAYER.paint(input(m)).stops;
      expect(stops[0]).toEqual(knuckleAlbedo(t));
      expect(stops.slice(1)).toEqual(nailStops(t).slice(1));
      const layered = (stack: ColourLayer["paint"][]) =>
        paintStopTable(
          stack.map(
            (paint, i): ColourLayer => ({
              id: `l${i}`,
              blend: "mix",
              targets: [],
              fields: () => d,
              paint,
            }),
          ),
          input(m),
        );
      const pair = layered([
        () => ({ strength: 1, stops: [knuckleAlbedo(t)] }),
        () => ({ strength: 1, stops: nailStops(t) }),
      ]);
      const merged = layered([DIGIT_LAYER.paint]);
      const base = skinAlbedo(t);
      let worst = 0;
      for (let v = 0; v < assets.manifest.vertexCount; v++) {
        expect(d.mask[v]).toBe(Math.max(k[v] as number, nails.mask[v] as number));
        if (!(d.mask[v] as number)) continue;
        const a = labFromLinear(
          applyLayers(base, pair, [
            [k[v] as number, 0],
            [nails.mask[v] as number, nails.coord?.[v] as number],
          ]),
        );
        const b = labFromLinear(
          applyLayers(base, merged, [[d.mask[v] as number, d.coord?.[v] as number]]),
        );
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
      // Under 1 ΔE*ab, about a just-noticeable difference (Sharma 2003).
      expect(worst, `melanin ${m}`).toBeLessThan(1);
    }
  });

  it("draw the palm's creases and the knuckles' wrinkles in one relief, each as it was", () => {
    const creases = palmCreaseReliefFields(assets);
    const wrinkles = knuckleFields(assets).wrinkles;
    const relief = HAND_RELIEF_LAYER.fields(assets);
    const depth = KNUCKLE_WRINKLE_DEPTH / PALM_CREASE_DEPTH;
    for (let v = 0; v < assets.manifest.vertexCount; v++) {
      const c = creases.mask[v] as number;
      const k = (wrinkles.mask[v] as number) * depth;
      // Palmar and dorsal: the two never lie on one vertex.
      expect(Math.min(c, k), `vertex ${v}`).toBe(0);
      if (c > 0)
        expect(relief.coord?.[v]).toBeCloseTo(
          ((creases.coord?.[v] as number) * CREASE_PHASES) / HAND_RELIEF_PHASES,
          6,
        );
      if (k > 0) expect(relief.coord?.[v]).toBe(wrinkles.coord?.[v]);
      expect(relief.mask[v]).toBeCloseTo(Math.max(c, k), 6);
    }
    const p = HAND_RELIEF_LAYER.paint(input(0.5));
    expect(p.height).toBe(PALM_CREASE_DEPTH);
    expect(p.size).toBe(HAND_RELIEF_PHASES);
  });
});

describe("the hands' layers in the stack", () => {
  it("paint at every tone and age, and come before the state layers", () => {
    // By id: the stack holds these layers with the feet's skin on them (`areas.ts`).
    const place = (id: string) => SKIN_LAYERS.findIndex((l) => l.id === id);
    const first = place(HAND_SKIN_LAYERS[0].id);
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
        const row = place(layer.id) * STOP_TABLE_WIDTH * 4;
        expect(table[row], layer.id).toBe(1);
      }
    }
  });
});
