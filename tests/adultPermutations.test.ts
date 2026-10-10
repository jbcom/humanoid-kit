import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { appliedAnatomy } from "../src/recipe/anatomy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The permutation matrix (docs/research/ADULT-SCULPT-PLAN.md, "Acceptance
 * matrix"): adult anatomy is independent features, not a male/female switch, so
 * the figures the library must hold are the cross of every age from 18 up,
 * every gender position, every combination of the shape features (each absent,
 * reduced, or enlarged) and both states, flaccid and aroused. A figure with a
 * penis and a female macro, one with testes and no penis, one with only the
 * mound, are all points in this cross: none is special-cased, each must
 * evaluate finite, keep the age gate, and carry exactly the anatomy its
 * modifiers name.
 */
const withAdult = loadFixtureAssets(true);
const control = new HumanoidModel(withAdult, { subdivision: 0 });
const surfaced = new HumanoidModel(withAdult, { subdivision: 1 });
const features = adultManifest.anatomy?.features ?? [];

const AGES = [18, 30, 90];
const GENDERS = [0, 0.25, 0.5, 0.75, 1];
const LEVELS = [-1, 0, 1];
const STATES = [0, 0.5, 1];

/** The levels a modifier takes: a one-sided one (a size) has no reduced level. */
const levelsOf = (id: string) =>
  adultManifest.modifiers.find((m) => m.id === id)?.lo === null
    ? LEVELS.filter((v) => v >= 0)
    : LEVELS;

/** Every assignment of a level to each feature's first modifier. */
function featureCombinations(): Record<string, number>[] {
  let out: Record<string, number>[] = [{}];
  for (const f of features) {
    const id = f.modifiers[0] as string;
    out = out.flatMap((m) => levelsOf(id).map((v) => ({ ...m, [id]: v })));
  }
  return out;
}

const COMBINATIONS = featureCombinations();

const finite = (a: Float32Array) => a.every(Number.isFinite);

const SIZE = "genitals/phallus-size";
const base = () => createRecipe({ macros: { age: 30, gender: 0.5 } });

/**
 * How far the organ reaches from the skin: the largest distance any vertex of
 * the adult surface has moved from where the figure's surface is without the
 * organ. The organ is a tube drawn out of its root, so its tip is the farthest.
 */
function reach(m: HumanoidModel, recipe: ReturnType<typeof base>, signals: Record<string, number>) {
  const without = createRecipe({
    macros: recipe.macros,
    modifiers: { ...recipe.modifiers, [SIZE]: 0 },
  });
  const a = m.evaluate(without).positions;
  const b = m.evaluate(recipe, signals).positions;
  let far = 0;
  for (let v = 0; v < a.length / 3; v++)
    far = Math.max(
      far,
      Math.hypot(...[0, 1, 2].map((k) => (b[v * 3 + k] as number) - (a[v * 3 + k] as number))),
    );
  return far;
}
const withOrgan = (extra: Record<string, number> = {}, macros = base().macros) =>
  createRecipe({ macros, modifiers: { [SIZE]: 0.65, ...extra } });

// The cross is a thousand evaluations and the refined slice builds a surface:
// seconds unloaded, minutes on a busy machine.
describe("the adult permutation matrix", { timeout: 600_000 }, () => {
  it("covers every feature the pack names, so a new feature extends the matrix by itself", () => {
    expect(features.map((f) => f.id)).toEqual(["phallus", "scrotum", "mound"]);
    expect(COMBINATIONS.length).toBe(
      features.reduce((n, f) => n * levelsOf(f.modifiers[0] as string).length, 1),
    );
  });

  it("evaluates every age × gender × feature combination × state finite, at the control level", () => {
    let count = 0;
    for (const age of AGES)
      for (const gender of GENDERS)
        for (const modifiers of COMBINATIONS)
          for (const arousal of STATES) {
            const recipe = createRecipe({ macros: { age, gender }, modifiers });
            const ev = control.evaluate(recipe, { arousal });
            const where = `age ${age} gender ${gender} ${JSON.stringify(modifiers)} arousal ${arousal}`;
            if (!finite(ev.positions) || !finite(ev.normals) || !finite(ev.control))
              throw new Error(`not finite: ${where}`);
            expect(ev.surface, where).toBe("base");
            count++;
          }
    expect(count).toBe(AGES.length * GENDERS.length * COMBINATIONS.length * STATES.length);
  });

  it("applies exactly the anatomy the modifiers name, whatever the gender", () => {
    for (const gender of GENDERS)
      for (const modifiers of COMBINATIONS) {
        const recipe = createRecipe({ macros: { age: 35, gender }, modifiers });
        const applied = appliedAnatomy(recipe, features);
        for (const f of features) {
          const set = f.modifiers.some((id) => (modifiers[id] ?? 0) !== 0);
          expect(applied[f.id], `${f.id} at gender ${gender} ${JSON.stringify(modifiers)}`).toBe(
            set ? 1 : undefined,
          );
        }
      }
  });

  it("evaluates the refined surface finite across ages, genders, builds and states", () => {
    const builds = [
      { weight: 0, muscle: 0 },
      { weight: 1, muscle: 0 },
      { weight: 0.5, muscle: 1 },
      { weight: 1, muscle: 1 },
    ];
    for (const age of [18, 45, 90])
      for (const gender of [0, 0.5, 1])
        for (const build of builds)
          for (const modifiers of [
            {},
            { "pelvis/bulge-decr|incr": 1 },
            { "pelvis/mound-decr|incr": 1 },
            { "pelvis/mound-decr|incr": -1, "pelvis/bulge-decr|incr": 1 },
            { "genitals/penis-length-decr|incr": 1, "genitals/penis-testicles-decr|incr": -1 },
            {
              "genitals/penis-length-decr|incr": 0.5,
              "genitals/penis-testicles-decr|incr": 0.5,
              "pelvis/mound-decr|incr": 1,
            },
            // The organ, from a clitoral glans to the largest key, with its length and girth.
            { [SIZE]: 0.08 },
            { [SIZE]: 0.45 },
            { [SIZE]: 0.65, "genitals/phallus-length-decr|incr": 1 },
            { [SIZE]: 1, "genitals/phallus-girth-decr|incr": -1, "pelvis/mound-decr|incr": 1 },
            // The sacs and testes, alone and with the organ and the mound.
            { "genitals/testes-size": 0.25 },
            { "genitals/testes-size": 1, [SIZE]: 0.65, "pelvis/mound-decr|incr": -1 },
          ])
            for (const arousal of [0, 1]) {
              const recipe = createRecipe({ macros: { age, gender, ...build }, modifiers });
              const ev = surfaced.evaluate(recipe, { arousal });
              const where = `age ${age} gender ${gender} ${JSON.stringify(build)} ${JSON.stringify(modifiers)} arousal ${arousal}`;
              expect(ev.surface, where).toBe("adult");
              if (!finite(ev.positions) || !finite(ev.normals) || !finite(ev.curvature))
                throw new Error(`not finite: ${where}`);
            }
  });

  it("refuses every state under 18 and gives a minor the base surface, at every gender and combination", () => {
    for (const age of [1, 11, 15, 17.99])
      for (const gender of GENDERS)
        for (const modifiers of COMBINATIONS) {
          const recipe = createRecipe({ macros: { age, gender }, modifiers });
          const named = Object.values(modifiers).some((v) => v !== 0);
          // However the recipe was built, no anatomy is applied under 18.
          expect(appliedAnatomy(recipe, features)).toEqual({});
          if (named) {
            // A minor's recipe that names an adult modifier is refused outright.
            expect(() => surfaced.evaluate(recipe)).toThrow(AgePolicyError);
            continue;
          }
          expect(surfaced.evaluate(recipe).surface).toBe("base");
          for (const arousal of [0.1, 0.5, 1])
            expect(() => control.evaluate(recipe, { arousal })).toThrow(AgePolicyError);
        }
  });
});

