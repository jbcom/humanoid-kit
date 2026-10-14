import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { hairManifest, loadHairFixtureAssets } from "./hairFixtures.ts";

const model = new HumanoidModel(loadHairFixtureAssets());
const facial = (styles: readonly string[]) =>
  createRecipe({ hair: { style: null }, facialHair: styles } as never);

describe("a figure wearing authored facial hair", () => {
  it("wears each selected asset on its own morphed mesh", () => {
    for (const style of hairManifest.styles.filter((entry) => entry.kind === "facial")) {
      const evaluation = model.evaluate(facial([style.id]));
      const worn = evaluation.facialHair[0];
      expect(worn?.id, style.id).toBe(style.id);
      expect(worn?.positions.length, style.id).toBe(model.hairTopology(style.id).vertexCount * 3);
    }
  });

  it("wears a moustache and beard independently", () => {
    expect(
      model.evaluate(facial(["beard-viking", "moustache-viking"])).facialHair.map((h) => h.id),
    ).toEqual(["beard-viking", "moustache-viking"]);
  });

  it("keeps legacy body-hair beard recipes as coat coverage without generated card geometry", () => {
    const evaluation = model.evaluate(createRecipe({ bodyHair: { beard: "longstreet" } }));
    expect(evaluation.facialHair).toEqual([]);
  });
});
