/**
 * The body's own CPU skinning (src/render/dualSkinning.ts, `followDualSkinning`):
 * three skins a mesh on the CPU for its bounds and ray picking, and for the
 * body that skinning must be what the shader draws, the hip fold included, as
 * much of it as has faded in. Without the fold a seated figure's bounds and
 * picks miss the folded skin.
 */
import { BufferAttribute, BufferGeometry, SkinnedMesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { DualBones, FOLD_SLOT_ATTRIBUTE, followDualSkinning } from "../src/render/dualSkinning.ts";
import { skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipe = createRecipe();

/** The recipe's hip fold on its body surface, solved to the end. */
function solved() {
  const steps = model.hipFold(recipe);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

describe("the body's CPU skinning (followDualSkinning)", { timeout: 120_000 }, () => {
  it("adds the hip fold as the shader does, scaled by how much of it shows", () => {
    const body = posedSurface(model, recipe, "seated");
    const { surface, fold } = solved();
    expect(surface).toBe(body.surface);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(body.rest, 3));
    g.setAttribute("skinIndex", new BufferAttribute(body.skinIndex, 4));
    g.setAttribute("skinWeight", new BufferAttribute(body.skinWeight, 4));
    g.setAttribute(FOLD_SLOT_ATTRIBUTE, new BufferAttribute(Float32Array.from(fold.slot), 1));
    const mesh = new SkinnedMesh(g);
    const dual = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    dual.update(body.bones, body.rotations);
    dual.setFold(fold, surface);
    followDualSkinning(mesh, dual, true);
    // The bones' own skinning, without the fold: what the mesh skins to with none set.
    const bare = new SkinnedMesh(g);
    const unfolded = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    unfolded.update(body.bones, body.rotations);
    followDualSkinning(bare, unfolded, true);
    const at = (m: SkinnedMesh, v: number) => m.getVertexPosition(v, new Vector3());
    const moved = Array.from(fold.slot.keys()).filter((v) => (fold.slot[v] as number) >= 0);
    expect(moved.length).toBeGreaterThan(50);
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
        // The posed body carries the fold whole; part of it shows part of the way there.
        want.sub(b).multiplyScalar(blend).add(b);
        worst = Math.max(worst, p.distanceTo(want));
        if (blend === 1) furthest = Math.max(furthest, p.distanceTo(b));
      }
    }
    expect(worst).toBeLessThan(2e-6);
    // The fold moves the skin it holds visibly, so a skinning without it is wrong.
    expect(furthest).toBeGreaterThan(0.005);
  });

  it("leaves a mesh without the fold's slots, or not asked to fold, skinned by the bones alone", () => {
    const body = posedSurface(model, recipe, "seated");
    const { surface, fold } = solved();
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(body.rest, 3));
    g.setAttribute("skinIndex", new BufferAttribute(body.skinIndex, 4));
    g.setAttribute("skinWeight", new BufferAttribute(body.skinWeight, 4));
    g.setAttribute(FOLD_SLOT_ATTRIBUTE, new BufferAttribute(Float32Array.from(fold.slot), 1));
    const dual = new DualBones(body.bones.names.length, skinDualShare(body.bones.names));
    dual.update(body.bones, body.rotations);
    dual.setFold(fold, surface);
    // A fold that arrives fades in (`advanceFold`); this one has.
    dual.foldBlend.value = 1;
    const folded = new SkinnedMesh(g);
    followDualSkinning(folded, dual, true);
    const garment = new SkinnedMesh(g);
    followDualSkinning(garment, dual);
    // The vertex the fold moves furthest.
    let v = -1;
    let most = 0;
    for (const [r, s] of fold.slot.entries()) {
      if (s < 0) continue;
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
    dual.setFold(null);
    expect(folded.getVertexPosition(v, new Vector3()).distanceTo(b)).toBe(0);
  });
});
