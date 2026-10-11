/**
 * Editor state for React: the recipe with undo/redo, the loaded packs'
 * controls, and the actions a creator UI needs. It holds no UI of its own, so
 * an application can build a different creator on it.
 *
 * Every route that changes the figure (`update`, `setSlider`, `undo`, `redo`,
 * `randomize`, `resetAll`, `load`) proposes a figure to the gate in front of the
 * state (`../gate.ts`, `../limits.ts`, `../cover.ts`): the host's ranges, then its
 * `onBeforeChange`, then its cover policy, which may ask a person. A figure the
 * gate refuses is never held, so it is never drawn or reported, and one that
 * waits for an answer is not the figure until it is allowed. With `value` the
 * host owns the figure: an accepted change is reported through `onChange` and
 * shown when `value` comes back.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { SliderEntry, SliderTask } from "../../format/assetFormat.ts";
import { useHumanoidReady } from "../../react/Humanoid.tsx";
import { agePolicyViolations } from "../../recipe/agePolicy.ts";
import { createRecipe, type Recipe } from "../../recipe/recipe.ts";
import { recipeProblems } from "../../recipe/validate.ts";
import type { ReadyInfo } from "../../worker/protocol.ts";
import { type ModifierTable, type SliderRange, sliderRange, withSliderValue } from "../controls.ts";
import { type CoverPolicy, isCovered, mustConfirm, type UncoverRequest } from "../cover.ts";
import { jsonEqual } from "../equal.ts";
import {
  type BeforeChange,
  beforeChange,
  type ChangeCause,
  type ChangeInfo,
  type PolicyCause,
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
import type { WardrobeEntry } from "../wardrobe.ts";

export interface EditorOptions {
  /**
   * The figure, when the host owns it. The editor then shows `value`, reports each
   * accepted change through `onChange` and changes the figure when `value` does.
   * A `value` that is not the figure replaces it as an undoable step; it is the
   * host's own, so neither clamped nor vetoed (the cover policy still applies).
   * Compared by content.
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
  /**
   * What counts as covered, and who may allow an uncovered figure. With it, no
   * uncovered figure is held, reported or handed to `<Humanoid>` until it allows it.
   */
  coverPolicy?: CoverPolicy;
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
  /** The cover policy is being asked; the editor ignores its own changes until it answers. */
  pending: boolean;
  /**
   * The figure is held back: nothing has been allowed yet and it is uncovered, so it
   * must not be handed to `<Humanoid>`. False without a cover policy.
   */
  withheld: boolean;
  /** Whether no answer could allow `proposed`: it is uncovered, and there is no `allowUncover` to ask. */
  blocksUncover: (proposed: Recipe) => boolean;
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
const NO_WARDROBE: readonly WardrobeEntry[] = [];

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

