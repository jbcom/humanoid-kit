/**
 * Jewellery against the rendered skin: a barbell's balls sit outside the
 * skin, where they show, and its bar runs through the tissue between them.
 */
import { describe, expect, it } from "vitest";
import { barbellBall } from "../src/bodyArt/jewellery.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import type { Vec3 } from "../src/presence/presence.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const body = model.topology().body;

/**
 * The signed distance from `p` to the surface, metres: to its closest point,
 * positive on the side its interpolated normal faces.
 */
function signedDistance(p: Vec3, positions: Float32Array, normals: Float32Array): number {
  const I = body.index;
  let best = Number.POSITIVE_INFINITY;
  let sign = 1;
  const at = (v: number, a: Float32Array): Vec3 => [
    a[v * 3] as number,
    a[v * 3 + 1] as number,
    a[v * 3 + 2] as number,
  ];
  for (let t = 0; t < I.length; t += 3) {
    const [ia, ib, ic] = [I[t] as number, I[t + 1] as number, I[t + 2] as number];
    const [a, b, c] = [at(ia, positions), at(ib, positions), at(ic, positions)];
    // Cheap reject: farther from a vertex than the best and the triangle's size.
    const da = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    if (da - 0.05 > best) continue;
    const { point, weights } = closestOnTriangle(p, a, b, c);
    const d = Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]);
    if (d < best) {
      best = d;
      const [na, nb, nc] = [at(ia, normals), at(ib, normals), at(ic, normals)];
      const n = [0, 1, 2].map(
        (k) =>
          (na[k] as number) * weights[0] +
          (nb[k] as number) * weights[1] +
          (nc[k] as number) * weights[2],
      );
      const out =
        (p[0] - point[0]) * (n[0] as number) +
        (p[1] - point[1]) * (n[1] as number) +
        (p[2] - point[2]) * (n[2] as number);
      sign = out >= 0 ? 1 : -1;
    }
  }
  return sign * best;
}

/** The closest point on triangle abc to p, and its barycentric weights (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  const sub = (x: Vec3, y: Vec3): Vec3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const result = (u: number, v: number, w: number) => ({
    point: [0, 1, 2].map(
      (k) => (a[k] as number) * u + (b[k] as number) * v + (c[k] as number) * w,
    ) as Vec3,
    weights: [u, v, w] as const,
  });
  if (d1 <= 0 && d2 <= 0) return result(1, 0, 0);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return result(0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return result(1 - v, v, 0);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return result(0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return result(1 - w, 0, w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return result(0, 1 - w, w);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return result(1 - v - w, v, w);
}

describe("a barbell on the rendered skin", () => {
  for (const site of ["navel", "brow.L", "brow.R"] as const)
    it(`at the ${site}, has both balls outside the skin and its bar through it`, () => {
      const ev = model.evaluate(
        createRecipe({ bodyArt: { piercings: [{ site, jewellery: "barbell" }] } }),
      );
      const p = ev.bodyArt?.piercings[0];
      if (!p) throw new Error("no piercing placed");
      const sd = (q: Vec3) => signedDistance(q, ev.positions, ev.normals);
      // Each ball rests on the skin: its centre outside, by about its radius
      // (the rendered surface is the subdivided one, a little off the control mesh's).
      const r = barbellBall(p);
      for (const [end, which] of [
        [p.ends[0], "one ball"],
        [p.ends[1], "the other ball"],
      ] as const) {
        expect(sd(end), which).toBeGreaterThan(0.5 * r);
        expect(sd(end), which).toBeLessThan(2 * r);
      }
      expect(sd(p.middle), "the bar's middle, in the tissue").toBeLessThan(0);
    });
});