describe("flaccid and erect", () => {
  it("lengthens the organ monotonically with the state, for every gender position", () => {
    for (const gender of GENDERS) {
      const recipe = withOrgan({}, { ...base().macros, gender });
      const [flaccid, half, erect] = STATES.map((arousal) => reach(surfaced, recipe, { arousal }));
      expect(half, `gender ${gender}`).toBeGreaterThan(flaccid as number);
      expect(erect, `gender ${gender}`).toBeGreaterThan(half as number);
    }
  });

  it("stays an engorgement of the figure's own organ, at every size, shorter, as made, or longer", () => {
    // Aroused is a plausible multiple of the figure's own flaccid organ at every
    // size (the measured +43% along the top, more from the tip's rise, since it
    // is reached from the skin), never one fixed size. The organs that erect:
    // from the key above the smallest up. A shorter one grows by more of its free
    // length (its dorsal length counts the root's own footprint, which does not grow);
    // the +43% itself is held on the authored shapes (tests/phallus.test.ts).
    for (const size of [0.25, 0.45, 0.65, 1])
      for (const length of [-1, 0, 1]) {
        const recipe = withOrgan({ [SIZE]: size, "genitals/phallus-length-decr|incr": length });
        const r = reach(surfaced, recipe, { arousal: 1 }) / reach(surfaced, recipe, {});
        expect(r, `size ${size} length ${length}`).toBeGreaterThan(1.2);
        expect(r, `size ${size} length ${length}`).toBeLessThan(2.6);
      }
  });

  it("holds at every adult age, and the state never changes a figure that has not got it set", () => {
    for (const age of AGES) {
      const macros = { ...base().macros, age };
      expect(reach(surfaced, withOrgan({}, macros), { arousal: 1 })).toBeGreaterThan(
        reach(surfaced, withOrgan({}, macros), { arousal: 0 }),
      );
      // A figure with no organ: its size set to none. Left unset, an adult takes the pack's
      // default anatomy for its gender (`AdultAnatomySpec.defaults`) and has one.
      const recipe = createRecipe({ macros, modifiers: { [SIZE]: 0, "genitals/testes-size": 0 } });
      const rest = surfaced.evaluate(recipe).positions;
      expect(Array.from(surfaced.evaluate(recipe, { arousal: 1 }).positions)).toEqual(
        Array.from(rest),
      );
    }
  });

  it("has no vulva state morph yet: a female-macro figure's aroused surface equals its rest surface", () => {
    // The vulva's engorgement has no CC0 target and no verified magnitude
    // (docs/research/ADULT-ANATOMY-DATA.md, "Arousal"), so until the sculpt
    // adds the vulva it is documented as absent rather than guessed. This pins
    // the gap: when the vulva morph lands this test is replaced by a
    // measurement of it, not silently passed.
    const recipe = createRecipe({ macros: { age: 30, gender: 0 } });
    const rest = control.evaluate(recipe);
    const aroused = control.evaluate(recipe, { arousal: 1 });
    expect(Array.from(aroused.positions)).toEqual(Array.from(rest.positions));
  });
});
