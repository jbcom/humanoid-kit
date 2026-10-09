/**
 * Editor state for React: the recipe with undo/redo, the loaded packs'
 * controls, and the actions a creator UI needs. It holds no UI of its own, so
 * an application can build a different creator on it.
 */
import { useCallback, useMemo, useReducer } from "react";
import type { SliderEntry, SliderTask } from "../../format/assetFormat.ts";
import { useHumanoidReady } from "../../react/Humanoid.tsx";
import { agePolicyViolations } from "../../recipe/agePolicy.ts";
import { createRecipe, type Recipe } from "../../recipe/recipe.ts";
import { recipeProblems } from "../../recipe/validate.ts";
import type { ReadyInfo } from "../../worker/protocol.ts";
import { type ModifierTable, withSliderValue } from "../controls.ts";
import { createHistory, historyReducer } from "../history.ts";
import { type RandomizeOptions, randomRecipe } from "../randomize.ts";

export interface HumanoidEditor {
  /** The worker's ready info, or null while the packs load. */
  ready: ReadyInfo | null;
  recipe: Recipe;
  tasks: SliderTask[];
  modifiers: ModifierTable;
  canUndo: boolean;
  canRedo: boolean;
  /** Sets a slider. Changes sharing a `gesture` key form one undo step. */
  setSlider: (entry: SliderEntry, value: number, gesture?: string) => void;
  /** Applies any recipe change (skin, eyes, ...). */
  update: (change: (recipe: Recipe) => Recipe, gesture?: string) => void;
  /** Ends the current gesture so the next change is a new undo step. */
  settle: () => void;
  undo: () => void;
  redo: () => void;
  /** Replaces the recipe with a random figure for `seed`; undoable. */
  randomize: (seed: number, options?: RandomizeOptions) => void;
  /** Back to the default figure; undoable. */
  resetAll: () => void;
  /**
   * Loads a saved recipe (parsed JSON). Returns the problems that stopped it,
   * or an empty list once it is loaded; undoable.
   */
  load: (value: unknown) => string[];
}

const EMPTY_TASKS: SliderTask[] = [];

/** Editor state for the `HumanoidProvider`'s client. */
export function useHumanoidEditor(initial?: Recipe): HumanoidEditor {
  return useEditorState(useHumanoidReady(), initial);
}

/**
 * Editor state over any ready info: what `useHumanoidEditor` does, without
 * needing a worker (tests, or an application that loads packs itself).
 */
export function useEditorState(ready: ReadyInfo | null, initial?: Recipe): HumanoidEditor {
  const [history, dispatch] = useReducer(historyReducer, initial ?? createRecipe(), createHistory);
  const modifiers = useMemo<ModifierTable>(
    () => new Map((ready?.modifiers ?? []).map((m) => [m.id, m] as const)),
    [ready],
  );
  const recipe = history.present;
  const hairStyles = useMemo(
    () => ready?.hair?.styles.filter((s) => s.kind === "scalp").map((s) => s.id),
    [ready],
  );
  const browStyles = useMemo(
    () => ready?.hair?.styles.filter((s) => s.kind === "brows").map((s) => s.id),
    [ready],
  );
  const lashStyles = useMemo(
    () => ready?.hair?.styles.filter((s) => s.kind === "lashes").map((s) => s.id),
    [ready],
  );

  const update = useCallback(
    (change: (r: Recipe) => Recipe, gesture?: string) =>
      dispatch({ type: "apply", change, ...(gesture ? { gesture } : {}) }),
    [],
  );
  const setSlider = useCallback(
    (entry: SliderEntry, value: number, gesture?: string) =>
      update((r) => withSliderValue(r, entry, value, modifiers), gesture),
    [update, modifiers],
  );

  return {
    ready,
    recipe,
    tasks: ready?.sliders ?? EMPTY_TASKS,
    modifiers,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    setSlider,
    update,
    settle: () => dispatch({ type: "settle" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    randomize: (seed, options) =>
      dispatch({
        type: "apply",
        change: (r) =>
          // A random figure wears hair from the pack when there is one.
          randomRecipe(r, seed, modifiers, {
            ...(hairStyles && { hairStyles }),
            ...(browStyles?.length && { browStyles }),
            ...(lashStyles?.length && { lashStyles }),
            ...options,
          }),
      }),
    resetAll: () => dispatch({ type: "set", recipe: createRecipe() }),
    load: (value) => {
      const problems = recipeProblems(value);
      if (problems.length) return problems;
      const loaded = value as Recipe;
      const unknown = Object.keys(loaded.modifiers).filter((id) => !modifiers.has(id));
      const policy = agePolicyViolations(loaded);
      // A saved figure's hair must be a style the loaded hair pack has.
      const style = loaded.hair?.style ?? null;
      const noStyle = style !== null && !hairStyles?.includes(style);
      const brows = loaded.hair?.brows;
      const lashes = loaded.hair?.lashes;
      const noBrows = brows !== undefined && !browStyles?.includes(brows);
      const noLashes = lashes !== undefined && !lashStyles?.includes(lashes);
      if (unknown.length || policy.length || noStyle || noBrows || noLashes)
        return [
          ...unknown.map((id) => `modifier ${id} is not in the loaded packs`),
          ...(noStyle ? [`hair style ${style} is not in the loaded packs`] : []),
          ...(noBrows ? [`eyebrows ${brows} are not in the loaded packs`] : []),
          ...(noLashes ? [`eyelashes ${lashes} are not in the loaded packs`] : []),
          ...policy,
        ];
      dispatch({ type: "set", recipe: structuredClone(loaded) });
      return [];
    },
  };
}
