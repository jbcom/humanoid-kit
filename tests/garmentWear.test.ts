import {
  MeshStandardMaterial,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";
import { GARMENT_DUST, garmentFinish } from "../src/model/garmentLook.ts";
import { applyGarmentWear } from "../src/render/attachmentLook.ts";

function compile(material: MeshStandardMaterial): WebGLProgramParametersWithUniforms {
  const shader = {
    name: "test",
    uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

describe("a garment material's wear", () => {
  it("wears the albedo after the texture is applied, as wornAlbedo does", () => {
    const material = new MeshStandardMaterial();
    applyGarmentWear(material);
    const { fragmentShader } = compile(material);
    const map = fragmentShader.indexOf("#include <map_fragment>");
    // Its use, not its declaration above main().
    const wear = fragmentShader.lastIndexOf("hkWearFade");
    expect(map).toBeGreaterThan(0);
    expect(wear).toBeGreaterThan(map);
  });

  it("takes a new finish through its uniforms, without recompiling", () => {
    const material = new MeshStandardMaterial();
    const wear = applyGarmentWear(material);
    const shader = compile(material);
    const key = material.customProgramCacheKey();
    const version = material.version;
    wear.set(garmentFinish({ color: [1, 1, 1], roughness: 0.5 }, { wear: 1 }));
    expect(shader.uniforms.hkWearFade?.value).toBeGreaterThan(0);
    expect(shader.uniforms.hkWearDust?.value).toBeGreaterThan(0);
    expect(shader.uniforms.hkDustColor?.value.toArray()).toEqual([...GARMENT_DUST]);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(material.version).toBe(version);
  });

  it("keeps what the material already patches", () => {
    const material = new MeshStandardMaterial();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// own\n${shader.fragmentShader}`;
    };
    material.customProgramCacheKey = () => "own";
    applyGarmentWear(material);
    expect(compile(material).fragmentShader.startsWith("// own\n")).toBe(true);
    expect(material.customProgramCacheKey()).toMatch(/^own\|/);
  });
});
