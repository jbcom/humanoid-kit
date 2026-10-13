import { describe, expect, it } from "vitest";
import { withSliderValue } from "../src/editor/controls.ts";
import { withAnatomyDefaults } from "../src/recipe/anatomy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const modifiers = assets.modifiers;
const sliders = assets.sliders.flatMap((task) => task.groups.flatMap((group) => group.sliders));
const defaults = adultManifest.anatomy?.defaults;

function slider(id: string) {
  const entry = sliders.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`missing slider ${id}`);
  return entry;
}

describe("creator anatomy-default control semantics", () => {
  it("keeps an explicit adult zero through default application", () => {
    const entry = slider("genitals/phallus-size");
    const recipe = createRecipe({ macros: { age: 30, gender: 0.5 } });

    const fromCreator = withSliderValue(recipe, entry, 0, modifiers, defaults);
    const consumed = withAnatomyDefaults(fromCreator, defaults);

    expect(fromCreator.modifiers[entry.id]).toBe(0);
    expect(consumed.modifiers[entry.id]).toBe(0);
  });

  it("still removes an ordinary neutral body modifier", () => {
    const entry = slider("nose/nose-scale-horiz-decr|incr");
    const changed = withSliderValue(createRecipe({ macros: { age: 30 } }), entry, 0.4, modifiers);

    expect(withSliderValue(changed, entry, 0, modifiers, defaults).modifiers).not.toHaveProperty(
      entry.id,
    );
  });
});
