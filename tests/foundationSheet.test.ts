/**
 * The foundation's sheet cells (src/foundation/sheet.ts): what
 * `scripts/foundation-cells.ts` prints for `hk-sheets` is the module's, every
 * cell is a permutation the playground can draw, and no cell carries an adult
 * modifier.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { foundationPermutations, REST_POSE } from "../src/foundation/permutations.ts";
import { FOUNDATION_VIEWS, foundationSheet } from "../src/foundation/sheet.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const script = path.resolve(import.meta.dirname, "../scripts/foundation-cells.ts");

describe("the foundation's sheet cells", () => {
  it("are what the sheet tool's script prints, for each tier", () => {
    for (const tier of ["smoke", "full"] as const)
      expect(JSON.parse(execFileSync("node", [script, tier], { encoding: "utf8" }))).toEqual(
        foundationSheet(tier),
      );
  });

  it("are each tier's permutations, in order, with their pose and tone", () => {
    for (const tier of ["smoke", "full"] as const) {
      const perms = foundationPermutations(tier);
      const { cells } = foundationSheet(tier);
      expect(cells.map((c) => c.id)).toEqual(perms.map((p) => p.id));
      cells.forEach((c, i) => {
        const p = perms[i] as (typeof perms)[number];
        expect(c.$pose?.body ?? REST_POSE, c.id).toBe(p.pose.name);
        expect(c.skin.melanin, c.id).toBe(p.tone.melanin);
        expect(c.anatomy, c.id).toBe(p.anatomy);
      });
    }
  });

  it("are recipes the playground can draw, in poses the body pack has", () => {
    const poses = new Set(loadFixtureAssets().manifest.poses.map((p) => p.name));
    for (const c of foundationSheet("full").cells) {
      expect(() => createRecipe({ macros: c.macros, skin: c.skin }), c.id).not.toThrow();
      if (c.$pose) expect(poses.has(c.$pose.body), c.id).toBe(true);
    }
  });

  it("name no adult modifier, and give no anatomy under 18", () => {
    const text = JSON.stringify(foundationSheet("full"));
    for (const m of adultManifest.modifiers) expect(text.includes(m.id), m.id).toBe(false);
    for (const c of foundationSheet("full").cells)
      if ((c.macros.age ?? 25) < 18) expect(c.anatomy, c.id).toBeNull();
  });

  it("frame every view on a bone the skeleton has", () => {
    const bones = new Set(loadFixtureAssets().manifest.skeleton.bones.map((b) => b.name));
    for (const [name, query] of Object.entries(FOUNDATION_VIEWS)) {
      const bone = new URLSearchParams(query).get("frame");
      expect(bone !== null && bones.has(bone), name).toBe(true);
    }
  });
});
