/** Bounded static source-card LOD GPU comparison, with paired source coverage counts. */
import { bodyPack } from "humanoid-kit-body";
import { hairPack } from "humanoid-kit-hair";
import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene } from "three";
import { expect, it } from "vitest";
import { bakeMiniature, type MiniatureBake } from "../../src/bake/miniature.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { MiniatureCrowd } from "../../src/render/miniature.ts";
import { createTestRenderer, releaseTestRenderer } from "./gl.ts";

it.each([true])(
  "measures 600 static source cards and all-LOD source cards (antialias: %s)",
  async (antialias) => {
    const assets = await loadHumanoidAssets({ body: bodyPack, hair: hairPack });
    await assets.hair?.load("beard-viking");
    const image = await createImageBitmap(
      await (await fetch(hairPack.files["beard-viking.webp"])).blob(),
    );
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext("2d");
    if (!context) throw new Error("no source decoder");
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const bake = bakeMiniature(
      new HumanoidModel(assets, { subdivision: 0 }),
      createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] }),
      {
        body: "surface",
        lods: [800, 400],
        facialHair: "alpha-cards",
        texture: (part) =>
          part.id === "beard-viking"
            ? { width: pixels.width, height: pixels.height, data: pixels.data }
            : null,
      },
    );
    const withCards = bake;
    const { alphaCards: _, ...withoutCards } = bake;
    const level = bake.lods[1];
    if (!level) throw new Error("no shared body LOD");
    const sourceBake = { ...withCards, lods: [level, level] },
      bodyBake = { ...withoutCards, lods: [level, level] };
    const renderer = createTestRenderer({ antialias });
    renderer.setSize(960, 640);
    renderer.setPixelRatio(1);
    const scene = new Scene(),
      key = new DirectionalLight(0xffffff, 2.5);
    key.position.set(2, 3, 4);
    scene.add(key, new AmbientLight(0xffffff, 1.3));
    const camera = new PerspectiveCamera(50, 1.5, 0.01, 100);
    camera.position.set(0, 18, 32);
    camera.lookAt(0, 0.85, 0);
    const figures = Array.from({ length: 600 }, (_, i) => ({
      archetype: 0,
      x: (i % 30) - 14.5,
      z: Math.floor(i / 30) - 9.5,
      heading: ((i % 8) * Math.PI) / 4,
    }));
    const gl = renderer.getContext() as WebGL2RenderingContext,
      timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const receipts = [];
    const captured: Uint8Array[] = [];
    for (const [mode, selected, retained] of [
      ["body only", bodyBake, false],
      ["source alpha cards", sourceBake, false],
      ["all-LOD source cards", sourceBake, true],
    ] as const) {
      const crowd = new MiniatureCrowd([selected as MiniatureBake], {
        maxFigures: 600,
        triangleBudget: 4500000,
        facialHairLod: retained ? "all" : "near-only",
        levelPixels: retained ? [1e9, 0] : [0, 0],
      });
      crowd.setFigures(figures);
      scene.add(crowd.object);
      const stats = crowd.update(camera, 0, 640);
      expect(stats.visible).toBe(600);
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.render(scene, camera);
      const measured = {
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
      };
      expect(measured.triangles).toBe(stats.triangles);
      expect(measured.drawCalls).toBe(stats.drawCalls);
      if (retained) expect(stats.triangles).toBe(3649200);
      renderer.info.autoReset = true;
      for (let i = 0; i < 8; i++) renderer.render(scene, camera);
      gl.finish();
      const rgba = new Uint8Array(960 * 640 * 4);
      gl.readPixels(0, 0, 960, 640, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      captured.push(rgba);
      const cpuStart = performance.now();
      for (let i = 0; i < 50; i++) crowd.update(camera, i / 60, 640);
      const updateMeanMs = (performance.now() - cpuStart) / 50;
      const gpuBatchMeanMs: (number | null)[] = [];
      if (timer)
        for (let batch = 0; batch < 3; batch++) {
          const query = gl.createQuery();
          if (!query) throw new Error("no timer query");
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          for (let i = 0; i < 5; i++) renderer.render(scene, camera);
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          let available = false;
          for (let attempt = 0; attempt < 300; attempt++) {
            available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean;
            if (available) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          gpuBatchMeanMs.push(
            available && !gl.getParameter(timer.GPU_DISJOINT_EXT)
              ? (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 5e6
              : null,
          );
          gl.deleteQuery(query);
        }
      receipts.push({
        mode,
        stats,
        measured,
        retainedTextureBytes: crowd.textureBytes,
        updateMeanMs,
        gpuBatchMeanMs,
      });
      scene.remove(crowd.object);
      crowd.dispose();
    }
    const [bodyPixels, sourcePixels, retainedPixels] = captured;
    if (!bodyPixels || !sourcePixels || !retainedPixels)
      throw new Error("missing paired coverage render");
    let sourceAffected = 0,
      retainedAffected = 0,
      intersection = 0,
      sourceOnly = 0,
      retainedOnly = 0,
      absolute = 0;
    for (let p = 0; p < 960 * 640; p++) {
      let sourceDelta = 0,
        retainedDelta = 0,
        pairDelta = 0;
      for (let c = 0; c < 3; c++) {
        const b = bodyPixels[p * 4 + c] as number,
          s = sourcePixels[p * 4 + c] as number,
          g = retainedPixels[p * 4 + c] as number;
        sourceDelta += Math.abs(s - b);
        retainedDelta += Math.abs(g - b);
        pairDelta += Math.abs(s - g);
      }
      const source = sourceDelta > 15,
        retained = retainedDelta > 15;
      if (source) sourceAffected++;
      if (retained) retainedAffected++;
      if (source && retained) intersection++;
      if (source && !retained) sourceOnly++;
      if (retained && !source) retainedOnly++;
      if (source || retained) absolute += pairDelta;
    }
    expect(sourceAffected).toBeGreaterThan(0);
    expect(retainedAffected).toBeGreaterThan(0);
    expect(retainedPixels).toEqual(sourcePixels);
    const pairedCoverage = {
      thresholdRGBSum: 15,
      sourceAffected,
      retainedAffected,
      intersection,
      sourceOnly,
      retainedOnly,
      meanRGBByteDifferenceOnUnion: absolute / ((sourceAffected + retainedOnly) * 3),
    };
    console.info(
      "static-all-lod-source600",
      JSON.stringify({
        submitted: 600,
        antialias,
        gpuTimerSupported: Boolean(timer),
        receipts,
        pairedCoverage,
        meaning:
          "Three bounded five-render GPU timer batches after eight warmup frames on shared Metal host; separate 50-update CPU mean, no FPS or general performance claim. Identical 400-triangle body in every mode.",
      }),
    );
    releaseTestRenderer(renderer);
  },
  120000,
);
