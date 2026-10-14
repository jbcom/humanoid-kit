/**
 * The response sheet's live runtime probe asks CoatMaterial to retain the
 * patched fragment alpha path only in QA mode. This remains a pure compile
 * contract: the sheet is the hardware gate that proves the browser has the
 * actual program and material state.
 */
import { ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { CoatMaterial } from "../src/render/coat.ts";
import { applyDualSkinning, DualBones } from "../src/render/dualSkinning.ts";

function shaderFor(): WebGLProgramParametersWithUniforms {
  return {
    name: "coat-runtime-probe",
    uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe("the coat runtime probe", () => {
  it("skins the comb through the same eight-place normal matrix as the coat", () => {
    const material = new CoatMaterial();
    const bones = new DualBones(1, 1);
    applyDualSkinning(material, bones);
    const shader = shaderFor();
    material.onBeforeCompile(shader, {} as WebGLRenderer);

    const declaration = shader.vertexShader.indexOf("mat4 hkNormalMatrix =");
    const comb = shader.vertexShader.indexOf(
      "hkComb = ( hkNormalMatrix * vec4( hkComb, 0.0 ) ).xyz;",
    );
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(comb).toBeGreaterThan(declaration);
    expect(shader.vertexShader).toContain("#ifdef HK_LINEAR_MATRIX");
    material.dispose();
    bones.dispose();
  });

  it("captures the patched alpha path only under its separate QA program key", () => {
    const material = new CoatMaterial();
    const normalKey = material.customProgramCacheKey();
    expect(material.compiledAlphaProbe()).toBeNull();

    material.setCompileProbe(true);
    expect(material.customProgramCacheKey()).toBe(`${normalKey}|qa-alpha`);
    const shader = shaderFor();
    material.onBeforeCompile(shader, {} as WebGLRenderer);

    const captured = material.compiledAlphaProbe();
    expect(captured?.programKey).toBe(material.customProgramCacheKey());
    expect(captured?.alphaPath).toContain("float hkBases");
    expect(captured?.alphaPath).toContain("float hkWidthScale");
    expect(captured?.alphaPath).toContain("float hkCapsuleEnd");
    expect(captured?.alphaPath).toContain("float hkSides");
    expect(captured?.alphaPath).toContain("float hkFar");
    expect(captured?.alphaPath).toContain("diffuseColor.a = hkCover;");

    material.setCompileProbe(false);
    expect(material.customProgramCacheKey()).toBe(normalKey);
    expect(material.compiledAlphaProbe()).toBeNull();
    material.dispose();
  });
});
