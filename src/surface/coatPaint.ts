/**
 * The coat paint a recipe asks the renderer to draw. This is deliberately a
 * pure ESM surface module: Node-side fixtures and sheet builders must import
 * it here rather than importing `react/CoatMesh`, whose renderer dependencies
 * may resolve a package's CommonJS entry outside Vite's ESM resolver.
 */
import { isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { coatPainted, paintCoat } from "./coat.ts";
import { COAT_REGIONS } from "./regions/index.ts";

/** The coat's pure paint table for a recipe, or null when no region grows. */
export function coatPaintFor(recipe: Recipe): Float32Array | null {
  const s = recipe.skin;
  const paint = paintCoat(COAT_REGIONS, {
    tone: {
      melanin: s.melanin,
      haemoglobin: s.haemoglobin,
      undertone: s.undertone,
      override: s.override,
    },
    flush: s.flush,
    lips: s.lips,
    areola: s.areola,
    signals: {},
    age: recipe.macros.age,
    adult: isAdult(recipe),
    ...(recipe.hair && { hairColour: recipe.hair.colour }),
    ...(recipe.bodyHair && { bodyHair: recipe.bodyHair }),
  });
  return coatPainted(paint) ? paint : null;
}
