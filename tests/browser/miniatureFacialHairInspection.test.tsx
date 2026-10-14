/**
 * Review-only comparison of an opaque miniature and the same bake with its
 * selected source facial cards preserved. It is deliberately not a claim that
 * source cards are a solid miniature representation.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { hairPack } from "humanoid-kit-hair";
import { useEffect, useMemo } from "react";
import type { PerspectiveCamera, Scene } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  bakeMiniature,
  type DecodedTexture,
  type MiniatureBake,
} from "../../src/bake/miniature.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { MiniatureCrowd } from "../../src/render/miniature.ts";

const inspect = import.meta.env.HK_FACIAL_HAIR_MINIATURE_INSPECTION === "1" ? it : it.skip;
const BEARD = "beard-viking";
const LOAD = { timeout: 60_000 };
let bakes: readonly [MiniatureBake, MiniatureBake] | null = null;

async function rgba(url: string): Promise<DecodedTexture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`source texture fetch failed: ${response.status}`);
  const image = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("source texture canvas is unavailable");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height);
  image.close();
  return { width: pixels.width, height: pixels.height, data: pixels.data };
}

async function miniatureBakes(): Promise<readonly [MiniatureBake, MiniatureBake]> {
  if (bakes) return bakes;
  const assets = await loadHumanoidAssets({ body: bodyPack, hair: hairPack });
  await assets.hair?.load(BEARD);
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const recipe = createRecipe({ hair: { style: null }, facialHair: [BEARD] });
  const source = await rgba(hairPack.files["beard-viking.webp"]);
  const opaque = bakeMiniature(model, recipe, { body: "surface", lods: [800] });
  const cards = bakeMiniature(model, recipe, {
    body: "surface",
    lods: [800],
    facialHair: "alpha-cards",
    texture: (part) => (part.id === BEARD ? source : null),
  });
  bakes = [opaque, cards];
  return bakes;
}

function Crowds({
  bakes: source,
  onReady,
}: {
  bakes: readonly [MiniatureBake, MiniatureBake];
  onReady: () => void;
}) {
  const crowds = useMemo(
    () => source.map((bake) => new MiniatureCrowd([bake], { levelPixels: [0] })),
    [source],
  );
  const { camera, size } = useThree();
  useEffect(() => {
    crowds.forEach((crowd, index) => {
      crowd.setFigures([{ archetype: 0, x: index === 0 ? -0.42 : 0.42, z: 0 }]);
    });
    onReady();
    return () => {
      crowds.forEach((crowd) => {
        crowd.dispose();
      });
    };
  }, [crowds, onReady]);
  useFrame(({ clock }) => {
    crowds.forEach((crowd) => {
      crowd.update(camera, clock.elapsedTime, size.height);
    });
  });
  return (
    <>
      {crowds.map((crowd) => (
        <primitive key={crowd.object.uuid} object={crowd.object} />
      ))}
    </>
  );
}

function Inspection({
  bakes: source,
  onReady,
}: {
  bakes: readonly [MiniatureBake, MiniatureBake];
  onReady: () => void;
}) {
  return (
    <div data-inspection="miniature-facial-hair">
      <Canvas
        style={{ width: 960, height: 620 }}
        dpr={1}
        camera={{ position: [0, 1.54, 2.45], fov: 26 }}
        onCreated={({ camera, scene }) => {
          (camera as PerspectiveCamera).lookAt(0, 1.54, 0);
          (scene as Scene).background = null;
        }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[1, 2, 2]} intensity={2.2} />
        <Crowds bakes={source} onReady={onReady} />
      </Canvas>
      <table>
        <caption>Source facial cards preserved in a miniature bake</caption>
        <tbody>
          <tr>
            <th>left</th>
            <td>opaque miniature; selected facial source omitted</td>
          </tr>
          <tr>
            <th>right</th>
            <td>same recipe; exact source cards, UV seams and embedded RGBA alpha</td>
          </tr>
        </tbody>
      </table>
      <p>Diagnostic source-card preservation only; not an alpha-to-solid miniature claim.</p>
    </div>
  );
}

describe("facial source card miniature inspection", () => {
  inspect(
    "shows the selected authored beard only in the alpha-card companion payload",
    async () => {
      const source = await miniatureBakes();
      expect(source[0].alphaCards).toBeUndefined();
      expect(source[1].alphaCards?.[0]?.id).toBe(BEARD);
      let ready = false;
      const screen = await render(
        <Inspection
          bakes={source}
          onReady={() => {
            ready = true;
          }}
        />,
      );
      const fixture = screen.container.querySelector("[data-inspection]");
      if (!fixture) throw new Error("miniature facial-hair inspection root is not mounted");
      await expect.poll(() => ready, LOAD).toBe(true);
      const canvas = fixture.querySelector("canvas");
      if (!canvas) throw new Error("miniature facial-hair inspection canvas is not mounted");
      const bounds = canvas.getBoundingClientRect();
      expect(bounds.width).toBe(960);
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(
        screen.getByText(/exact source cards, UV seams and embedded RGBA alpha/),
      ).toBeVisible();
      expect(screen.getByText(/not an alpha-to-solid miniature claim/)).toBeVisible();
      await page.screenshot({
        element: fixture,
        path: "../../test-results/miniature-facial-hair-inspection/source-card-comparison.png",
      });
      await screen.unmount();
    },
    LOAD.timeout + 10_000,
  );
});

afterAll(() => {
  bakes = null;
});
