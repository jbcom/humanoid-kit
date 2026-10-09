import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { labFromLinear } from "../src/surface/cielab.ts";
import {
  DEFAULT_HAIR_COLOUR,
  HAIR_COLOURS,
  HAIR_STRAND_MEAN,
  type HairColour,
  hairAlbedo,
  hairTint,
} from "../src/surface/hairTone.ts";
import { luminance, type Rgb } from "../src/surface/skinTone.ts";

const colour = (eumelanin: number, pheomelanin = 0, grey = 0): HairColour => ({
  eumelanin,
  pheomelanin,
  grey,
  override: null,
});

/** What a spectrophotometer reads: the diffuse albedo plus a little specular gloss. */
const SPECULAR = 0.02;
const measured = (c: HairColour) =>
  labFromLinear(hairAlbedo(c).map((x) => x + SPECULAR) as unknown as Rgb);
const deltaE = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((x, i) => x - (b[i] as number)));

describe("hairAlbedo", () => {
  it("darkens monotonically as eumelanin rises, at any pheomelanin and greying", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.98, noNaN: true }),
        fc.double({ min: 0.001, max: 0.02, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        (e, d, p, g) => {
          expect(luminance(hairAlbedo(colour(e + d, p, g)))).toBeLessThan(
            luminance(hairAlbedo(colour(e, p, g))),
          );
        },
      ),
    );
  });

  it("darkens as pheomelanin rises and lightens as the hair greys", () => {
    for (const e of [0, 0.3, 0.7]) {
      expect(luminance(hairAlbedo(colour(e, 0.9)))).toBeLessThan(
        luminance(hairAlbedo(colour(e, 0.1))),
      );
    }
    for (const e of [0.4, 0.8, 1]) {
      expect(luminance(hairAlbedo(colour(e, 0.2, 0.7)))).toBeGreaterThan(
        luminance(hairAlbedo(colour(e, 0.2, 0))),
      );
    }
  });

  it("is redder with pheomelanin: a larger red-to-green ratio at any eumelanin, and a higher a* where the hair is light enough to show it", () => {
    for (const e of [0, 0.15, 0.3, 0.5, 0.8]) {
      // Dark hair loses chroma as it darkens, so a* only rises with pheomelanin in lighter hair.
      if (e <= 0.3)
        expect(measured(colour(e, 0.5))[1], `eumelanin ${e}`).toBeGreaterThan(
          measured(colour(e, 0))[1],
        );
      const [r0, g0] = hairAlbedo(colour(e, 0));
      const [r1, g1] = hairAlbedo(colour(e, 0.5));
      expect(r1 / g1, `eumelanin ${e}`).toBeGreaterThan(r0 / g0);
    }
    const a = hairAlbedo(colour(0.3, 0.6));
    expect(a[0]).toBeGreaterThan(a[1]);
    expect(a[1]).toBeGreaterThan(a[2]);
  });

  it("lets pheomelanin reach a red: the reddest pigment-only hair is well past brown in a*", () => {
    // Measured light brown has a* 6.9. A red needs more.
    let reddest = 0;
    for (let e = 0; e <= 0.3; e += 0.02)
      for (let p = 0; p <= 1; p += 0.02) {
        const lab = measured(colour(e, p));
        if (lab[0] >= 30) reddest = Math.max(reddest, lab[1]);
      }
    expect(reddest).toBeGreaterThan(10);
  });

  it("stays inside [0, 1] for every input, including out-of-range ones", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (e, p, g) => {
          for (const c of hairAlbedo(colour(e, p, g))) expect(c >= 0 && c <= 1).toBe(true);
        },
      ),
    );
  });

  it("returns a non-natural colour unchanged and ignores the pigments", () => {
    const dyed: HairColour = { ...colour(1, 1, 1), override: [0.1, 0.3, 0.6] };
    expect(hairAlbedo(dyed)).toEqual([0.1, 0.3, 0.6]);
  });

  it("reaches the measured tresses: black, dark brown and light brown (CIELAB, one tress each)", () => {
    // Measured untreated tresses, J. Cosmet. Sci. / Soc. Cosmet. Chem. (see
    // docs/research/HAIR-COLOUR.md): black L* 17.3 a* 1.8 b* 1.6; dark brown
    // L* 22 a* 4 b* 4.5; light brown L* 32.6 a* 6.9 b* 14.4. Single tresses,
    // so the bar is a few units of CIELAB distance, not zero.
    const targets: [string, number[]][] = [
      ["black", [17.3, 1.8, 1.6]],
      ["dark brown", [22, 4, 4.5]],
      ["light brown", [32.6, 6.9, 14.4]],
    ];
    for (const [name, lab] of targets) {
      let best = Number.POSITIVE_INFINITY;
      for (let e = 0; e <= 1.0001; e += 0.02)
        for (let p = 0; p <= 1.0001; p += 0.02)
          best = Math.min(best, deltaE(measured(colour(e, p)), lab));
      expect(best, name).toBeLessThan(3.5);
    }
  });

  it("spans black to white along eumelanin: no pigment is unpigmented keratin", () => {
    expect(luminance(hairAlbedo(colour(0, 0)))).toBeGreaterThan(0.4);
    expect(luminance(hairAlbedo(colour(1, 0)))).toBeLessThan(0.012);
  });
});

describe("HAIR_COLOURS", () => {
  it("names natural colours from black to white, each a valid colour", () => {
    for (const id of [
      "black",
      "dark-brown",
      "brown",
      "light-brown",
      "auburn",
      "red",
      "ginger",
      "blonde",
      "light-blonde",
      "platinum",
      "grey",
      "white",
    ])
      expect(HAIR_COLOURS[id], id).toBeDefined();
    for (const [id, c] of Object.entries(HAIR_COLOURS)) {
      for (const k of ["eumelanin", "pheomelanin", "grey"] as const)
        expect(c[k] >= 0 && c[k] <= 1, `${id}.${k}`).toBe(true);
      expect(c.override).toBeNull();
    }
  });

  it("orders the browns by lightness, black the darkest and white the lightest", () => {
    const y = (id: string) => luminance(hairAlbedo(HAIR_COLOURS[id] as HairColour));
    const order = ["black", "dark-brown", "brown", "light-brown", "blonde", "platinum", "white"];
    for (let i = 1; i < order.length; i++)
      expect(y(order[i] as string), order[i]).toBeGreaterThan(y(order[i - 1] as string));
  });

  it("has a default that is one of the presets", () => {
    expect(Object.values(HAIR_COLOURS)).toContainEqual(DEFAULT_HAIR_COLOUR);
  });
});

describe("hairTint", () => {
  it("is the albedo divided by the strand map's mean, so a strand map averages to the albedo", () => {
    const c = HAIR_COLOURS["light-brown"] as HairColour;
    const a = hairAlbedo(c);
    hairTint(c).forEach((t, k) => {
      expect(t * HAIR_STRAND_MEAN).toBeCloseTo(a[k] as number, 12);
    });
  });
});
