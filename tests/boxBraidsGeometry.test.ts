import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { BodySurface, HeadFrame } from "../scripts/lib/hairCards/head.ts";
import { type Cards, threeStrandPlait } from "../scripts/lib/hairCards/ropes.ts";
import { boxBraids } from "../scripts/lib/hairCards/styles.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

const PLAIT = {
  strandRadius: 0.002,
  tipRadius: 0.001,
  laneRadius: 0.0056,
  crossingLift: 0.0045,
  crossings: 7,
  segments: 21,
  sides: 4,
} as const;

const carrier = Array.from({ length: 15 }, (_, i) => new Vector3(0, i * 0.02, 0));

function closestSegmentPair(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3) {
  const d1 = a1.clone().sub(a0);
  const d2 = b1.clone().sub(b0);
  const r = a0.clone().sub(b0);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const epsilon = 1e-12;
  let s = 0;
  let t = 0;
  if (a <= epsilon && e <= epsilon) return { distance: a0.distanceTo(b0), s, t };
  if (a <= epsilon) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(r);
    if (e <= epsilon) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2);
      const denominator = a * e - b * b;
      s = denominator > epsilon ? Math.min(1, Math.max(0, (b * f - c * e) / denominator)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return {
    distance: a0.clone().addScaledVector(d1, s).distanceTo(b0.clone().addScaledVector(d2, t)),
    s,
    t,
  };
}

describe("threeStrandPlait", () => {
  const plait = threeStrandPlait(carrier, new Vector3(0, 0, 1), PLAIT);

  it("makes three continuous physical strands with alternating over/under crossings", () => {
    expect(plait.paths).toHaveLength(3);
    for (const path of plait.paths) expect(path).toHaveLength(PLAIT.segments + 1);
    expect(plait.crossingOrders).toHaveLength(PLAIT.crossings);
    for (const [index, crossing] of plait.crossingOrders.entries()) {
      expect(crossing.over).not.toBe(crossing.under);
      const sample = Math.round(crossing.at * PLAIT.segments);
      const above = plait.paths[crossing.over]?.[sample]?.z ?? 0;
      const below = plait.paths[crossing.under]?.[sample]?.z ?? 0;
      expect(above, `crossing ${index} over strand`).toBeGreaterThan(below);
    }
  });

  it("keeps physical strand centreline clearance at every sampled ring", () => {
    for (let i = 0; i <= PLAIT.segments; i++)
      for (let a = 0; a < 3; a++)
        for (let b = a + 1; b < 3; b++) {
          const aPath = plait.paths[a];
          const bPath = plait.paths[b];
          const aRadii = plait.radii[a];
          const bRadii = plait.radii[b];
          if (!aPath || !bPath || !aRadii || !bRadii) throw new Error("missing plait strand");
          const distance = (aPath[i] as Vector3).distanceTo(bPath[i] as Vector3);
          const required = (aRadii[i] as number) + (bRadii[i] as number) + 0.0001;
          expect(distance, `sample ${i}, strands ${a}/${b}`).toBeGreaterThan(required);
        }
  });

  it("keeps clearance between every pair of actual strand segments, including crossings", () => {
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++) {
        const aPath = plait.paths[a];
        const bPath = plait.paths[b];
        const aRadii = plait.radii[a];
        const bRadii = plait.radii[b];
        if (!aPath || !bPath || !aRadii || !bRadii) throw new Error("missing plait strand");
        for (let i = 0; i < aPath.length - 1; i++)
          for (let j = 0; j < bPath.length - 1; j++) {
            const closest = closestSegmentPair(
              aPath[i] as Vector3,
              aPath[i + 1] as Vector3,
              bPath[j] as Vector3,
              bPath[j + 1] as Vector3,
            );
            const aRadius =
              (aRadii[i] as number) +
              ((aRadii[i + 1] as number) - (aRadii[i] as number)) * closest.s;
            const bRadius =
              (bRadii[j] as number) +
              ((bRadii[j + 1] as number) - (bRadii[j] as number)) * closest.t;
            expect(closest.distance, `segments ${a}:${i} / ${b}:${j}`).toBeGreaterThan(
              aRadius + bRadius + 0.0001,
            );
          }
      }
  });

  it("does not introduce discontinuities between adjacent sampled rings", () => {
    for (const path of plait.paths)
      for (let i = 1; i < path.length; i++)
        expect((path[i] as Vector3).distanceTo(path[i - 1] as Vector3)).toBeLessThan(0.03);
  });
});

function ropeRuns(cards: Cards): number {
  let runs = 0;
  for (let i = 0; i < cards.roots.length; i++)
    if (i === 0 || cards.roots[i] !== (cards.roots[i - 1] as number) + 1) runs++;
  return runs;
}

describe("boxBraids geometry budget", () => {
  let cards: Cards;
  beforeAll(() => {
    const rest = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 }).restHead();
    const head = new HeadFrame(rest);
    cards = boxBraids({ head, body: new BodySurface(rest, head) });
  });

  it("keeps the existing root-section count while making three strands per section", () => {
    expect(ropeRuns(cards) / 3).toBeGreaterThanOrEqual(100);
    expect(ropeRuns(cards) / 3).toBeLessThanOrEqual(200);
  });

  it("stays below four times the former single-tube mesh cost", () => {
    expect(cards.positions.length / 3).toBeLessThanOrEqual(13_425 * 4);
    expect(cards.faceVerts.length / 4).toBeLessThanOrEqual(12_530 * 4);
  });
});
