import { act as reactAct, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { CoverPolicy, UncoverRequest } from "../../src/editor/cover.ts";
import type { Rejection } from "../../src/editor/gate.ts";
import {
  type EditorOptions,
  type HumanoidEditor,
  useEditorState,
} from "../../src/editor/ui/useHumanoidEditor.ts";
import { wearGarment } from "../../src/editor/wardrobe.ts";
import type { SliderEntry } from "../../src/format/assetFormat.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import type { ReadyInfo } from "../../src/worker/protocol.ts";
import { readyInfo } from "./harness.tsx";

const ready = readyInfo(true, true);
const wardrobe = ready.wardrobe;
const garment = (kind: string) => {
  const g = wardrobe.find((w) => w.kind === kind);
  if (!g) throw new Error(`no ${kind} in the wardrobe`);
  return g;
};
const SUIT = garment("clothes");
const SHOES = garment("shoes");
const WEIGHT = ready.sliders
  .flatMap((t) => t.groups.flatMap((g) => g.sliders))
  .find((s) => s.id === "weight") as SliderEntry;

/** Calls into the editor inside React's `act`; vitest-browser-react turns the flag off outside its own. */
const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
function act(call: () => void): void {
  env.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    reactAct(call);
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = false;
  }
}
async function actAsync(call: () => void | Promise<void>): Promise<void> {
  env.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await reactAct(async () => {
      await call();
    });
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const dressed = () => createRecipe({ macros: { age: 30 }, outfit: [SUIT.id] });
const bare = () => createRecipe({ macros: { age: 30 } });
const takeOffSuit = (e: HumanoidEditor) =>
  act(() => e.update((r) => wearGarment(r, SUIT, wardrobe)));
const wearsSuit = (r: Recipe) => r.outfit?.includes(SUIT.id) === true;

interface Probe {
  editor: HumanoidEditor;
  setReady: (r: ReadyInfo | null) => void;
  rejected: Rejection[];
  everPending: boolean;
  /** Every figure the editor ever offered to be drawn: what `<Humanoid>` would be handed. */
  drawn: Recipe[];
  unmount: () => Promise<void>;
}

function Late({
  options,
  initial,
  probe,
  start,
}: {
  options: EditorOptions;
  initial: Recipe;
  probe: Probe;
  start: ReadyInfo | null;
}) {
  const [r, setR] = useState(start);
  probe.setReady = setR;
  const editor = useEditorState(r, initial, options);
  probe.editor = editor;
  if (editor.pending) probe.everPending = true;
  if (!editor.withheld && probe.drawn.at(-1) !== editor.recipe) probe.drawn.push(editor.recipe);
  return null;
}

async function mount(
  coverPolicy: CoverPolicy | undefined,
  initial: Recipe,
  options: Omit<EditorOptions, "coverPolicy"> = {},
  start: ReadyInfo | null = ready,
): Promise<Probe> {
  const probe = { rejected: [], everPending: false, drawn: [] } as unknown as Probe;
  const screen = await render(
    <Late
      probe={probe}
      initial={initial}
      start={start}
      options={{
        ...options,
        ...(coverPolicy && { coverPolicy }),
        onReject: (x) => probe.rejected.push(x),
      }}
    />,
  );
  probe.unmount = () => screen.unmount();
  return probe;
}

afterEach(() => vi.restoreAllMocks());

describe("the cover gate", () => {
  it("asks only when a covered figure would become uncovered, never about a garment put on", async () => {
    const asked: UncoverRequest[] = [];
    const probe = await mount(
      {
        allowUncover: (r) => {
          asked.push(r);
          return true;
        },
      },
      dressed(),
    );
    act(() => probe.editor.update((r) => wearGarment(r, SHOES, wardrobe)));
    act(() => probe.editor.setSlider(WEIGHT, 0.7));
    expect(asked).toEqual([]);
    takeOffSuit(probe.editor);
    expect(asked).toHaveLength(1);
    const [request] = asked as [UncoverRequest];
    expect(request.cause).toBe("edit");
    expect(request.current && wearsSuit(request.current)).toBe(true);
    expect(wearsSuit(request.proposed)).toBe(false);
    expect(request.signal.aborted).toBe(false);
  });

  it("applies a synchronous answer at once, with no waiting state, and stops asking while uncovered", async () => {
    const allow = vi.fn(() => true);
    const probe = await mount({ allowUncover: allow }, dressed());
    takeOffSuit(probe.editor);
    expect(wearsSuit(probe.editor.recipe)).toBe(false);
    expect(probe.everPending).toBe(false);
    act(() => probe.editor.setSlider(WEIGHT, 0.8));
    act(() => probe.editor.update((r) => wearGarment(r, SHOES, wardrobe)));
    expect(allow).toHaveBeenCalledTimes(1);
    expect(probe.editor.recipe.macros.weight).toBe(0.8);
  });

  it("asks again after the figure has been covered and uncovered once more", async () => {
    const allow = vi.fn(() => true);
    const probe = await mount({ allowUncover: allow }, dressed());
    takeOffSuit(probe.editor);
    act(() => probe.editor.update((r) => wearGarment(r, SUIT, wardrobe)));
    expect(allow).toHaveBeenCalledTimes(1);
    takeOffSuit(probe.editor);
    expect(allow).toHaveBeenCalledTimes(2);
  });

  it("keeps the figure and ignores the creator's own changes while an answer is pending, then applies it", async () => {
    const answer = defer<boolean>();
    const probe = await mount({ allowUncover: () => answer.promise }, dressed());
    takeOffSuit(probe.editor);
    expect(probe.editor.pending).toBe(true);
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
    act(() => probe.editor.setSlider(WEIGHT, 0.8));
    act(() => probe.editor.randomize(3));
    expect(probe.editor.recipe.macros.weight).toBe(0.5);
    await actAsync(() => answer.resolve(true));
    expect(probe.editor.pending).toBe(false);
    expect(wearsSuit(probe.editor.recipe)).toBe(false);
    expect(probe.rejected).toEqual([]);
    // Everything offered to be drawn between was covered, until the answer.
    expect(probe.drawn.map(wearsSuit)).toEqual([true, false]);
  });

  it("leaves the figure as it was when the answer is no, and says so", async () => {
    const answer = defer<boolean>();
    const probe = await mount({ allowUncover: () => answer.promise }, dressed());
    takeOffSuit(probe.editor);
    await actAsync(() => answer.resolve(false));
    expect(probe.editor.pending).toBe(false);
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
    expect(probe.editor.canUndo).toBe(false);
    expect(probe.rejected.map((x) => [x.reason, x.cause])).toEqual([["cover", "edit"]]);
    expect(wearsSuit(probe.rejected[0]?.proposed as Recipe)).toBe(false);
  });

  it("allows only on true: any other answer, a throw or a rejection refuses, and the error is reported", async () => {
    for (const answer of [
      () => "yes" as never,
      () => 1 as never,
      () => undefined as never,
      () => {
        throw new Error("sync boom");
      },
      () => Promise.reject(new Error("async boom")),
    ]) {
      const probe = await mount({ allowUncover: answer }, dressed());
      takeOffSuit(probe.editor);
      await actAsync(() => new Promise((done) => setTimeout(done, 20)));
      expect(wearsSuit(probe.editor.recipe)).toBe(true);
      expect(probe.rejected).toHaveLength(1);
      expect(probe.rejected[0]).toMatchObject({ reason: "cover" });
      await probe.unmount();
    }
  });

  it("carries a failing policy's error in the rejection, and logs it when the host does not listen", async () => {
    const probe = await mount(
      {
        allowUncover: () => {
          throw new Error("sync boom");
        },
      },
      dressed(),
    );
    takeOffSuit(probe.editor);
    expect(probe.rejected[0]).toMatchObject({ reason: "cover", error: new Error("sync boom") });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unheard = { allowUncover: () => Promise.reject(new Error("quiet")) };
    function Quiet({ out }: { out: { editor?: HumanoidEditor } }) {
      out.editor = useEditorState(ready, dressed(), { coverPolicy: unheard });
      return null;
    }
    const out: { editor?: HumanoidEditor } = {};
    await render(<Quiet out={out} />);
    takeOffSuit(out.editor as HumanoidEditor);
    await actAsync(() => new Promise((done) => setTimeout(done, 20)));
    expect(logged).toHaveBeenCalled();
  });

  it("refuses every uncovering without allowUncover, and says which proposals no answer could allow", async () => {
    const probe = await mount({}, dressed());
    takeOffSuit(probe.editor);
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
    expect(probe.rejected.map((x) => x.reason)).toEqual(["cover"]);
    expect(probe.editor.blocksUncover(bare())).toBe(true);
    expect(probe.editor.blocksUncover(dressed())).toBe(false);
    let problems: string[] = [];
    act(() => {
      problems = probe.editor.load(bare());
    });
    expect(problems).toEqual(["Not allowed here"]);
    act(() => probe.editor.resetAll());
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
  });

  it("does not block anything when there is no cover policy", async () => {
    const probe = await mount(undefined, dressed());
    takeOffSuit(probe.editor);
    expect(wearsSuit(probe.editor.recipe)).toBe(false);
    expect(probe.editor.blocksUncover(bare())).toBe(false);
    expect(probe.editor.withheld).toBe(false);
  });

  it("asks after the host's veto, so a figure the host refuses is never asked about", async () => {
    const allow = vi.fn(() => true);
    const probe = await mount({ allowUncover: allow }, dressed(), { onBeforeChange: () => false });
    takeOffSuit(probe.editor);
    expect(allow).not.toHaveBeenCalled();
    expect(probe.rejected.map((x) => x.reason)).toEqual(["veto"]);
  });

  it("asks for reset, redo and a loaded file as well, with the cause", async () => {
    const causes: string[] = [];
    const probe = await mount(
      {
        allowUncover: (r) => {
          causes.push(r.cause);
          return true;
        },
      },
      dressed(),
    );
    act(() => probe.editor.resetAll());
    act(() => probe.editor.update((r) => wearGarment(r, SUIT, wardrobe)));
    act(() => {
      probe.editor.load(bare());
    });
    // Undo into the suit needs no answer; redo out of it does.
    act(() => probe.editor.undo());
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
    act(() => probe.editor.redo());
    expect(causes).toEqual(["reset", "load", "redo"]);
  });
});

describe("a starting figure that is uncovered", () => {
  it("is not shown until the packs are loaded and the policy allows it", async () => {
    const answer = defer<boolean>();
    const asked: UncoverRequest[] = [];
    const probe = await mount(
      {
        allowUncover: (r) => {
          asked.push(r);
          return answer.promise;
        },
      },
      bare(),
      {},
      null,
    );
    expect(probe.editor.withheld).toBe(true);
    expect(asked).toEqual([]);
    await actAsync(() => probe.setReady(ready));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ cause: "initial", current: null });
    expect(probe.editor.withheld).toBe(true);
    expect(probe.editor.pending).toBe(true);
    await actAsync(() => answer.resolve(true));
    expect(probe.editor.withheld).toBe(false);
    expect(probe.editor.pending).toBe(false);
    expect(probe.drawn).toHaveLength(1);
  });

  it("stays held when the policy refuses, and putting a garment on ends the wait without a question", async () => {
    const allow = vi.fn(() => false);
    const probe = await mount({ allowUncover: allow }, bare());
    expect(allow).toHaveBeenCalledTimes(1);
    expect(probe.editor.withheld).toBe(true);
    expect(probe.rejected.map((x) => [x.reason, x.cause])).toEqual([["cover", "initial"]]);
    expect(probe.drawn).toEqual([]);
    act(() => probe.editor.update((r) => wearGarment(r, SUIT, wardrobe)));
    expect(probe.editor.withheld).toBe(false);
    expect(allow).toHaveBeenCalledTimes(1);
    expect(probe.drawn.every(wearsSuit)).toBe(true);
  });

  it("asks nothing of a covered start, which is held only until the wardrobe is known", async () => {
    const allow = vi.fn(() => true);
    const probe = await mount({ allowUncover: allow }, dressed(), {}, null);
    expect(probe.editor.withheld).toBe(true);
    await actAsync(() => probe.setReady(ready));
    expect(probe.editor.withheld).toBe(false);
    expect(allow).not.toHaveBeenCalled();
  });

  it("never withholds anything without a cover policy", async () => {
    const probe = await mount(undefined, bare(), {}, null);
    expect(probe.editor.withheld).toBe(false);
  });

  it("does not leave the creator waiting when it unmounts while asked", async () => {
    const answer = defer<boolean>();
    let signal: AbortSignal | undefined;
    const probe = await mount(
      {
        allowUncover: (r) => {
          signal = r.signal;
          return answer.promise;
        },
      },
      bare(),
    );
    expect(signal?.aborted).toBe(false);
    await probe.unmount();
    expect(signal?.aborted).toBe(true);
    answer.resolve(true);
  });
});

