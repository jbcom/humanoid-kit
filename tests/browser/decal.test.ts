/**
 * The brows' and lashes' material on the GPU (src/render/decalMaterial.ts): a
 * white alpha mask takes the hair's colour and blends by its alpha, a thin
 * stroke keeps the partial opacity it covers rather than being cut out, and a
 * faint soft fill lies between strokes.
 */
import {
  AmbientLight,
  DataTexture,
  FloatType,
  LinearMipmapLinearFilter,
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
import { DECAL_SPECULAR, DecalMaterial, SOFT_FILL } from "../../src/render/decalMaterial.ts";

const SIZE = 16;
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

/** A white mask of `alphas` across, as a plane's texture (mipmapped, as the loader makes it). */
function maskOf(alphas: number[]): DataTexture {
  const data = new Float32Array(alphas.length * 4);
  alphas.forEach((alpha, i) => {
    data.set([1, 1, 1, alpha], i * 4);
  });
  const map = new DataTexture(data, alphas.length, 1, RGBAFormat, FloatType);
  map.colorSpace = NoColorSpace;
  map.magFilter = NearestFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/** The rendered red and alpha at the centre of each of `count` equal columns of `material` on a plane. */
function columns(material: MeshStandardMaterial, count: number): { red: number; alpha: number }[] {
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
  return Array.from({ length: count }, (_, c) => {
    const x = Math.floor(((c + 0.5) * SIZE) / count);
    const i = ((SIZE >> 1) * SIZE + x) * 4;
    return { red: px[i] as number, alpha: px[i + 3] as number };
  });
}

/** What a fully opaque white texel renders as under the same light, at colour `c`. */
function unit(): number {
  const m = new DecalMaterial();
  m.map = maskOf([1, 1, 1, 1]);
  m.setColour([1, 1, 1]);
  const r = (columns(m, 4)[1] as { red: number }).red;
  m.dispose();
  return r;
}

describe("the decal material", () => {
  it("shows the mask in the hair colour where it is opaque, and nothing where it is clear", () => {
    const material = new DecalMaterial();
    // Four opaque texels, a wide clear run (wider than the soft fill's blur), four opaque.
    material.map = maskOf([...Array(4).fill(1), ...Array(24).fill(0), ...Array(4).fill(1)]);
    material.setColour([0.4, 0.2, 0.1]);
    const cols = columns(material, 8);
    const [left, clear, right] = [cols[0], cols[4], cols[7]];
    expect(clear?.alpha).toBe(0);
    expect(left?.alpha).toBeCloseTo(1, 2);
    expect(right?.alpha).toBeCloseTo(1, 2);
    // Premultiplied by its alpha, the colour is the albedo's share of white's.
    expect((left?.red as number) / unit()).toBeCloseTo(0.4, 1);
    material.dispose();
  });

  it("blends a thin stroke by the opacity it covers, instead of keeping or cutting it", () => {
    const material = new DecalMaterial();
    material.map = maskOf([1, 0.6, 0.3, 0]);
    material.setColour([1, 1, 1]);
    const [full, sixty, thirty] = columns(material, 4);
    expect(sixty?.alpha).toBeGreaterThan(0.45);
    expect(sixty?.alpha).toBeLessThan(0.75);
    expect(thirty?.alpha).toBeGreaterThan(0.15);
    expect(thirty?.alpha).toBeLessThan(0.5);
    expect(full?.alpha).toBeGreaterThan((sixty?.alpha as number) + 0.1);
    material.dispose();
  });

  it("thins with opacity, continuously: half the opacity is about half the cover", () => {
    const material = new DecalMaterial();
    material.map = maskOf([1, 1, 1, 1]);
    material.setColour([1, 1, 1]);
    material.setOpacity(1);
    const full = (columns(material, 4)[1] as { alpha: number }).alpha;
    material.setOpacity(0.5);
    const half = (columns(material, 4)[1] as { alpha: number }).alpha;
    expect(half / full).toBeCloseTo(0.5, 1);
    material.dispose();
  });

  it("fills softly between strokes, faintly, and never past the soft fill's share", () => {
    const material = new DecalMaterial();
    // Strokes at both ends of a row of texels, clear between.
    material.map = maskOf([1, 0, 0, 0, 0, 0, 0, 1]);
    material.setColour([1, 1, 1]);
    const between = (columns(material, 8)[3] as { alpha: number }).alpha;
    expect(between).toBeGreaterThan(0.02);
    expect(between).toBeLessThanOrEqual(SOFT_FILL * 0.5);
    material.dispose();
  });

  it("keeps little of a standard material's specular, draws over the skin without writing depth", () => {
    const material = new DecalMaterial();
    expect(material.specularIntensity).toBe(DECAL_SPECULAR);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
    material.dispose();
  });
});
