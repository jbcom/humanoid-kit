/**
 * Editor state for React: the recipe with undo/redo, the loaded packs'
 * controls, and the actions a creator UI needs. It holds no UI of its own, so
 * an application can build a different creator on it.
 *
 * Every route that changes the figure (`update`, `setSlider`, `undo`, `redo`,
 * `randomize`, `resetAll`, `load`) proposes a figure to the gate in front of the
 * state (`../gate.ts`, `../limits.ts`): the host's ranges, then its
 * `onBeforeChange`. A figure the gate refuses is never held, so it is never
 * drawn or reported. With `value` the host owns the figure: an accepted change
 * is reported through `onChange` and shown when `value` comes back.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { SliderEntry, SliderTask } from "../../format/assetFormat.ts";
import { useHumanoidReady } from "../../react/Humanoid.tsx";
import { agePolicyViolations } from "../../recipe/agePolicy.ts";
import { createRecipe, type Recipe } from "../../recipe/recipe.ts";
import { recipeProblems } from "../../recipe/validate.ts";
import type { ReadyInfo } from "../../worker/protocol.ts";
import { type ModifierTable, type SliderRange, sliderRange, withSliderValue } from "../controls.ts";
import { jsonEqual } from "../equal.ts";
import {
  type BeforeChange,
  beforeChange,
  type ChangeCause,
  type ChangeInfo,
  type Rejection,
  sameRecipe,
} from "../gate.ts";
import {
  createHistory,
  type HistoryAction,
  historyReducer,
  type RecipeHistory,
} from "../history.ts";
import {
  assertControls,
  type ControlLimits,
  type CreatorPanel,
  limitedRange,
  limitRecipe,
  macroRange,
  visiblePanels,
  visibleTasks,
} from "../limits.ts";
import { type RandomizeOptions, randomRecipe } from "../randomize.ts";
import type { RegionalMacro } from "../regional.ts";

export interface EditorOptions {
  /**
   * The figure, when the host owns it. The editor then shows `value`, reports each
   * accepted change through `onChange` and changes the figure when `value` does.
   * A `value` that is not the figure replaces it as an undoable step; it is the
   * host's own, so neither clamped nor vetoed. Compared by content.
   */
  value?: Recipe;
  /**
   * Every new figure. Uncontrolled, that includes the starting figure (cause
   * `"initial"`); controlled, only what the editor proposed and the gate accepted.
   */
  onChange?: (recipe: Recipe, change: ChangeInfo) => void;
  /** The host's synchronous veto; see `BeforeChange`. */
  onBeforeChange?: BeforeChange;
  /** Ranges for sliders, and sliders, tasks and panels left out. */
  controls?: ControlLimits;
  /** A change that was refused. */
  onReject?: (rejection: Rejection) => void;
}

