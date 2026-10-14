import { BufferGeometry, Float32BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import type { FluidCoverageSnapshot } from "../src/fluid/attachedField.ts";
import { bindFluidWetFilmCoverage, FLUID_COVERAGE_ATTRIBUTE } from "../src/render/fluidCoverage.ts";
import { SkinMaterial } from "../src/render/skinMaterial.ts";

const geometry = () => {
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  return out;
};

const snapshot = (materialId: "water" | "sweat", vertexCoverage: readonly number[]) =>
  Object.freeze({
    version: 1 as const,
    topology: "body",
    bodySha256: "sha",
    surface: "base" as const,
    units: Object.freeze({ mass: "kg", area: "m2", arealMassDensity: "kg/m2", position: "m" }),
    attachedKg: 0.25,
    cells: Object.freeze([]),
    materials: Object.freeze([
      Object.freeze({
        materialId,
        attachedKg: 0.25,
        coveredAreaM2: 0.5,
        vertexCoverage: Object.freeze([...vertexCoverage]),
      }),
    ]),
  }) satisfies FluidCoverageSnapshot;

describe("fluid wet-film rendering bridge", () => {
  it("keeps dry materials byte-equivalent and binds wet coverage per figure", () => {
    const dry = new SkinMaterial();
    const wet = new SkinMaterial();
    const baseline = dry.customProgramCacheKey();
    const dryGeometry = geometry();
    const wetGeometry = geometry();

    bindFluidWetFilmCoverage(dry, dryGeometry, null);
    bindFluidWetFilmCoverage(wet, wetGeometry, snapshot("water", [0, 0.25, 1, 0.5]));

    expect(dry.customProgramCacheKey()).toBe(baseline);
    expect(dryGeometry.getAttribute(FLUID_COVERAGE_ATTRIBUTE)).toBeUndefined();
    expect(wet.customProgramCacheKey()).toContain("-fluid");
    expect(Array.from(wetGeometry.getAttribute(FLUID_COVERAGE_ATTRIBUTE)?.array ?? [])).toEqual([
      0, 0.25, 1, 0.5,
    ]);

    dryGeometry.dispose();
    wetGeometry.dispose();
    dry.dispose();
    wet.dispose();
  });

  it("does not share coverage buffers between figures and accepts the sweat wet-film path", () => {
    const firstMaterial = new SkinMaterial();
    const secondMaterial = new SkinMaterial();
    const firstGeometry = geometry();
    const secondGeometry = geometry();
    bindFluidWetFilmCoverage(firstMaterial, firstGeometry, snapshot("water", [1, 0, 0, 0]));
    bindFluidWetFilmCoverage(
      secondMaterial,
      secondGeometry,
      snapshot("sweat", [0, 0, 0, 1]),
      "sweat",
    );

    const first = firstGeometry.getAttribute(FLUID_COVERAGE_ATTRIBUTE);
    const second = secondGeometry.getAttribute(FLUID_COVERAGE_ATTRIBUTE);
    expect(first).not.toBe(second);
    expect(first?.array).not.toBe(second?.array);
    (first?.array as Float32Array)[0] = 0.5;
    expect(second?.getX(0)).toBe(0);
    expect(second?.getX(3)).toBe(1);

    firstGeometry.dispose();
    secondGeometry.dispose();
    firstMaterial.dispose();
    secondMaterial.dispose();
  });

  it("rejects reusing a material or geometry for another figure", () => {
    const firstMaterial = new SkinMaterial();
    const secondMaterial = new SkinMaterial();
    const firstGeometry = geometry();
    const secondGeometry = geometry();
    bindFluidWetFilmCoverage(firstMaterial, firstGeometry, snapshot("water", [1, 0, 0, 0]));

    expect(() =>
      bindFluidWetFilmCoverage(firstMaterial, secondGeometry, snapshot("water", [0, 1, 0, 0])),
    ).toThrow("distinct SkinMaterial");
    expect(() =>
      bindFluidWetFilmCoverage(secondMaterial, firstGeometry, snapshot("water", [0, 1, 0, 0])),
    ).toThrow("distinct geometry");

    firstGeometry.dispose();
    secondGeometry.dispose();
    firstMaterial.dispose();
    secondMaterial.dispose();
  });

  it("replaces a figure's per-vertex coverage from its next posed snapshot", () => {
    const material = new SkinMaterial();
    const body = geometry();
    bindFluidWetFilmCoverage(material, body, snapshot("water", [1, 1, 1, 0]));
    const attribute = body.getAttribute(FLUID_COVERAGE_ATTRIBUTE);

    bindFluidWetFilmCoverage(material, body, snapshot("water", [0, 1, 1, 1]));

    expect(body.getAttribute(FLUID_COVERAGE_ATTRIBUTE)).toBe(attribute);
    expect(Array.from(attribute?.array ?? [])).toEqual([0, 1, 1, 1]);

    body.dispose();
    material.dispose();
  });

  it("rejects a snapshot whose units or render-vertex count cannot drive this geometry", () => {
    const material = new SkinMaterial();
    const body = geometry();
    const wrongUnits = {
      ...snapshot("water", [0, 0, 0, 1]),
      units: { mass: "g", area: "m2", arealMassDensity: "kg/m2", position: "m" },
    };
    expect(() => bindFluidWetFilmCoverage(material, body, wrongUnits as never)).toThrow("units");
    expect(() => bindFluidWetFilmCoverage(material, body, snapshot("water", [0, 1]))).toThrow(
      "vertex count",
    );

    body.dispose();
    material.dispose();
  });
});
