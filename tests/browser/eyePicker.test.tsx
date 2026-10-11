import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import eyeManifest from "../../packs/eyes/data/manifest.json";
import { eyeMaterialGroups } from "../../src/editor/eyeMaterials.ts";
import { AppearancePanel } from "../../src/editor/ui/AppearancePanel.tsx";
import { CREATOR_CSS } from "../../src/editor/ui/styles.ts";
import type { HumanoidEditor } from "../../src/editor/ui/useHumanoidEditor.ts";
import { createEyeLibrary, type EyeManifest } from "../../src/eyes/library.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { EditorHarness, readyInfo } from "./harness.tsx";

const library = createEyeLibrary(eyeManifest as unknown as EyeManifest, (file) => file);
const noFocus = () => undefined;

const Styled = ({ children }: { children: React.ReactNode }) => (
  <div className="hk-creator" style={{ height: 900, display: "block" }}>
    <style>{CREATOR_CSS}</style>
    {children}
  </div>
);

function panel(
  initial = createRecipe(),
  withLibrary = true,
  onEditor?: (e: HumanoidEditor) => void,
) {
  return (
    <Styled>
      <EditorHarness
        ready={readyInfo()}
        initial={initial}
        options={{ ...(withLibrary && { eyeMaterials: library }) }}
        {...(onEditor && { onEditor })}
      >
        {(editor) => (
          <AppearancePanel
            editor={editor}
            onFocus={noFocus}
            {...(withLibrary && { eyeMaterials: library })}
          />
        )}
      </EditorHarness>
    </Styled>
  );
}

describe("the eye texture choice", () => {
  it("offers the built-in eye and every material of the library, by kind", async () => {
    const screen = await render(panel());
    const choice = screen.getByRole("group", { name: "Eye texture" });
    await expect
      .element(choice.getByRole("button", { name: "Built-in" }))
      .toHaveAttribute("aria-pressed", "true");
    for (const g of eyeMaterialGroups(library)) {
      const group = screen.getByRole("group", { name: g.label, exact: true });
      await expect.element(group).toBeVisible();
      for (const m of g.materials)
        await expect
          .element(group.getByRole("button", { name: m.label, exact: true }))
          .toHaveAttribute("aria-pressed", "false");
    }
  });

  it("wears the material that is picked, keeps the colours, and goes back to the built-in eye", async () => {
    let latest: HumanoidEditor | undefined;
    const start = createRecipe({ eyes: { iris: [0.05, 0.1, 0.25], scleraWarmth: 0.8 } });
    const screen = await render(panel(start, true, (e) => (latest = e)));
    const amber = screen.getByRole("button", { name: "Diffuse amber eyes", exact: true });
    await amber.click();
    await expect.poll(() => latest?.recipe.eyes.material).toBe("bobby_03_diffuse_amber_eyes");
    expect(latest?.recipe.eyes.iris).toEqual([0.05, 0.1, 0.25]);
    expect(latest?.recipe.eyes.scleraWarmth).toBe(0.8);
    await expect.element(amber).toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "Built-in" }))
      .toHaveAttribute("aria-pressed", "false");
    await screen.getByRole("button", { name: "Built-in" }).click();
    await expect.poll(() => latest?.recipe.eyes.material).toBeUndefined();
    expect(latest ? "material" in latest.recipe.eyes : true).toBe(false);
    // One undo per pick.
    latest?.undo();
    await expect.poll(() => latest?.recipe.eyes.material).toBe("bobby_03_diffuse_amber_eyes");
  });

  it("shows the material a figure already wears as chosen", async () => {
    const screen = await render(
      panel(createRecipe({ eyes: { material: "nyloseth_green_cat_eyes" } })),
    );
    await expect
      .element(screen.getByRole("button", { name: "Green cat eyes", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "Built-in" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("says when a material has no iris to colour", async () => {
    const screen = await render(
      panel(createRecipe({ eyes: { material: "bobby_03_daz_dragon_eyes" } })),
    );
    await expect
      .element(screen.getByText("This eye has no iris, so its colour has no effect."))
      .toBeVisible();
  });

  it("does not say so of a material that has one", async () => {
    const screen = await render(
      panel(createRecipe({ eyes: { material: "bobby_03_diffuse_amber_eyes" } })),
    );
    await expect
      .element(screen.getByRole("button", { name: "Diffuse amber eyes", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByText("This eye has no iris, so its colour has no effect."))
      .not.toBeInTheDocument();
  });

  it("is not there without a library, and the rest of the eye controls are", async () => {
    const screen = await render(panel(createRecipe(), false));
    await expect
      .element(screen.getByRole("group", { name: "Eye texture" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("group", { name: "Iris colour" })).toBeVisible();
    await expect.element(screen.getByRole("slider", { name: "Sclera warmth" })).toBeVisible();
  });
});

describe("loading a figure that wears an eye material", () => {
  const withMaterial = (material: string) => createRecipe({ eyes: { material } });

  async function mounted(withLibrary: boolean) {
    let editor: HumanoidEditor | undefined;
    await render(
      <EditorHarness
        ready={readyInfo()}
        options={{ ...(withLibrary && { eyeMaterials: library }) }}
        onEditor={(e) => (editor = e)}
      >
        {() => null}
      </EditorHarness>,
    );
    return editor as HumanoidEditor;
  }

  it("takes a material the library has", async () => {
    const editor = await mounted(true);
    expect(editor.load(withMaterial("bobby_03_diffuse_amber_eyes"))).toEqual([]);
  });

  it("refuses a material the library lacks, and any material without a library", async () => {
    const editor = await mounted(true);
    expect(editor.load(withMaterial("not_in_the_pack"))).toEqual([
      "eye material not_in_the_pack is not in the loaded eye pack",
    ]);
    const without = await mounted(false);
    expect(without.load(withMaterial("bobby_03_diffuse_amber_eyes"))).toEqual([
      "eye material bobby_03_diffuse_amber_eyes is not in the loaded eye pack",
    ]);
    expect(without.load(createRecipe())).toEqual([]);
  });
});
