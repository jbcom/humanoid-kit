/**
 * Undo/redo for recipes, as a pure reducer (usable with React's `useReducer`
 * or on its own).
 *
 * A slider drag produces many changes; passing the same `gesture` key for each
 * keeps the whole drag as one undo step. Any other action (or a different
 * key) starts a new step.
 */
import type { Recipe } from "../recipe/recipe.ts";

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
  /** Replaces the whole history (loading a saved figure, say). */
  | { type: "reset"; recipe: Recipe };

export const HISTORY_LIMIT = 200;

export function createHistory(recipe: Recipe): RecipeHistory {
  return { past: [], present: recipe, future: [], gesture: null };
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
    case "reset":
      return createHistory(action.recipe);
  }
}
