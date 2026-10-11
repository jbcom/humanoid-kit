import { act as reactAct, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { ChangeCause } from "../../src/editor/gate.ts";
import type { HumanoidEditor } from "../../src/editor/ui/useHumanoidEditor.ts";
import { type EditorOptions, useEditorState } from "../../src/editor/ui/useHumanoidEditor.ts";
import type { SliderEntry } from "../../src/format/assetFormat.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { EditorHarness, readyInfo } from "./harness.tsx";

/**
 * React's `act` for a synchronous call into the editor. vitest-browser-react turns the
 * flag React asks for off outside its own `act`, so it is on only for the call.
 */
function act(call: () => void): void {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  env.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    reactAct(call);
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

const ready = readyInfo(true);
const all = ready.sliders.flatMap((t) => t.groups.flatMap((g) => g.sliders));
const slider = (id: string): SliderEntry => {
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(`no slider ${id}`);
  return s;
};
const AGE = slider("age");
const WEIGHT = slider("weight");
const NOSE = slider("nose/nose-scale-horiz-decr|incr");

interface Probe {
  editor: HumanoidEditor;
  /** Every recipe the editor has held, in render order, without repeats. */
  held: Recipe[];
}

/** Mounts the editor state and returns a handle on its latest value and everything it ever held. */
async function mount(options: EditorOptions, initial?: Recipe): Promise<Probe> {
  const probe = { held: [] as Recipe[] } as Probe;
  await render(
    <EditorHarness
      ready={ready}
      {...(initial && { initial })}
      options={options}
      onEditor={(e) => {
        probe.editor = e;
        if (probe.held.at(-1) !== e.recipe) probe.held.push(e.recipe);
      }}
    >
      {() => null}
    </EditorHarness>,
  );
  return probe;
}

const thirty = () => createRecipe({ macros: { age: 30 } });

describe("the change gate, uncontrolled", () => {
  it("never holds a refused figure: a veto leaves the figure, the history and the host untouched", async () => {
    const changes: Recipe[] = [];
    const rejected: { reason: string; cause: ChangeCause; age: number }[] = [];
    const probe = await mount(
      {
        onChange: (r) => changes.push(r),
        onBeforeChange: (p) => (p.macros.weight > 0.6 ? false : p),
        onReject: (x) =>
          rejected.push({
            reason: x.reason,
            cause: x.cause as ChangeCause,
            age: x.proposed.macros.age,
          }),
      },
      thirty(),
    );
    act(() => probe.editor.setSlider(WEIGHT, 0.9));
    act(() => probe.editor.setSlider(WEIGHT, 0.4));
    act(() => probe.editor.setSlider(WEIGHT, 0.95));
    expect(probe.editor.recipe.macros.weight).toBe(0.4);
    expect(probe.held.every((r) => r.macros.weight <= 0.6)).toBe(true);
    expect(changes.every((r) => r.macros.weight <= 0.6)).toBe(true);
    expect(rejected.map((r) => [r.reason, r.cause])).toEqual([
      ["veto", "edit"],
      ["veto", "edit"],
    ]);
    // One undo step: the refused changes made none.
    act(() => probe.editor.undo());
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
    expect(probe.editor.canUndo).toBe(false);
  });

  it("takes a clamped figure in place of the proposed one", async () => {
    const probe = await mount(
      {
        onBeforeChange: (p) => ({
          ...p,
          macros: { ...p.macros, weight: Math.min(p.macros.weight, 0.55) },
        }),
      },
      thirty(),
    );
    act(() => probe.editor.setSlider(WEIGHT, 0.9));
    expect(probe.editor.recipe.macros.weight).toBe(0.55);
    expect(probe.held.some((r) => r.macros.weight === 0.9)).toBe(false);
  });

  it("tells the hook the cause of every route that changes the figure", async () => {
    const causes: ChangeCause[] = [];
    const probe = await mount(
      {
        onBeforeChange: (p, c) => {
          causes.push(c.cause);
          return p;
        },
      },
      thirty(),
    );
    act(() => probe.editor.setSlider(NOSE, 0.3));
    act(() => probe.editor.update((r) => ({ ...r, skin: { ...r.skin, melanin: 0.8 } })));
    act(() => probe.editor.undo());
    act(() => probe.editor.redo());
    act(() => probe.editor.randomize(7));
    act(() => probe.editor.resetAll());
    act(() => {
      probe.editor.load(createRecipe({ macros: { age: 44 } }));
    });
    expect(causes).toEqual(["edit", "edit", "undo", "redo", "randomize", "reset", "load"]);
  });

  it("gives the hook the figure as it was, and ignores a proposal equal to it", async () => {
    const seen: { current: number; proposed: number }[] = [];
    const probe = await mount(
      {
        onBeforeChange: (p, c) => {
          seen.push({ current: c.current.macros.weight, proposed: p.macros.weight });
          return p;
        },
      },
      thirty(),
    );
    act(() => probe.editor.setSlider(WEIGHT, 0.7));
    act(() => probe.editor.setSlider(WEIGHT, 0.7));
    expect(seen).toEqual([{ current: 0.5, proposed: 0.7 }]);
    expect(probe.editor.canUndo).toBe(true);
  });

  it("refuses a load the hook refuses, and says so as a problem", async () => {
    const probe = await mount(
      { onBeforeChange: (p, c) => (c.cause === "load" ? false : p) },
      thirty(),
    );
    let problems: string[] = [];
    act(() => {
      problems = probe.editor.load(createRecipe({ macros: { age: 44 } }));
    });
    expect(problems).toEqual(["Not allowed here"]);
    expect(probe.editor.recipe.macros.age).toBe(30);
  });

  it("refuses a hook that answers with something that is not a recipe", async () => {
    const probe = await mount({ onBeforeChange: (() => undefined) as never }, thirty());
    expect(() => act(() => probe.editor.setSlider(WEIGHT, 0.7))).toThrow(TypeError);
  });

  it("holds every route to the ranges: slider, random, reset, undo and load", async () => {
    const probe = await mount(
      { controls: { ranges: { age: { min: 25 }, weight: { min: 0.3, max: 0.7 } } } },
      thirty(),
    );
    act(() => probe.editor.setSlider(AGE, 10));
    expect(probe.editor.recipe.macros.age).toBe(25);
    act(() => probe.editor.setSlider(WEIGHT, 1));
    expect(probe.editor.recipe.macros.weight).toBe(0.7);
    act(() => probe.editor.randomize(11));
    act(() => probe.editor.resetAll());
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
    act(() => {
      expect(probe.editor.load(createRecipe({ macros: { age: 19, weight: 0.05 } }))).toEqual([]);
    });
    expect(probe.editor.recipe.macros).toMatchObject({ age: 25, weight: 0.3 });
    act(() => probe.editor.undo());
    // Nothing the editor ever held, from its first render, is outside the ranges the host set
    // (the starting figure was the host's own, inside them).
    for (const r of probe.held) {
      expect(r.macros.age).toBeGreaterThanOrEqual(25);
      expect(r.macros.weight).toBeGreaterThanOrEqual(0.3);
      expect(r.macros.weight).toBeLessThanOrEqual(0.7);
    }
  });

  it("makes a proposal the ranges clamp to the current figure no step at all", async () => {
    const probe = await mount({ controls: { ranges: { age: { min: 30 } } } }, thirty());
    act(() => probe.editor.setSlider(AGE, 12));
    expect(probe.editor.recipe.macros.age).toBe(30);
    expect(probe.editor.canUndo).toBe(false);
  });

  it("narrows range(entry) and macroRange(key), and clamps neutral into the range", async () => {
    const probe = await mount({
      controls: { ranges: { age: { min: 25, max: 60 }, weight: { max: 0.7 } } },
    });
    expect(probe.editor.range(AGE)).toMatchObject({ min: 25, max: 60, neutral: 25 });
    expect(probe.editor.range(WEIGHT)).toMatchObject({ min: 0, max: 0.7, neutral: 0.5 });
    expect(probe.editor.macroRange("weight")).toEqual({ min: 0, max: 0.7 });
    expect(probe.editor.range(NOSE).min).toBe(-1);
  });

  it("leaves out hidden sliders and tasks, and lists the panels left", async () => {
    const probe = await mount({
      controls: { hide: ["age"], hideTasks: ["Face"], hidePanels: ["regions", "wardrobe"] },
    });
    const sliders = probe.editor.tasks.flatMap((t) => t.groups.flatMap((g) => g.sliders));
    expect(sliders.some((s) => s.id === "age")).toBe(false);
    expect(probe.editor.tasks.some((t) => t.id === "Face")).toBe(false);
    expect(probe.editor.tasks.length).toBeGreaterThan(0);
    expect([...probe.editor.panels]).toEqual(["appearance"]);
  });
});

/** A host that keeps the figure in its own state, as it does for any input. */
function ControlledHost({
  options,
  start,
  accept = (r: Recipe) => r,
  probe,
}: {
  options?: EditorOptions;
  start: Recipe;
  /** What the host stores for a change it is told of; `null` ignores it. */
  accept?: (r: Recipe) => Recipe | null;
  probe: { editor?: HumanoidEditor; setValue?: (r: Recipe) => void; told: Recipe[] };
}) {
  const [value, setValue] = useState(start);
  probe.setValue = setValue;
  const editor = useEditorState(ready, undefined, {
    ...options,
    value,
    onChange: (r) => {
      probe.told.push(r);
      const kept = accept(r);
      if (kept) setValue(kept);
    },
  });
  probe.editor = editor;
  return null;
}

async function host(props: Omit<Parameters<typeof ControlledHost>[0], "probe">) {
  const probe = { told: [] as Recipe[] } as Parameters<typeof ControlledHost>[0]["probe"];
  await render(<ControlledHost {...props} probe={probe} />);
  return probe as Required<typeof probe>;
}

describe("the change gate, controlled", () => {
  it("reports a change to the host and shows the figure when the host's value comes back", async () => {
    const probe = await host({ start: thirty() });
    expect(probe.told).toEqual([]);
    act(() => probe.editor.setSlider(WEIGHT, 0.8));
    expect(probe.told.map((r) => r.macros.weight)).toEqual([0.8]);
    expect(probe.editor.recipe.macros.weight).toBe(0.8);
    act(() => probe.editor.undo());
    expect(probe.told.map((r) => r.macros.weight)).toEqual([0.8, 0.5]);
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
    act(() => probe.editor.redo());
    expect(probe.editor.recipe.macros.weight).toBe(0.8);
  });

  it("keeps the figure when the host ignores a change", async () => {
    const probe = await host({ start: thirty(), accept: () => null });
    act(() => probe.editor.setSlider(WEIGHT, 0.8));
    expect(probe.told).toHaveLength(1);
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
    expect(probe.editor.canUndo).toBe(false);
  });

  it("shows the host's amended figure, and undoes to the one before", async () => {
    const probe = await host({
      start: thirty(),
      accept: (r) => ({ ...r, macros: { ...r.macros, weight: Math.min(0.6, r.macros.weight) } }),
    });
    act(() => probe.editor.setSlider(WEIGHT, 0.95));
    expect(probe.editor.recipe.macros.weight).toBe(0.6);
    act(() => probe.editor.undo());
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
  });

  it("undoes and redoes when the host stores a copy, not the object it was given", async () => {
    const probe = await host({ start: thirty(), accept: (r) => structuredClone(r) });
    act(() => probe.editor.setSlider(WEIGHT, 0.8));
    act(() => probe.editor.setSlider(NOSE, 0.4));
    act(() => probe.editor.undo());
    expect(probe.editor.recipe.modifiers).toEqual({});
    expect(probe.editor.recipe.macros.weight).toBe(0.8);
    act(() => probe.editor.undo());
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
    act(() => probe.editor.redo());
    act(() => probe.editor.redo());
    expect(probe.editor.recipe.modifiers).toEqual({ "nose/nose-scale-horiz-decr|incr": 0.4 });
  });

  it("adopts a value the host sets itself, as an undoable step, without telling the host", async () => {
    const probe = await host({ start: thirty() });
    act(() => probe.setValue(createRecipe({ macros: { age: 52 } })));
    expect(probe.editor.recipe.macros.age).toBe(52);
    expect(probe.told).toEqual([]);
    act(() => probe.editor.undo());
    expect(probe.editor.recipe.macros.age).toBe(30);
  });

  it("neither clamps nor vetoes the host's own value", async () => {
    const probe = await host({
      start: thirty(),
      options: { controls: { ranges: { age: { min: 25 } } }, onBeforeChange: () => false },
    });
    act(() => probe.setValue(createRecipe({ macros: { age: 19 } })));
    expect(probe.editor.recipe.macros.age).toBe(19);
  });

  it("holds a proposal to the ranges and the hook before the host hears of it", async () => {
    const probe = await host({
      start: createRecipe({ macros: { age: 25 } }),
      options: {
        controls: { ranges: { age: { min: 25 } } },
        onBeforeChange: (p) => (p.macros.weight > 0.9 ? false : p),
      },
    });
    act(() => probe.editor.setSlider(AGE, 5));
    act(() => probe.editor.setSlider(WEIGHT, 0.99));
    expect(probe.told).toEqual([]);
    act(() => probe.editor.setSlider(WEIGHT, 0.6));
    expect(probe.told).toHaveLength(1);
  });

  it("does not loop when the host passes an equal copy on every render", async () => {
    let renders = 0;
    function Fresh() {
      renders++;
      const editor = useEditorState(ready, undefined, {
        value: createRecipe({ macros: { age: 30 } }),
      });
      return <output>{editor.recipe.macros.age}</output>;
    }
    const screen = await render(<Fresh />);
    await expect.element(screen.getByText("30")).toBeVisible();
    expect(renders).toBeLessThan(10);
  });
});
