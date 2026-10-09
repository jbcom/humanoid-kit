/**
 * Renders skin layers on a flat plane in a real WebGL context, for the browser
 * tests that hold the shader to the layers' models (detail.test.ts) and the
 * state layers to their measured sizes (states.test.ts).
 */
import {
  BufferAttribute,
  DirectionalLight,
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { buildLayerAtlas, type LayerAtlasSource } from "../../src/render/layerAtlas.ts";
import {
  DEFAULT_SKIN_APPEARANCE,
  type SkinAppearance,
  SkinMaterial,
  UV_SCALE_ATTRIBUTE,
} from "../../src/render/skinMaterial.ts";
import { planAtlas } from "../../src/surface/atlasPlan.ts";
import type { SkinLayer } from "../../src/surface/layers.ts";

/** Pixels per side of the render. */
export const SIZE = 128;

export interface LayerRenderOptions {
  /** Direction toward the light; grazing along x shows relief. */
  light?: [number, number, number];
  tune?: (m: SkinMaterial) => void;
  /** Side of the square plane, metres (also its metres per UV unit); default 2. */
  plane?: number;
  /**
   * What the camera sees: its span in metres (default the whole plane) around
   * `centre`, metres from the plane's middle. A small view of the plane's far
   * corner draws relief at large UV coordinates, where a figure's detail lives.
   */
  view?: { span: number; centre: [number, number] };
  /** Pixels per side; default `SIZE`. */
  size?: number;
  appearance?: SkinAppearance;
  /** Turns the plane about its vertical axis, radians: its u axis is foreshortened by the cosine. */
  tilt?: number;
}

let renderer: WebGLRenderer | null = null;
const targets = new Map<number, WebGLRenderTarget>();

function context(size: number) {
  renderer ??= new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
  renderer.setSize(size, size, false);
  let target = targets.get(size);
  if (!target) {
    target = new WebGLRenderTarget(size, size, { type: FloatType });
    targets.set(size, target);
  }
  return { renderer, target };
}

/** Frees the shared context; call once from `afterAll`. */
export function disposeLayerRender(): void {
  for (const t of targets.values()) t.dispose();
  targets.clear();
  renderer?.dispose();
  renderer = null;
}

export const noFields = () => ({ mask: new Float32Array(0), coord: null });

/**
 * Renders a square plane (UV 0..1) with `layers`, every layer fully masked with
 * its coordinate running along u, lit by `options.light`. Returns the red
 * channel, row-major.
 */
export function renderLayers(layers: readonly SkinLayer[], options: LayerRenderOptions = {}) {
  const side = options.plane ?? 2;
  const size = options.size ?? SIZE;
  const { renderer, target } = context(size);
  const half = (options.view?.span ?? side) / 2;
  const [cx, cy] = options.view?.centre ?? [0, 0];
  const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 10);
  camera.position.set(cx, cy, 5);
  const plane = new PlaneGeometry(side, side);
  if (options.tilt) plane.rotateY(options.tilt);
  const uv = plane.getAttribute("uv");
  plane.setAttribute(
    UV_SCALE_ATTRIBUTE,
    new BufferAttribute(new Float32Array(uv.count).fill(side), 1),
  );
  const source: LayerAtlasSource = {
    uvs: uv.array as Float32Array,
    index: plane.getIndex()?.array as Uint16Array,
    vertexCount: uv.count,
    layerFields: new Float32Array(layers.length * uv.count * 2),
    layers: layers.map((l) => l.id),
    plan: planAtlas(layers),
  };
  for (let v = 0; v < uv.count; v++)
    layers.forEach((_, l) => {
      source.layerFields[(l * uv.count + v) * 2] = 1;
      source.layerFields[(l * uv.count + v) * 2 + 1] = uv.getX(v);
    });
  const atlas = layers.length ? buildLayerAtlas(renderer, source, 256) : null;
  const material = new SkinMaterial(layers);
  material.setAppearance(options.appearance ?? { ...DEFAULT_SKIN_APPEARANCE, flush: 0 });
  material.setLayerAtlas(atlas);
  material.normalMap = null; // the pore map would add its own relief
  options.tune?.(material);
  const scene = new Scene();
  scene.add(new Mesh(plane, material));
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(...(options.light ?? [1, 0, 0.35]));
  scene.add(light);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, px);
  renderer.setRenderTarget(null);
  atlas?.dispose();
  material.dispose();
  plane.dispose();
  return px.filter((_, i) => i % 4 === 0);
}

export const mean = (a: Float32Array) => a.reduce((s, x) => s + x, 0) / a.length;

export const variance = (a: Float32Array) => {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
};
