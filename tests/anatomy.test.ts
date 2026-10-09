import { describe, expect, it } from "vitest";
import { ADULT_ONLY_MODIFIER, withAge } from "../src/recipe/agePolicy.ts";
import { type AnatomyFeature, appliedAnatomy } from "../src/recipe/anatomy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest } from "./fixtures.ts";

// The features are the adult pack's data, as the worker reports them in `ready`.
const features: readonly AnatomyFeature[] = adultManifest.anatomy?.features ?? [];
const applied = (recipe: ReturnType<typeof createRecipe>) => appliedAnatomy(recipe, features);

const adult = (modifiers: Record<string, number> = {}) =>
  createRecipe({ macros: { age: 30 }, modifiers });

describe("the anatomy a recipe applies", () => {
  it("is none for a recipe that sets no anatomy modifier", () => {
    expect(applied(adult())).toEqual({});
    expect(applied(adult({ "genitals/penis-length-decr|incr": 0 }))).toEqual({});
  });

  it("is none without an adult pack, whatever the recipe sets", () => {
    expect(appliedAnatomy(adult({ "genitals/penis-length-decr|incr": 0.4 }), [])).toEqual({});
  });

  it("names a feature once any of its modifiers is set, in either direction", () => {
    expect(applied(adult({ "genitals/penis-length-decr|incr": 0.4 }))).toEqual({ penis: 1 });
    expect(applied(adult({ "genitals/penis-circ-decr|incr": -0.3 }))).toEqual({ penis: 1 });
    expect(applied(adult({ "genitals/penis-testicles-decr|incr": 0.2 }))).toEqual({ testes: 1 });
  });

  it("keeps every feature independent: setting one never names another", () => {
    const only = (id: string) => Object.keys(applied(adult({ [id]: 0.5 })));
    expect(only("genitals/penis-length-decr|incr")).toEqual(["penis"]);
    expect(only("genitals/penis-testicles-decr|incr")).toEqual(["testes"]);
    expect(only("pelvis/bulge-decr|incr")).toEqual(["mound"]);
    const all = applied(
      adult({
        "genitals/penis-length-decr|incr": 0.5,
        "genitals/penis-testicles-decr|incr": 0.5,
        "pelvis/bulge-decr|incr": 0.5,
      }),
    );
    expect(Object.keys(all).sort()).toEqual(["mound", "penis", "testes"]);
  });

  it("is none under 18 even when the recipe carries the modifiers", () => {
    // The age policy rejects such a recipe at evaluation; the paint input must
    // not depend on that having run first.
    const teen = createRecipe({
      macros: { age: 15 },
      modifiers: { "genitals/penis-length-decr|incr": 0.5, "pelvis/bulge-decr|incr": 0.5 },
    });
    expect(applied(teen)).toEqual({});
    expect(applied(withAge(adult({ "genitals/penis-length-decr|incr": 0.5 }), 15))).toEqual({});
  });

  it("lists only adult-only modifiers the adult pack ships, none twice", () => {
    expect(features.length).toBeGreaterThan(0);
    const shipped = new Set(adultManifest.modifiers.map((m) => m.id));
    const seen = new Set<string>();
    for (const f of features) {
      expect(f.modifiers.length, f.id).toBeGreaterThan(0);
      for (const id of f.modifiers) {
        expect(ADULT_ONLY_MODIFIER(id), id).toBe(true);
        expect(shipped.has(id), id).toBe(true);
        expect(seen.has(id), `${id} is in two features`).toBe(false);
        seen.add(id);
      }
    }
  });

  it("ignores shape modifiers that are not anatomy (pregnancy is body shape, not a skin feature)", () => {
    expect(applied(adult({ "stomach/stomach-pregnant-decr|incr": 1 }))).toEqual({});
  });
});
