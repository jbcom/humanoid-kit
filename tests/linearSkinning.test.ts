import {
  BufferAttribute,
  BufferGeometry,
  MeshStandardMaterial,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  applyLinearSkinning,
  LINEAR_SKINNING_KEY,
  linearShadowMaterials,
  SKIN_INDEX_ATTRIBUTE_1,
  SKIN_WEIGHT_ATTRIBUTE_1,
} from "../src/render/dualSkinning.ts";

function shaderFor(): WebGLProgramParametersWithUniforms {
  return {
    name: "linear-skinning-test",
    uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe("a host body material's eight-place linear skinning", () => {
  it("keeps the host hooks and program cache while compiling every influence without dual skinning", () => {
    const material = new MeshStandardMaterial();
    const ownCompile = vi.fn((shader: WebGLProgramParametersWithUniforms) => {
      shader.vertexShader = `// host compile\n${shader.vertexShader}`;
    });
    const ownRender = vi.fn();
    material.onBeforeCompile = ownCompile;
    material.onBeforeRender = ownRender;
    material.customProgramCacheKey = () => "host-key";
    const release = applyLinearSkinning(material);

    const shader = shaderFor();
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(ownCompile).toHaveBeenCalledOnce();
    expect(shader.vertexShader.startsWith("// host compile\n")).toBe(true);
    expect(shader.vertexShader).toContain(`attribute vec4 ${SKIN_INDEX_ATTRIBUTE_1}`);
    expect(shader.vertexShader).toContain(`attribute vec4 ${SKIN_WEIGHT_ATTRIBUTE_1}`);
    expect(shader.vertexShader).toContain("for ( int k = 0; k < 8; k ++ )");
    expect(shader.vertexShader).toContain("mat4 hkLinear = hkLinearMatrix()");
    expect(shader.vertexShader).not.toContain("hkDualBones");
    expect(material.customProgramCacheKey()).toBe(`host-key|${LINEAR_SKINNING_KEY}`);

    const geometry = new BufferGeometry();
    geometry.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(4), 4));
    material.onBeforeRender(
      {} as WebGLRenderer,
      null as never,
      null as never,
      geometry,
      null as never,
      null as never,
    );
    expect(geometry.getAttribute(SKIN_INDEX_ATTRIBUTE_1)).toBeDefined();
    expect(geometry.getAttribute(SKIN_WEIGHT_ATTRIBUTE_1)).toBeDefined();
    expect(ownRender).toHaveBeenCalledOnce();

    release();
    expect(material.onBeforeCompile).toBe(ownCompile);
    expect(material.onBeforeRender).toBe(ownRender);
    expect(material.customProgramCacheKey()).toBe("host-key");
  });

  it("keeps a shared host material patched until its final figure releases it", () => {
    const material = new MeshStandardMaterial();
    const ownCompile = material.onBeforeCompile;
    const ownRender = material.onBeforeRender;
    const ownKey = material.customProgramCacheKey;
    const releaseFirst = applyLinearSkinning(material);
    const releaseSecond = applyLinearSkinning(material);

    releaseFirst();
    expect(material.customProgramCacheKey()).toContain(LINEAR_SKINNING_KEY);
    releaseSecond();
    expect(material.onBeforeCompile).toBe(ownCompile);
    expect(material.onBeforeRender).toBe(ownRender);
    expect(material.customProgramCacheKey).toBe(ownKey);
  });

  it("gives a host body material's dedicated depth and distance shaders all eight linear influences", () => {
    const shadows = linearShadowMaterials();
    for (const material of [shadows.depth, shadows.distance]) {
      const shader = {
        name: "linear-shadow-test",
        uniforms: {},
        vertexShader: ShaderLib.depth.vertexShader,
        fragmentShader: ShaderLib.depth.fragmentShader,
      } as unknown as WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      expect(shader.vertexShader).toContain("for ( int k = 0; k < 8; k ++ )");
      expect(shader.vertexShader).not.toContain("hkDualBones");
      expect(material.customProgramCacheKey()).toContain(LINEAR_SKINNING_KEY);
      material.dispose();
    }
  });
});
