/**
 * Each reservoir's loop, as the adult pack ships it, is a smooth edge loop of the
 * patched surface (scripts/lib/detail/smoothLoop.ts), not a staircase of whole
 * refinement polygons. A staircase's band to the first ring was a row of thin teeth,
 * each leaning its own way, which shaded as a fringe round the shaft's root and the
 * sac's corners.
 *
 * The loop is measured, not the band's quads: a thin shaft draws its first ring in
 * toward its centre over the skin (`Pose.rootFollows`), and its band's quads are long
 * and narrow by design, while a staircase's band at a full shaft's root had quads no
 * thinner than a smooth loop's.
 */
import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import type { Vec3 } from "../scripts/lib/detail/disc.ts";
import { reservoirRoot } from "../scripts/lib/detail/root.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no lattice");
const specs = adultManifest.anatomy?.reservoirs ?? [];

/**
 * The most a loop may turn at one vertex, degrees, seen along the root's normal. A
 * staircase turns a right angle at every step (96 degrees at the shaft's root and 138 at
 * the sac's corners on the pack before the patches); the faired loops turn at most 25.
 */
const MOST_TURN = 40;

/** The most a closed loop turns at any one of its vertices, seen along `normal`, degrees. */
function mostTurn(loop: readonly Vec3[], normal: Vec3): number {
  const n = loop.length;
  const flat = (a: Vec3, b: Vec3): Vec3 => {
    const v: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const k = v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2];
    return [v[0] - normal[0] * k, v[1] - normal[1] * k, v[2] - normal[2] * k];
  };
  let most = 0;
  for (let i = 0; i < n; i++) {
    const e0 = flat(loop[(i + n - 1) % n] as Vec3, loop[i] as Vec3);
    const e1 = flat(loop[i] as Vec3, loop[(i + 1) % n] as Vec3);
    const cos =
      (e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2]) / (Math.hypot(...e0) * Math.hypot(...e1));
    most = Math.max(most, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  }
  return most;
}

describe("each reservoir's loop", { timeout: 300_000 }, () => {
  it.each(["phallic", "labioscrotal"])("%s turns smoothly at every vertex", (id) => {
    const spec = specs.find((r) => r.id === id);
    if (!spec) throw new Error(`no ${id} reservoir`);
    const root = reservoirRoot(lattice, spec);
    expect(mostTurn(root.loop as Vec3[], root.normal)).toBeLessThan(MOST_TURN);
  });
});
