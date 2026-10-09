/**
 * What the rig's skinning does at the joint extremes, held against linear blend
 * skinning on the packed figure (docs/ARCHITECTURE.md, "Skinning artefacts";
 * the cases and measures are scripts/lib/skinBench.ts). The shipped blend must
 * keep what dual quaternions fix (a twisted limb's girth and a raised arm's
 * volume), never be worse than linear skinning where it matters, and not bulge
 * a bent joint past what the table was searched to allow.
 */
import { describe, expect, it } from "vitest";
import { type Reading, SkinBench } from "../scripts/lib/skinBench.ts";
import { skinPositions, skinPositionsLinear } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const bench = new SkinBench(loadFixtureAssets(), ["average", "tall lean man", "short full woman"]);
const linear = bench.readings(skinPositionsLinear);
const shipped = bench.readings(skinPositions);

/** The reading of `joint` at `angle` for each body, from `readings`. */
const at = (readings: Reading[], joint: string, angle: number) =>
  readings.filter((r) => r.joint === joint && r.angle === angle);
const worstP5 = (rs: Reading[]) => Math.min(...rs.map((r) => r.p5));
const worstDV = (rs: Reading[]) => Math.min(...rs.map((r) => r.dV));

describe("the shipped skinning at the joint extremes", () => {
  it("keeps a twisted limb's girth where linear skinning collapses it", () => {
    // [joint, angle, the 5th percentile it must reach]; it must also beat linear skinning by 0.05
    const twists: [string, number, number][] = [
      ["forearm twist", 180, 0.88],
      ["upper arm twist", 135, 0.8],
      ["thigh twist", 90, 0.9],
    ];
    for (const [joint, angle, floor] of twists) {
      const got = worstP5(at(shipped, joint, angle));
      expect(got, `${joint} ${angle}°`).toBeGreaterThan(floor);
      expect(got, `${joint} ${angle}° over linear`).toBeGreaterThan(
        worstP5(at(linear, joint, angle)) + 0.05,
      );
    }
  });

  it("keeps the volume a raised arm and a flexed hip lose to linear skinning", () => {
    // The shipped loss must be under 70 % of linear's.
    const cases: [string, number][] = [
      ["shoulder raise (forward)", 130],
      ["shoulder raise (side)", -130],
      ["upper arm twist", 135],
      ["thigh twist", 90],
      ["hip flexion", -120],
    ];
    for (const [joint, angle] of cases) {
      const was = worstDV(at(linear, joint, angle));
      const now = worstDV(at(shipped, joint, angle));
      expect(was, `${joint} ${angle}° loses volume in linear skinning`).toBeLessThan(-4);
      expect(now, `${joint} ${angle}°`).toBeGreaterThan(was * 0.7);
    }
  });

  it("is never worse than linear skinning in a joint's girth, or by more than a thousandth in its volume", () => {
    linear.forEach((l, i) => {
      const s = shipped[i] as Reading;
      const name = `${l.figure}, ${l.joint} ${l.angle}°`;
      expect(s.mean, name).toBeGreaterThanOrEqual(l.mean - 0.005);
      expect(s.dV, name).toBeGreaterThan(l.dV - 1);
      expect(s.p5, name).toBeGreaterThan(l.p5 - 0.05);
    });
  });

  it("bulges no bent joint past what the table was searched to allow", () => {
    for (const s of shipped)
      expect(s.p95, `${s.figure}, ${s.joint} ${s.angle}°`).toBeLessThan(1.45);
  });
});
