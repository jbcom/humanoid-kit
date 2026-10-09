import { describe, expect, it } from "vitest";
import {
  type WardrobeEntry,
  wardrobeGroups,
  wardrobeOf,
  wearGarment,
  wornIn,
} from "../src/editor/wardrobe.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { clothingManifest } from "./fixtures.ts";

const wardrobe: WardrobeEntry[] = [
  { id: "suits/a", name: "a", kind: "clothes", tags: ["Casual"] },
  { id: "suits/b", name: "b", kind: "clothes", tags: [] },
  { id: "suits/j", name: "j", kind: "jacket", tags: ["Elegant"] },
  { id: "shoes/s", name: "s", kind: "shoes", tags: [] },
];
const [a, b, j, s] = wardrobe as [WardrobeEntry, WardrobeEntry, WardrobeEntry, WardrobeEntry];

describe("the wardrobe", () => {
  it("lists a clothing pack's garments for browsing", () => {
    const list = wardrobeOf(clothingManifest);
    expect(list).toHaveLength(19);
    expect(list.find((g) => g.id === "shoes/shoes01")).toMatchObject({
      kind: "shoes",
      name: "shoes01",
    });
    expect(wardrobeOf(null)).toEqual([]);
  });

  it("groups garments by what they are, in the order a person dresses", () => {
    const groups = wardrobeGroups(wardrobe);
    expect(groups.map((g) => g.kind)).toEqual(["clothes", "jacket", "shoes"]);
    expect(groups[0]?.garments.map((g) => g.id)).toEqual(["suits/a", "suits/b"]);
    expect(groups.map((g) => g.label)).toEqual(["Outfits", "Jackets", "Shoes"]);
  });
});

describe("wearing a garment", () => {
  it("adds it, and takes the one it replaces of the same kind off", () => {
    const one = wearGarment(createRecipe(), a, wardrobe);
    expect(one.outfit).toEqual(["suits/a"]);
    expect(wearGarment(one, b, wardrobe).outfit).toEqual(["suits/b"]);
  });

  it("layers garments of different kinds", () => {
    const dressed = [a, j, s].reduce((r, g) => wearGarment(r, g, wardrobe), createRecipe());
    expect(wornIn(dressed)).toEqual(["suits/a", "suits/j", "shoes/s"]);
  });

  it("takes a worn garment off when it is chosen again", () => {
    const dressed = wearGarment(wearGarment(createRecipe(), a, wardrobe), s, wardrobe);
    const off = wearGarment(dressed, a, wardrobe);
    expect(off.outfit).toEqual(["shoes/s"]);
  });

  it("leaves no outfit field behind once nothing is worn, and changes nothing else", () => {
    const base = createRecipe({ macros: { age: 40 } });
    const off = wearGarment(wearGarment(base, a, wardrobe), a, wardrobe);
    expect("outfit" in off).toBe(false);
    expect(off).toEqual(base);
    expect(base.outfit).toBeUndefined();
  });

  it("does not change the recipe it was given", () => {
    const base = wearGarment(createRecipe(), a, wardrobe);
    const before = JSON.stringify(base);
    wearGarment(base, b, wardrobe);
    expect(JSON.stringify(base)).toBe(before);
  });
});
