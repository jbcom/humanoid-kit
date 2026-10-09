/**
 * Refreshing the field atlas in place when the adult anatomy's fields arrive
 * (src/render/layerAtlas.ts): only the pages holding those layers are
 * re-rasterised, the texture stays the same object, and the skin shader is not
 * recompiled.
 */
import {
  FloatType,
  GLSL3,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  type Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  acquireLayerAtlas,
  buildLayerAtlas,
  type LayerAtlasSource,
} from "../../src/render/layerAtlas.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { densePlan, planAtlas } from "../../src/surface/atlasPlan.ts";
import {
  applyLayers,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
} from "../../src/surface/layers.ts";
import { type Rgb, skinAlbedo } from "../../src/surface/skinTone.ts";

const SIZE = 64;
const canvas = document.createElement("canvas");
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** A full-screen quad whose every layer starts with the given (mask, coord). */
function quadSource(values: [number, number][]): LayerAtlasSource {
  const plane = new PlaneGeometry(2, 2);
  const uv = plane.getAttribute("uv");
  const layerFields = new Float32Array(values.length * uv.count * 2);
  values.forEach(([m, c], l) => {
    for (let v = 0; v < uv.count; v++) {
      layerFields[(l * uv.count + v) * 2] = m;
      layerFields[(l * uv.count + v) * 2 + 1] = c;
    }
  });
  const source = {
    uvs: Float32Array.from(uv.array),
    index: Uint32Array.from(plane.getIndex()?.array ?? []),
    vertexCount: uv.count,
    layerFields,
    layers: values.map((_, l) => `l${l}`),
    plan: densePlan(values.length),
  };
  plane.dispose();
  return source;
}

/** The update that sets layer `ids` to the given constant (mask, coord). */
const update = (source: LayerAtlasSource, values: Record<string, [number, number]>) => {
  const ids = Object.keys(values);
  const layerFields = new Float32Array(ids.length * source.vertexCount * 2);
  ids.forEach((id, k) => {
    const [m, c] = values[id] as [number, number];
    for (let v = 0; v < source.vertexCount; v++) {
      layerFields[(k * source.vertexCount + v) * 2] = m;
      layerFields[(k * source.vertexCount + v) * 2 + 1] = c;
    }
  });
  return { layers: ids, layerFields };
};

/** The texel at the middle of an atlas page. */
function centre(texture: Texture, page: number, size: number): number[] {
  const rt = new WebGLRenderTarget(size, size, { type: FloatType });
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: `in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; uniform highp sampler2DArray atlas; uniform int page;
      out vec4 color; void main() { color = texelFetch(atlas, ivec3(ivec2(gl_FragCoord.xy), page), 0); }`,
    uniforms: { atlas: { value: texture }, page: { value: page } },
    blending: NoBlending,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const out = new Float32Array(4);
  renderer.readRenderTargetPixels(rt, size >> 1, size >> 1, 1, 1, out);
  renderer.setRenderTarget(null);
  mesh.geometry.dispose();
  material.dispose();
  rt.dispose();
  return Array.from(out);
}

