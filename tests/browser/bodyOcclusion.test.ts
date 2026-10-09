/**
 * The body's cavity occlusion on the GPU (src/render/occlusion.ts through
 * SkinMaterial): the skin shader reads the body's corner bytes, blends them
 * by the figure's key weights as the attachments' do, and scales the light by
 * the floor-mixed result. A body geometry without them is open.
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
  BODY_OCCLUSION_FLOOR,
  BODY_OCCLUSION_POWER,
  setBodyOcclusionAttributes,
} from "../../src/render/occlusion.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
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

const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);

/** Mean red of a lit skin plane, whose every vertex has `corners` (bytes, 255 open) if given, posed at `keys`. */
function render(corners: number[] | null, keys: [number, number, number] = [0, 0, 0]): number {
  const plane = new PlaneGeometry(2, 2);
  if (corners) {
    const n = plane.getAttribute("position").count;
    const bytes = new Uint8Array(n * CORNERS);
    for (let v = 0; v < n; v++) bytes.set(corners, v * CORNERS);
    setBodyOcclusionAttributes(plane, bytes);
  }
  const material = new SkinMaterial();
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
  plane.dispose();
  let sum = 0;
  for (let i = 0; i < SIZE * SIZE; i++) sum += px[i * 4] as number;
  return sum / (SIZE * SIZE);
}

/** The light left at blended occlusion `occ` for a vertex whose occlusion at rest is `rest`. */
const shaded = (occ: number, rest: number) =>
  BODY_OCCLUSION_FLOOR +
  (1 - BODY_OCCLUSION_FLOOR) * occ ** (1 + (BODY_OCCLUSION_POWER - 1) * (1 - rest));

describe("the body's cavity occlusion", () => {
  it("scales the light by the floor-mixed byte, and leaves a body without the attributes open", () => {
    const open = render(new Array(CORNERS).fill(255));
    expect(render(null)).toBeCloseTo(open, 5);
    expect(render(new Array(CORNERS).fill(0)) / open).toBeCloseTo(BODY_OCCLUSION_FLOOR, 2);
    // A byte's value is raised to a power before the floor mixes in; the power
    // grows with how enclosed the vertex is at rest (corner 0).
    expect(render(new Array(CORNERS).fill(230)) / open).toBeCloseTo(
      shaded(230 / 255, 230 / 255),
      2,
    );
    expect(render(new Array(CORNERS).fill(180)) / open).toBeCloseTo(
      shaded(180 / 255, 180 / 255),
      2,
    );
  });

  it("keeps a fold's plain value and darkens a cavity's steeply, as the jaw opens", () => {
    const open = render(new Array(CORNERS).fill(255));
    const jaw: [number, number, number] = [1, 0, 0];
    // Open at rest and 40% visible with the jaw open: a fold, at its own value.
    const fold = [255, 102, 255, 255, 255, 255, 255, 255];
    expect(render(fold, jaw) / open).toBeCloseTo(shaded(102 / 255, 1), 2);
    // Enclosed at rest and 80% visible with the jaw open: a cavity, at the steepest power.
    const cavity = [0, 204, 0, 0, 0, 0, 0, 0];
    expect(render(cavity, jaw) / open).toBeCloseTo(shaded(204 / 255, 0), 2);
  });

  it("blends the corner bytes multilinearly by the figure's key weights", () => {
    // A different value at every corner, all fairly open so the power leaves a signal.
    const corners = [153, 255, 178, 204, 230, 166, 242, 191];
    const open = render(new Array(CORNERS).fill(255));
    for (const keys of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 1],
      [0.3, 0.6, 0.1],
    ] as [number, number, number][]) {
      const w = occlusionCornerWeights(keys);
      const occ = corners.reduce((s, c, m) => s + (c / 255) * (w[m] as number), 0);
      expect(render(corners, keys) / open, `keys ${keys.join(",")}`).toBeCloseTo(
        shaded(occ, (corners[0] as number) / 255),
        2,
      );
    }
  });
});
