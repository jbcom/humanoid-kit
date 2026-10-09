import { describe, expect, it } from "vitest";
import {
  BROW_LIFT,
  browColour,
  DECAL_OPACITY,
  decalOpacity,
  LASH_DARKEN,
  lashColour,
} from "../src/surface/decalTone.ts";
import { HAIR_COLOURS, hairAlbedo } from "../src/surface/hairTone.ts";
import { luminance } from "../src/surface/skinTone.ts";

describe("the colour of brows and lashes", () => {
  it("brows are the hair's colour, lifted a little, for every colour the hair can be", () => {
    for (const [name, c] of Object.entries(HAIR_COLOURS)) {
      const albedo = hairAlbedo(c);
      browColour(c).forEach((v, k) => {
        expect(v, `${name} ${k}`).toBeCloseTo((albedo[k] as number) ** BROW_LIFT, 9);
        // Never darker than the hair, and never so far lifted it is another colour.
        expect(v, `${name} ${k}`).toBeGreaterThanOrEqual(albedo[k] as number);
        expect(v, `${name} ${k}`).toBeLessThanOrEqual(Math.max(0.65, (albedo[k] as number) * 2));
      });
      // The lift keeps hue: red stays the largest channel of a coloured hair, blue the least.
      const [r, g, b] = browColour(c);
      if (c.grey === 0 && c.pheomelanin > c.eumelanin) {
        expect(r, name).toBeGreaterThanOrEqual(g);
        expect(g, name).toBeGreaterThanOrEqual(b);
      }
    }
  });

  it("a blonde's brow keeps more of its blue than its albedo does, against the tone curve's crush", () => {
    const blonde = HAIR_COLOURS.blonde as (typeof HAIR_COLOURS)[string];
    const [, , ab] = hairAlbedo(blonde as never);
    const [br, , bb] = browColour(blonde as never);
    expect(bb / br).toBeGreaterThan(ab / (hairAlbedo(blonde as never)[0] as number));
  });

  it("lashes are the same hue darker by a fixed factor", () => {
    expect(LASH_DARKEN).toBeGreaterThan(0.3);
    expect(LASH_DARKEN).toBeLessThan(0.8);
    for (const [name, c] of Object.entries(HAIR_COLOURS)) {
      const brow = browColour(c);
      const lash = lashColour(c);
      brow.forEach((v, k) => {
        expect(lash[k], `${name} ${k}`).toBeCloseTo(v * LASH_DARKEN, 9);
      });
      expect(luminance(lash), name).toBeLessThan(luminance(brow));
    }
  });

  it("follow the colour's pigments, not a table: more eumelanin is darker", () => {
    const light = browColour({ eumelanin: 0.1, pheomelanin: 0, grey: 0, override: null });
    const dark = browColour({ eumelanin: 0.9, pheomelanin: 0, grey: 0, override: null });
    expect(luminance(dark)).toBeLessThan(luminance(light));
  });

  it("take an override colour as it is, darkened for lashes", () => {
    const c = {
      eumelanin: 0.5,
      pheomelanin: 0.1,
      grey: 0,
      override: [0.2, 0.1, 0.05] as [number, number, number],
    };
    expect(browColour(c)[0]).toBeCloseTo(0.2 ** BROW_LIFT, 9);
    expect(lashColour(c)[0]).toBeCloseTo(0.2 ** BROW_LIFT * LASH_DARKEN, 9);
  });
});

describe("how much of a brow or a lash a figure of an age has", () => {
  it("is sparse and fine in a small child and full by the teens", () => {
    for (const kind of ["brows", "lashes"] as const) {
      expect(decalOpacity(kind, 0), kind).toBe(DECAL_OPACITY[kind].youngest);
      expect(decalOpacity(kind, 6), kind).toBeLessThan(0.95);
      expect(decalOpacity(kind, 6), kind).toBeGreaterThan(DECAL_OPACITY[kind].youngest);
      expect(decalOpacity(kind, 14), kind).toBe(1);
      expect(decalOpacity(kind, 60), kind).toBe(1);
      let last = 0;
      for (let age = 0; age <= 20; age += 0.5) {
        expect(decalOpacity(kind, age)).toBeGreaterThanOrEqual(last);
        last = decalOpacity(kind, age);
      }
    }
    expect(DECAL_OPACITY.brows.youngest).toBeLessThan(DECAL_OPACITY.lashes.youngest);
    expect(decalOpacity("brows", undefined)).toBe(1);
  });
});
