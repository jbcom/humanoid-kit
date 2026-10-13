/**
 * The chest lab's shared fixed data: the evaluator at the control level, the body
 * mesh, the support chosen once on the adult average-tissue frame, and the tissue
 * library over age. Everything here is built from the committed packs; nothing
 * reads a recipe at generation time.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { HumanoidModel } from "../../../src/model/humanoidModel.ts";
import type { Recipe } from "../../../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "../../../tests/fixtures.ts";
import type { FrameDirection } from "./conditions.ts";
import { anchors, FIXED, frameRecipe, type Lab } from "./figure.ts";
import { bodyMesh } from "./mesh.ts";
import { chooseSupport, trunkMask } from "./support.ts";
import { type AgeLibrary, ageLibrary, type TissueCtx } from "./tissue.ts";

export interface LabSetup {
  lab: Lab;
  ctx: TissueCtx;
  ages: AgeLibrary;
}

/** The average-tissue frame at an age: MakeHuman's female anchor, every other macro average. */
export const cellRecipeAt = (age: number): Recipe => frameRecipe({ gender: 0, age });

export function labSetup(): LabSetup {
  const assets = loadFixtureAssets();
  const lab: Lab = {
    assets,
    manifest: bodyManifest,
    model: new HumanoidModel(assets, { subdivision: 0, attachments: [] }),
  };
  const mesh = bodyMesh(assets, bodyManifest);
  const canonical = lab.model.evaluate(cellRecipeAt(FIXED.age)).control;
  const support = chooseSupport(
    mesh,
    canonical,
    anchors(bodyManifest, canonical),
    trunkMask(assets, bodyManifest),
  );
  const ctx: TissueCtx = { mesh, support, manifest: bodyManifest };
  return { lab, ctx, ages: ageLibrary(ctx, lab, cellRecipeAt) };
}

/** A frame direction at an age, as a recipe (breast macros left at MakeHuman's average). */
export function directionRecipe(
  dir: FrameDirection,
  age: number,
  over: Partial<Recipe["macros"]> = {},
): Recipe {
  const r = frameRecipe({ gender: dir.gender, age, ...over });
  return dir.regionalMacros ? { ...r, regionalMacros: dir.regionalMacros } : r;
}

/** Where a candidate's outputs go: never committed, keyed by the commit they were made at. */
export function candidateDir(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  return path.join(
    process.env.HOME ?? ".",
    ".cache/humanoid-kit/chest-foundation",
    `candidate-${sha}`,
  );
}
