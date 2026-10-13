/**
 * The chest lab's review conditions: the ages and the frame directions every sheet
 * and table uses. A frame direction is a recipe fragment (the frame macro, and for
 * the intersex columns regional frame values), never an input to the generator:
 * the generator only ever sees the control mesh the evaluator makes of it.
 */
import type { Recipe } from "../../../src/recipe/recipe.ts";

/** The review ages: the six asked for, plus in-between ages so the curve between anchors shows. */
export const REVIEW_AGES = [5, 9, 13, 18, 25, 40, 55, 70] as const;

export interface FrameDirection {
  id: string;
  label: string;
  gender: number;
  regionalMacros?: Recipe["regionalMacros"];
}

const masculine = { gender: 1 } as const;
const feminine = { gender: 0 } as const;

export const FRAME_DIRECTIONS: readonly FrameDirection[] = [
  { id: "g0", label: "frame 0", gender: 0 },
  { id: "g25", label: "frame .25", gender: 0.25 },
  { id: "g50", label: "frame .5", gender: 0.5 },
  { id: "g75", label: "frame .75", gender: 0.75 },
  { id: "g100", label: "frame 1", gender: 1 },
  {
    // A feminine chest frame on masculine pelvis, shoulders and arms.
    id: "fchest-mbody",
    label: "F chest / M hips+shoulders",
    gender: 0,
    regionalMacros: { pelvis: masculine, arms: masculine, legs: masculine },
  },
  {
    // A masculine chest frame on feminine pelvis, shoulders and arms.
    id: "mchest-fbody",
    label: "M chest / F hips+shoulders",
    gender: 1,
    regionalMacros: { pelvis: feminine, arms: feminine, legs: feminine },
  },
  {
    // A masculine whole frame whose chest and breast regions alone are feminine.
    id: "mframe-fchest",
    label: "M frame / F chest region",
    gender: 1,
    regionalMacros: { chest: feminine, breastL: feminine, breastR: feminine },
  },
  {
    // The reverse: a feminine frame whose chest and breast regions are masculine.
    id: "fframe-mchest",
    label: "F frame / M chest region",
    gender: 0,
    regionalMacros: { chest: masculine, breastL: masculine, breastR: masculine },
  },
];
