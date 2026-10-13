import { describe, expect, it } from "vitest";
import {
  COVERING_KINDS,
  type CoverPolicy,
  isCovered,
  mustConfirm,
  wearsCover,
} from "../src/editor/cover.ts";
import { type WardrobeEntry, wardrobeOf } from "../src/editor/wardrobe.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { clothingManifest } from "./fixtures.ts";

const wardrobe = wardrobeOf([clothingManifest]);
const ofKind = (kind: string) => {
  const g = wardrobe.find((w) => w.kind === kind);
  if (!g) throw new Error(`the clothing pack has no ${kind}`);
  return g.id;
};
const SUIT = ofKind("clothes");
const SHOES = ofKind("shoes");
const HAT = ofKind("hat");
const entry = (id: string, kind: string): WardrobeEntry => ({
  id,
  name: id,
  label: id,
  kind,
  tags: [],
});

const dressed = createRecipe({ outfit: [SUIT] });
const bare = createRecipe();
const shod = createRecipe({ outfit: [SHOES, HAT] });

describe("wearsCover", () => {
  it("is true for a garment of a covering kind and false for the rest", () => {
    expect(COVERING_KINDS).toEqual(["underwear", "clothes"]);
    expect(wearsCover(dressed, wardrobe)).toBe(true);
    expect(wearsCover(createRecipe({ outfit: [SHOES, SUIT] }), wardrobe)).toBe(true);
    expect(wearsCover(bare, wardrobe)).toBe(false);
    expect(wearsCover(shod, wardrobe)).toBe(false);
  });

  it("counts underwear, which the shipped pack has none of", () => {
    const withUnderwear = [...wardrobe, entry("briefs", "underwear")];
    expect(wearsCover(createRecipe({ outfit: ["briefs"] }), withUnderwear)).toBe(true);
  });

  it("is false for a garment the wardrobe does not list, and for no wardrobe at all", () => {
    expect(wearsCover(createRecipe({ outfit: ["not/a-garment"] }), wardrobe)).toBe(false);
    expect(wearsCover(dressed, [])).toBe(false);
  });
});

describe("isCovered", () => {
  it("is the policy's own rule when it has one, wearsCover when not", () => {
    expect(isCovered({}, dressed, wardrobe)).toBe(true);
    expect(isCovered({}, bare, wardrobe)).toBe(false);
    const anyGarment: CoverPolicy = { covered: (r) => (r.outfit?.length ?? 0) > 0 };
    expect(isCovered(anyGarment, shod, wardrobe)).toBe(true);
    const never: CoverPolicy = { covered: () => false };
    expect(isCovered(never, dressed, wardrobe)).toBe(false);
  });

  it("hands the rule the recipe and the wardrobe", () => {
    const seen: unknown[] = [];
    isCovered(
      {
        covered: (...args) => {
          seen.push(...args);
          return true;
        },
      },
      dressed,
      wardrobe,
    );
    expect(seen).toEqual([dressed, wardrobe]);
  });
});

describe("mustConfirm", () => {
  const policy: CoverPolicy = {};
  it("never asks about a covered figure", () => {
    expect(mustConfirm(policy, wardrobe, dressed, bare)).toBe(false);
    expect(mustConfirm(policy, wardrobe, dressed, dressed)).toBe(false);
    expect(mustConfirm(policy, wardrobe, dressed, null)).toBe(false);
  });

  it("asks when a covered figure would become uncovered", () => {
    expect(mustConfirm(policy, wardrobe, bare, dressed)).toBe(true);
    expect(mustConfirm(policy, wardrobe, shod, dressed)).toBe(true);
  });

  it("asks when nothing is shown yet and the figure is uncovered", () => {
    expect(mustConfirm(policy, wardrobe, bare, null)).toBe(true);
  });

  it("does not ask again while the figure shown is already uncovered", () => {
    expect(mustConfirm(policy, wardrobe, bare, shod)).toBe(false);
    expect(mustConfirm(policy, wardrobe, shod, bare)).toBe(false);
  });
});
