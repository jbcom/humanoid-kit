import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { useEffect } from "react";
import { type BufferGeometry, UnsignedByteType, WebGLRenderTarget } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { type DualBones, FOLD_SLOTS_ATTRIBUTE, foldSlotAt } from "../../src/render/dualSkinning.ts";
import { FOLD_JOINTS } from "../../src/rig/folds.ts";
import { HumanoidWorkerClient } from "../../src/worker/client.ts";

const recipe = createRecipe({ macros: { age: 25, weight: 1, muscle: 0.3 } });
const clients = [60, 5].map(
  (foldSolvePasses) =>
    new HumanoidWorkerClient(
      { body: bodyPack },
      { subdivision: 1, foldSolvePasses },
      new Worker(new URL("../../src/worker/index.ts", import.meta.url), { type: "module" }),
    ),
);
beforeAll(async () => {
  // Real workers receive the typed setting and solve before rendering starts.
  for (const client of clients) {
    await client.ready;
    await client.folds(recipe);
  }
}, 240_000);
afterAll(() => {
  for (const client of clients) client.dispose();
});

function Probe({ ready }: { ready: (get: () => RootState) => void }) {
  const get = useThree((s) => s.get);
  useEffect(() => ready(get), [get, ready]);
  return null;
}

/** Frozen views from actual Metal render-target pixels, shown together for inspection. */
describe("fold pass quality through the real worker and renderer", () => {
  it("keeps full fold rows at both settings and captures the tucked figure from four cameras", async () => {
    const states: (() => RootState)[] = [];
    const settled = [false, false];
    const figures = await render(
      <div style={{ display: "flex" }}>
        {clients.map((client, i) => (
          <HumanoidProvider key={[60, 5][i]} client={client}>
            <div style={{ width: 240, height: 240 }}>
              <Canvas frameloop="demand">
                <Probe
                  ready={(get) => {
                    states[i] = get;
                  }}
                />
                <ambientLight intensity={1.2} />
                <directionalLight position={[1.5, 2, 3]} intensity={2.5} />
                <Humanoid
                  recipe={recipe}
                  pose={{ body: "tucked" }}
                  onSettled={() => {
                    settled[i] = true;
                  }}
                />
              </Canvas>
            </div>
          </HumanoidProvider>
        ))}
      </div>,
    );
    await expect.poll(() => settled.every(Boolean), { timeout: 180_000 }).toBe(true);
    const views: [number, number, number][] = [
      [0.35, 0.5, 0.9],
      [1, 0.6, 0.15],
      [0.15, 1.5, 0.7],
      [0.3, -0.2, 0.9],
    ];
    const labels = ["front", "side", "above", "below"];
    const images: string[][] = [[], []];
    const pixels: Uint8Array[][] = [[], []];
    for (let i = 0; i < states.length; i++) {
      const state = (states[i] as () => RootState)();
      let dual: DualBones | null = null;
      const slots = { hip: 0, knee: 0 };
      state.scene.traverse((object) => {
        const found = (object.userData as { dualBones?: DualBones }).dualBones;
        if (found) dual = found;
        const geometry = (object as { geometry?: BufferGeometry }).geometry;
        const attribute = geometry?.getAttribute(FOLD_SLOTS_ATTRIBUTE);
        if (geometry && attribute)
          for (const joint of FOLD_JOINTS)
            for (let v = 0; v < attribute.count; v++)
              if (foldSlotAt(geometry, joint, v) >= 0) slots[joint.name]++;
      });
      expect(dual).not.toBeNull();
      for (const joint of FOLD_JOINTS) {
        expect(slots[joint.name]).toBeGreaterThan(50);
        const image = (dual as unknown as DualBones).folds[joint.name].value.image as {
          height: number;
        };
        expect(image.height).toBeGreaterThan(1);
      }
      for (const view of views) {
        state.camera.position.set(...view);
        state.camera.lookAt(0, 0.5, 0.15);
        state.camera.updateMatrixWorld();
        const target = new WebGLRenderTarget(512, 512, { type: UnsignedByteType });
        state.gl.setRenderTarget(target);
        state.gl.render(state.scene, state.camera);
        const rgba = new Uint8Array(512 * 512 * 4);
        state.gl.readRenderTargetPixels(target, 0, 0, 512, 512, rgba);
        state.gl.setRenderTarget(null);
        target.dispose();
        pixels[i]?.push(rgba);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 512;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("capture needs a 2d context");
        const flipped = new Uint8ClampedArray(rgba.length);
        for (let y = 0; y < 512; y++)
          flipped.set(rgba.subarray(y * 512 * 4, (y + 1) * 512 * 4), (511 - y) * 512 * 4);
        context.putImageData(new ImageData(flipped, 512, 512), 0, 0);
        images[i]?.push(canvas.toDataURL("image/png"));
      }
    }
    const differences = views.map((_, view) => {
      const full = pixels[0]?.[view] as Uint8Array;
      const reduced = pixels[1]?.[view] as Uint8Array;
      let lit = 0;
      let sum = 0;
      let max = 0;
      for (let p = 0; p < full.length; p += 4) {
        if ((full[p] as number) > 12) lit++;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs((full[p + c] as number) - (reduced[p + c] as number));
          sum += d;
          max = Math.max(max, d);
        }
      }
      expect(lit).toBeGreaterThan(1500);
      return { view: labels[view], rgbMae: sum / (512 * 512 * 3), rgbMax: max };
    });
    console.info("fold-quality-renderer-measurement", JSON.stringify(differences));
    await figures.unmount();
    await page.viewport(1100, 2500);
    const matrix = await render(
      <div
        data-inspection
        style={{ width: 1048, background: "#141820", color: "white", padding: 12 }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <h2 style={{ width: 512 }}>60 passes (default)</h2>
          <h2>5 passes (explicit tradeoff)</h2>
        </div>
        {views.map((_, view) => (
          <div key={labels[view]}>
            <p>{labels[view]} · tucked pose · source body · same cameras and lighting</p>
            <div style={{ display: "flex", gap: 8 }}>
              {images.map((column, i) => (
                <img
                  key={column[view]}
                  alt={`${labels[view]} ${i === 0 ? 60 : 5} passes`}
                  src={column[view]}
                  width={512}
                  height={512}
                />
              ))}
            </div>
          </div>
        ))}
      </div>,
    );
    const fixture = matrix.container.querySelector("[data-inspection]");
    if (!fixture) throw new Error("fold comparison is not mounted");
    expect(fixture.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot({
      element: fixture,
      path: "../../test-results/fold-quality-inspection/tucked-60-vs-5-four-cameras.png",
      fullPage: true,
    });
  }, 240_000);
});
