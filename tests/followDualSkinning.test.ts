/**
 * The body's own CPU skinning (src/render/dualSkinning.ts, `followDualSkinning`):
 * three skins a mesh on the CPU for its bounds and ray picking, and for the
 * body that skinning must be what the shader draws, the joint folds included,
 * as much of them as has faded in. Without the folds a seated figure's bounds
 * and picks miss the folded skin at the hips and the knees.
 */
import { BufferAttribute, BufferGeometry, SkinnedMesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  DualBones,
  FOLD_SLOTS_ATTRIBUTE,
  followDualSkinning,
  makeFoldSlots,
  setSkinAttributes,
  writeFoldSlots,
} from "../src/render/dualSkinning.ts";
import type { SurfaceFold } from "../src/rig/jointFold.ts";
import { skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipe = createRecipe();

/** The recipe's joint folds on its body surface, solved to the end. */
function solved() {
  const steps = model.folds(recipe);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** The posed body's surface as a geometry, with each joint's fold slots. */
function geometryOf(body: ReturnType<typeof posedSurface>, folds: readonly SurfaceFold[]) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(body.rest, 3));
  setSkinAttributes(g, body.skinIndex, body.skinWeight);
  const slots = makeFoldSlots(body.rest.length / 3);
  for (const fold of folds) writeFoldSlots(slots, fold.joint, fold.slot);
  g.setAttribute(FOLD_SLOTS_ATTRIBUTE, slots);
  return g;
}

/** The render vertices any of `folds` moves. */
const movedBy = (folds: readonly SurfaceFold[]) => {
  const moved = new Set<number>();
  for (const fold of folds) for (const [v, s] of fold.slot.entries()) if (s >= 0) moved.add(v);
  return [...moved];
};

describe("the body's CPU skinning (followDualSkinning)", { timeout: 120_000 }, () => {
  it("adds the joint folds as the shader does, scaled by how much of them shows", () => {
    const body = posedSurface(model, recipe, "seated");
    const { surface, folds } = solved();
    expect(surface).toBe(body.surface);
    const g = geometryOf(body, folds);
    const mesh = new SkinnedMesh(g);
    const dual = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    dual.update(body.bones, body.rotations);
    dual.setFolds(folds, surface);
    followDualSkinning(mesh, dual, true);
    // The bones' own skinning, without the folds: what the mesh skins to with none set.
    const bare = new SkinnedMesh(g);
    const unfolded = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    unfolded.update(body.bones, body.rotations);
    followDualSkinning(bare, unfolded, true);
    const at = (m: SkinnedMesh, v: number) => m.getVertexPosition(v, new Vector3());
    for (const fold of folds)
      expect(Array.from(fold.slot).filter((s) => s >= 0).length, fold.joint.name).toBeGreaterThan(
        50,
      );
    const moved = movedBy(folds);
    let worst = 0;
    let furthest = 0;
    for (const blend of [1, 0.5, 0]) {
      dual.foldBlend.value = blend;
      for (const v of moved) {
        const p = at(mesh, v);
        const b = at(bare, v);
        const want = new Vector3(
          body.positions[v * 3] as number,
          body.positions[v * 3 + 1] as number,
          body.positions[v * 3 + 2] as number,
        );
        // The posed body carries the folds whole; part of them shows part of the way there.
        want.sub(b).multiplyScalar(blend).add(b);
        worst = Math.max(worst, p.distanceTo(want));
        if (blend === 1) furthest = Math.max(furthest, p.distanceTo(b));
      }
    }
    expect(worst).toBeLessThan(2e-6);
    // The folds move the skin they hold visibly, so a skinning without them is wrong.
    expect(furthest).toBeGreaterThan(0.005);
  });

  it("leaves a mesh without the folds' slots, or not asked to fold, skinned by the bones alone", () => {
    const body = posedSurface(model, recipe, "seated");
    const { surface, folds } = solved();
    const g = geometryOf(body, folds);
    const dual = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    dual.update(body.bones, body.rotations);
    dual.setFolds(folds, surface);
    // Folds that arrive fade in (`advanceFold`); these have.
    dual.foldBlend.value = 1;
    const folded = new SkinnedMesh(g);
    followDualSkinning(folded, dual, true);
    const garment = new SkinnedMesh(g);
    followDualSkinning(garment, dual);
    const slotless = new SkinnedMesh(geometryOf(body, []));
    followDualSkinning(slotless, dual, true);
    // The vertex the folds move furthest.
    let v = -1;
    let most = 0;
    for (const r of movedBy(folds)) {
      const d = folded
        .getVertexPosition(r, new Vector3())
        .distanceTo(garment.getVertexPosition(r, new Vector3()));
      if (d > most) {
        most = d;
        v = r;
      }
    }
    expect(most).toBeGreaterThan(0.005);
    const b = garment.getVertexPosition(v, new Vector3());
    expect(slotless.getVertexPosition(v, new Vector3()).distanceTo(b)).toBe(0);
    dual.setFolds(null);
    expect(folded.getVertexPosition(v, new Vector3()).distanceTo(b)).toBe(0);
  });

  it("fades first folds in over frames, or shows them whole where no frame will come", () => {
    const body = posedSurface(model, recipe, "seated");
    const { surface, folds } = solved();
    const dual = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    dual.update(body.bones, body.rotations);
    dual.setFolds(folds, surface);
    expect(dual.foldBlend.value).toBe(0);
    expect(dual.foldFading).toBe(true);
    expect(dual.advanceFold(1)).toBe(false);
    expect(dual.foldFading).toBe(false);
    // A canvas drawn only by its host's clock (`frameloop="never"`) has no frames to fade over.
    const manual = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    manual.update(body.bones, body.rotations);
    manual.setFolds(folds, surface, false);
    expect(manual.foldBlend.value).toBe(1);
    expect(manual.foldFading).toBe(false);
  });
});
