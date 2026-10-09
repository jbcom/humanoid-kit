import { describe, expect, it } from "vitest";
import { labFromLinear } from "../src/surface/cielab.ts";
import { palmAlbedo } from "../src/surface/handTone.ts";
import {
  AREA_SKIN_LAYERS,
  DIGIT_AND_TOENAIL_LAYER,
  NAIL_AND_TOENAIL_GLOSS_LAYER,
  RELIEF_AND_TOE_LAYER,
  SOLE_PALMOPLANTAR_LAYER,
} from "../src/surface/regions/areas.ts";
import { footFrame, toeFrame } from "../src/surface/regions/feet.ts";
import {
  DIGIT_LAYER,
  digitFields,
  HAND_RELIEF_LAYER,
  HAND_RELIEF_PHASES,
  handReliefFields,
  NAIL_GLOSS_LAYER,
  nailFields,
  PALMOPLANTAR_LAYER,
} from "../src/surface/regions/hands/index.ts";
import { SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { SKIN_F0, type SkinTone } from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const n = assets.manifest.vertexCount;
const P = assets.positions;
const input = (melanin: number, age?: number) => ({
  tone: { melanin, haemoglobin: 0.5, undertone: 0, override: null } as SkinTone,
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals: {},
  ...(age !== undefined && { age }),
});

describe("the hands' layers with the feet's skin on them", () => {
  it("keep the hands' layer ids and order, and the stack has the ridges after them", () => {
    const ids = AREA_SKIN_LAYERS.map((l) => l.id);
    expect(ids).toEqual([
      "palmoplantar",
      "palm-crease-lines",
      "knuckles-nails",
      "hand-relief",
      "nail-gloss",
      "sole-ridges",
    ]);
    for (const l of AREA_SKIN_LAYERS) expect(SKIN_LAYERS).toContain(l);
    expect(SKIN_LAYERS).not.toContain(PALMOPLANTAR_LAYER);
    expect(SKIN_LAYERS).not.toContain(DIGIT_LAYER);
    expect(SKIN_LAYERS).not.toContain(HAND_RELIEF_LAYER);
    expect(SKIN_LAYERS).not.toContain(NAIL_GLOSS_LAYER);
  });

  describe("palmoplantar", () => {
    const fields = SOLE_PALMOPLANTAR_LAYER.fields(assets);
    const base = PALMOPLANTAR_LAYER.fields(assets);

    it("keeps the hands' mask exactly and adds the callus as its coordinate, on the sole only", () => {
      expect(Array.from(fields.mask)).toEqual(Array.from(base.mask));
      const frame = footFrame(assets);
      let on = 0;
      for (let v = 0; v < n; v++) {
        const c = (fields.coord as Float32Array)[v] as number;
        if (c > 0) {
          on++;
          expect(frame.side[v], `vertex ${v} is on a foot`).not.toBe(255);
          expect(fields.mask[v] as number).toBeGreaterThan(0);
        }
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(on).toBeGreaterThan(100);
    });

    it("paints the palm's colour first and a callus colour, paler and yellower, second", () => {
      for (const m of [0.1, 0.5, 0.9]) {
        const p = SOLE_PALMOPLANTAR_LAYER.paint(input(m, 40));
        expect(p.stops[0]).toEqual(palmAlbedo(input(m).tone));
        const lab = (c: readonly number[]) => labFromLinear(c.map((x) => x + SKIN_F0) as never);
        const a = lab(p.stops[0] as number[]);
        const b = lab(p.stops[1] as number[]);
        expect(b[0], `melanin ${m}`).toBeGreaterThan(a[0] + 1);
        expect(b[2], `melanin ${m}`).toBeGreaterThan(a[2] + 1);
      }
    });

    it("has more callus the older the figure, and none to speak of in a small child", () => {
      const lift = (age: number) => {
        const p = SOLE_PALMOPLANTAR_LAYER.paint(input(0.5, age));
        const a = p.stops[0] as number[];
        const b = p.stops[1] as number[];
        return Math.hypot(
          (b[0] as number) - (a[0] as number),
          (b[1] as number) - (a[1] as number),
          (b[2] as number) - (a[2] as number),
        );
      };
      expect(lift(2)).toBeLessThan(lift(30));
      expect(lift(30)).toBeLessThan(lift(80));
      expect(lift(2)).toBeLessThan(0.15 * lift(80));
    });
  });

  describe("knuckles and nails with the toenails", () => {
    const fields = DIGIT_AND_TOENAIL_LAYER.fields(assets);
    const hands = digitFields(assets);
    const frame = toeFrame(assets);

    it("leaves every vertex that is not on a toe as the hands' layer has it", () => {
      for (let v = 0; v < n; v++) {
        if (frame.digit[v] !== 0 && (fields.mask[v] as number) !== (hands.mask[v] as number))
          continue;
        expect(fields.mask[v]).toBe(hands.mask[v]);
        expect((fields.coord as Float32Array)[v]).toBe((hands.coord as Float32Array)[v]);
      }
      // The hands themselves are untouched.
      for (let v = 0; v < n; v++)
        if (Math.abs(P[v * 3 + 1] as number) > -0.3 && (P[v * 3 + 1] as number) > -0.3)
          expect(fields.mask[v]).toBe(hands.mask[v]);
    });

    it("has a nail on every toe, with the coordinate at or past the fold's stop, as the fingers' has", () => {
      for (const side of [1, -1])
        for (let toe = 1; toe <= 5; toe++) {
          let best = 0;
          for (let v = 0; v < n; v++)
            if (frame.digit[v] === toe && Math.sign(P[v * 3] as number) === side)
              best = Math.max(best, fields.mask[v] as number);
          expect(best, `toe ${toe}`).toBeGreaterThan(0.5);
        }
      for (let v = 0; v < n; v++)
        if ((fields.mask[v] as number) > 0.5 && frame.digit[v] !== 0)
          expect((fields.coord as Float32Array)[v] as number).toBeGreaterThanOrEqual(1 / 7 - 1e-6);
    });

    it("paints with the hands' stops", () => {
      expect(DIGIT_AND_TOENAIL_LAYER.paint(input(0.5, 30))).toEqual(
        DIGIT_LAYER.paint(input(0.5, 30)),
      );
    });
  });

  describe("nail gloss", () => {
    it("covers the fingernails' gloss and the toenails'", () => {
      const merged = NAIL_AND_TOENAIL_GLOSS_LAYER.fields(assets).mask;
      const hands = nailFields(assets).gloss;
      let more = 0;
      for (let v = 0; v < n; v++) {
        expect(merged[v] as number).toBeGreaterThanOrEqual(hands[v] as number);
        if ((merged[v] as number) > (hands[v] as number)) more++;
      }
      expect(more).toBeGreaterThan(5);
      expect(NAIL_AND_TOENAIL_GLOSS_LAYER.paint(input(0.5))).toEqual(
        NAIL_GLOSS_LAYER.paint(input(0.5)),
      );
    });
  });

  describe("relief", () => {
    const merged = RELIEF_AND_TOE_LAYER.fields(assets);
    const hands = handReliefFields(assets);
    const frame = toeFrame(assets);

    it("is the hands' relief on the hands and the toes' wrinkles and creases on the toes", () => {
      let toes = 0;
      for (let v = 0; v < n; v++) {
        if (frame.digit[v] === 0) {
          expect(merged.mask[v]).toBe(hands.mask[v]);
          expect((merged.coord as Float32Array)[v]).toBe((hands.coord as Float32Array)[v]);
        } else if ((merged.mask[v] as number) > (hands.mask[v] as number)) {
          toes++;
          // A wrinkle band is three periods of the hands' coordinate's ten, a crease one: the coordinate stays within 0.3.
          expect((merged.coord as Float32Array)[v] as number).toBeLessThanOrEqual(
            3 / HAND_RELIEF_PHASES + 1e-6,
          );
        }
      }
      expect(toes).toBeGreaterThan(50);
    });

    it("keeps the hands' paint", () => {
      expect(RELIEF_AND_TOE_LAYER.paint(input(0.5))).toEqual(HAND_RELIEF_LAYER.paint(input(0.5)));
    });
  });
});
