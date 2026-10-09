/**
 * Detail and surface skin layers on the GPU (src/surface/layers.ts): relief
 * drawn at true scale from the layer's fields, faded where it is finer than a
 * pixel, and surface layers changing roughness and specular exactly as the
 * material's own parameters would.
 */
import {
  BufferAttribute,
  DataUtils,
  DirectionalLight,
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { buildLayerAtlas, type LayerAtlasSource } from "../../src/render/layerAtlas.ts";
import { SkinMaterial, UV_SCALE_ATTRIBUTE } from "../../src/render/skinMaterial.ts";
import type { SkinLayer, SkinPaintInput } from "../../src/surface/layers.ts";

const SIZE = 128;
const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

const appearance: SkinPaintInput = {
  tone: { melanin: 0.4, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0,
  lips: 0.5,
  areola: 0.5,
  signals: {},
};
const noFields = () => ({ mask: new Float32Array(0), coord: null });

/**
 * Renders a 2 m plane (UV 0..1, so 2 m per UV unit) with `layers`, every layer
 * fully masked with its coordinate running along u; lit by a grazing light so
 * relief shows. Returns the red channel, row-major.
 */
function render(
  layers: SkinLayer[],
  options: { light?: [number, number, number]; tune?: (m: SkinMaterial) => void } = {},
): Float32Array {
  const plane = new PlaneGeometry(2, 2);
  const uv = plane.getAttribute("uv");
  plane.setAttribute(
    UV_SCALE_ATTRIBUTE,
    new BufferAttribute(new Float32Array(uv.count).fill(2), 1),
  );
  const source: LayerAtlasSource = {
    uvs: uv.array as Float32Array,
    index: plane.getIndex()?.array as Uint16Array,
    vertexCount: uv.count,
    layerFields: new Float32Array(layers.length * uv.count * 2),
    layers: layers.map((l) => l.id),
  };
  for (let v = 0; v < uv.count; v++)
    layers.forEach((_, l) => {
      source.layerFields[(l * uv.count + v) * 2] = 1;
      source.layerFields[(l * uv.count + v) * 2 + 1] = uv.getX(v);
    });
  const atlas = layers.length ? buildLayerAtlas(renderer, source, 256) : null;
  const material = new SkinMaterial(layers);
  material.setAppearance(appearance);
  material.setLayerAtlas(atlas?.texture ?? null);
  material.normalMap = null; // the pore map would add its own relief
  options.tune?.(material);
  const scene = new Scene();
  scene.add(new Mesh(plane, material));
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(...(options.light ?? [1, 0, 0.35]));
  scene.add(light);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  atlas?.dispose();
  material.dispose();
  plane.dispose();
  return px.filter((_, i) => i % 4 === 0);
}

const variance = (a: Float32Array) => {
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length;
};

describe("detail layers", () => {
  const creases = (height: number, size: number): SkinLayer => ({
    id: "creases",
    kind: "detail",
    pattern: "creases",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, height, size }),
  });
  const bumps = (height: number, size: number): SkinLayer => ({
    id: "bumps",
    kind: "detail",
    pattern: "bumps",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, height, size }),
  });

  it("ripples the shading across the coordinate, as many creases as asked", () => {
    const flat = render([]);
    const rippled = render([creases(0.01, 8)]);
    // Along the middle row, the shading rises and falls once per crease.
    const row = Array.from(
      { length: SIZE },
      (_, x) =>
        (rippled[(SIZE / 2) * SIZE + x] as number) - (flat[(SIZE / 2) * SIZE + x] as number),
    );
    let crossings = 0;
    for (let x = 1; x < SIZE; x++)
      if (Math.sign(row[x] as number) !== Math.sign(row[x - 1] as number)) crossings++;
    // Two sign changes per period of the slope.
    expect(crossings).toBeGreaterThanOrEqual(14);
    expect(crossings).toBeLessThanOrEqual(18);
    expect(variance(flat)).toBeLessThan(1e-6);
  });

  it("raises bumps at their true size, and fades them where they are finer than a pixel", () => {
    // 2 m across at 0.1 m spacing: 20 bumps over 128 px, about 6 px each.
    const coarse = render([bumps(0.01, 0.1)]);
    // At 2 mm spacing, a thousand bumps across 128 px: fade to flat, no shimmer.
    const fine = render([bumps(0.01, 0.002)]);
    const none = render([]);
    expect(variance(coarse)).toBeGreaterThan(100 * Math.max(variance(none), 1e-8));
    expect(variance(fine)).toBeLessThan(variance(coarse) / 50);
  });
});

describe("surface layers", () => {
  const surface = (roughness: number, specular: number): SkinLayer => ({
    id: "sheen",
    kind: "surface",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, roughness, specular }),
  });
  // A light mirrored to the camera, so the highlight fills the frame.
  const glancing: [number, number, number] = [0, 0, 1];

  it("lowers roughness exactly as the material's own roughness would", () => {
    const layered = render([surface(-0.3, 0)], { light: glancing });
    // The stop table is half-float (mobile GPUs filter it linearly), so the
    // change arrives as the nearest half; the reference uses the same value.
    const change = DataUtils.fromHalfFloat(DataUtils.toHalfFloat(-0.3));
    const direct = render([], { light: glancing, tune: (m) => (m.roughness = 0.52 + change) });
    let worst = 0;
    for (let i = 0; i < layered.length; i++)
      worst = Math.max(worst, Math.abs((layered[i] as number) - (direct[i] as number)));
    expect(worst).toBeLessThan(1e-3);
  });

  it("strengthens the specular reflection with a positive specular change", () => {
    const mean = (a: Float32Array) => a.reduce((s, x) => s + x, 0) / a.length;
    const plain = mean(render([surface(0, 0)], { light: glancing }));
    const wet = mean(render([surface(0, 0.8)], { light: glancing }));
    expect(wet).toBeGreaterThan(plain * 1.02);
  });
});
