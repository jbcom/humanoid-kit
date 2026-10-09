import { describe, expect, it } from "vitest";
import {
  AgePolicyError,
  agePolicyViolations,
  assertAgePolicy,
  withAge,
} from "../src/recipe/agePolicy.ts";
import { BIRTHMARKS, JEWELLERY_SIZE, PIERCING_SITES, SCAR_WIDTH } from "../src/recipe/bodyArt.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";

const art = {
  tattoos: [{ image: "rose", at: 1234, size: 0.08 }],
  piercings: [
    { site: "ear-lobe.L" },
    { site: "navel", jewellery: "ring" as const, metal: "gold" as const },
  ],
  scars: [{ at: 4116, length: 0.06 }],
  birthmarks: [{ kind: "cafe-au-lait" as const, at: 2000, size: 0.03 }],
  vitiligo: { extent: 0.4, seed: 7 },
};

describe("the recipe's optional body art", () => {
  it("is absent from a recipe that never asked for it, so saved recipes are unchanged", () => {
    const r = createRecipe();
    expect("bodyArt" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("bodyArt");
  });

  it("fills every item's defaults, and round-trips through JSON", () => {
    const r = createRecipe({ bodyArt: art });
    expect(r.bodyArt).toEqual({
      tattoos: [{ image: "rose", at: 1234, size: 0.08, rotation: 0, density: 1 }],
      piercings: [
        { site: "ear-lobe.L", jewellery: "stud", metal: "steel", size: JEWELLERY_SIZE.stud },
        { site: "navel", jewellery: "ring", metal: "gold", size: JEWELLERY_SIZE.ring },
      ],
      scars: [{ at: 4116, length: 0.06, width: SCAR_WIDTH, rotation: 0, maturity: 1, raised: 0 }],
      birthmarks: [{ kind: "cafe-au-lait", at: 2000, size: 0.03, rotation: 0, seed: 0 }],
      vitiligo: { extent: 0.4, seed: 7 },
    });
    expect(recipeProblems(r)).toEqual([]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect("vitiligo" in (createRecipe({ bodyArt: {} }).bodyArt ?? {})).toBe(false);
  });

  it("lists every structural problem, and clamps nothing", () => {
    const r = createRecipe({ bodyArt: art }) as unknown as { bodyArt: Record<string, unknown> };
    r.bodyArt.tattoos = [{ image: "", at: -1, size: 0, rotation: Number.NaN, density: 2, ink: 1 }];
    r.bodyArt.piercings = [
      { site: "navel", jewellery: "hoop", metal: "brass", size: 0.2 },
      { site: "navel", jewellery: "stud", metal: "steel", size: 0.003 },
    ];
    r.bodyArt.scars = [{ at: 1.5, length: 3, width: 0.003, rotation: 0, maturity: -1, raised: 0 }];
    r.bodyArt.birthmarks = [{ kind: "mole", at: "", size: 0.02, rotation: 0, seed: 0.5 }];
    r.bodyArt.vitiligo = { extent: 1.5, seed: 0 };
    expect(recipeProblems(r)).toEqual([
      "bodyArt.tattoos[0].ink is not a field",
      "bodyArt.tattoos[0].image must be an image key",
      "bodyArt.tattoos[0].at must be a site name or a vertex index",
      "bodyArt.tattoos[0].size must be metres in (0, 2]",
      "bodyArt.tattoos[0].rotation must be a finite number",
      "bodyArt.tattoos[0].density must be a number in [0, 1]",
      `bodyArt.piercings[0].jewellery must be one of stud, ring, barbell`,
      "bodyArt.piercings[0].metal must be one of steel, titanium, gold, rose-gold, silver",
      "bodyArt.piercings[0].size must be metres in (0, 0.05]",
      "bodyArt.piercings[1]: site navel is pierced twice",
      "bodyArt.scars[0].at must be a site name or a vertex index",
      "bodyArt.scars[0].length must be metres in (0, 2]",
      "bodyArt.scars[0].maturity must be a number in [0, 1]",
      `bodyArt.birthmarks[0].kind must be one of ${BIRTHMARKS.join(", ")}`,
      "bodyArt.birthmarks[0].at must be a site name or a vertex index",
      "bodyArt.birthmarks[0].seed must be an integer",
      "bodyArt.vitiligo.extent must be a number in [0, 1]",
    ]);
    expect(recipeProblems({ ...r, bodyArt: [] })).toEqual(["bodyArt must be an object"]);
  });
});

describe("body art under the age policy", () => {
  const adultSite = { site: "adult-pack-site" };

  it("allows the body's own piercing sites, and every mark, at every age", () => {
    const r = createRecipe({
      macros: { age: 8 },
      bodyArt: { ...art, piercings: PIERCING_SITES.map((site) => ({ site })) },
    });
    expect(agePolicyViolations(r)).toEqual([]);
  });

  it("refuses any other piercing site under 18, failing closed, and never clamps", () => {
    const child = createRecipe({ macros: { age: 17.5 }, bodyArt: { piercings: [adultSite] } });
    expect(agePolicyViolations(child)).toEqual(["piercing site adult-pack-site is adult-only"]);
    expect(() => assertAgePolicy(child)).toThrow(AgePolicyError);
    expect(child.bodyArt?.piercings).toHaveLength(1);
    const adult = createRecipe({ macros: { age: 18 }, bodyArt: { piercings: [adultSite] } });
    expect(agePolicyViolations(adult)).toEqual([]);
  });

  it("drops only the adult-only piercings when moved below 18, visibly", () => {
    const adult = createRecipe({
      macros: { age: 30 },
      bodyArt: { piercings: [adultSite, { site: "brow.L" }] },
    });
    const young = withAge(adult, 16);
    expect(young.bodyArt?.piercings.map((p) => p.site)).toEqual(["brow.L"]);
    expect(adult.bodyArt?.piercings).toHaveLength(2);
    expect(withAge(adult, 40).bodyArt?.piercings).toHaveLength(2);
  });
});
