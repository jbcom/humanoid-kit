/**
 * The foundation's permutations (src/foundation/permutations.ts) and their
 * recipes (src/foundation/recipe.ts): each tier's size and order, every pose
 * one the body pack has, and adult anatomy on adults alone, by type, by
 * construction and through the age policy.
 */
import { describe, expect, it } from "vitest";
import type { BatteryBody } from "../src/foundation/battery.ts";
import {
  FOUNDATION_POSES,
  type FoundationPermutation,
  foundationPermutations,
  SMOKE_POSES,
} from "../src/foundation/permutations.ts";
import { anatomyModifiers, foundationRecipe } from "../src/foundation/recipe.ts";
import { agePolicyViolations } from "../src/recipe/agePolicy.ts";
import { adultManifest, bodyManifest } from "./fixtures.ts";

const smoke = foundationPermutations("smoke");
const full = foundationPermutations("full");

describe("the foundation's permutations", () => {
  it("are the cross set's extremes × three tones × four poses in the smoke tier", () => {
    // Six bodies (five adults at the default anatomy, the child at none) × 3 × 4.
    expect(smoke).toHaveLength(6 * 3 * 4);
    expect(new Set(smoke.map((p) => p.pose.name))).toEqual(new Set(SMOKE_POSES));
    expect(new Set(smoke.map((p) => p.tone.name))).toEqual(new Set(["tone-1", "tone-3", "tone-6"]));
  });

  it("are every body × tone × pose, adults at three anatomy sizes, in the full tier", () => {
    const poses = FOUNDATION_POSES.length;
    expect(full).toHaveLength(16 * 6 * poses * 3 + 2 * 6 * poses);
    // The smoke tier is part of the full one.
    const ids = new Set(full.map((p) => p.id));
    for (const p of smoke) expect(ids.has(p.id), p.id).toBe(true);
  });

  it("name each permutation once", () => {
    for (const tier of [smoke, full]) expect(new Set(tier.map((p) => p.id)).size).toBe(tier.length);
  });

  it("pose only with whole-body poses the body pack has", () => {
    const packed = new Set(bodyManifest.poses.map((p: { name: string }) => p.name));
    for (const name of FOUNDATION_POSES) expect(packed.has(name), name).toBe(true);
  });

  it("give an anatomy to every adult and to no one under 18", () => {
    for (const p of full) {
      expect(p.body.adult, p.id).toBe(p.body.macros.age >= 18);
      expect(p.anatomy === null, p.id).toBe(!p.body.adult);
    }
  });

  it("refuse an anatomy on a body under 18 by type", () => {
    const child: BatteryBody<false> = { name: "child", macros: { age: 6 }, adult: false };
    const tone = { name: "tone-1", melanin: 0.05 };
    const allowed: FoundationPermutation = {
      id: "child",
      body: child,
      tone,
      pose: { name: "tpose" },
      anatomy: null,
    };
    // @ts-expect-error: a body under 18 takes no anatomy
    const refused: FoundationPermutation = { ...allowed, anatomy: "max" };
    expect(refused.body.adult).toBe(false);
  });
});

describe("a permutation's recipe", () => {
  it("is its body's macros and its tone, and passes the age policy for every permutation", () => {
    for (const p of full) {
      const r = foundationRecipe(p, adultManifest);
      expect(r.skin.melanin, p.id).toBe(p.tone.melanin);
      expect(r.macros.age, p.id).toBe(p.body.macros.age);
      expect(agePolicyViolations(r), p.id).toEqual([]);
    }
  });

  it("sets every adult anatomy modifier the pack names to its ends at the extremes, none at the default", () => {
    expect(anatomyModifiers(adultManifest, "default")).toEqual({});
    const max = anatomyModifiers(adultManifest, "max");
    const min = anatomyModifiers(adultManifest, "min");
    const named = (adultManifest.anatomy?.features ?? []).flatMap((f) => [...f.modifiers]);
    expect(named.length).toBeGreaterThan(0);
    expect(Object.keys(max).sort()).toEqual([...named].sort());
    for (const id of named) {
      expect(max[id], id).toBe(1);
      const lo = adultManifest.modifiers.find((m) => m.id === id)?.lo;
      expect(min[id], id).toBe(lo === null ? 0 : -1);
    }
  });

  it("needs the adult pack only for an anatomy extreme", () => {
    const extreme = full.find((p) => p.anatomy === "max") as FoundationPermutation;
    expect(() => foundationRecipe(extreme)).toThrow(/adult pack/);
    const minor = full.find((p) => p.anatomy === null) as FoundationPermutation;
    expect(foundationRecipe(minor).modifiers).toEqual({});
  });
});
