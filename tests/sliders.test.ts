import { describe, expect, it } from "vitest";
import { modifierLabel } from "../scripts/lib/sliders.ts";
import { mergeSliderTasks, type SliderTask } from "../src/format/assetFormat.ts";
import { DEFAULT_MACROS } from "../src/makehuman/macro.ts";
import { adultManifest, bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const sliderIds = (tasks: SliderTask[]) =>
  tasks.flatMap((t) => t.groups.flatMap((g) => g.sliders.map((s) => s.id)));

describe("slider taxonomy", () => {
  it("gives every packed modifier exactly one slider, and every slider something to drive", () => {
    const assets = loadFixtureAssets(true);
    const ids = sliderIds(assets.sliders);
    expect(new Set(ids).size).toBe(ids.length);
    const modifierSliders = assets.sliders.flatMap((t) =>
      t.groups.flatMap((g) => g.sliders.filter((s) => s.kind === "modifier").map((s) => s.id)),
    );
    expect(new Set(modifierSliders)).toEqual(new Set(assets.modifiers.keys()));
    for (const t of assets.sliders)
      for (const g of t.groups)
        for (const s of g.sliders)
          if (s.kind === "macro") expect(Object.keys(DEFAULT_MACROS)).toContain(s.id);
  });

  it("keeps adult anatomy sliders out of the body pack", () => {
    const adult = new Set(adultManifest.modifiers.map((m) => m.id));
    expect(adult.size).toBeGreaterThan(0);
    for (const id of sliderIds(bodyManifest.sliders)) expect(adult.has(id), id).toBe(false);
    expect(new Set(sliderIds(adultManifest.sliders))).toEqual(adult);
  });

  it("offers only body sliders when the adult pack is not loaded", () => {
    const core = loadFixtureAssets(false).sliders;
    expect(new Set(sliderIds(core))).toEqual(new Set(sliderIds(bodyManifest.sliders)));
    // In MakeHuman's tab order, not the manifest's file order.
    expect(core.map((t) => t.id)).toEqual([
      "Macro modelling",
      "Gender",
      "Face",
      "Torso",
      "Arms and Legs",
      "Measure",
      "Body shapes",
    ]);
  });

  it("merges adult sliders into their upstream task, group and position", () => {
    const merged = loadFixtureAssets(true).sliders;
    const gender = merged.find((t) => t.id === "Gender");
    expect(gender?.groups.map((g) => g.id)).toEqual(["Breast", "Genitals"]);
    const torso = merged.find((t) => t.id === "Torso");
    for (const g of torso?.groups ?? []) {
      const orders = g.sliders.map((s) => s.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
    expect(merged.map((t) => t.id)).toEqual([
      "Macro modelling",
      "Gender",
      "Face",
      "Torso",
      "Arms and Legs",
      "Measure",
      "Body shapes",
    ]);
  });

  it("does not modify its inputs", () => {
    const body = structuredClone(bodyManifest.sliders);
    const adult = structuredClone(adultManifest.sliders);
    mergeSliderTasks(body, adult);
    expect(body).toEqual(bodyManifest.sliders);
    expect(adult).toEqual(adultManifest.sliders);
  });

  it("labels unlabelled modifiers readably", () => {
    expect(modifierLabel("head/head-fat-decr|incr")).toBe("Head fat");
    expect(modifierLabel("eyes/r-eye-bag-decr|incr")).toBe("Right eye bag");
    expect(modifierLabel("head/head-oval")).toBe("Head oval");
  });
});