/** A controlled host over `coverPolicy`; `setValue` is the host speaking. */
function Controlled({
  policy,
  probe,
  start,
}: {
  policy: CoverPolicy;
  probe: { editor?: HumanoidEditor; setValue?: (r: Recipe) => void; told: Recipe[] };
  start: Recipe;
}) {
  const [value, setValue] = useState(start);
  probe.setValue = setValue;
  probe.editor = useEditorState(ready, undefined, {
    value,
    coverPolicy: policy,
    onChange: (r) => {
      probe.told.push(r);
      setValue(r);
    },
  });
  return null;
}

describe("the cover gate, controlled", () => {
  async function host(policy: CoverPolicy, start: Recipe) {
    const probe = { told: [] as Recipe[] } as Parameters<typeof Controlled>[0]["probe"] & {
      editor: HumanoidEditor;
      setValue: (r: Recipe) => void;
    };
    const screen = await render(<Controlled policy={policy} probe={probe} start={start} />);
    return { probe, screen };
  }

  it("asks before the host hears of an uncovering, and tells it only once allowed", async () => {
    const answer = defer<boolean>();
    const { probe } = await host({ allowUncover: () => answer.promise }, dressed());
    takeOffSuit(probe.editor);
    expect(probe.told).toEqual([]);
    expect(probe.editor.pending).toBe(true);
    await actAsync(() => answer.resolve(true));
    expect(probe.told).toHaveLength(1);
    expect(wearsSuit(probe.editor.recipe)).toBe(false);
    // The figure came back from the host as the one that was confirmed: no second question.
  });

  it("does not tell the host of a figure that was refused", async () => {
    const { probe } = await host({ allowUncover: () => false }, dressed());
    takeOffSuit(probe.editor);
    expect(probe.told).toEqual([]);
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
  });

  it("asks about an uncovered value the host sets, with the cause value, and keeps the figure until allowed", async () => {
    const answer = defer<boolean>();
    const asked: UncoverRequest[] = [];
    const { probe } = await host(
      {
        allowUncover: (r) => {
          asked.push(r);
          return answer.promise;
        },
      },
      dressed(),
    );
    act(() => probe.setValue(bare()));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ cause: "value" });
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
    await actAsync(() => answer.resolve(true));
    expect(wearsSuit(probe.editor.recipe)).toBe(false);
    expect(probe.told).toEqual([]);
  });

  it("aborts a pending request when the host sets another value, and drops its answer", async () => {
    const answer = defer<boolean>();
    let signal: AbortSignal | undefined;
    const { probe } = await host(
      {
        allowUncover: (r) => {
          signal = r.signal;
          return answer.promise;
        },
      },
      dressed(),
    );
    takeOffSuit(probe.editor);
    expect(signal?.aborted).toBe(false);
    act(() => probe.setValue(createRecipe({ macros: { age: 40 }, outfit: [SUIT.id] })));
    expect(signal?.aborted).toBe(true);
    expect(probe.editor.pending).toBe(false);
    expect(probe.editor.recipe.macros.age).toBe(40);
    await actAsync(() => answer.resolve(true));
    expect(wearsSuit(probe.editor.recipe)).toBe(true);
    expect(probe.told).toEqual([]);
  });
});
