/** Bounded native-source comparison; the root reviewer inspects these captures. */
import { bodyPack } from "humanoid-kit-body";
import { hairPack } from "humanoid-kit-hair";
import {
  AmbientLight,
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from "three";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { bakeMiniature } from "../../src/bake/miniature.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { MiniatureCrowd } from "../../src/render/miniature.ts";
import { createTestRenderer, releaseTestRenderer } from "./gl.ts";

it.each([false, true])(
  "captures static native source near/far (with moustache: %s)",
  async (combined) => {
    await page.viewport(1000, 800);
    const assets = await loadHumanoidAssets({ body: bodyPack, hair: hairPack });
    const styles = combined ? ["beard-viking", "moustache-viking"] : ["beard-viking"];
    const textures = new Map<string, ImageData>();
    for (const style of styles) {
      await assets.hair?.load(style);
      const response = await fetch(hairPack.files[`${style}.webp` as keyof typeof hairPack.files]);
      const image = await createImageBitmap(await response.blob());
      const decoded = new OffscreenCanvas(image.width, image.height);
      const context = decoded.getContext("2d");
      if (!context) throw new Error("no source decoder");
      context.drawImage(image, 0, 0);
      image.close();
      textures.set(style, context.getImageData(0, 0, decoded.width, decoded.height));
    }
    const outputDirectory = combined ? "facial-all-lod-combined" : "facial-all-lod-source";
    const model = new HumanoidModel(assets, { subdivision: 0 });
    const bake = bakeMiniature(model, createRecipe({ hair: { style: null }, facialHair: styles }), {
      body: "surface",
      lods: [800, 400],
      facialHair: "alpha-cards",
      texture: (part) => {
        const pixels = textures.get(part.id);
        if (!pixels) return null;
        return { width: pixels.width, height: pixels.height, data: pixels.data };
      },
    });
    const near = new MiniatureCrowd([bake], { levelPixels: [0, 0] }),
      far = new MiniatureCrowd([bake], { levelPixels: [1e9, 0], facialHairLod: "all" });
    const scene = new Scene();
    const key = new DirectionalLight(0xffffff, 2.5);
    key.position.set(2, 3, 4);
    scene.add(key, new AmbientLight(0xffffff, 1.3), near.object, far.object);
    const renderer = createTestRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x777777, 1);
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "width:960px;background:#222;color:white;font:16px sans-serif;";
    const label = document.createElement("div");
    wrapper.append(label, renderer.domElement);
    document.body.append(wrapper);
    const cardPositions = bake.alphaCards?.[0]?.positions;
    if (!cardPositions) throw new Error("missing native card");
    const heights = Array.from(cardPositions).filter((_, i) => i % 3 === 1);
    const y = (Math.min(...heights) + Math.max(...heights)) / 2 + 0.08;
    const camera = new OrthographicCamera(-0.75, 0.75, 0.5, -0.5, 0.01, 20);
    for (const [name, yaw, elevation] of [
      ["front", 0, 0],
      ["oblique", Math.PI / 4, 0],
      ["profile", Math.PI / 2, 0],
    ] as const) {
      near.setFigures([{ archetype: 0, x: -0.34 * Math.cos(yaw), z: 0.34 * Math.sin(yaw) }]);
      far.setFigures([{ archetype: 0, x: 0.34 * Math.cos(yaw), z: -0.34 * Math.sin(yaw) }]);
      camera.position.set(
        Math.sin(yaw) * Math.cos(elevation) * 4,
        y + Math.sin(elevation) * 4,
        Math.cos(yaw) * Math.cos(elevation) * 4,
      );
      camera.lookAt(0, y, 0);
      const a = near.update(camera, 0, 640),
        b = far.update(camera, 0, 640);
      if (name === "front")
        console.info(
          "all-lod-facial-source-receipt",
          JSON.stringify({
            sourceStyles: styles,
            frameCount: bake.frameCount,
            near: a,
            far: b,
            retainedTextureBytes: far.textureBytes,
            sourceVertices: bake.alphaCards?.reduce((sum, card) => sum + card.vertexCount, 0),
            sourceTriangles: bake.alphaCards?.reduce((sum, card) => sum + card.index.length / 3, 0),
          }),
        );
      expect(a.perLevel).toEqual([1, 0]);
      expect(b.perLevel).toEqual([0, 1]);
      expect(b.drawCalls).toBe(combined ? 3 : 2);
      expect(far.textureBytes).toBe(near.textureBytes);
      label.textContent = `${name}: authored cards near (left), exact authored cards far (right). Forced levels for inspection.`;
      renderer.render(scene, camera);
      expect(wrapper.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      await page.screenshot({
        element: wrapper,
        path: `../../test-results/${outputDirectory}/${name}.png`,
      });
    }
    scene.remove(near.object, far.object);
    near.dispose();
    far.dispose();
    const distanceCrowd = new MiniatureCrowd([bake], { facialHairLod: "all" });
    scene.add(distanceCrowd.object);
    distanceCrowd.setFigures([{ archetype: 0, x: 0, z: 0 }]);
    const distanceCamera = new PerspectiveCamera(50, 960 / 640, 0.1, 500);
    const thresholdDistance = (bake.max[1] * 640) / (2 * Math.tan((50 * Math.PI) / 360) * 64);
    for (const [name, distance, yaw, expected] of [
      ["actual-near", 14, 0, [1, 0]],
      ["actual-far", 26, 0, [0, 1]],
      ["threshold-near", thresholdDistance * 0.99, Math.PI / 8, [1, 0]],
      ["threshold-far", thresholdDistance * 1.01, Math.PI / 8, [0, 1]],
    ] as const) {
      distanceCamera.position.set(
        Math.sin(yaw) * distance,
        bake.max[1] / 2,
        Math.cos(yaw) * distance,
      );
      distanceCamera.lookAt(0, bake.max[1] / 2, 0);
      const stats = distanceCrowd.update(distanceCamera, 0, 640);
      expect(stats.perLevel).toEqual(expected);
      label.textContent = `${name}: camera distance ${distance.toFixed(3)} m, yaw ${((yaw * 180) / Math.PI).toFixed(1)}°, default 64 px LOD threshold; ${stats.triangles} triangles, ${stats.drawCalls} draws.`;
      renderer.render(scene, distanceCamera);
      await page.screenshot({
        element: wrapper,
        path: `../../test-results/${outputDirectory}/${name}.png`,
      });
    }
    distanceCrowd.dispose();
    scene.remove(distanceCrowd.object);
    wrapper.remove();
    releaseTestRenderer(renderer);
  },
  120_000,
);
