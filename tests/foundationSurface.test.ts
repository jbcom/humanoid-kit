/**
 * Surface queries on the posed body (src/foundation/surface.ts, docs/FOUNDATION.md,
 * "What the foundation gives layers"): the closest point of the skin as drawn,
 * the signed distance to it and the body's local frame there, so draping and
 * collision use the body as it actually is in the pose.
 */
import { describe, expect, it } from "vitest";
import { batteryBody } from "../src/foundation/battery.ts";
import { landmarks } from "../src/foundation/landmarks.ts";
import { REST_POSE, SMOKE_POSES } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { BodySurface } from "../src/foundation/surface.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

type V = readonly [number, number, number];
const along = (p: V, d: V, k: number): V => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipe = createRecipe({ macros: { ...batteryBody("m-heavy").macros } });

describe("surface queries", { timeout: 300_000 }, () => {
  it("finds a vertex of the skin as its own closest point, at no distance", () => {
    const body = posedSurface(model, recipe, REST_POSE);
    const surface = new BodySurface(body);
    for (let r = 0; r < body.vertexCount; r += 997) {
      const p: V = [
        body.positions[r * 3] as number,
        body.positions[r * 3 + 1] as number,
        body.positions[r * 3 + 2] as number,
      ];
      const hit = surface.closest(p);
      expect(hit?.distance, `vertex ${r}`).toBeLessThan(1e-6);
      expect(Math.abs(surface.signedDistance(p)), `vertex ${r}`).toBeLessThan(1e-6);
    }
    surface.dispose();
  });

  it("measures a point off the skin as far as it is, positive outside and negative inside, in every pose", () => {
    for (const pose of SMOKE_POSES) {
      const body = posedSurface(model, recipe, pose);
      const surface = new BodySurface(body);
      const marks = landmarks(model, body);
      // Smooth, open places, away from any fold the pose makes.
      for (const id of ["navel", "sternum-notch", "nipple.L", "crown"] as const) {
        const f = marks[id];
        for (const k of [0.005, 0.01]) {
          expect(
            surface.signedDistance(along(f.position, f.normal, k)),
            `${pose} ${id} +${k}`,
          ).toBeCloseTo(k, 3);
          expect(
            surface.signedDistance(along(f.position, f.normal, -k)),
            `${pose} ${id} -${k}`,
          ).toBeCloseTo(-k, 3);
        }
      }
      surface.dispose();
    }
  });

  it("gives the body's frame at the closest point: the skin's normal, and up along the skin", () => {
    const body = posedSurface(model, recipe, REST_POSE);
    const surface = new BodySurface(body);
    const marks = landmarks(model, body);
    // Convex places, where the closest skin to a point off it is the place itself (off a
    // hole's bottom, the navel's, the closest skin is its rim).
    for (const id of ["nipple.L", "pubic-point", "chin", "ear-lobe.L"] as const) {
      const f = marks[id];
      const frame = surface.frame(along(f.position, f.normal, 0.004));
      expect(frame, id).not.toBeNull();
      if (!frame) continue;
      for (let k = 0; k < 3; k++)
        expect(frame.position[k], id).toBeCloseTo(f.position[k] as number, 2);
      expect(dot(frame.normal, f.normal), id).toBeGreaterThan(0.98);
      expect(dot(frame.normal, frame.tangent), id).toBeCloseTo(0, 6);
      expect(dot(frame.tangent, frame.bitangent), id).toBeCloseTo(0, 6);
      // Up projected onto the skin, or forward where the skin faces up or down (under the chin).
      const want: V = Math.abs(frame.normal[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      const d = dot(want, frame.normal);
      const t: V = [
        want[0] - frame.normal[0] * d,
        want[1] - frame.normal[1] * d,
        want[2] - frame.normal[2] * d,
      ];
      expect(dot(frame.tangent, t) / Math.hypot(...t), id).toBeGreaterThan(0.999);
    }
    surface.dispose();
  });

  it("finds nothing beyond the reach it is asked for", () => {
    const body = posedSurface(model, recipe, REST_POSE);
    const surface = new BodySurface(body);
    const f = landmarks(model, body).navel;
    expect(surface.closest(along(f.position, f.normal, 0.05), 0.01)).toBeNull();
    expect(surface.closest(along(f.position, f.normal, 0.005), 0.01)).not.toBeNull();
    surface.dispose();
  });
});
