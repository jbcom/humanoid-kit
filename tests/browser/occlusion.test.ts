/**
 * Pose-keyed attachment occlusion on the GPU (src/render/occlusion.ts): the
 * shader blends the corner bakes exactly as `occlusionCornerWeights` does and
 * scales the light by the floor-mixed result.
 */
import {
  DirectionalLight,
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  AttachmentStandardMaterial,
  OCCLUSION_ATTRIBUTE,
  OCCLUSION_FLOOR,
  setOcclusionAttributes,
} from "../../src/render/occlusion.ts";
import {
  OCCLUSION_KEYS,
  occlusionCorners,
  occlusionCornerWeights,
} from "../../src/rig/occlusionKeys.ts";

const SIZE = 16;
const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(SIZE, SIZE, false);
const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** `corners` at every vertex of `plane`, interleaved as the attributes take them. */
function everyVertex(plane: PlaneGeometry, corners: number[]): Float32Array {
  const n = plane.getAttribute("position").count;
  const occlusion = new Float32Array(n * corners.length);
  for (let v = 0; v < n; v++) occlusion.set(corners, v * corners.length);
  return occlusion;
}

/** Mean red of a lit white plane whose every vertex has `corners`, posed at key weights `keys`. */
function render(corners: number[], keys: [number, number, number]): number {
  const plane = new PlaneGeometry(2, 2);
  setOcclusionAttributes(plane, everyVertex(plane, corners));
  const red = renderPlane(plane, keys);
  plane.dispose();
  return red;
}

/** Mean red of a lit white `plane` (its occlusion attributes set), posed at `keys`. */
function renderPlane(plane: PlaneGeometry, keys: [number, number, number]): number {
  const material = new AttachmentStandardMaterial({ color: 0xffffff, roughness: 1 });
  material.occlusionKeys = new Vector3(...keys);
  const scene = new Scene();
  scene.add(new Mesh(plane, material));
  const light = new DirectionalLight(0xffffff, 1);
  light.position.set(0, 0, 1);
  scene.add(light);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  material.dispose();
  let sum = 0;
  for (let i = 0; i < SIZE * SIZE; i++) sum += px[i * 4] as number;
  return sum / (SIZE * SIZE);
}

describe("pose-keyed attachment occlusion", () => {
  it("blends the corner bakes multilinearly by the figure's key weights", () => {
    const count = occlusionCorners(OCCLUSION_KEYS.length);
    const corners = [0, 0.2, 0.4, 0.6, 0.8, 1, 0.3, 0.5];
    expect(corners.length).toBe(count);
    const open = render(new Array(count).fill(1), [0, 0, 0]);
    for (const keys of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 1],
      [0.3, 0.6, 0.1],
    ] as [number, number, number][]) {
      const w = occlusionCornerWeights(keys);
      const occ = corners.reduce((s, c, m) => s + c * (w[m] as number), 0);
      const want = OCCLUSION_FLOOR + (1 - OCCLUSION_FLOOR) * occ;
      expect(render(corners, keys) / open, `keys ${keys.join(",")}`).toBeCloseTo(want, 2);
    }
  });

  it("refills the uploaded buffer when the corners arrive, and renders them", () => {
    const count = occlusionCorners(OCCLUSION_KEYS.length);
    const plane = new PlaneGeometry(2, 2);
    // At rest only, as a set the pack did not bake arrives: enclosed everywhere.
    const atRest = everyVertex(plane, new Array(count).fill(0));
    setOcclusionAttributes(plane, atRest);
    const attribute = plane.getAttribute(OCCLUSION_ATTRIBUTE);
    const jaw: [number, number, number] = [1, 0, 0];
    const before = renderPlane(plane, jaw);
    // The posed bake opens the jaw corner.
    const posed = everyVertex(plane, [0, 1, 0, 0, 0, 0, 0, 0]);
    setOcclusionAttributes(plane, posed);
    expect(plane.getAttribute(OCCLUSION_ATTRIBUTE)).toBe(attribute);
    expect([...atRest].every((v) => v === 0)).toBe(true);
    expect(renderPlane(plane, jaw)).toBeGreaterThan(before * 2);
    plane.dispose();
  });
});
