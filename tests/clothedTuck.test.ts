import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadClothedAssets } from "./fixtures.ts";

const SUIT = "suits/male_casualsuit01";

/**
 * The skin at a garment's edge is sunk under the cloth over it, so a joint that
 * moves cloth and skin differently does not bring the skin through
 * (docs/ARCHITECTURE.md, "Skin at a garment's edge").
 */
describe("skin at the edge of a garment", { timeout: 120_000 }, () => {
  const assets = loadClothedAssets();
  const model = new HumanoidModel(assets, { subdivision: 1 });

  it("is sunk by at most the cap, only where it shows, only for an outfit", () => {
    expect(model.outfit([]).bodyTuck).toBeNull();
    const outfit = model.outfit([SUIT]);
    const tuck = outfit.bodyTuck;
    if (!tuck) throw new Error("the suit sinks no skin");
    let sunk = 0;
    for (let v = 0; v < tuck.length; v++) {
      const t = tuck[v] as number;
      if (t === 0) continue;
      sunk++;
      expect(t).toBeLessThanOrEqual(0.03 + 1e-6);
      // Skin that is hidden is never worth moving.
      expect(outfit.bodyVisible[v], `vertex ${v}`).toBe(1);
    }
    expect(sunk).toBeGreaterThan(50);
  });

  it("moves the body's edge skin and nothing else, and leaves the garment where it was bound", () => {
    const dressed = model.evaluate(createRecipe({ outfit: [SUIT] }));
    const outfit = model.outfit([SUIT]);
    // Without the tuck, the same evaluation.
    const tuck = outfit.bodyTuck;
    outfit.bodyTuck = null;
    const flat = model.evaluate(createRecipe({ outfit: [SUIT] }));
    outfit.bodyTuck = tuck;
    // The garment follows the untucked shape; so do control, attachments and the ground.
    expect(Array.from(dressed.garments[0]?.positions ?? [])).toEqual(
      Array.from(flat.garments[0]?.positions ?? []),
    );
    expect(Array.from(dressed.control)).toEqual(Array.from(flat.control));
    // The body differs from the untucked one by sunk skin only: never more than the cap,
    // never outside the torso and limbs the suit covers (the head is where it was).
    let moved = 0;
    let largest = 0;
    for (let i = 0; i < dressed.positions.length; i += 3) {
      const d = Math.hypot(
        (dressed.positions[i] as number) - (flat.positions[i] as number),
        (dressed.positions[i + 1] as number) - (flat.positions[i + 1] as number),
        (dressed.positions[i + 2] as number) - (flat.positions[i + 2] as number),
      );
      if (d > 0) {
        moved++;
        largest = Math.max(largest, d);
        expect(flat.positions[i + 1] as number, "the head stays").toBeLessThan(1.62);
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(0.03 + 1e-4);
  });
});
