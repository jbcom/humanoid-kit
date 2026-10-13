/**
 * Undo/redo for recipes, as a pure reducer (usable with React's `useReducer`
 * or on its own).
 *
 * A slider drag produces many changes; passing the same `gesture` key for each
 * keeps the whole drag as one undo step. Any other action (or a different
 * key) starts a new step.
 */
import type { Recipe } from "../recipe/recipe.ts";
import { jsonEqual } from "./equal.ts";

export interface RecipeHistory {
  past: Recipe[];
  present: Recipe;
  future: Recipe[];
  /** The gesture the present step belongs to, while it may still be extended. */
  gesture: string | null;
}

export type HistoryAction =
  | { type: "set"; recipe: Recipe; gesture?: string }
  /** Like `set`, computed from the present recipe (a pure function). */
  | { type: "apply"; change: (present: Recipe) => Recipe; gesture?: string }
  /** Ends any open gesture, so the next change starts a new step. */
  | { type: "settle" }
  | { type: "undo" }
  | { type: "redo" }
  /**
   * Rewrites an already-held timeline through a newly available constraint.
   * This is not a person-facing edit: adjacent recipes that become equivalent
   * occupy one undo position.
   */
  | { type: "reconcile"; normalize: (recipe: Recipe) => Recipe; present?: Recipe }
  /** Replaces the whole history (loading a saved figure, say). */
  | { type: "reset"; recipe: Recipe };

export const HISTORY_LIMIT = 200;

export function createHistory(recipe: Recipe): RecipeHistory {
  return { past: [], present: recipe, future: [], gesture: null };
}

function sameRecipes(left: readonly Recipe[], right: readonly Recipe[]): boolean {
  return (
    left.length === right.length && left.every((recipe, index) => jsonEqual(recipe, right[index]))
  );
}

/** Drops consecutive positions that now describe the same figure. */
function compact(recipes: readonly Recipe[]): Recipe[] {
  const out: Recipe[] = [];
  for (const recipe of recipes) {
    if (out.length === 0 || !jsonEqual(out.at(-1), recipe)) out.push(recipe);
  }
  return out;
}

export function historyReducer(state: RecipeHistory, action: HistoryAction): RecipeHistory {
  switch (action.type) {
    case "set": {
      if (action.recipe === state.present) return state;
      const gesture = action.gesture ?? null;
      if (gesture !== null && gesture === state.gesture)
        return { ...state, present: action.recipe, future: [] };
      const past = [...state.past, state.present].slice(-HISTORY_LIMIT);
      return { past, present: action.recipe, future: [], gesture };
    }
    case "apply":
      return historyReducer(state, {
        type: "set",
        recipe: action.change(state.present),
        ...(action.gesture === undefined ? {} : { gesture: action.gesture }),
      });
    case "settle":
      return state.gesture === null ? state : { ...state, gesture: null };
    case "undo": {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
        gesture: null,
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future, gesture: null };
    }
    case "reconcile": {
      const pastAndPresent = compact([
        ...state.past.map(action.normalize),
        action.present ?? action.normalize(state.present),
      ]);
      const present = pastAndPresent.at(-1);
      if (!present) return state;
      const past = pastAndPresent.slice(0, -1);
      const future: Recipe[] = [];
      let previous = present;
      for (const recipe of state.future) {
        const normalized = action.normalize(recipe);
        if (jsonEqual(previous, normalized)) continue;
        future.push(normalized);
        previous = normalized;
      }
      if (
        state.gesture === null &&
        sameRecipes(state.past, past) &&
        jsonEqual(state.present, present) &&
        sameRecipes(state.future, future)
      )
        return state;
      return { past, present, future, gesture: null };
    }
    case "reset":
      return createHistory(action.recipe);
  }
}
