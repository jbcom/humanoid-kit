/** Runtime custom-set bake through the actual attachment material, with fixed source geometry. */
import { bodyPack } from "humanoid-kit-body";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Mesh,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { AttachmentStandardMaterial, setOcclusionAttributes } from "../../src/render/occlusion.ts";
import { createTestRenderer } from "./gl.ts";

const SIZE = 384;

function difference(a: ArrayLike<number>, b: ArrayLike<number>, stride = 1) {
  expect(b.length).toBe(a.length);
  let sum = 0;
  let max = 0;
  let changed = 0;
  let count = 0;
  for (let p = 0; p < a.length; p++) {
    if (stride === 4 && p % 4 === 3) continue;
    const d = Math.abs((a[p] as number) - (b[p] as number));
    sum += d;
    max = Math.max(max, d);
    changed += Number(d > 0);
    count++;
  }
  return { mae: sum / count, max, changed };
}

function image(pixels: Uint8Array): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("capture needs a 2d context");
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < SIZE; y++)
    flipped.set(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), (SIZE - y - 1) * SIZE * 4);
  context.putImageData(new ImageData(flipped, SIZE, SIZE), 0, 0);
  return canvas;
}

it("renders omitted/32 identically and consumes the actual 16-ray custom attachment bake", async () => {
  const assets = await loadHumanoidAssets({ body: bodyPack });
  const id = "eyes/high-poly";
  const packed = assets.attachments.get(id);
  if (!packed) throw new Error("source eye attachment missing");
  const packedBytes = packed.occlusion.slice();
  expect(assets.attachments.size).toBeGreaterThan(1);
  const models = [undefined, 32, 16].map(
    (runtimeOcclusionRays) =>
      new HumanoidModel(assets, {
        subdivision: 0,
        attachments: [id],
        ...(runtimeOcclusionRays !== undefined && { runtimeOcclusionRays }),
      }),
  );
  // The eyes-only worn set differs from the full packed set, so topology must
  // cast real runtime rays against the source body. No source bake is removed.
  for (const model of models) expect(model.occlusionBakeRecipe()).not.toBeNull();
  const topologies = models.map((model) => model.topology().attachments[0]);
  const surfaces = models.map((model) => model.evaluate(createRecipe()).attachments[0]);
  const source = surfaces[0];
  const topology = topologies[0];
  if (!source || !topology) throw new Error("custom attachment source missing");
  const fields = topologies.map((part) => {
    if (!part) throw new Error("custom attachment topology missing");
    expect(part.id).toBe(id);
    expect(part.index).toEqual(topology.index);
    expect(part.occlusion.length).toBe((source.positions.length / 3) * 8);
    return part.occlusion;
  });
  for (const surface of surfaces) {
    expect(surface?.positions).toEqual(source.positions);
    expect(surface?.normals).toEqual(source.normals);
  }
  expect(new Uint8Array((fields[0] as Float32Array).buffer)).toEqual(
    new Uint8Array((fields[1] as Float32Array).buffer),
  );
  const fieldDifference = difference(fields[1] as Float32Array, fields[2] as Float32Array);
  expect(fieldDifference.changed, "ray option must affect a real custom bake").toBeGreaterThan(0);
  expect((fields[2] as Float32Array).every((v) => v >= 0 && v <= 1)).toBe(true);

  const originalPositions = source.positions.slice();
  const originalNormals = source.normals.slice();
  const originalIndex = topology.index.slice();
  const renderer = createTestRenderer({ antialias: false });
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as string;
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x141820, 1);
  const target = new WebGLRenderTarget(SIZE, SIZE);
  // All renders share this one source geometry object, material, scene and light.
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(source.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(source.normals, 3));
  geometry.setIndex(new BufferAttribute(topology.index, 1));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("source bounds missing");
  const center = box.getCenter(new Vector3());
  const half = box.getSize(new Vector3()).length() * 0.6;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.01, 10);
  const material = new AttachmentStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    side: DoubleSide,
  });
  const scene = new Scene();
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(0.3, 1, 2);
  scene.add(new Mesh(geometry, material), key, new AmbientLight(0xffffff, 0.8));
  const draw = (field: Float32Array): Uint8Array => {
    setOcclusionAttributes(geometry, field);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(null);
    return pixels;
  };
  const panel = document.createElement("div");
  panel.style.cssText =
    "width:1180px;padding:12px;background:#141820;color:white;font:16px sans-serif";
  const heading = document.createElement("h2");
  heading.textContent = "Source eyes-only attachment: omitted / 32 rays / 16 rays";
  panel.append(heading);
  const explanation = document.createElement("p");
  explanation.textContent =
    "Runtime bake against the source body. Attachment isolated in white to inspect occlusion; identical geometry, camera and lights in each row.";
  panel.append(explanation);
  const measurements = [];
  try {
    for (const [view, offset] of [
      ["front", [0, 0, 1]],
      ["oblique", [0.45, 0.15, 1]],
    ] as const) {
      camera.position.copy(center).add(new Vector3(...offset));
      camera.lookAt(center);
      camera.updateMatrixWorld();
      const pixels = fields.map(draw);
      expect(pixels[0], `${view}: omitted and explicit32 pixels`).toEqual(pixels[1]);
      expect(
        (pixels[1] as Uint8Array).filter((v, p) => p % 4 === 0 && v > 32).length,
      ).toBeGreaterThan(1000);
      const renderedDifference = difference(pixels[1] as Uint8Array, pixels[2] as Uint8Array, 4);
      expect(
        renderedDifference.changed,
        `${view}: renderer must consume the changed bake`,
      ).toBeGreaterThan(0);
      // An all-open diagnostic must brighten this same attachment. This guards
      // a shader that disconnects both runtime fields while still drawing eyes.
      const openDifference = difference(
        pixels[1] as Uint8Array,
        draw(new Float32Array((fields[1] as Float32Array).length).fill(1)),
        4,
      );
      expect(
        openDifference.changed,
        `${view}: material must consume occlusion attributes`,
      ).toBeGreaterThan(0);
      measurements.push({
        view,
        default32: difference(pixels[0] as Uint8Array, pixels[1] as Uint8Array, 4),
        reduced16: renderedDifference,
        allOpen: openDifference,
      });
      const label = document.createElement("p");
      label.textContent = `${view}: RGB MAE ${renderedDifference.mae.toFixed(6)}, max ${renderedDifference.max}, changed RGB channels ${renderedDifference.changed}`;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px";
      for (const pixelsForSetting of pixels) row.append(image(pixelsForSetting));
      panel.append(label, row);
    }
    expect(packed.occlusion).toEqual(packedBytes);
    expect(geometry.getAttribute("position").array).toEqual(originalPositions);
    expect(geometry.getAttribute("normal").array).toEqual(originalNormals);
    expect(geometry.getIndex()?.array).toEqual(originalIndex);
    console.info(
      "runtime-occlusion-quality-renderer",
      JSON.stringify({
        id,
        gpu,
        vertices: source.positions.length / 3,
        fieldDifference,
        measurements,
      }),
    );
    document.body.append(panel);
    await page.viewport(1240, 1080);
    expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot({
      element: panel,
      path: "../../test-results/runtime-occlusion-quality/eyes-omitted-32-16.png",
      fullPage: true,
    });
  } finally {
    panel.remove();
    material.dispose();
    geometry.dispose();
    target.dispose();
  }
}, 120_000);
