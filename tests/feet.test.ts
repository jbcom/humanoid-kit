import { describe, expect, it } from "vitest";
import { CALLUS_LAYER, callusAmount, footFrame } from "../src/surface/regions/feet.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const P = assets.positions;
const n = assets.manifest.vertexCount;

describe("the foot frame", () => {
  const frame = footFrame(assets);
  const zones = skinZones(assets);

  it("runs from the heel (0) to the second toe's tip (1), the same on both feet", () => {
    for (const side of [0, 1] as const) {
      const f = frame.landmarks[side];
      // A foot is about a quarter of a metre long.
      expect(frame.length[side]).toBeGreaterThan(0.2);
      expect(frame.length[side]).toBeLessThan(0.32);
      // Heel pad near the back, ball two thirds of the way, the big toe's pad near the end.
      expect(f.heel.along).toBeGreaterThan(0.04);
      expect(f.heel.along).toBeLessThan(0.2);
      for (const mt of f.metatarsals) {
        expect(mt.along).toBeGreaterThan(0.55);
        expect(mt.along).toBeLessThan(0.8);
      }
      expect(f.hallux.along).toBeGreaterThan(0.85);
      expect(f.hallux.along).toBeLessThan(1.02);
    }
    // The feet mirror each other, and `across` is outward on both: the same number.
    expect(frame.landmarks[0].heel.along).toBeCloseTo(frame.landmarks[1].heel.along, 2);
    expect(frame.landmarks[0].hallux.across).toBeCloseTo(frame.landmarks[1].hallux.across, 2);
    expect(frame.landmarks[0].hallux.along).toBeCloseTo(frame.landmarks[1].hallux.along, 2);
  });

  it("puts the big toe on the inside and the little toe on the outside of each foot", () => {
    for (const side of [0, 1] as const) {
      const f = frame.landmarks[side];
      // Across is positive toward the outside of the foot.
      expect(f.metatarsals[0]?.across).toBeLessThan(f.metatarsals[4]?.across as number);
      expect(f.hallux.across).toBeLessThan(0);
    }
  });

  it("measures along and across for the foot's vertices, none elsewhere", () => {
    let feet = 0;
    for (let v = 0; v < n; v++) {
      if ((zones.zone("foot")[v] as number) < 0.5) {
        expect(frame.side[v], `vertex ${v} off the feet`).toBe(255);
        continue;
      }
      feet++;
      const side = (P[v * 3] as number) >= 0 ? 0 : 1;
      expect(frame.side[v]).toBe(side);
      expect(Number.isFinite(frame.along[v])).toBe(true);
      expect(Number.isFinite(frame.across[v])).toBe(true);
    }
    expect(feet).toBeGreaterThan(1000);
  });
});

describe("callus", () => {
  const fields = CALLUS_LAYER.fields(assets);
  const frame = footFrame(assets);

  /** Largest mask on a foot's sole within `r` metres (along the foot) and across of a landmark. */
  const peakNear = (side: 0 | 1, along: number, across: number, r: number) => {
    let best = 0;
    for (let v = 0; v < n; v++) {
      if (frame.side[v] !== side) continue;
      const da = ((frame.along[v] as number) - along) * (frame.length[side] as number);
      const dc = (frame.across[v] as number) - across;
      if (Math.hypot(da, dc) < r) best = Math.max(best, fields.mask[v] as number);
    }
    return best;
  };

  it("is on the sole at the heel, the ball and the big toe's pad, on both feet", () => {
    for (const side of [0, 1] as const) {
      const f = frame.landmarks[side];
      expect(peakNear(side, f.heel.along, f.heel.across, 0.012), "heel").toBeGreaterThan(0.8);
      expect(peakNear(side, f.hallux.along, f.hallux.across, 0.012), "hallux").toBeGreaterThan(0.6);
      const ball = f.metatarsals[0] as { along: number; across: number };
      expect(peakNear(side, ball.along, ball.across, 0.012), "ball").toBeGreaterThan(0.8);
    }
  });

  it("is absent from the top of the foot, the arch and everything but the feet", () => {
    const zones = skinZones(assets);
    const sole = zones.sole;
    let dorsal = 0;
    let off = 0;
    for (let v = 0; v < n; v++) {
      const m = fields.mask[v] as number;
      if (frame.side[v] === 255 && m > 0) off++;
      if ((zones.zone("foot")[v] as number) > 0.5 && (sole[v] as number) === 0 && m > 0.05)
        dorsal++;
    }
    expect(off).toBe(0);
    expect(dorsal).toBe(0);
  });

  it("is between 0 and 1 and the arch carries less than the heel", () => {
    expect(Math.max(...fields.mask)).toBeLessThanOrEqual(1);
    expect(Math.min(...fields.mask)).toBeGreaterThanOrEqual(0);
    const f = frame.landmarks[0];
    // Midway between heel and ball, on the foot's inner side: the arch.
    const arch = peakNear(
      0,
      (f.heel.along + (f.metatarsals[0] as { along: number }).along) / 2,
      -0.03,
      0.012,
    );
    expect(arch).toBeLessThan(0.35);
  });

  it("thickens with age: little in a small child, most in the old", () => {
    expect(callusAmount(1)).toBeLessThan(0.2);
    expect(callusAmount(10)).toBeLessThan(callusAmount(30));
    expect(callusAmount(30)).toBeLessThan(callusAmount(80));
    expect(callusAmount(80)).toBeLessThanOrEqual(1);
    expect(callusAmount(undefined)).toBe(callusAmount(30));
  });
});
