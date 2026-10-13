import { describe, expect, it } from "vitest";
import { addHairStyle, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPackData, clothingPackData } from "./fixtures.ts";
import { hairManifest, hairStyleBin } from "./hairFixtures.ts";

const FEDORA = "hats/fedora01";
const CAP = "hats/jujube_newsboy_cap";
const SUIT = "suits/male_casualsuit01";

const assets = parseHumanoidAssets(bodyPackData(), undefined, clothingPackData(), {
  manifest: hairManifest,
});
for (const id of ["afro01", "short02", "long01", "ponytail01", "bob01"])
  addHairStyle(assets, id, hairStyleBin(id));

/**
 * Hair render vertices that come out through the hat: a ray from inside the
 * crown to the vertex crosses the hat's surface well before it reaches the
 * vertex. An outside check, independent of how the model puts the hair under.
 */
function poking(
  hair: Float32Array,
  hat: Float32Array,
  index: Uint32Array,
): { through: number; inCrown: number; deepest: number } {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < hat.length; i += 3) {
    lo = Math.min(lo, hat[i + 1] as number);
    hi = Math.max(hi, hat[i + 1] as number);
    cx += hat[i] as number;
    cz += hat[i + 2] as number;
  }
  const n = hat.length / 3;
  // Below the crown's top, a little above its lowest point: inside the head.
  const c = [cx / n, lo + 0.02, cz / n] as const;
  let through = 0;
  let inCrown = 0;
  let deepest = 0;
  for (let i = 0; i < hair.length; i += 3) {
    const p = [hair[i] as number, hair[i + 1] as number, hair[i + 2] as number];
    if ((p[1] as number) < (c[1] as number) + 0.03 || (p[1] as number) > hi + 0.05) continue;
    const d = [(p[0] as number) - c[0], (p[1] as number) - c[1], (p[2] as number) - c[2]];
    const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    const u = d.map((x) => (x as number) / len) as [number, number, number];
    let first = Number.POSITIVE_INFINITY;
    for (let t = 0; t < index.length; t += 3) {
      const h = hitTriangle(
        c,
        u,
        hat,
        index[t] as number,
        index[t + 1] as number,
        index[t + 2] as number,
      );
      if (h !== null && h > 0 && h < first) first = h;
    }
    if (!Number.isFinite(first)) continue;
    inCrown++;
    // A millimetre of slack for the render surface's own smoothing.
    if (first < len - 0.001) through++;
    deepest = Math.max(deepest, len - first);
  }
  return { through, inCrown, deepest };
}

function hitTriangle(
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  P: Float32Array,
  a: number,
  b: number,
  c: number,
): number | null {
  const e1 = [0, 1, 2].map((k) => (P[b * 3 + k] as number) - (P[a * 3 + k] as number));
  const e2 = [0, 1, 2].map((k) => (P[c * 3 + k] as number) - (P[a * 3 + k] as number));
  const [e1x, e1y, e1z] = e1 as [number, number, number];
  const [e2x, e2y, e2z] = e2 as [number, number, number];
  const px = d[1] * e2z - d[2] * e2y;
  const py = d[2] * e2x - d[0] * e2z;
  const pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const tx = o[0] - (P[a * 3] as number);
  const ty = o[1] - (P[a * 3 + 1] as number);
  const tz = o[2] - (P[a * 3 + 2] as number);
  const u = (tx * px + ty * py + tz * pz) / det;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
  if (v < 0 || u + v > 1) return null;
  return (e2x * qx + e2y * qy + e2z * qz) / det;
}

/**
 * A hat goes over the hair: hair the hat's crown and band cover is pressed
 * under them, and hair below the hat falls as it did (docs/ARCHITECTURE.md,
 * "Hair under a hat").
 */
