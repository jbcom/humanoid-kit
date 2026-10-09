import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { AppearancePanel } from "../../src/editor/ui/AppearancePanel.tsx";
import { RegionPanel } from "../../src/editor/ui/RegionPanel.tsx";
import { ShapePanel } from "../../src/editor/ui/ShapePanel.tsx";
import { SliderRow } from "../../src/editor/ui/SliderRow.tsx";
import { CREATOR_CSS } from "../../src/editor/ui/styles.ts";
import type { HumanoidEditor } from "../../src/editor/ui/useHumanoidEditor.ts";
import { WardrobePanel } from "../../src/editor/ui/WardrobePanel.tsx";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { DEFAULT_HAIR_COLOUR } from "../../src/surface/hairTone.ts";
import { EditorHarness, readyInfo } from "./harness.tsx";

const Styled = ({ children }: { children: React.ReactNode }) => (
  <div className="hk-creator" style={{ height: 900, display: "block" }}>
    <style>{CREATOR_CSS}</style>
    {children}
  </div>
);
const noFocus = () => undefined;

describe("SliderRow", () => {
  it("reports one gesture per drag, shows its value and resets to neutral", async () => {
    const changes: [number, string][] = [];
    let settled = 0;
    const screen = await render(
      <Styled>
        <SliderRow
          label="Nose width"
          value={0.4}
          min={-1}
          max={1}
          step={0.005}
          neutral={0}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, g) => changes.push([v, g])}
          onSettle={() => settled++}
        />
      </Styled>,
    );
    const slider = screen.getByRole("slider", { name: "Nose width" });
    await expect.element(slider).toHaveAttribute("aria-valuetext", "40%");
    // Keyboard steps while focused belong to one gesture (a click would be a gesture of its own).
    (slider.element() as HTMLElement).focus();
    await userKeys(slider, ["ArrowRight", "ArrowRight", "ArrowLeft"]);
    const gestures = new Set(changes.map(([, g]) => g));
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(gestures.size).toBe(1);
    await screen.getByRole("button", { name: "Reset Nose width" }).click();
    expect(changes.at(-1)?.[0]).toBe(0);
    expect(settled).toBeGreaterThan(0);
  });

  it("explains why it is disabled", async () => {
    const screen = await render(
      <Styled>
        <SliderRow
          label="Locked"
          value={0}
          min={0}
          max={1}
          step={0.01}
          neutral={0}
          format={String}
          disabledReason="Not available yet."
          onChange={() => undefined}
          onSettle={() => undefined}
        />
      </Styled>,
    );
    await expect.element(screen.getByRole("slider", { name: "Locked" })).toBeDisabled();
    await expect.element(screen.getByText("Not available yet.")).toBeVisible();
  });
});

async function userKeys(locator: { element(): Element }, keys: string[]) {
  const { userEvent } = await import("vitest/browser");
  for (const k of keys) await userEvent.keyboard(`{${k}}`);
  void locator;
}

