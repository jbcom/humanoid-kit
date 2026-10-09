import { describe, expect, it } from "vitest";
import { coatPaintFor } from "../src/react/CoatMesh.tsx";
import { createRecipe } from "../src/recipe/recipe.ts";

describe("which figures grow a coat", () => {
  it("grows none on a figure whose recipe asks for no body hair", () => {
    for (const gender of [0, 0.5, 1])
      for (const age of [8, 25, 60])
        expect(coatPaintFor(createRecipe({ macros: { age, gender } }))).toBeNull();
  });

  it("grows one when the recipe asks for body hair", () => {
    const paint = coatPaintFor(
      createRecipe({ macros: { age: 30, gender: 1 }, bodyHair: { beard: "full" } }),
    );
    expect(paint).not.toBeNull();
  });
});
