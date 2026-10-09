/**
 * Regional macro overrides for editors: any macro except age may take a
 * different value in one body region (a different gender anchor for the face
 * than the hips, a different breast size on each side). A region either
 * inherits the figure's value or overrides it; clearing an override returns
 * the region to inheriting.
 *
 * Ethnic macros stay normalised within a region as they do for the figure:
 * overriding one ethnic macro fixes all three in that region.
 */
import type { BodyRegion } from "../makehuman/regions.ts";
import type { Recipe, RegionalMacroValues } from "../recipe/recipe.ts";

export type RegionalMacro = keyof RegionalMacroValues;

/** The macros a region can override, in MakeHuman's Main-tab order. */
export const REGIONAL_MACROS: readonly RegionalMacro[] = [
  "gender",
  "muscle",
  "weight",
  "height",
  "proportions",
  "african",
  "asian",
  "caucasian",
  "breastSize",
  "breastFirmness",
];

const ETHNIC = ["african", "asian", "caucasian"] as const;
const isEthnic = (k: string): k is (typeof ETHNIC)[number] =>
  (ETHNIC as readonly string[]).includes(k);

/** The value in effect for a region: its override, or the figure's. */
export function regionalValue(recipe: Recipe, region: BodyRegion, key: RegionalMacro): number {
  return recipe.regionalMacros[region]?.[key] ?? recipe.macros[key];
}

export function isOverridden(recipe: Recipe, region: BodyRegion, key: RegionalMacro): boolean {
  return recipe.regionalMacros[region]?.[key] !== undefined;
}

/**
 * A new recipe with the region's value set, or cleared with `null` (back to
 * inheriting). Regions left with no overrides are removed. The input is not
 * modified.
 */
export function withRegionalValue(
  recipe: Recipe,
  region: BodyRegion,
  key: RegionalMacro,
  value: number | null,
): Recipe {
  if (value !== null && !Number.isFinite(value))
    throw new RangeError(`${region}.${key}: ${value} is not a number`);
  const current: Partial<RegionalMacroValues> = { ...recipe.regionalMacros[region] };
  if (value === null) {
    if (isEthnic(key)) for (const k of ETHNIC) delete current[k];
    else delete current[key];
  } else {
    const v = Math.min(1, Math.max(0, value));
    if (isEthnic(key)) {
      const others = ETHNIC.filter((k) => k !== key);
      const effective = (k: (typeof ETHNIC)[number]) => regionalValue(recipe, region, k);
      const rest = others.reduce((s, k) => s + effective(k), 0);
      current[key] = v;
      for (const k of others)
        current[k] = rest > 1e-9 ? ((1 - v) * effective(k)) / rest : (1 - v) / others.length;
    } else current[key] = v;
  }
  const regionalMacros = { ...recipe.regionalMacros };
  if (Object.keys(current).length) regionalMacros[region] = current;
  else delete regionalMacros[region];
  return { ...recipe, regionalMacros };
}

/** Labels for the overridable macros, matching MakeHuman's Main tab. */
export const REGIONAL_MACRO_LABELS: Readonly<Record<RegionalMacro, string>> = {
  gender: "Gender",
  muscle: "Muscle",
  weight: "Weight",
  height: "Height",
  proportions: "Proportions",
  african: "African",
  asian: "Asian",
  caucasian: "Caucasian",
  breastSize: "Breast size",
  breastFirmness: "Breast firmness",
};

/** Display names for body regions. */
export const REGION_LABELS: Readonly<Record<BodyRegion, string>> = {
  head: "Head",
  neck: "Neck",
  chest: "Chest",
  breastL: "Left breast",
  breastR: "Right breast",
  arms: "Arms",
  hands: "Hands",
  abdomen: "Abdomen",
  pelvis: "Pelvis",
  legs: "Legs",
  feet: "Feet",
};