/** What became of a proposal: `"pending"` while the cover policy is being asked. */
type Outcome = "applied" | "unchanged" | "rejected" | "pending";

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

  // The cover policy. A figure is shown once something has been allowed (`approved`: any
  // figure that went through the gate, or an answer to the starting figure) or it is covered
  // by the policy's own rule; until then it is withheld, which needs the wardrobe, so with a
  // policy nothing is shown before the packs are loaded.
  const policy = options.coverPolicy;
  const wardrobe = ready?.wardrobe ?? NO_WARDROBE;
  const [approved, setApproved] = useState(() => options.coverPolicy === undefined);
  const [pending, setPending] = useState(false);
  const withheld =
    policy !== undefined && !approved && !(ready !== null && isCovered(policy, recipe, wardrobe));

  // What the callbacks below read: the latest props, and a history that a change updates
  // at once, so two changes in one event each start from the figure the last one left.
  const live = useRef({ options, controls, modifiers, wardrobe });
  live.current = { options, controls, modifiers, wardrobe };
  const now = useRef<RecipeHistory>(history);
  now.current = history;
  const approvedNow = useRef(approved);
  approvedNow.current = approved;
  const intent = useRef<Intent | null>(null);
  const cause = useRef<ChangeCause | "initial">("initial");
  const asking = useRef<AbortController | null>(null);
  const askedAbout = useRef<Recipe | null>(null);
  const controlled = options.value !== undefined;

  const approve = useCallback(() => {
    approvedNow.current = true;
    setApproved(true);
  }, []);

  const apply = useCallback(
    (action: HistoryAction) => {
      now.current = historyReducer(now.current, action);
      dispatch(action);
      // A figure that reaches the history has been through the gate.
      if (action.type === "set" || action.type === "undo" || action.type === "redo") approve();
    },
    [approve],
  );

  /** The figure shown now, or null while it is withheld. */
  const shown = useCallback((): Recipe | null => {
    const { options: o, wardrobe: w } = live.current;
    const present = now.current.present;
    return o.coverPolicy === undefined ||
      approvedNow.current ||
      isCovered(o.coverPolicy, present, w)
      ? present
      : null;
  }, []);

  /** The host's refusal of a figure, reported. A policy that failed is a bug, and is logged when nobody listens. */
  const refuse = useCallback((why: PolicyCause, proposed: Recipe, error?: unknown) => {
    const { onReject } = live.current.options;
    if (onReject)
      onReject({ reason: "cover", cause: why, proposed, ...(error !== undefined && { error }) });
    else if (error !== undefined) console.error("coverPolicy.allowUncover failed:", error);
  }, []);

  const cancelAsk = useCallback(() => {
    asking.current?.abort();
    asking.current = null;
    setPending(false);
  }, []);

  /**
   * Asks the host whether `request.proposed` may be shown, and calls `done` with the
   * answer, once, unless it was cancelled. An answer that comes at once is passed on at
   * once ("done"); one that takes time sets the waiting state ("pending"). Only `true`
   * allows: a policy that throws, rejects or answers with anything else refuses.
   */
  const ask = useCallback(
    (
      request: Omit<UncoverRequest, "signal">,
      done: (allowed: boolean, error?: unknown) => void,
    ): "done" | "pending" => {
      const allow = live.current.options.coverPolicy?.allowUncover;
      if (!allow) {
        done(false);
        return "done";
      }
      const controller = new AbortController();
      let answer: unknown;
      try {
        answer = allow({ ...request, signal: controller.signal });
      } catch (error) {
        done(false, error);
        return "done";
      }
      if (typeof (answer as PromiseLike<boolean> | null)?.then !== "function") {
        done(answer === true);
        return "done";
      }
      asking.current = controller;
      setPending(true);
      const settle = (allowed: boolean, error?: unknown) => {
        if (controller.signal.aborted) return;
        asking.current = null;
        setPending(false);
        done(allowed, error);
      };
      Promise.resolve(answer as PromiseLike<boolean>).then(
        (ok) => settle(ok === true),
        (error) => settle(false, error),
      );
      return "pending";
    },
    [],
  );

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

  /** The last step before a figure is taken: the cover policy, then the commit. */
  const submit = useCallback(
    (next: Recipe, why: ChangeCause, gesture: string | undefined): Outcome => {
      const { options: o, wardrobe: w } = live.current;
      const current = shown();
      if (o.coverPolicy === undefined || !mustConfirm(o.coverPolicy, w, next, current)) {
        commit(next, why, gesture);
        return "applied";
      }
      let outcome: Outcome = "pending";
      const state = ask({ cause: why, current, proposed: next }, (allowed, error) => {
        outcome = allowed ? "applied" : "rejected";
        if (allowed) commit(next, why, gesture);
        else refuse(why, next, error);
      });
      return state === "done" ? outcome : "pending";
    },
    [shown, ask, commit, refuse],
  );

  const propose = useCallback(
    (change: (r: Recipe) => Recipe, why: ChangeCause, gesture?: string): Outcome => {
      // The host is being asked about the figure the person is looking at: nothing else changes it.
      if (asking.current) return "unchanged";
      const current = now.current.present;
      const proposed = change(current);
      // A figure equal to the one shown is no change: nothing to judge, no step, no report.
      if (proposed === current || sameRecipe(proposed, current)) return "unchanged";
      const next = judge(proposed, why);
      if (!next) return "rejected";
      if (sameRecipe(next, current)) return "unchanged";
      return submit(next, why, gesture);
    },
    [judge, submit],
  );

  const step = useCallback(
    (why: "undo" | "redo") => {
      if (asking.current) return;
      const { past, future, present } = now.current;
      const target = why === "undo" ? past.at(-1) : future[0];
      if (!target) return;
      const next = judge(target, why);
      if (next && !sameRecipe(next, present)) submit(next, why, undefined);
    },
    [judge, submit],
  );

  // With `value`, the figure follows the host. What the host sends back for a change the
  // editor proposed (it has been through the gate) moves along the history (undo and redo)
  // or extends it, in the gesture it was made in. Any other value is the host's own: a new
  // step, after the cover policy, which a pending answer about the old figure does not
  // outlive. Before paint, so the controls never show the figure that was.
  useLayoutEffect(() => {
    const value = options.value;
    if (value === undefined || sameRecipe(value, history.present)) return;
    cancelAsk();
    const told = intent.current;
    intent.current = null;
    const echo = told !== null && sameRecipe(told.recipe, value);
    if (echo) {
      const back = history.past.at(-1);
      const forward = history.future[0];
      if (told.cause === "undo" && back && sameRecipe(back, value)) apply({ type: "undo" });
      else if (told.cause === "redo" && forward && sameRecipe(forward, value))
        apply({ type: "redo" });
      else apply({ type: "set", recipe: value, ...(told.gesture && { gesture: told.gesture }) });
      return;
    }
    const { options: o, wardrobe: w } = live.current;
    const current = shown();
    if (o.coverPolicy !== undefined && mustConfirm(o.coverPolicy, w, value, current)) {
      // Whether it is covered is not known until the packs are: judged again when they are.
      if (ready === null) return;
      const why = current === null ? "initial" : "value";
      ask({ cause: why, current, proposed: value }, (allowed, error) => {
        if (allowed) apply({ type: "set", recipe: value });
        else refuse(why, value, error);
      });
      return;
    }
    apply({ type: "set", recipe: value });
  }, [options.value, history, ready, apply, ask, cancelAsk, refuse, shown]);

  // A starting figure that is uncovered is asked about once the packs are loaded; until
  // it is allowed it is withheld. Answering no leaves it so, and does not ask again for it.
  useEffect(() => {
    if (!policy || approved || ready === null || pending || askedAbout.current === recipe) return;
    if (isCovered(policy, recipe, ready.wardrobe)) return;
    askedAbout.current = recipe;
    ask({ cause: "initial", current: null, proposed: recipe }, (allowed, error) => {
      if (allowed) approve();
      else refuse("initial", recipe, error);
    });
  }, [policy, approved, ready, pending, recipe, ask, approve, refuse]);

  // Unmounting, or a development remount, drops the question: the host closes its dialog.
  useEffect(
    () => () => {
      asking.current?.abort();
      asking.current = null;
      askedAbout.current = null;
      setPending(false);
    },
    [],
  );

  // Uncontrolled, the host hears of every figure, the first included, once it is shown.
  useEffect(() => {
    if (controlled || withheld) return;
    live.current.options.onChange?.(history.present, { cause: cause.current });
  }, [history.present, controlled, withheld]);

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
    pending,
    withheld,
    blocksUncover: (proposed) =>
      policy !== undefined &&
      policy.allowUncover === undefined &&
      mustConfirm(policy, wardrobe, proposed, withheld ? null : recipe),
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
      const policyProblems = agePolicyViolations(loaded);
      // A saved figure's hair must be a style the loaded hair pack has.
      const style = loaded.hair?.style ?? null;
      const noStyle = style !== null && !hairStyles?.includes(style);
      const brows = loaded.hair?.brows;
      const lashes = loaded.hair?.lashes;
      const noBrows = brows !== undefined && !browStyles?.includes(brows);
      const noLashes = lashes !== undefined && !lashStyles?.includes(lashes);
      if (unknown.length || policyProblems.length || noStyle || noBrows || noLashes)
        return [
          ...unknown.map((id) => `modifier ${id} is not in the loaded packs`),
          ...(noStyle ? [`hair style ${style} is not in the loaded packs`] : []),
          ...(noBrows ? [`eyebrows ${brows} are not in the loaded packs`] : []),
          ...(noLashes ? [`eyelashes ${lashes} are not in the loaded packs`] : []),
          ...policyProblems,
        ];
      return propose(() => structuredClone(loaded), "load") === "rejected"
        ? ["Not allowed here"]
        : [];
    },
  };
}
