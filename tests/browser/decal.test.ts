/**
 * The brows' and lashes' material on the GPU (src/render/decalMaterial.ts): a
 * white alpha mask takes the hair's colour, its cut-out follows the opacity an
 * age gives, and it draws over the skin it lies on.
 */
import {
  AmbientLight,
  DataTexture,
  FloatType,
  Mesh,
  type MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { DecalMaterial } from "../../src/render/decalMaterial.ts";

const SIZE = 12;
const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** A white mask of three texels across with alphas `a`, as a plane's texture. */
function maskOf(a: [number, number, number]): DataTexture {
  const data = new Float32Array(3 * 4);
  a.forEach((alpha, i) => {
    data.set([1, 1, 1, alpha], i * 4);
  });
  const map = new DataTexture(data, 3, 1, RGBAFormat, FloatType);
  map.colorSpace = NoColorSpace;
  map.magFilter = NearestFilter;
  map.minFilter = NearestFilter;
  map.needsUpdate = true;
  return map;
}

/** The red of the left, middle and right thirds of `material` on a plane, lit by an ambient light. */
function thirds(material: MeshStandardMaterial): [number, number, number] {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, Math.PI));
  const plane = new PlaneGeometry(2, 2);
  scene.add(new Mesh(plane, material));
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  plane.dispose();
  const at = (x: number) => px[((SIZE >> 1) * SIZE + x) * 4] as number;
  return [at(1), at(SIZE >> 1), at(SIZE - 2)];
}

describe("the decal material", () => {
  it("shows the mask's opaque texels in the hair colour and cuts the clear ones out", () => {
    const material = new DecalMaterial();
    material.setMultisampled(false);
    material.map = maskOf([1, 0, 1]);
    material.setColour([0.4, 0.2, 0.1]);
    const [left, middle, right] = thirds(material);
    expect(middle).toBe(0);
    expect(left).toBeGreaterThan(0.05);
    expect(right).toBeCloseTo(left, 4);
    // Red is twice green's and four times blue's, as the colour is.
    const white = new DecalMaterial();
    white.setMultisampled(false);
    white.map = maskOf([1, 1, 1]);
    white.setColour([1, 1, 1]);
    const unit = thirds(white)[0];
    expect(left / unit).toBeCloseTo(0.4, 2);
    material.dispose();
    white.dispose();
  });

  it("thins with opacity: a partial texel goes first, a full one stays down to the cut-off", () => {
    const material = new DecalMaterial();
    material.setMultisampled(false);
    material.map = maskOf([1, 0.6, 0]);
    material.setColour([1, 1, 1]);
    material.setOpacity(1);
    const full = thirds(material);
    expect(full[0]).toBeGreaterThan(0.05);
    expect(full[1]).toBeGreaterThan(0.05);
    material.setOpacity(0.5);
    const sparse = thirds(material);
    expect(sparse[0]).toBeGreaterThan(0.05);
    expect(sparse[1]).toBe(0);
    material.dispose();
  });

  it("draws over the skin it lies on, however little it is lifted", () => {
    expect(new DecalMaterial().polygonOffset).toBe(true);
    expect(new DecalMaterial().polygonOffsetFactor).toBeLessThan(0);
  });
});
