import { describe, expect, it } from "vitest";
import { sameEntries } from "../src/react/sameEntries.ts";

describe("sameEntries", () => {
  it("holds for a new record with the same entries in any order", () => {
    expect(sameEntries({ JawDrop: 1, Smile: 0.5 }, { Smile: 0.5, JawDrop: 1 })).toBe(true);
    expect(sameEntries(undefined, undefined)).toBe(true);
  });

  it("fails on a changed, added, missing or renamed entry", () => {
    expect(sameEntries({ JawDrop: 1 }, { JawDrop: 0.5 })).toBe(false);
    expect(sameEntries({ JawDrop: 1 }, { JawDrop: 1, Smile: 0 })).toBe(false);
    expect(sameEntries({ JawDrop: 1, Smile: 0 }, { JawDrop: 1 })).toBe(false);
    expect(sameEntries({ JawDrop: 1 }, { Smile: 1 })).toBe(false);
    expect(sameEntries({ JawDrop: 1 }, undefined)).toBe(false);
    expect(sameEntries(undefined, {})).toBe(false);
  });
});
