import { Texture } from "three";
import { describe, expect, it } from "vitest";
import { ageAxis } from "../src/makehuman/macro.ts";
import { SkinMaterial } from "../src/render/skinMaterial.ts";
import { ageSurfaceSex, ageSurfaceStrength } from "../src/surface/ageSurface.ts";

const appearance = (age: number, gender = 0.5) => ({
  tone: { melanin: 0.3, haemoglobin: 0.5, undertone: 0, override: null },
  age,
  build: { gender },
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
  signals: {},
});

const map = () => {
  const t = new Texture();
  t.image = { width: 2048, height: 2048 };
  return t;
};

describe("ageSurfaceStrength", () => {
  it("is zero through the adult body (MakeHuman's 25), so 18 shows nothing", () => {
    for (let age = 1; age <= 25; age += 0.5) expect(ageSurfaceStrength(age)).toBe(0);
    expect(ageSurfaceStrength(18)).toBe(0);
    expect(ageSurfaceStrength(undefined)).toBe(0);
  });

  it("is MakeHuman's weight of its old body, rising smoothly and monotonically to 1 at 90", () => {
    let previous = 0;
    for (let age = 1; age <= 90; age += 0.25) {
      const s = ageSurfaceStrength(age);
      const old = ageAxis(age).find(([anchor]) => anchor === "old")?.[1] ?? 0;
      expect(s).toBeCloseTo(old, 12);
      expect(s).toBeGreaterThanOrEqual(previous);
      // No step: a quarter year moves it by at most a quarter of 1/65.
      expect(s - previous).toBeLessThanOrEqual(0.25 / 65 + 1e-9);
      previous = s;
    }
    expect(ageSurfaceStrength(90)).toBe(1);
    expect(ageSurfaceStrength(50)).toBeCloseTo(25 / 65, 9);
    expect(ageSurfaceStrength(70)).toBeCloseTo(45 / 65, 9);
    expect(ageSurfaceStrength(85)).toBeCloseTo(60 / 65, 9);
  });

  it("mixes the photographs by the gender macro, clamped", () => {
    expect(ageSurfaceSex(1)).toBe(1);
    expect(ageSurfaceSex(0)).toBe(0);
    expect(ageSurfaceSex(undefined)).toBe(0.5);
    expect(ageSurfaceSex(2)).toBe(1);
  });
});

describe("SkinMaterial age surface", () => {
  it("compiles the creases in only for a figure old enough, with the map", () => {
    const plain = new SkinMaterial();
    plain.setAppearance(appearance(18));
    const young = new SkinMaterial();
    young.setAgeSurface(map());
    young.setAppearance(appearance(18));
    // At 18 the shader is the one a figure without the map draws with.
    expect(young.showsAgeSurface).toBe(false);
    expect(young.defines?.HK_AGE_SURFACE).toBeUndefined();
    expect(young.customProgramCacheKey()).toBe(plain.customProgramCacheKey());

    young.setAppearance(appearance(70, 1));
    expect(young.showsAgeSurface).toBe(true);
    expect(young.defines?.HK_AGE_SURFACE).toBe("");
    expect(young.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    const u = young.hkUniforms.hkAgeSurface.value;
    expect(u.x).toBeCloseTo(45 / 65, 6);
    expect(u.y).toBe(1);
    expect(u.z).toBeCloseTo(1 / 2048, 9);

    // Without the map, or younger again, it is off.
    young.setAgeSurface(null);
    expect(young.defines?.HK_AGE_SURFACE).toBeUndefined();
    young.setAgeSurface(map());
    young.setAppearance(appearance(25));
    expect(young.defines?.HK_AGE_SURFACE).toBeUndefined();
    expect(young.customProgramCacheKey()).toBe(plain.customProgramCacheKey());
  });
});
