import { describe, expect, it } from "vitest";
import { randomRecipe } from "../src/editor/randomize.ts";
import { createRecipe, withHair } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import { DEFAULT_HAIR_COLOUR } from "../src/surface/hairTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const modifiers = loadFixtureAssets().modifiers;
const STYLES = ["short02", "bob02", "long01", "afro01"];
const BROWS = ["eyebrow001", "eyebrow002", "eyebrow003"];
const LASHES = ["eyelashes01", "eyelashes02"];

describe("changing a figure's hair without losing its brows and lashes", () => {
  const dressed = createRecipe({
    hair: { style: "short02", brows: "eyebrow004", lashes: "eyelashes03" },
  });

  it("keeps them when the style or the colour changes", () => {
    const longer = withHair(dressed, { style: "long01" });
    expect(longer.hair?.style).toBe("long01");
    expect(longer.hair?.brows).toBe("eyebrow004");
    expect(longer.hair?.lashes).toBe("eyelashes03");
    const dyed = withHair(dressed, { colour: { ...DEFAULT_HAIR_COLOUR, eumelanin: 0.1 } });
    expect(dyed.hair?.colour.eumelanin).toBe(0.1);
    expect(dyed.hair?.brows).toBe("eyebrow004");
    expect(withHair(dressed, { style: null }).hair?.lashes).toBe("eyelashes03");
  });

  it("changes or takes away one of them and leaves the other", () => {
    const other = withHair(dressed, { brows: "eyebrow009" });
    expect(other.hair?.brows).toBe("eyebrow009");
    expect(other.hair?.lashes).toBe("eyelashes03");
    const bare = withHair(dressed, { brows: null });
    expect("brows" in (bare.hair ?? {})).toBe(false);
    expect(bare.hair?.lashes).toBe("eyelashes03");
    const none = withHair(withHair(dressed, { brows: null }), { lashes: null });
    expect(Object.keys(none.hair ?? {}).sort()).toEqual(["colour", "style"]);
  });

  it("starts a figure with no hair at the default colour, and does not touch the original", () => {
    const base = createRecipe();
    const w = withHair(base, { brows: "eyebrow001" });
    expect(w.hair).toEqual({ style: null, colour: DEFAULT_HAIR_COLOUR, brows: "eyebrow001" });
    expect(base.hair).toBeUndefined();
    expect(dressed.hair?.style).toBe("short02");
  });
});

describe("random brows and lashes", () => {
  it("do not change the rest of the figure, or the hair, so figures from before keep their seeds", () => {
    for (const seed of [1, 7, 42, 1234]) {
      const plain = randomRecipe(createRecipe(), seed, modifiers, { hairStyles: STYLES });
      const dressed = randomRecipe(createRecipe(), seed, modifiers, {
        hairStyles: STYLES,
        browStyles: BROWS,
        lashStyles: LASHES,
      });
      const { brows: _b, lashes: _l, ...hair } = dressed.hair ?? {};
      expect(hair).toEqual(plain.hair);
      expect({ ...dressed, hair: undefined }).toEqual({ ...plain, hair: undefined });
    }
  });

  it("give every figure a brow and a lash from the ones on offer, valid and repeatable", () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = randomRecipe(createRecipe(), seed, modifiers, {
        hairStyles: STYLES,
        browStyles: BROWS,
        lashStyles: LASHES,
      });
      expect(BROWS).toContain(r.hair?.brows);
      expect(LASHES).toContain(r.hair?.lashes);
      expect(recipeProblems(r)).toEqual([]);
      expect(
        randomRecipe(createRecipe(), seed, modifiers, {
          hairStyles: STYLES,
          browStyles: BROWS,
          lashStyles: LASHES,
        }),
      ).toEqual(r);
    }
  });

  it("use every style on offer across seeds, and work without scalp hair on offer", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 80; seed++) {
      const r = randomRecipe(createRecipe(), seed, modifiers, { browStyles: BROWS });
      seen.add(r.hair?.brows ?? "none");
      expect(r.hair?.style).toBeNull();
      expect(r.hair?.lashes).toBeUndefined();
    }
    expect([...seen].sort()).toEqual(BROWS);
  });

  it("are left as they are when none are on offer", () => {
    const worn = createRecipe({ hair: { style: "bob02", brows: "eyebrow005" } });
    expect(randomRecipe(worn, 3, modifiers, { hairStyles: STYLES }).hair?.brows).toBe("eyebrow005");
    expect(randomRecipe(worn, 3, modifiers).hair).toEqual(worn.hair);
  });
});
