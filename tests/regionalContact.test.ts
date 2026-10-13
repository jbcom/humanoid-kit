import { describe, expect, it } from "vitest";
import {
  affordances,
  assertRegionalContact,
  createRecipe,
  type RegionalContact,
} from "../src/index.ts";

const own = affordances(createRecipe({ macros: { age: 25 } }));

const surface = (): RegionalContact => ({
  region: "finger-pad-1.R",
  topology: "surface",
  location: [0, 1, 2],
  normal: [0, 1, 0],
  force: 0,
  duration: 0,
  contactPhase: "begin",
});

describe("regional contact contract", () => {
  it("accepts a finite, unit-normal surface report without creating an aperture", () => {
    expect(() => assertRegionalContact(surface(), own)).not.toThrow();
  });

  it("accepts an entry only at a registered aperture with an explicit depth", () => {
    expect(() =>
      assertRegionalContact(
        {
          ...surface(),
          region: "ear-canal.L",
          topology: "aperture-entry",
          depth: 0.01,
          contactPhase: "sustain",
        },
        own,
      ),
    ).not.toThrow();
  });

  it("rejects a surface report at an aperture and an entry at a surface", () => {
    expect(() => assertRegionalContact({ ...surface(), region: "mouth" }, own)).toThrow(
      "mouth is an aperture",
    );
    expect(() =>
      assertRegionalContact({ ...surface(), topology: "aperture-entry", depth: 0 }, own),
    ).toThrow("finger-pad-1.R is not an aperture");
  });

  it("rejects malformed evidence instead of normalizing or inventing a response", () => {
    expect(() => assertRegionalContact({ ...surface(), normal: [0, 2, 0] }, own)).toThrow(
      "normal must be a unit vector",
    );
    expect(() => assertRegionalContact({ ...surface(), force: -1 }, own)).toThrow(
      "force must be non-negative",
    );
    expect(() => assertRegionalContact({ ...surface(), duration: -1 }, own)).toThrow(
      "duration must be non-negative",
    );
    expect(() =>
      assertRegionalContact(
        { ...surface(), region: "nostril.R", topology: "aperture-entry", depth: -1 },
        own,
      ),
    ).toThrow("depth must be non-negative");
  });
});
