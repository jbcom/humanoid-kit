import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { AppearancePanel } from "../../src/editor/ui/AppearancePanel.tsx";
import { RegionPanel } from "../../src/editor/ui/RegionPanel.tsx";
import { ShapePanel } from "../../src/editor/ui/ShapePanel.tsx";
import { SliderRow } from "../../src/editor/ui/SliderRow.tsx";
import { CREATOR_CSS } from "../../src/editor/ui/styles.ts";
import type { HumanoidEditor } from "../../src/editor/ui/useHumanoidEditor.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
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
});
