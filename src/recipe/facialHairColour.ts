/** Shared renderer-free colour resolution for live and baked authored facial cards. */
import { agedHairColour, DEFAULT_HAIR_COLOUR, type HairColour } from "../surface/hairTone.ts";
import type { Recipe } from "./recipe.ts";

/** Missing entries retain the existing scalp colour and ageing exactly. */
export function facialHairColour(recipe: Recipe, id: string): HairColour {
  return agedHairColour(
    recipe.facialHairColour?.[id] ?? recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR,
    recipe.macros.age,
    "scalp",
  );
}
