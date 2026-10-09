import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { EXPRESSIONS, expressionUnits } from "../src/rig/expressions.ts";
import { mirrorUnit } from "../src/rig/faceMirror.ts";
import { faceUnitRotations, restBones, rigData, skinPositions } from "../src/rig/pose.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const unitNames: string[] = bodyManifest.faceUnits.names;
const REQUIRED = [
  "smile",
  "grin",
  "frown",
  "surprise",
  "anger",
  "disgust",
  "fear",
  "sad",
  "blink",
  "squint",
];

describe("the named expressions", () => {
  it("cover the basic emotions, a blink and a squint", () => {
    const ids = EXPRESSIONS.map((e) => e.id);
    for (const id of REQUIRED) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are made only of face units the body pack has, at weights above 0 and up to 1", () => {
    for (const e of EXPRESSIONS) {
      expect(Object.keys(e.faceUnits).length, e.id).toBeGreaterThan(0);
      for (const [unit, w] of Object.entries(e.faceUnits)) {
        expect(unitNames, `${e.id}: ${unit}`).toContain(unit);
        expect(w, `${e.id}: ${unit}`).toBeGreaterThan(0);
        expect(w, `${e.id}: ${unit}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("are symmetric: every left unit is held at the weight of its right", () => {
    for (const e of EXPRESSIONS) {
      for (const [unit, w] of Object.entries(e.faceUnits)) {
        const other = mirrorUnit(unit);
        if (other === unit) continue;
        expect(e.faceUnits[other], `${e.id}: ${unit} has no ${other}`).toBe(w);
      }
    }
  });

  it("scale with intensity, to nothing at 0 and no further than the unit's full weight", () => {
    const full = expressionUnits("surprise");
    const half = expressionUnits("surprise", 0.5);
    expect(Object.keys(half).sort()).toEqual(Object.keys(full).sort());
    for (const [u, w] of Object.entries(full)) expect(half[u]).toBeCloseTo(w * 0.5, 9);
    expect(expressionUnits("surprise", 0)).toEqual({});
    const over = expressionUnits("surprise", 3);
    for (const [u, w] of Object.entries(full)) expect(over[u]).toBe(w);
    expect(() => expressionUnits("nope")).toThrow(/unknown expression/);
  });
});

describe("the named expressions on the body", () => {
  const assets = loadFixtureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const rig = rigData(assets);
  const BODY_VERTICES = 13380;

  /** The body's triangles, helper geometry (eyelash and tongue helpers, joints) left out. */
  const triangles: number[] = [];
  for (let f = 0; f < assets.faceVerts.length; f += 4) {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f + k] as number);
    if (q.some((v) => v >= BODY_VERTICES)) continue;
    triangles.push(q[0] as number, q[1] as number, q[2] as number);
    triangles.push(q[0] as number, q[2] as number, q[3] as number);
  }

  /** Fractions of rays inside a cone about +Z that leave `from` without meeting the body. */
  function opening(posed: Float32Array, from: number[]): number {
    const near: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = triangles[t + k] as number;
        const d = Math.hypot(
          (posed[v * 3] as number) - (from[0] as number),
          (posed[v * 3 + 1] as number) - (from[1] as number),
          (posed[v * 3 + 2] as number) - (from[2] as number),
        );
        if (d < 0.1) {
          near.push(t);
          break;
        }
      }
    }
    const rays = 160;
    let out = 0;
    for (let i = 0; i < rays; i++) {
      const r = Math.sqrt((i + 0.5) / rays) * Math.tan((35 * Math.PI) / 180);
      const a = i * 2.399963;
      const len = Math.hypot(r * Math.cos(a), r * Math.sin(a), 1);
      const d = [(r * Math.cos(a)) / len, (r * Math.sin(a)) / len, 1 / len];
      if (!near.some((t) => hits(posed, from, d, t))) out++;
    }
    return out / rays;
  }

  /** Möller–Trumbore: does the ray from `o` along `d` meet triangle `t` ahead of it. */
  function hits(p: Float32Array, o: number[], d: number[], t: number): boolean {
    const [a, b, c] = [0, 1, 2].map((k) => (triangles[t + k] as number) * 3) as [
      number,
      number,
      number,
    ];
    const P = (i: number, k: number) => p[i + k] as number;
    const e1 = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)] as number[];
    const e2 = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)] as number[];
    const [d0, d1, d2] = d as [number, number, number];
    const h = [
      d1 * (e2[2] as number) - d2 * (e2[1] as number),
      d2 * (e2[0] as number) - d0 * (e2[2] as number),
      d0 * (e2[1] as number) - d1 * (e2[0] as number),
    ] as number[];
    const det =
      (e1[0] as number) * (h[0] as number) +
      (e1[1] as number) * (h[1] as number) +
      (e1[2] as number) * (h[2] as number);
    if (Math.abs(det) < 1e-12) return false;
    const f = 1 / det;
    const s = [(o[0] as number) - P(a, 0), (o[1] as number) - P(a, 1), (o[2] as number) - P(a, 2)];
    const u =
      f *
      ((s[0] as number) * (h[0] as number) +
        (s[1] as number) * (h[1] as number) +
        (s[2] as number) * (h[2] as number));
    if (u < 0 || u > 1) return false;
    const q = [
      (s[1] as number) * (e1[2] as number) - (s[2] as number) * (e1[1] as number),
      (s[2] as number) * (e1[0] as number) - (s[0] as number) * (e1[2] as number),
      (s[0] as number) * (e1[1] as number) - (s[1] as number) * (e1[0] as number),
    ] as number[];
    const v = f * (d0 * (q[0] as number) + d1 * (q[1] as number) + d2 * (q[2] as number));
    if (v < 0 || u + v > 1) return false;
    return (
      f *
        ((e2[0] as number) * (q[0] as number) +
          (e2[1] as number) * (q[1] as number) +
          (e2[2] as number) * (q[2] as number)) >
      1e-4
    );
  }

  const figure = (age: number) => {
    const rest = model.evaluate(createRecipe({ macros: { age, gender: 0.5 } })).control;
    const bones = restBones(assets, rest);
    const pose = (units: Record<string, number>) =>
      skinPositions(
        bones,
        faceUnitRotations(rig, units),
        rest,
        assets.skinIndex,
        assets.skinWeight,
        new Float32Array(rest.length),
      );
    const eye = (side: "L" | "R") => {
      const i = bones.names.indexOf(`eye.${side}`);
      return [bones.heads[i * 3], bones.heads[i * 3 + 1], bones.heads[i * 3 + 2]] as number[];
    };
    return { rest, pose, eye };
  };

  it("a blink closes both eyes completely, at every age", { timeout: 120_000 }, () => {
    for (const age of [6, 14, 45, 75]) {
      const f = figure(age);
      const open = opening(f.pose({}), f.eye("L"));
      const closed = opening(f.pose(expressionUnits("blink")), f.eye("L"));
      const closedRight = opening(f.pose(expressionUnits("blink")), f.eye("R"));
      expect(open, `age ${age} open`).toBeGreaterThan(0.25);
      expect(closed, `age ${age} left`).toBeLessThan(0.02);
      expect(closedRight, `age ${age} right`).toBeLessThan(0.02);
    }
  });

  it("a squint narrows the eyes without closing them", { timeout: 120_000 }, () => {
    const f = figure(45);
    const open = opening(f.pose({}), f.eye("L"));
    const squint = opening(f.pose(expressionUnits("squint")), f.eye("L"));
    expect(squint).toBeLessThan(open * 0.75);
    expect(squint).toBeGreaterThan(0.02);
  });

  it("move the face the same on both sides", { timeout: 120_000 }, () => {
    const f = figure(45);
    const rest = f.rest;
    // Skin vertex pairs reflected in the face's midplane (the rest figure is symmetric).
    const head: number[] = [];
    const neck = restBones(assets, rest).names.indexOf("head");
    const headY = restBones(assets, rest).heads[neck * 3 + 1] as number;
    for (let v = 0; v < BODY_VERTICES; v++) if ((rest[v * 3 + 1] as number) > headY) head.push(v);
    const partner = (v: number): number => {
      let best = Number.POSITIVE_INFINITY;
      let bi = v;
      for (const w of head) {
        const d =
          ((rest[w * 3] as number) + (rest[v * 3] as number)) ** 2 +
          ((rest[w * 3 + 1] as number) - (rest[v * 3 + 1] as number)) ** 2 +
          ((rest[w * 3 + 2] as number) - (rest[v * 3 + 2] as number)) ** 2;
        if (d < best) {
          best = d;
          bi = w;
        }
      }
      return bi;
    };
    const pairs = new Map(head.filter((_, i) => i % 7 === 0).map((v) => [v, partner(v)]));
    for (const e of EXPRESSIONS) {
      const p = f.pose(expressionUnits(e.id));
      let worst = 0;
      for (const [v, w] of pairs) {
        const dx = (p[v * 3] as number) - (rest[v * 3] as number);
        const mx = -((p[w * 3] as number) - (rest[w * 3] as number));
        const dy = (p[v * 3 + 1] as number) - (rest[v * 3 + 1] as number);
        const my = (p[w * 3 + 1] as number) - (rest[w * 3 + 1] as number);
        const dz = (p[v * 3 + 2] as number) - (rest[v * 3 + 2] as number);
        const mz = (p[w * 3 + 2] as number) - (rest[w * 3 + 2] as number);
        worst = Math.max(worst, Math.hypot(dx - mx, dy - my, dz - mz));
      }
      expect(worst * 1000, `${e.id}: worst mirrored difference in mm`).toBeLessThan(0.1);
    }
  });
});
