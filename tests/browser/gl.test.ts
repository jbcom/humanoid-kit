/**
 * The suite's renderer helper (gl.ts): a renderer from it draws, and one released
 * has lost its context and refuses to draw or read, so a test cannot take what
 * a lost context returns for a measurement.
 */
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene } from "three";
import { describe, expect, it } from "vitest";
import { createTestRenderer, releaseTestRenderer } from "./gl.ts";

describe("createTestRenderer", () => {
  it("draws and reads on a live context", () => {
    const renderer = createTestRenderer({ antialias: false });
    renderer.setSize(4, 4, false);
    const scene = new Scene();
    const quad = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ color: 0xffffff }));
    scene.add(quad);
    const camera = new PerspectiveCamera(60, 1, 0.1, 10);
    camera.position.z = 1;
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    expect(px[0]).toBe(255);
    quad.geometry.dispose();
    quad.material.dispose();
  });

  it("loses the context of a renderer it releases, and refuses to draw on it", () => {
    const renderer = createTestRenderer({ antialias: false });
    expect(renderer.getContext().isContextLost()).toBe(false);
    releaseTestRenderer(renderer);
    expect(renderer.getContext().isContextLost()).toBe(true);
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    expect(() => renderer.render(scene, camera)).toThrow(/released/);
    // Releasing twice is not an error.
    expect(() => releaseTestRenderer(renderer)).not.toThrow();
  });

  it("makes a new canvas when none is given, and uses the one it is given", () => {
    const own = createTestRenderer({ antialias: false });
    expect(own.domElement).toBeInstanceOf(HTMLCanvasElement);
    const canvas = document.createElement("canvas");
    const given = createTestRenderer({ canvas, antialias: false });
    expect(given.domElement).toBe(canvas);
  });
});
