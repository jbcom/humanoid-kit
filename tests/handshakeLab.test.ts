import { describe, expect, it } from "vitest";
import { sampleRequiredHandFrame } from "../playground/src/handFrame.ts";
import { HumanoidAffordances } from "../src/affordance/live.ts";
import { frameOut } from "../src/foundation/landmarks.ts";
import { createRecipe } from "../src/recipe/recipe.ts";

describe("handshake lab hand-frame lifecycle", () => {
  it("does not query a required hand before the figure has settled and bound its affordances", () => {
    const affordances = new HumanoidAffordances();
    expect(affordances.has("hand.R")).toBe(false);
    expect(() =>
      sampleRequiredHandFrame({
        figure: "tall",
        settled: false,
        affordances,
        out: frameOut(),
      }),
    ).not.toThrow();
  });

  it("treats a bound but not-yet-drawn hand as pending instead of absent", () => {
    const affordances = new HumanoidAffordances();
    affordances.setRecipe(createRecipe({ macros: { age: 25 } }));
    expect(affordances.has("hand.R")).toBe(true);
    expect(
      sampleRequiredHandFrame({
        figure: "tall",
        settled: true,
        affordances,
        out: frameOut(),
      }),
    ).toBeNull();
  });

  it("fails closed with the figure id if a settled figure never bound its required hand", () => {
    expect(() =>
      sampleRequiredHandFrame({
        figure: "short",
        settled: true,
        affordances: new HumanoidAffordances(),
        out: frameOut(),
      }),
    ).toThrow("short settled without required hand.R affordance");
  });
});