describe("ShapePanel", () => {
  it("shows MakeHuman's groups for a task and edits through the real controls", async () => {
    let latest: HumanoidEditor | undefined;
    const ready = readyInfo();
    const face = ready.sliders.find((t) => t.id === "Face");
    const screen = await render(
      <Styled>
        <EditorHarness ready={ready} onEditor={(e) => (latest = e)}>
          {(editor) => (
            <ShapePanel editor={editor} task={face ?? null} query="" onFocus={noFocus} />
          )}
        </EditorHarness>
      </Styled>,
    );
    await expect.element(screen.getByText("Head shape")).toBeVisible();
    const slider = screen.getByRole("slider", { name: "Head fat" });
    // Focus, not click: a click lands on the track and commits a value of its own.
    (slider.element() as HTMLElement).focus();
    const { userEvent } = await import("vitest/browser");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect.poll(() => latest?.recipe.modifiers["head/head-fat-decr|incr"]).toBeGreaterThan(0);
    // The drag is one undo step.
    latest?.settle();
    latest?.undo();
    await expect.poll(() => latest?.recipe.modifiers["head/head-fat-decr|incr"]).toBeUndefined();
  });

  it("searches every task", async () => {
    const screen = await render(
      <Styled>
        <EditorHarness ready={readyInfo()}>
          {(editor) => <ShapePanel editor={editor} task={null} query="nose" onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    await expect.element(screen.getByText("Face · Nose size").first()).toBeVisible();
    const none = await render(
      <Styled>
        <EditorHarness ready={readyInfo()}>
          {(editor) => <ShapePanel editor={editor} task={null} query="zzzz" onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    await expect.element(none.getByText(/No sliders match/)).toBeVisible();
  });

  it("disables adult anatomy sliders under 18, with the reason, and enables them at 18", async () => {
    const ready = readyInfo(true);
    const gender = ready.sliders.find((t) => t.id === "Gender") ?? null;
    const minor = await render(
      <Styled>
        <EditorHarness ready={ready} initial={createRecipe({ macros: { age: 15 } })}>
          {(editor) => <ShapePanel editor={editor} task={gender} query="" onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    // A task with two groups opens both.
    await expect.element(minor.getByText("Genitals")).toBeVisible();
    await expect.element(minor.getByRole("slider", { name: "Penis length" })).toBeDisabled();
    await expect.element(minor.getByText(/available from age 18/).first()).toBeVisible();
    await minor.unmount();
    const adult = await render(
      <Styled>
        <EditorHarness ready={ready} initial={createRecipe({ macros: { age: 30 } })}>
          {(editor) => <ShapePanel editor={editor} task={gender} query="" onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    await expect.element(adult.getByRole("slider", { name: "Penis length" })).toBeEnabled();
  });

  it("offers no adult anatomy sliders when the pack is not loaded", async () => {
    const ready = readyInfo(false);
    const gender = ready.sliders.find((t) => t.id === "Gender") ?? null;
    const screen = await render(
      <Styled>
        <EditorHarness ready={ready} initial={createRecipe({ macros: { age: 30 } })}>
          {(editor) => <ShapePanel editor={editor} task={gender} query="" onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    await expect.element(screen.getByText("Breast")).toBeVisible();
    expect(screen.getByText("Genitals").query()).toBeNull();
  });
});

describe("RegionPanel", () => {
  it("overrides a macro in one region, marks it, and resets it to inherit", async () => {
    let latest: HumanoidEditor | undefined;
    const screen = await render(
      <Styled>
        <EditorHarness ready={readyInfo()} onEditor={(e) => (latest = e)}>
          {(editor) => <RegionPanel editor={editor} onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    await screen.getByRole("button", { name: "Pelvis" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Pelvis" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText("50% · whole body").first()).toBeVisible();
    (screen.getByRole("slider", { name: "Weight" }).element() as HTMLElement).focus();
    const { userEvent } = await import("vitest/browser");
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => latest?.recipe.regionalMacros.pelvis?.weight).toBeGreaterThan(0.5);
    await expect
      .element(screen.getByRole("button", { name: "Pelvis" }))
      .toHaveAttribute("data-overridden", "true");
    await screen.getByRole("button", { name: "Reset Weight" }).click();
    await expect.poll(() => latest?.recipe.regionalMacros.pelvis).toBeUndefined();
  });
});

describe("WardrobePanel", () => {
  it("wears a garment, replaces the one of its kind, layers another kind and takes it off", async () => {
    let latest: HumanoidEditor | undefined;
    const screen = await render(
      <Styled>
        <EditorHarness ready={readyInfo(false, true)} onEditor={(e) => (latest = e)}>
          {(editor) => <WardrobePanel editor={editor} />}
        </EditorHarness>
      </Styled>,
    );
    // Garments are listed by kind, with readable names.
    await expect.element(screen.getByText("Outfits").first()).toBeVisible();
    await expect.element(screen.getByText("Shoes").first()).toBeVisible();
    const one = screen.getByRole("button", { name: "Navy shirt and jeans" });
    await one.click();
    await expect.element(one).toHaveAttribute("aria-pressed", "true");
    expect(latest?.recipe.outfit).toEqual(["suits/male_casualsuit01"]);
    // A second outfit replaces the first; shoes layer over it.
    await screen.getByRole("button", { name: "Blue sweater and jeans" }).click();
    await screen.getByRole("button", { name: "Brown oxfords" }).click();
    expect(latest?.recipe.outfit).toEqual(["suits/male_casualsuit02", "shoes/shoes01"]);
    await expect.element(one).toHaveAttribute("aria-pressed", "false");
    await screen.getByRole("button", { name: "Brown oxfords" }).click();
    expect(latest?.recipe.outfit).toEqual(["suits/male_casualsuit02"]);
    // Wearing is one undoable step.
    latest?.undo();
    await expect
      .poll(() => latest?.recipe.outfit)
      .toEqual(["suits/male_casualsuit02", "shoes/shoes01"]);
  });

  it("says so when no clothing pack is loaded", async () => {
    const screen = await render(
      <Styled>
        <EditorHarness ready={readyInfo()}>
          {(editor) => <WardrobePanel editor={editor} />}
        </EditorHarness>
      </Styled>,
    );
    await expect.element(screen.getByText("No clothing pack is loaded.")).toBeVisible();
  });
});

describe("AppearancePanel", () => {
  it("sets the iris from the palette and marks the chosen swatch", async () => {
    let latest: HumanoidEditor | undefined;
    const screen = await render(
      <Styled>
        <EditorHarness ready={readyInfo()} onEditor={(e) => (latest = e)}>
          {(editor) => <AppearancePanel editor={editor} onFocus={noFocus} />}
        </EditorHarness>
      </Styled>,
    );
    await screen.getByRole("button", { name: "Green" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Green" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(latest?.recipe.eyes.iris).toEqual([0.1, 0.16, 0.06]);
  });

  describe("body hair", () => {
    const panel = async (age: number) => {
      const seen: { editor?: HumanoidEditor } = {};
      const screen = await render(
        <Styled>
          <EditorHarness
            ready={readyInfo()}
            initial={createRecipe({ macros: { age, gender: 1 } })}
            onEditor={(e) => (seen.editor = e)}
          >
            {(editor) => <AppearancePanel editor={editor} onFocus={noFocus} />}
          </EditorHarness>
        </Styled>,
      );
      await screen.getByText("Body hair").click();
      return { screen, seen };
    };

    it("starts natural, picks a beard, and returns to natural leaving no body hair field", async () => {
      const { screen, seen } = await panel(30);
      await expect
        .element(screen.getByRole("button", { name: "Natural" }))
        .toHaveAttribute("aria-pressed", "true");
      expect(seen.editor?.recipe.bodyHair).toBeUndefined();
      await screen.getByRole("button", { name: "Goatee" }).click();
      expect(seen.editor?.recipe.bodyHair).toEqual({ beard: "goatee" });
      await screen.getByRole("button", { name: "Natural" }).click();
      expect(seen.editor?.recipe.bodyHair).toBeUndefined();
    });

    it("offers underarm and pubic density to an adult", async () => {
      const { screen } = await panel(30);
      await expect.element(screen.getByText("Underarms")).toBeInTheDocument();
      await expect.element(screen.getByText("Pubic")).toBeInTheDocument();
    });

    it("offers neither to a figure under 18", async () => {
      const { screen } = await panel(15);
      await expect.element(screen.getByText("Chest")).toBeInTheDocument();
      expect(screen.getByText("Underarms").elements()).toHaveLength(0);
      expect(screen.getByText("Pubic").elements()).toHaveLength(0);
    });
  });

  describe("hair", () => {
    const hair = {
      styles: [
        { id: "short02", label: "Short, tousled", tags: ["short"], kind: "scalp" as const },
        { id: "long01", label: "Long, straight", tags: ["long"], kind: "scalp" as const },
        // Brows and lashes share the pack but are not hair styles the creator offers.
        { id: "brow01", label: "Brows, natural", tags: ["brows"], kind: "brows" as const },
      ],
    };
    const panel = async (info = readyInfo(false, false, hair)) => {
      const seen: { editor?: HumanoidEditor } = {};
      const screen = await render(
        <Styled>
          <EditorHarness ready={info} onEditor={(e) => (seen.editor = e)}>
            {(editor) => <AppearancePanel editor={editor} onFocus={noFocus} />}
          </EditorHarness>
        </Styled>,
      );
      return { screen, seen };
    };

    it("offers no hair controls without a hair pack", async () => {
      const { screen } = await panel(readyInfo());
      await expect.element(screen.getByText("Green")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Long, straight" }).elements()).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Black hair" }).elements()).toHaveLength(0);
    });

    it("lists the pack's styles and none, and wears the one chosen", async () => {
      const { screen, seen } = await panel();
      await expect
        .element(screen.getByRole("button", { name: "None" }))
        .toHaveAttribute("aria-pressed", "true");
      await screen.getByRole("button", { name: "Long, straight" }).click();
      await expect
        .element(screen.getByRole("button", { name: "Long, straight" }))
        .toHaveAttribute("aria-pressed", "true");
      expect(seen.editor?.recipe.hair?.style).toBe("long01");
      await expect
        .element(screen.getByRole("button", { name: "Brows, natural" }))
        .not.toBeInTheDocument();
      // Choosing a style keeps the colour, and the default colour is the starting point.
      expect(seen.editor?.recipe.hair?.colour).toEqual(DEFAULT_HAIR_COLOUR);
      await screen.getByRole("button", { name: "None" }).click();
      expect(seen.editor?.recipe.hair?.style).toBeNull();
    });

    it("sets a natural colour from the palette, marks it, and the pigment sliders move off it", async () => {
      const { screen, seen } = await panel();
      await screen.getByRole("button", { name: "Blond hair" }).click();
      await expect
        .element(screen.getByRole("button", { name: "Blond hair" }))
        .toHaveAttribute("aria-pressed", "true");
      expect(seen.editor?.recipe.hair?.colour).toEqual({
        eumelanin: 0.22,
        pheomelanin: 0.2,
        grey: 0,
        override: null,
      });
      await expect
        .element(screen.getByRole("slider", { name: "Dark pigment" }))
        .toHaveAttribute("aria-valuetext", "22%");
      await screen.getByRole("button", { name: "Reset Dark pigment" }).click();
      await expect
        .element(screen.getByRole("button", { name: "Blond hair" }))
        .toHaveAttribute("aria-pressed", "false");
    });

    it("dyes the hair from the colour picker, and a palette colour undoes the dye", async () => {
      const { screen, seen } = await panel();
      const picker = screen.getByLabelText("Custom hair colour").element() as HTMLElement;
      const input = picker.querySelector("input") as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "#2060c0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await expect.poll(() => seen.editor?.recipe.hair?.colour.override).not.toBeNull();
      expect(seen.editor?.recipe.hair?.colour.override?.[2]).toBeGreaterThan(0.4);
      await screen.getByRole("button", { name: "Black hair" }).click();
      expect(seen.editor?.recipe.hair?.colour.override).toBeNull();
    });

    it("is undoable, one step per swatch", async () => {
      const { screen, seen } = await panel();
      await screen.getByRole("button", { name: "Red hair" }).click();
      await screen.getByRole("button", { name: "Platinum hair" }).click();
      expect(seen.editor?.recipe.hair?.colour.eumelanin).toBe(0.08);
      seen.editor?.undo();
      await expect.poll(() => seen.editor?.recipe.hair?.colour.eumelanin).toBe(0.1);
    });
  });
});
