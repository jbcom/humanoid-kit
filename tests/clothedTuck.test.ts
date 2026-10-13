import { describe, expect, it } from "vitest";
import { evaluateBinding } from "../src/mhclo/bound.ts";
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

/**
 * A garment under another is sunk wherever it pokes out of it, so jeans worn
 * under tall boots go into the shaft instead of through it
 * (docs/ARCHITECTURE.md, "A garment under another is sunk under it").
 */
describe("a garment under another", { timeout: 120_000 }, () => {
  const assets = loadClothedAssets();
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const BOOTS = "shoes/culturalibre_male_boots";

  it("is sunk only under the garment over it, and the outermost never", () => {
    expect(model.outfit([SUIT]).garmentTuck).toEqual([null]);
    const outfit = model.outfit([SUIT, BOOTS]);
    expect(outfit.order).toEqual([SUIT, BOOTS]);
    const [jeans, boots] = outfit.garmentTuck;
    expect(boots).toBeNull();
    if (!jeans) throw new Error("the boots sink none of the suit");
    const suit = assets.garments.get(SUIT);
    if (!suit) throw new Error("the pack has no suit");
    const rest = evaluateBinding(
      suit,
      assets.positions,
      new Float32Array(suit.entry.vertexCount * 3),
    );
    let sunk = 0;
    for (let v = 0; v < jeans.length; v++) {
      const t = jeans[v] as number;
      if (t === 0) continue;
      sunk++;
      expect(t).toBeLessThanOrEqual(0.05 + 0.004 + 1e-6);
      // The boots reach the knee: nothing of the suit above it is moved.
      expect(rest[v * 3 + 1] as number, `vertex ${v}`).toBeLessThan(0.62);
    }
    expect(sunk).toBeGreaterThan(50);
  });

  it("hides the inner garment's faces behind the one over it, and only those", () => {
    const alone = model.outfit([SUIT]).masks.garmentIndex[0]?.length ?? 0;
    const outfit = model.outfit([SUIT, BOOTS]);
    const under = outfit.masks.garmentIndex[0]?.length ?? 0;
    const boots = model.outfit([BOOTS]).masks.garmentIndex[0]?.length ?? 0;
    expect(under).toBeLessThan(alone);
    // Most of the suit is above the boots and stays.
    expect(under).toBeGreaterThan(alone * 0.6);
    expect(outfit.masks.garmentIndex[1]?.length).toBe(boots);
  });

  it("moves the inner garment, never the one over it", () => {
    const outfit = model.outfit([SUIT, BOOTS]);
    const dressed = model.evaluate(createRecipe({ outfit: [SUIT, BOOTS] }));
    const tuck = outfit.garmentTuck;
    outfit.garmentTuck = [null, null];
    const flat = model.evaluate(createRecipe({ outfit: [SUIT, BOOTS] }));
    outfit.garmentTuck = tuck;
    expect(Array.from(dressed.garments[1]?.positions ?? [])).toEqual(
      Array.from(flat.garments[1]?.positions ?? []),
    );
    expect(Array.from(dressed.garments[0]?.positions ?? [])).not.toEqual(
      Array.from(flat.garments[0]?.positions ?? []),
    );
  });
});
