/**
 * The tent filter belongs to the kit's own materials and to the ones a consumer opts in
 * (`render/shadowFilter.ts`, `docs/ARCHITECTURE.md`, "The key light's shadow"): a library
 * must not change how the host app's other lights and materials are drawn. three's
 * shadow-read code is a shared `ShaderChunk`, so the filter is spliced into the shaders of
 * the materials it is for, never into the chunk. What the render looks like is measured in
 * the browser (`tests/browser/shadowScope.test.ts`); here, that nothing global moves and
 * that every material the kit makes is patched and no other is.
 */
import {
  DirectionalLight,
  Group,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderChunk,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";
import {
  createAttachmentMaterial,
  NailPlateMaterial,
  TeethMaterial,
} from "../src/render/attachmentLook.ts";
import { CoatMaterial } from "../src/render/coat.ts";
import { DecalMaterial } from "../src/render/decalMaterial.ts";
import { EyeMaterial } from "../src/render/eyeMaterial.ts";
import { HairMaterial } from "../src/render/hairMaterial.ts";
import { AttachmentStandardMaterial } from "../src/render/occlusion.ts";
import {
  applyShadowFilter,
  patchShadowFilter,
  SHADOW_FILTER_MARK,
} from "../src/render/shadowFilter.ts";
import { SkinMaterial } from "../src/render/skinMaterial.ts";
import { configureKeyShadow, keyShadowFitter } from "../src/render/studioShadow.ts";

/** Every ShaderChunk three ships, as it was before this file ran anything. */
const STOCK_CHUNKS = { ...ShaderChunk };

/** The shader three hands `onBeforeCompile`: a program's templates, includes not yet resolved. */
function shaderFor(material: MeshStandardMaterial): WebGLProgramParametersWithUniforms {
  const lib = material instanceof MeshPhysicalMaterial ? ShaderLib.physical : ShaderLib.standard;
  return {
    name: "test",
    uniforms: {},
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
}

/** The fragment shader `material` compiles with, and the program key it caches it under. */
function compiled(material: MeshStandardMaterial): { fragment: string; key: string } {
  const shader = shaderFor(material);
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return { fragment: shader.fragmentShader, key: material.customProgramCacheKey() };
}

const STOCK = ShaderChunk.shadowmap_pars_fragment;

/** Asserts no ShaderChunk differs from the stock set: not its names, not its source. */
function expectChunksStock(): void {
  expect(Object.keys(ShaderChunk).sort()).toEqual(Object.keys(STOCK_CHUNKS).sort());
  for (const [name, source] of Object.entries(STOCK_CHUNKS))
    expect(ShaderChunk[name as keyof typeof ShaderChunk], name).toBe(source);
  expect(ShaderChunk.shadowmap_pars_fragment).not.toContain(SHADOW_FILTER_MARK);
}

describe("the key light's shadow touches nothing global", () => {
  it("leaves every ShaderChunk as three ships it once the stage's key light is set up and fitted", () => {
    const light = new DirectionalLight();
    light.castShadow = true;
    configureKeyShadow(light);
    keyShadowFitter()(light, new Group());
    expectChunksStock();
  });

  it("and once the kit's materials, and a consumer's opted in, have compiled", () => {
    for (const material of [
      new SkinMaterial(),
      new CoatMaterial(),
      new HairMaterial(),
      new EyeMaterial(),
      new DecalMaterial(),
      applyShadowFilter(new MeshStandardMaterial()),
    ])
      compiled(material as MeshStandardMaterial);
    expectChunksStock();
  });
});

describe("patchShadowFilter", () => {
  it("swaps the percentage-closer read in the shader's own copy of the shadow chunk", () => {
    const shader = shaderFor(new MeshStandardMaterial());
    expect(shader.fragmentShader).toContain("#include <shadowmap_pars_fragment>");
    patchShadowFilter(shader);
    expect(shader.fragmentShader).not.toContain("#include <shadowmap_pars_fragment>");
    expect(shader.fragmentShader).toContain(SHADOW_FILTER_MARK);
    // The other filters and the point lights' read stay three's.
    expect(shader.fragmentShader).toContain("SHADOWMAP_TYPE_VSM");
    expect(shader.fragmentShader).toContain("float getPointShadow( samplerCubeShadow");
    expect(shader.fragmentShader).not.toContain("vogelDiskSample( 0, 5, phi ) * radius");
  });

  it("is idempotent", () => {
    const shader = shaderFor(new MeshStandardMaterial());
    patchShadowFilter(shader);
    const once = shader.fragmentShader;
    patchShadowFilter(shader);
    expect(shader.fragmentShader).toBe(once);
  });

  it("leaves a shader with no shadow read as it is", () => {
    const shader = { fragmentShader: "void main() {}" };
    patchShadowFilter(shader);
    expect(shader.fragmentShader).toBe("void main() {}");
  });

  it("fails loudly when three's chunk no longer has the one read it replaces", () => {
    ShaderChunk.shadowmap_pars_fragment = "// moved";
    try {
      expect(() =>
        patchShadowFilter({ fragmentShader: "#include <shadowmap_pars_fragment>" }),
      ).toThrow(/no longer has the one PCF getShadow/);
    } finally {
      ShaderChunk.shadowmap_pars_fragment = STOCK;
    }
  });
});

describe("applyShadowFilter", () => {
  it("opts a consumer's material in: its shader and its program key change", () => {
    const stock = compiled(new MeshStandardMaterial());
    const material = new MeshStandardMaterial();
    expect(applyShadowFilter(material)).toBe(material);
    const opted = compiled(material);
    expect(opted.fragment).toContain(SHADOW_FILTER_MARK);
    // A program is cached by its key, so the filtered one must not be taken for the stock one.
    expect(opted.key).not.toBe(stock.key);
  });

  it("keeps what the material already patches, and its key", () => {
    const material = new MeshStandardMaterial();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// own\n${shader.fragmentShader}`;
    };
    material.customProgramCacheKey = () => "own";
    applyShadowFilter(material);
    const { fragment, key } = compiled(material);
    expect(fragment.startsWith("// own\n")).toBe(true);
    expect(fragment).toContain(SHADOW_FILTER_MARK);
    expect(key.startsWith("own")).toBe(true);
  });

  it("is idempotent", () => {
    const material = applyShadowFilter(new MeshStandardMaterial());
    const once = compiled(material);
    applyShadowFilter(material);
    expect(compiled(material)).toEqual(once);
  });

  it("does not touch another material, nor a class's own prototype", () => {
    applyShadowFilter(new MeshStandardMaterial());
    const other = new MeshStandardMaterial();
    expect(compiled(other).fragment).not.toContain(SHADOW_FILTER_MARK);
    expect(compiled(other).fragment).toContain("#include <shadowmap_pars_fragment>");
    const same = new MeshStandardMaterial();
    expect(other.customProgramCacheKey()).toBe(same.customProgramCacheKey());
  });

  it("passes a material that reads no shadow (unlit) through unchanged", () => {
    const basic = applyShadowFilter(new MeshBasicMaterial());
    const shader = {
      name: "basic",
      uniforms: {},
      vertexShader: "",
      fragmentShader: ShaderLib.basic.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms;
    basic.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.fragmentShader).toBe(ShaderLib.basic.fragmentShader);
  });
});

describe("the kit's own materials read their shadows through the tent", () => {
  const materials: [string, () => MeshStandardMaterial][] = [
    ["SkinMaterial", () => new SkinMaterial()],
    ["CoatMaterial", () => new CoatMaterial()],
    ["HairMaterial", () => new HairMaterial()],
    ["EyeMaterial", () => new EyeMaterial()],
    ["DecalMaterial", () => new DecalMaterial()],
    ["AttachmentStandardMaterial", () => new AttachmentStandardMaterial()],
    ["TeethMaterial", () => new TeethMaterial()],
    ["NailPlateMaterial", () => new NailPlateMaterial()],
    [
      "an attachment from the pack",
      () =>
        createAttachmentMaterial("tongue", {
          color: [1, 0.5, 0.5],
          roughness: 0.6,
          texture: null,
          transparent: false,
          alphaToCoverage: false,
          backfaceCull: true,
        }),
    ],
  ];

  for (const [name, make] of materials)
    it(`${name}: patched, and cached apart from three's own program`, () => {
      const kit = compiled(make());
      expect(kit.fragment).toContain(SHADOW_FILTER_MARK);
      expect(kit.fragment).not.toContain("#include <shadowmap_pars_fragment>");
      expect(kit.key).toContain("tent-shadow");
    });
});