export interface HumanoidEditor {
  /** The worker's ready info, or null while the packs load. */
  ready: ReadyInfo | null;
  recipe: Recipe;
  /** The slider taxonomy, less what `controls` hides. */
  tasks: SliderTask[];
  modifiers: ModifierTable;
  /** A slider's range, narrowed by `controls.ranges`. */
  range: (entry: SliderEntry) => SliderRange;
  /** What a regional override of a macro may take, narrowed by `controls.ranges`. */
  macroRange: (key: RegionalMacro) => { min: number; max: number };
  /** The panels `controls` leaves in. */
  panels: ReadonlySet<CreatorPanel>;
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
export function useHumanoidEditor(initial?: Recipe, options?: EditorOptions): HumanoidEditor {
  return useEditorState(useHumanoidReady(), initial, options);
}

/** The same value as last time while its content is the same, so a literal in a render is stable. */
function useStable<T>(value: T): T {
  const ref = useRef(value);
  if (!jsonEqual(ref.current, value)) ref.current = value;
  return ref.current;
}

/** What the editor proposed to a controlled host, so the value that comes back is told from the host's own. */
interface Intent {
  recipe: Recipe;
  cause: ChangeCause;
  gesture: string | undefined;
}

type Outcome = "applied" | "unchanged" | "rejected";

/**
 * Editor state over any ready info: what `useHumanoidEditor` does, without
 * needing a worker (tests, or an application that loads packs itself).
 */
export function useEditorState(
  ready: ReadyInfo | null,
  initial?: Recipe,
  options: EditorOptions = {},
): HumanoidEditor {
  const [history, dispatch] = useReducer(historyReducer, null, () =>
    createHistory(options.value ?? initial ?? createRecipe()),
  );
  const controls = useStable(options.controls);
  // Checked once per distinct set of limits, and again on the next render if they were refused.
  const checked = useRef<ControlLimits | undefined>(undefined);
  if (controls !== checked.current) {
    if (controls) assertControls(controls);
    checked.current = controls;
  }
  const modifiers = useMemo<ModifierTable>(
    () => new Map((ready?.modifiers ?? []).map((m) => [m.id, m] as const)),
    [ready],
  );
  const tasks = useMemo(
    () => visibleTasks(ready?.sliders ?? EMPTY_TASKS, controls),
    [ready, controls],
  );
  const panels = useMemo(() => visiblePanels(controls), [controls]);
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

  // What the callbacks below read: the latest props, and a history that a change updates
  // at once, so two changes in one event each start from the figure the last one left.
  const live = useRef({ options, controls, modifiers });
  live.current = { options, controls, modifiers };
  const now = useRef<RecipeHistory>(history);
  now.current = history;
  const intent = useRef<Intent | null>(null);
  const cause = useRef<ChangeCause | "initial">("initial");
  const controlled = options.value !== undefined;

  const apply = useCallback((action: HistoryAction) => {
    now.current = historyReducer(now.current, action);
    dispatch(action);
  }, []);

  /** The gate: the figure to take for a proposed one (limits, then the hook), or null when refused. */
  const judge = useCallback((proposed: Recipe, why: ChangeCause): Recipe | null => {
    const { options: o, controls: c, modifiers: m } = live.current;
    const limited = limitRecipe(proposed, c, m);
    const verdict = beforeChange(
      limited,
      { cause: why, current: now.current.present },
      o.onBeforeChange,
    );
    if (verdict.accepted) return verdict.recipe;
    o.onReject?.({ reason: "veto", cause: why, proposed: limited });
    return null;
  }, []);

  /** Takes an accepted figure: into the history, or, with `value`, to the host. */
  const commit = useCallback(
    (next: Recipe, why: ChangeCause, gesture: string | undefined) => {
      const { options: o } = live.current;
      if (o.value !== undefined) {
        intent.current = { recipe: next, cause: why, gesture };
        o.onChange?.(next, { cause: why });
        return;
      }
      cause.current = why;
      const { past, future } = now.current;
      const neighbour = why === "undo" ? past.at(-1) : why === "redo" ? future[0] : undefined;
      apply(
        neighbour && sameRecipe(neighbour, next)
          ? { type: why === "undo" ? "undo" : "redo" }
          : { type: "set", recipe: next, ...(gesture && { gesture }) },
      );
    },
    [apply],
  );

  const propose = useCallback(
    (change: (r: Recipe) => Recipe, why: ChangeCause, gesture?: string): Outcome => {
      const current = now.current.present;
      const proposed = change(current);
      // A figure equal to the one shown is no change: nothing to judge, no step, no report.
      if (proposed === current || sameRecipe(proposed, current)) return "unchanged";
      const next = judge(proposed, why);
      if (!next) return "rejected";
      if (sameRecipe(next, current)) return "unchanged";
      commit(next, why, gesture);
      return "applied";
    },
    [judge, commit],
  );

  const step = useCallback(
    (why: "undo" | "redo") => {
      const { past, future, present } = now.current;
      const target = why === "undo" ? past.at(-1) : future[0];
      if (!target) return;
      const next = judge(target, why);
      if (next && !sameRecipe(next, present)) commit(next, why, undefined);
    },
    [judge, commit],
  );

  // With `value`, the figure follows the host. What the host sends back for a change the
  // editor proposed moves along the history (undo and redo) or extends it, in the gesture
  // it was made in; any other value is the host's own, a new step. Before paint, so the
  // controls never show the figure that was.
  useLayoutEffect(() => {
    const value = options.value;
    if (value === undefined || sameRecipe(value, history.present)) return;
    const told = intent.current;
    intent.current = null;
    const echo = told !== null && sameRecipe(told.recipe, value);
    const back = history.past.at(-1);
    const forward = history.future[0];
    if (echo && told.cause === "undo" && back && sameRecipe(back, value)) apply({ type: "undo" });
    else if (echo && told.cause === "redo" && forward && sameRecipe(forward, value))
      apply({ type: "redo" });
    else
      apply({
        type: "set",
        recipe: value,
        ...(echo && told.gesture && { gesture: told.gesture }),
      });
  }, [options.value, history, apply]);

  // Uncontrolled, the host hears of every figure, the first included.
  useEffect(() => {
    if (controlled) return;
    live.current.options.onChange?.(history.present, { cause: cause.current });
  }, [history.present, controlled]);

  const update = useCallback(
    (change: (r: Recipe) => Recipe, gesture?: string) => void propose(change, "edit", gesture),
    [propose],
  );
  const setSlider = useCallback(
    (entry: SliderEntry, value: number, gesture?: string) =>
      update((r) => withSliderValue(r, entry, value, modifiers), gesture),
    [update, modifiers],
  );
  const range = useCallback(
    (entry: SliderEntry) => limitedRange(entry, sliderRange(entry, modifiers), controls),
    [modifiers, controls],
  );

  return {
    ready,
    recipe,
    tasks,
    modifiers,
    range,
    macroRange: (key) => macroRange(key, controls),
    panels,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    setSlider,
    update,
    settle: () => apply({ type: "settle" }),
    undo: () => step("undo"),
    redo: () => step("redo"),
    randomize: (seed, randomOptions) =>
      void propose(
        (r) =>
          // A random figure wears hair from the pack when there is one.
          randomRecipe(r, seed, modifiers, {
            ...(hairStyles && { hairStyles }),
            ...(browStyles?.length && { browStyles }),
            ...(lashStyles?.length && { lashStyles }),
            beards: true,
            ...randomOptions,
          }),
        "randomize",
      ),
    resetAll: () => void propose(() => createRecipe(), "reset"),
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
      return propose(() => structuredClone(loaded), "load") === "rejected"
        ? ["Not allowed here"]
        : [];
    },
  };
}