describe("refreshing the field atlas in place", () => {
  it("fills the refreshed layers' page and leaves the other pages and the texture alone", () => {
    // l0 and l1 share page 0 and are set; l2 and l3 share page 1 and start empty.
    const source = quadSource([
      [0.5, 0.25],
      [1, 0.75],
      [0, 0],
      [0, 0],
    ]);
    const atlas = buildLayerAtlas(renderer, source, SIZE);
    try {
      const texture = atlas.texture;
      const page0 = centre(texture, 0, SIZE);
      expect(centre(texture, 1, SIZE)).toEqual([0, 0, 0, 0]);
      atlas.refresh(update(source, { l2: [0.8, 0.4], l3: [0.2, 0.6] }));
      expect(atlas.texture).toBe(texture);
      const page1 = centre(texture, 1, SIZE);
      expect(page1[0]).toBeCloseTo(0.8, 2);
      expect(page1[1]).toBeCloseTo(0.4, 2);
      expect(page1[2]).toBeCloseTo(0.2, 2);
      expect(page1[3]).toBeCloseTo(0.6, 2);
      // Page 0 is exactly what it was.
      expect(centre(texture, 0, SIZE)).toEqual(page0);
    } finally {
      atlas.dispose();
    }
  });

  it("keeps a page-mate's fields when only one of the two layers is refreshed", () => {
    const source = quadSource([
      [0.5, 0.25],
      [0, 0],
    ]);
    const atlas = buildLayerAtlas(renderer, source, SIZE);
    try {
      atlas.refresh(update(source, { l1: [1, 0.5] }));
      const p = centre(atlas.texture, 0, SIZE);
      expect(p[0]).toBeCloseTo(0.5, 2);
      expect(p[1]).toBeCloseTo(0.25, 2);
      expect(p[2]).toBeCloseTo(1, 2);
      expect(p[3]).toBeCloseTo(0.5, 2);
    } finally {
      atlas.dispose();
    }
  });

  it("rejects a layer the atlas does not hold and fields of the wrong length", () => {
    const source = quadSource([[0, 0]]);
    const atlas = buildLayerAtlas(renderer, source, SIZE);
    try {
      expect(() => atlas.refresh({ layers: ["nope"], layerFields: new Float32Array(8) })).toThrow(
        /nope/,
      );
      expect(() => atlas.refresh({ layers: ["l0"], layerFields: new Float32Array(3) })).toThrow(
        /fields/,
      );
    } finally {
      atlas.dispose();
    }
  });

  it("applies a shared update once, however many figures hand it over", () => {
    const source = quadSource([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const a = acquireLayerAtlas(renderer, source);
    const b = acquireLayerAtlas(renderer, source);
    try {
      expect(b.texture).toBe(a.texture);
      const u = update(source, { l2: [1, 1] });
      const render = vi.spyOn(renderer, "render");
      a.refresh(u);
      const calls = render.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      b.refresh(u);
      a.refresh(u);
      expect(render.mock.calls.length).toBe(calls);
      render.mockRestore();
      expect(centre(a.texture, 1, SIZE)[0]).toBeCloseTo(1, 2);
    } finally {
      a.release();
      b.release();
    }
  });
});

describe("the skin shader after a refresh", () => {
  const adult: SkinLayer = {
    id: "adult-flat",
    adult: { feature: "penis" },
    blend: "mix",
    targets: [],
    fields: () => ({ mask: new Float32Array(0), coord: null }),
    paint: () => ({ strength: 1, stops: [[0.9, 0.1, 0.1]] }),
  };
  const appearance: SkinPaintInput = {
    tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
    flush: 0.4,
    lips: 0.5,
    areola: 0.5,
    signals: {},
    adult: true,
    anatomy: { penis: 1 },
  };

  /** The material's diffuse colour at the quad's centre. */
  function drawn(material: SkinMaterial, plane: PlaneGeometry): Rgb {
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      compile.call(material, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n\tgl_FragColor = vec4( diffuseColor.rgb, 1.0 );",
      );
    };
    material.customProgramCacheKey = () => "humanoid-kit-skin-test-adult-refresh";
    const scene = new Scene();
    scene.add(new Mesh(plane, material));
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const px = new Float32Array(4);
    renderer.readRenderTargetPixels(target, SIZE >> 1, SIZE >> 1, 1, 1, px);
    renderer.setRenderTarget(null);
    return [px[0] as number, px[1] as number, px[2] as number];
  }

  it("shows the adult layer after the refresh, with no new shader program and the same texture", () => {
    const plane = new PlaneGeometry(2, 2);
    const uv = plane.getAttribute("uv");
    const source: LayerAtlasSource = {
      uvs: Float32Array.from(uv.array),
      index: Uint32Array.from(plane.getIndex()?.array ?? []),
      vertexCount: uv.count,
      layerFields: new Float32Array(uv.count * 2),
      layers: [adult.id],
      plan: planAtlas([adult]),
    };
    const held = acquireLayerAtlas(renderer, source);
    const material = new SkinMaterial([adult]);
    material.setAppearance(appearance);
    material.setLayerAtlas(held);
    try {
      const base = skinAlbedo(appearance.tone);
      const before = drawn(material, plane);
      for (let k = 0; k < 3; k++) expect(before[k]).toBeCloseTo(base[k] as number, 2);
      const programs = renderer.info.programs?.length ?? 0;
      held.refresh(update(source, { [adult.id]: [1, 0] }));
      const after = drawn(material, plane);
      const want = applyLayers(base, paintStopTable([adult], appearance), [[1, 0]]);
      for (let k = 0; k < 3; k++) expect(after[k]).toBeCloseTo(want[k] as number, 2);
      expect(after[0]).toBeGreaterThan((before[0] as number) + 0.1);
      expect(renderer.info.programs?.length ?? 0).toBe(programs);
    } finally {
      material.dispose();
      held.release();
      plane.dispose();
    }
  });
});

describe("drawing an update's extra triangles with the body's", () => {
  /** The texel of an atlas page at (x, y) of its grid. */
  function texelAt(texture: Texture, page: number, size: number, x: number, y: number): number[] {
    const rt = new WebGLRenderTarget(size, size, { type: FloatType });
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: `in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `precision highp float; uniform highp sampler2DArray atlas; uniform int page;
        out vec4 color; void main() { color = texelFetch(atlas, ivec3(ivec2(gl_FragCoord.xy), page), 0); }`,
      uniforms: { atlas: { value: texture }, page: { value: page } },
      blending: NoBlending,
    });
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    const scene = new Scene();
    scene.add(mesh);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const out = new Float32Array(4);
    renderer.readRenderTargetPixels(rt, x, y, 1, 1, out);
    renderer.setRenderTarget(null);
    mesh.geometry.dispose();
    material.dispose();
    rt.dispose();
    return Array.from(out);
  }

  /** A body covering the left half of UV space, one layer of (0.5, 0.25) on it. */
  const leftHalf = (): LayerAtlasSource => ({
    uvs: Float32Array.of(0, 0, 0.5, 0, 0.5, 1, 0, 1),
    index: Uint32Array.of(0, 1, 2, 0, 2, 3),
    vertexCount: 4,
    layerFields: Float32Array.of(0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.25),
    layers: ["l0"],
    plan: densePlan(1),
  });
  /** An island covering the right half (a quad), the layer's fields on it. */
  const island = (mask: number, coord: number) => ({
    uvs: Float32Array.of(0.625, 0.25, 0.875, 0.25, 0.875, 0.75, 0.625, 0.75),
    index: Uint32Array.of(0, 1, 2, 0, 2, 3),
    layerFields: Float32Array.of(mask, coord, mask, coord, mask, coord, mask, coord),
  });

  it("puts the island's fields in UV space the body does not cover, and keeps the body's", () => {
    const source = leftHalf();
    const atlas = buildLayerAtlas(renderer, source, SIZE);
    try {
      // On the island's own ground (x = 3/4 of the grid) nothing is drawn before: it is far
      // from the body, beyond the filter's reach of covered texels.
      const before = texelAt(atlas.texture, 0, SIZE, (SIZE * 3) >> 2, SIZE >> 1);
      expect(before[0]).toBe(0);
      atlas.refresh({
        layers: ["l0"],
        layerFields: Float32Array.of(0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.25),
        extra: island(1, 0.75),
      });
      const on = texelAt(atlas.texture, 0, SIZE, (SIZE * 3) >> 2, SIZE >> 1);
      expect(on[0]).toBeCloseTo(1, 2);
      expect(on[1]).toBeCloseTo(0.75, 2);
      // The body, where it is, is what it was.
      const body = texelAt(atlas.texture, 0, SIZE, SIZE >> 2, SIZE >> 1);
      expect(body[0]).toBeCloseTo(0.5, 2);
      expect(body[1]).toBeCloseTo(0.25, 2);
    } finally {
      atlas.dispose();
    }
  });

  it("draws nothing extra for an update without it, as before", () => {
    const source = leftHalf();
    const atlas = buildLayerAtlas(renderer, source, SIZE);
    try {
      atlas.refresh({
        layers: ["l0"],
        layerFields: Float32Array.of(0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.25),
      });
      const on = texelAt(atlas.texture, 0, SIZE, (SIZE * 3) >> 2, SIZE >> 1);
      expect(on[0]).toBe(0);
    } finally {
      atlas.dispose();
    }
  });
});
