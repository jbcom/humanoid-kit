import { BufferGeometry, Float32BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import type { FluidCoverageSnapshot } from "../src/fluid/attachedField.ts";
import { bindFluidWetFilmCoverage } from "../src/render/fluidCoverage.ts";
import { SkinMaterial } from "../src/render/skinMaterial.ts";

const geometry = () => {
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  out.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  out.setIndex([0, 1, 2, 1, 3, 2]);
  return out;
};

const snapshot = (
  materialId: "water" | "sweat",
  vertexCoverage: readonly number[],
  triangles: readonly number[] = [0],
) =>
  Object.freeze({
    version: 1 as const,
    topology: "body",
    bodySha256: "sha",
    surface: "base" as const,
    units: Object.freeze({ mass: "kg", area: "m2", arealMassDensity: "kg/m2", position: "m" }),
    attachedKg: 0.25,
    cells: Object.freeze(
      triangles.map((triangle) =>
        Object.freeze({
          triangle,
          materialId,
          massKg: 0.25 / triangles.length,
          supportAreaM2: 0.5,
          arealMassDensityKgPerM2: 0.5 / triangles.length,
          coverage: 1 as const,
          positionM: Object.freeze([0, 0, 0] as const),
          normal: Object.freeze([0, 0, 1] as const),
        }),
      ),
    ),
    materials: Object.freeze([
      Object.freeze({
        materialId,
        attachedKg: 0.25,
        coveredAreaM2: 0.5,
        vertexCoverage: Object.freeze([...vertexCoverage]),
      }),
    ]),
  }) satisfies FluidCoverageSnapshot;

const mask = (material: SkinMaterial) => {
  const texture = material.hkUniforms.hkFluidCoverage.value;
  if (!texture) throw new Error("expected a fluid coverage texture");
  return (texture as { image: { data: Uint8Array } }).image.data;
};

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
    expect(dry.hkUniforms.hkFluidCoverage.value).toBeNull();
    expect(wet.customProgramCacheKey()).toContain("-fluid");
    expect(mask(wet).some((value) => value === 255)).toBe(true);

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

    const first = mask(firstMaterial);
    const second = mask(secondMaterial);
    expect(first).not.toBe(second);
    first[0] = 127;
    expect(second[0]).not.toBe(127);

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
    const texture = material.hkUniforms.hkFluidCoverage.value;
    const before = Array.from(mask(material));

    bindFluidWetFilmCoverage(material, body, snapshot("water", [0, 1, 1, 1], [1]));

    expect(material.hkUniforms.hkFluidCoverage.value).toBe(texture);
    expect(Array.from(mask(material))).not.toEqual(before);

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
