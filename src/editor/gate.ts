/**
 * The gate every figure the creator proposes passes before it becomes the
 * figure: what a host may say about a change, as plain functions with no React
 * in them. `useEditorState` applies it to each route that changes the figure, so
 * a figure the host refuses is never held, drawn or reported.
 *
 * A host's rules come in two forms. `ControlLimits` (`./limits.ts`) is data: a
 * range per slider, applied first. `onBeforeChange` is code: it sees the figure
 * as proposed (already inside the ranges) and the cause, and returns the figure
 * to take or `false`.
 */
import type { Recipe } from "../recipe/recipe.ts";
import { recipeProblems } from "../recipe/validate.ts";
import { jsonEqual } from "./equal.ts";

/** Which route proposed a figure. */
export type ChangeCause =
  /** A control: a slider, a swatch, a chip, a garment. */
  | "edit"
  | "undo"
  | "redo"
  /** The random figure button. */
  | "randomize"
  /** Back to the default figure. */
  | "reset"
  /** A saved figure loaded from a file. */
  | "load";

/** What `onBeforeChange` is told besides the proposed figure. */
export interface ChangeContext {
  cause: ChangeCause;
  /** The figure as it is now. */
  current: Recipe;
}

/**
 * Synchronous. Returns the recipe to accept (`proposed` itself, or a clamped
 * copy), or `false` to refuse. Anything else is a `TypeError`.
 */
export type BeforeChange = (proposed: Recipe, context: ChangeContext) => Recipe | false;

/** What `onChange` is told besides the new figure. */
export interface ChangeInfo {
  /** `"initial"` for the starting figure an uncontrolled creator reports as it mounts. */
  cause: ChangeCause | "initial";
}

/** A change that was refused, as `onReject` hears of it. */
export interface Rejection {
  /** `"veto"`: `onBeforeChange` returned `false`. */
  reason: "veto";
  cause: ChangeCause;
  /** The figure as it was proposed, after the ranges. */
  proposed: Recipe;
}

export type Judgement = { accepted: true; recipe: Recipe } | { accepted: false };

/** Runs the host's hook, if it has one, and checks its answer. */
export function beforeChange(
  proposed: Recipe,
  context: ChangeContext,
  hook: BeforeChange | undefined,
): Judgement {
  if (!hook) return { accepted: true, recipe: proposed };
  const answer: unknown = hook(proposed, context);
  if (answer === false) return { accepted: false };
  const problems = recipeProblems(answer);
  if (problems.length)
    throw new TypeError(
      `onBeforeChange must return a recipe or false: ${problems.slice(0, 3).join("; ")}`,
    );
  return { accepted: true, recipe: answer as Recipe };
}

/**
 * Whether two recipes are the same figure. By content, not identity: a host that
 * keeps the recipe in a store hands back an equal copy, not the object it was given.
 */
export const sameRecipe = (a: Recipe, b: Recipe): boolean => jsonEqual(a, b);
