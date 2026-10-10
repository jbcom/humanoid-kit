/**
 * The studio key light's shadow on skin (`render/studioShadow.ts`): the edge of
 * a cast shadow must be a penumbra, not a step. A hard, stepped shadow-map edge on
 * a thigh under a belly reads as dirt, and it is what the shadow map's texel does
 * unless the map is fitted to the figure and blurred.
 *
 * The scene is the stage's own: its key light with `configureKeyShadow`, a
 * receiving plane (lit as skin is, a physical material of skin's albedo) and a thin
 * occluder a few centimetres above it, the distance a thigh lies under a belly. An
 * orthographic camera looks straight down at the evidence framing of a body (1.8 m
 * over 480 px: 3.75 mm a pixel); the luminance across the shadow's edge, along the
 * light's direction on the plane, is read back, and the width of its 10 % to 90 %
 * step is counted in pixels.
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  FloatType,
  Mesh,
  MeshPhysicalMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  VSMShadowMap,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { configureKeyShadow, KEY_SHADOW, STUDIO_SHADOWS } from "../../src/render/studioShadow.ts";

const WIDTH = 480;
const HEIGHT = 480;
/** The evidence framing of a body: 1.8 m across the frame. */
const SPAN = 1.8;
const METRES_PER_PIXEL = SPAN / HEIGHT;

const canvas = document.createElement("canvas");
const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = VSMShadowMap;
const target = new WebGLRenderTarget(WIDTH, HEIGHT, { type: FloatType });
afterAll(() => {
  target.dispose();
  renderer.dispose();
});

/** The 10 % to 90 % width, in pixels, of the edge of the shadow an occluder `height` metres over the plane casts. */
function penumbra(height: number): number {
  const scene = new Scene();
  scene.background = new Color(0);
  const key = new DirectionalLight("#fff6ef", 2.4);
  key.position.set(1.8, 3.2, 2.6);
  key.castShadow = true;
  configureKeyShadow(key);
  scene.add(key, key.target, new AmbientLight("#ffffff", 0.1));
  const plane = new Mesh(
    new PlaneGeometry(4, 4),
    new MeshPhysicalMaterial({ color: "#c68e6e", roughness: 0.5 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  // Invisible to the camera, which looks down on the plane through it; the shadow pass does not use its material.
  const occluder = new Mesh(
    new BoxGeometry(0.5, 0.01, 0.5),
    new MeshPhysicalMaterial({ colorWrite: false, depthWrite: false }),
  );
  occluder.position.set(0, height, 0);
  occluder.castShadow = true;
  scene.add(plane, occluder);
  const camera = new OrthographicCamera(
    (-SPAN * WIDTH) / HEIGHT / 2,
    (SPAN * WIDTH) / HEIGHT / 2,
    SPAN / 2,
    -SPAN / 2,
    0.1,
    10,
  );
  camera.position.set(0, 5, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  renderer.toneMapping = NoToneMapping;
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(WIDTH * HEIGHT * 4);
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, px);
  renderer.setRenderTarget(null);
  // The shadow lies away from the light, on the plane: along (-1.8, -2.6) in (x, z). In the image
  // x is to the right and z is down (the camera's up is -z), so the row's y grows with z.
  // Walk from the plane's middle (under the occluder, shadowed) out along that line to where it is lit.
  const dir = [-1.8, -2.6];
  const norm = Math.hypot(dir[0] as number, dir[1] as number);
  const along = (m: number) => {
    const x = ((dir[0] as number) / norm) * m;
    const z = ((dir[1] as number) / norm) * m;
    return {
      col: Math.round(WIDTH / 2 + x / METRES_PER_PIXEL),
      row: Math.round(HEIGHT / 2 + z / METRES_PER_PIXEL),
    };
  };
  const lum: number[] = [];
  for (let m = 0; m < 0.75; m += METRES_PER_PIXEL / 2) {
    const { col, row } = along(m);
    const y = HEIGHT - 1 - row;
    if (col < 0 || col >= WIDTH || y < 0 || y >= HEIGHT) break;
    const i = (y * WIDTH + col) * 4;
    lum.push(
      0.2126 * (px[i] as number) + 0.7152 * (px[i + 1] as number) + 0.0722 * (px[i + 2] as number),
    );
  }
  plane.geometry.dispose();
  occluder.geometry.dispose();
  (plane.material as MeshPhysicalMaterial).dispose();
  (occluder.material as MeshPhysicalMaterial).dispose();
  key.shadow.dispose();
  // From the shadowed core to the lit plane: the first sample in the shadow, the last lit.
  const dark = Math.min(...lum.slice(0, 20));
  const lit = Math.max(...lum.slice(-20));
  expect(lit, "the plane is lit past the shadow").toBeGreaterThan(2 * dark);
  const at = (frac: number) => lum.findIndex((v) => v >= dark + frac * (lit - dark));
  // Samples were taken every half pixel.
  return (at(0.9) - at(0.1)) / 2;
}

describe("the studio key light's shadow on skin", () => {
  it("is the variance shadow map the stage is validated with, fitted to the figure", () => {
    expect(STUDIO_SHADOWS).toBe("variance");
    // A texel is about a millimetre or two: the map covers a figure's box, not the light's default.
    expect((2 * KEY_SHADOW.extent) / KEY_SHADOW.mapSize).toBeLessThan(0.0015);
  });

  it("has a penumbra of at least four pixels at the evidence framing, under a belly's few centimetres or a hand's ten", () => {
    for (const height of [0.03, 0.1]) {
      const width = penumbra(height);
      expect(width, `occluder ${height} m over the skin: ${width} px`).toBeGreaterThanOrEqual(4);
    }
  });

  it("is not so soft that a contact shadow loses its form: under 16 pixels (6 cm) a few centimetres off the skin", () => {
    expect(penumbra(0.03)).toBeLessThan(16);
  });
});