describe("hair under a hat", { timeout: 300_000 }, () => {
  const model = new HumanoidModel(assets, { subdivision: 1 });

  it.each([
    ["afro01", FEDORA, 1],
    ["afro01", CAP, 1],
    ["short02", FEDORA, 1],
    ["long01", CAP, 0],
    ["ponytail01", FEDORA, 1],
    // On a figure other than the one the depths are worked out on.
    ["bob01", FEDORA, 0],
    ["bob01", CAP, 0],
  ] as const)("%s does not come through %s (gender %d)", (style, hat, gender) => {
    const e = model.evaluate(
      createRecipe({ macros: { age: 28, gender }, hair: { style }, outfit: [hat] }),
    );
    const index = model.garmentTopology(hat).index;
    const { through, inCrown, deepest } = poking(
      e.hair?.positions as Float32Array,
      e.garments[0]?.positions as Float32Array,
      index,
    );
    expect(inCrown, "the check sees hair inside the crown").toBeGreaterThan(50);
    const seen = `${through} of ${inCrown} through, the deepest ${(deepest * 1000).toFixed(1)} mm`;
    expect(through / inCrown, seen).toBeLessThan(0.01);
    expect(deepest, seen).toBeLessThan(0.004);
  });

  it("leaves hair alone with no hat, and below the hat", () => {
    const bare = model.evaluate(createRecipe({ hair: { style: "long01" } }));
    const suited = model.evaluate(createRecipe({ hair: { style: "long01" }, outfit: [SUIT] }));
    // A garment that is not a hat never moves hair.
    expect(Array.from(suited.hair?.positions ?? [])).toEqual(
      Array.from(bare.hair?.positions ?? []),
    );
    const hatted = model.evaluate(createRecipe({ hair: { style: "long01" }, outfit: [CAP] }));
    const before = bare.hair?.positions as Float32Array;
    const after = hatted.hair?.positions as Float32Array;
    let low = Number.POSITIVE_INFINITY;
    const hat = hatted.garments[0]?.positions as Float32Array;
    for (let i = 1; i < hat.length; i += 3) low = Math.min(low, hat[i] as number);
    let movedLow = 0;
    let lowCount = 0;
    for (let i = 0; i < before.length; i += 3) {
      // Well below the hat (the shoulders, the back), the hair is where it was.
      if ((before[i + 1] as number) > low - 0.12) continue;
      lowCount++;
      const d = Math.hypot(
        (after[i] as number) - (before[i] as number),
        (after[i + 1] as number) - (before[i + 1] as number),
        (after[i + 2] as number) - (before[i + 2] as number),
      );
      if (d > 1e-5) movedLow++;
    }
    expect(lowCount).toBeGreaterThan(100);
    expect(movedLow).toBe(0);
  });

  it("moves only hair at the hat, and only inward", () => {
    const bare = model.evaluate(createRecipe({ hair: { style: "afro01" } }));
    const hatted = model.evaluate(createRecipe({ hair: { style: "afro01" }, outfit: [FEDORA] }));
    const before = bare.hair?.positions as Float32Array;
    const after = hatted.hair?.positions as Float32Array;
    const hat = hatted.garments[0]?.positions as Float32Array;
    const lo = [0, 1, 2].map(() => Number.POSITIVE_INFINITY);
    const hi = [0, 1, 2].map(() => Number.NEGATIVE_INFINITY);
    for (let i = 0; i < hat.length; i += 3)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a] as number, hat[i + a] as number);
        hi[a] = Math.max(hi[a] as number, hat[i + a] as number);
      }
    // The middle of the hat's box, a little low: inside the head.
    const mid = [0, 1, 2].map((a) => ((lo[a] as number) + (hi[a] as number)) / 2);
    mid[1] = (lo[1] as number) + 0.03;
    let moved = 0;
    for (let i = 0; i < before.length; i += 3) {
      const d = [0, 1, 2].map((a) => (after[i + a] as number) - (before[i + a] as number));
      if (Math.hypot(...d) < 1e-6) continue;
      moved++;
      for (let a = 0; a < 3; a++) {
        expect(before[i + a] as number).toBeGreaterThan((lo[a] as number) - 0.03);
        expect(before[i + a] as number).toBeLessThan((hi[a] as number) + 0.03);
      }
      const out = [0, 1, 2].map((a) => (before[i + a] as number) - (mid[a] as number));
      expect(d.reduce((s, x, a) => s + x * (out[a] as number), 0)).toBeLessThan(0);
    }
    expect(moved).toBeGreaterThan(100);
  });
});
