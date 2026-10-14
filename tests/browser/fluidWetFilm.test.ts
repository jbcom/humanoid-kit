/** Real-WebGL proof for the per-figure water/sweat wet-film material bridge. */
import {
  BufferAttribute,
  Color,
  DirectionalLight,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { FluidCoverageSnapshot } from "../../src/fluid/attachedField.ts";
import { bindFluidWetFilmCoverage } from "../../src/render/fluidCoverage.ts";
import {
  DEFAULT_SKIN_APPEARANCE,
  SkinMaterial,
  UV_SCALE_ATTRIBUTE,
} from "../../src/render/skinMaterial.ts";
import { createTestRenderer, releaseTestRenderer } from "./gl.ts";

const SIZE = 256;

function coverage(values: readonly number[]): FluidCoverageSnapshot {
  return Object.freeze({
    version: 1,
    topology: "body",
    bodySha256: "shader-fixture",
    surface: "base",
    units: Object.freeze({ mass: "kg", area: "m2", arealMassDensity: "kg/m2", position: "m" }),
    attachedKg: 0.01,
    cells: Object.freeze([]),
    materials: Object.freeze([
      Object.freeze({
        materialId: "water",
        attachedKg: 0.01,
        coveredAreaM2: 1,
        vertexCoverage: Object.freeze([...values]),
      }),
    ]),
  });
}

function surface(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute(
    UV_SCALE_ATTRIBUTE,
    new BufferAttribute(new Float32Array(geometry.getAttribute("position").count).fill(1), 1),
  );
  return geometry;
}

function material(): SkinMaterial {
  const value = new SkinMaterial();
  value.setAppearance({ ...DEFAULT_SKIN_APPEARANCE, flush: 0 });
  value.normalMap = null;
  // The existing water/sweat profile reduces this fixture from 0.45 to 0.25.
  // That makes the documented roughness change legible in the comparison frame.
  value.roughness = 0.45;
  return value;
}

function sceneFor(mesh: Mesh, span = 1.2): { scene: Scene; camera: OrthographicCamera } {
  const scene = new Scene();
  scene.background = new Color(0x141414);
  scene.add(mesh);
  const key = new DirectionalLight(0xffffff, 8);
  key.position.set(0.1, 0.15, 2);
  scene.add(key);
  const camera = new OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 10);
  camera.position.set(0, 0, 3);
  return { scene, camera };
}

function pixels(
  renderer: ReturnType<typeof createTestRenderer>,
  scene: Scene,
  camera: OrthographicCamera,
): Uint8Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: UnsignedByteType });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const out = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, out);
  renderer.setRenderTarget(null);
  target.dispose();
  return out;
}

describe("the water/sweat wet-film bridge in SkinMaterial", () => {
  it("keeps dry pixels exact, changes covered pixels, and records a dry/wet comparison", async () => {
    const renderer = createTestRenderer({ antialias: false });
    renderer.setSize(SIZE, SIZE, false);
    document.body.append(renderer.domElement);
    const dryGeometry = surface();
    const clearedGeometry = surface();
    const wetGeometry = surface();
    const dryMaterial = material();
    const clearedMaterial = material();
    const wetMaterial = material();
    bindFluidWetFilmCoverage(clearedMaterial, clearedGeometry, null);
    bindFluidWetFilmCoverage(wetMaterial, wetGeometry, coverage([1, 1, 1, 1]));
    const dry = sceneFor(new Mesh(dryGeometry, dryMaterial));
    const cleared = sceneFor(new Mesh(clearedGeometry, clearedMaterial));
    const wet = sceneFor(new Mesh(wetGeometry, wetMaterial));

    const dryPixels = pixels(renderer, dry.scene, dry.camera);
    expect([...pixels(renderer, cleared.scene, cleared.camera)]).toEqual([...dryPixels]);
    const wetPixels = pixels(renderer, wet.scene, wet.camera);
    const changed = wetPixels.reduce(
      (count, value, index) => count + (value === dryPixels[index] ? 0 : 1),
      0,
    );
    expect(changed).toBeGreaterThan(SIZE * SIZE);

    const comparison = new Scene();
    comparison.background = new Color(0x141414);
    const dryMesh = new Mesh(surface(), material());
    dryMesh.position.x = -0.58;
    const wetCaptureGeometry = surface();
    const wetCaptureMaterial = material();
    bindFluidWetFilmCoverage(wetCaptureMaterial, wetCaptureGeometry, coverage([1, 1, 1, 1]));
    const wetMesh = new Mesh(wetCaptureGeometry, wetCaptureMaterial);
    wetMesh.position.x = 0.58;
    comparison.add(dryMesh, wetMesh);
    const key = new DirectionalLight(0xffffff, 8);
    key.position.set(0.1, 0.15, 2);
    comparison.add(key);
    const comparisonCamera = new OrthographicCamera(-1.25, 1.25, 0.75, -0.75, 0.1, 10);
    comparisonCamera.position.set(0, 0, 3);
    renderer.render(comparison, comparisonCamera);
    await page.screenshot({
      element: renderer.domElement,
      path: "../../test-results/fluid-wet-film/dry-wet.png",
    });

    dryGeometry.dispose();
    clearedGeometry.dispose();
    wetGeometry.dispose();
    dryMaterial.dispose();
    clearedMaterial.dispose();
    wetMaterial.dispose();
    dryMesh.geometry.dispose();
    wetCaptureGeometry.dispose();
    dryMesh.material.dispose();
    wetCaptureMaterial.dispose();
    renderer.domElement.remove();
    releaseTestRenderer(renderer);
  });
});
