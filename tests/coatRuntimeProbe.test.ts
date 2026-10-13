/**
 * The response sheet's live runtime probe asks CoatMaterial to retain the
 * patched fragment alpha path only in QA mode. This remains a pure compile
 * contract: the sheet is the hardware gate that proves the browser has the
 * actual program and material state.
 */
import { ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { CoatMaterial } from "../src/render/coat.ts";

function shaderFor(): WebGLProgramParametersWithUniforms {
  return {
    name: "coat-runtime-probe",
    uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe("the coat runtime probe", () => {
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
    expect(captured?.alphaPath).toContain("float hkSides");
    expect(captured?.alphaPath).toContain("float hkFar");
    expect(captured?.alphaPath).toContain("diffuseColor.a = hkCover;");

    material.setCompileProbe(false);
    expect(material.customProgramCacheKey()).toBe(normalKey);
    expect(material.compiledAlphaProbe()).toBeNull();
    material.dispose();
  });
});
