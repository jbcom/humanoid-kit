/**
 * The eye material's shader (src/render/eyeMaterial.ts) compiles in every state
 * it is drawn in: before the eye's texture has arrived (no map) as well as
 * after, for each of its modes.
 */
import {
  DataTexture,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  WebGLRenderer,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import { EyeMaterial } from "../../src/render/eyeMaterial.ts";

const renderer = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
renderer.setSize(8, 8, false);
const errors: string[] = [];
renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
  errors.push(`${vertex}|${fragment}`);
};
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
afterAll(() => renderer.dispose());

/** Draws a quad in an eye material in `mode`, with or without a map; the shader errors it raised. */
function draw(mode: number, withMap: boolean): string[] {
  errors.length = 0;
  const material = new EyeMaterial();
  material.hkUniforms.hkEyeMode.value = mode;
  if (withMap) {
    const map = new DataTexture(new Uint8Array([200, 120, 80, 255]), 1, 1, RGBAFormat);
    map.needsUpdate = true;
    material.map = map;
  }
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));
  renderer.render(scene, camera);
  material.map?.dispose();
  material.dispose();
  return [...errors];
}

describe("the eye material's shader", () => {
  it("compiles before the eye's texture has arrived, in every mode", () => {
    for (const mode of [0, 1, 2]) expect(draw(mode, false), `mode ${mode}`).toEqual([]);
  });

  it("compiles with its texture, in every mode", () => {
    for (const mode of [0, 1, 2]) expect(draw(mode, true), `mode ${mode}`).toEqual([]);
  });
});
