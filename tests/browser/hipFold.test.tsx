/**
 * The hip fold through the whole path (docs/ARCHITECTURE.md, "The hip fold"): a
 * figure whose hips are flexed past the fold's start asks the worker for the
 * fold, which reaches the body's geometry (a slot per vertex) and the bone
 * texture's fold (a row per moved vertex), and the figure settles only after.
 * The picture shows it.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import {
  type BufferAttribute,
  type Object3D,
  type Scene,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import {
  type DualBones,
  FOLD_SLOT_ATTRIBUTE,
  noFoldTexture,
} from "../../src/render/dualSkinning.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 180_000 };
/** The side (pixels) of the pictures drawn: close enough on the lap for the groin to be most of one. */
const SIDE = 512;

const client = inlineWorkerClient({ subdivision: 1 });
beforeAll(async () => {
  await client.ready;
});
afterAll(() => client.dispose());

/** Hands the test the canvas's state, to read the scene and draw it. */
function Probe({ onReady }: { onReady: (get: () => RootState) => void }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    onReady(get);
  }, [get, onReady]);
  return null;
}

/** The figure's bone texture, found on its group. */
function bonesOf(scene: Scene): DualBones | null {
  let found: DualBones | null = null;
  scene.traverse((o: Object3D) => {
    const dual = (o.userData as { dualBones?: DualBones | null }).dualBones;
    if (dual) found = dual;
  });
  return found;
}

/** How many vertices of the scene's geometries have a fold slot, and how many rows the fold texture has. */
function foldOf(scene: Scene) {
  let slots = 0;
  scene.traverse((o: Object3D) => {
    const g = (o as { geometry?: { getAttribute(n: string): BufferAttribute | undefined } })
      .geometry;
    const a = g?.getAttribute(FOLD_SLOT_ATTRIBUTE);
    if (a) for (const s of a.array) if ((s as number) >= 0) slots++;
  });
  const dual = bonesOf(scene);
  return { slots, rows: dual ? (dual.fold.value.image as { height: number }).height : 0 };
}

/** Light for the figure to be seen by: unlit, a skin draws black. */
function Lights() {
  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[1.5, 2, 3]} intensity={2.5} />
    </>
  );
}

describe("the hip fold in <Humanoid>", () => {
  it(
    "reaches the geometry and the bone texture before the figure settles, and the picture shows it, when the hips are flexed",
    async () => {
      let get: (() => RootState) | null = null;
      let settled = false;
      let atSettle = { slots: 0, rows: 0 };
      await render(
        <HumanoidProvider client={client}>
          <div style={{ width: 240, height: 240 }}>
            <Canvas>
              <Probe onReady={(g) => (get = g)} />
              <Lights />
              <Humanoid
                recipe={createRecipe()}
                pose={{ body: "tucked" }}
                onSettled={() => {
                  settled = true;
                  if (get) atSettle = foldOf(get().scene);
                }}
              />
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => settled, LOAD).toBe(true);
      expect(atSettle.slots).toBeGreaterThan(50);
      expect(atSettle.rows).toBeGreaterThan(50);
      // The same figure drawn with the fold and without differs where the groin is: seen from the front, the side, above and below.
      const state = (get as unknown as () => RootState)();
      const dual = bonesOf(state.scene) as DualBones;
      const draw = (at: [number, number, number]) => {
        state.camera.position.set(...at);
        state.camera.lookAt(0, 0.5, 0.15);
        state.camera.updateMatrixWorld();
        const target = new WebGLRenderTarget(SIDE, SIDE, { type: UnsignedByteType });
        state.gl.setRenderTarget(target);
        state.gl.render(state.scene, state.camera);
        const px = new Uint8Array(SIDE * SIDE * 4);
        state.gl.readRenderTargetPixels(target, 0, 0, SIDE, SIDE, px);
        state.gl.setRenderTarget(null);
        target.dispose();
        return px;
      };
      const views: [number, number, number][] = [
        [0.35, 0.5, 0.9],
        [1, 0.6, 0.15],
        [0.15, 1.5, 0.7],
        [0.3, -0.2, 0.9],
      ];
      const held = dual.fold.value;
      const folded = views.map(draw);
      dual.fold.value = noFoldTexture();
      const bare = views.map(draw);
      dual.fold.value = held;
      const seen = folded.map((px, view) => {
        let lit = 0;
        let differing = 0;
        const other = bare[view] as Uint8Array;
        for (let i = 0; i < px.length; i += 4) {
          if ((px[i] as number) > 12) lit++;
          const change = [0, 1, 2].reduce(
            (s, c) => s + Math.abs((px[i + c] as number) - (other[i + c] as number)),
            0,
          );
          if (change > 12) differing++;
        }
        return { lit, differing };
      });
      // The figure is lit in the picture, so a difference is the fold's and not a black frame's.
      expect(Math.max(...seen.map((s) => s.lit)), "pixels the figure lights").toBeGreaterThan(1500);
      expect(
        Math.max(...seen.map((s) => s.differing)),
        `pixels the fold changes, per view ${JSON.stringify(seen)}`,
      ).toBeGreaterThan(40);
    },
    LOAD.timeout,
  );

  it(
    "asks for no fold while the hips are not flexed",
    async () => {
      let get: (() => RootState) | null = null;
      let settled = false;
      await render(
        <HumanoidProvider client={client}>
          <div style={{ width: 240, height: 240 }}>
            <Canvas>
              <Probe onReady={(g) => (get = g)} />
              <Humanoid
                recipe={createRecipe()}
                pose={{ body: "relaxed" }}
                onSettled={() => {
                  settled = true;
                }}
              />
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => settled, LOAD).toBe(true);
      expect(foldOf((get as unknown as () => RootState)().scene)).toEqual({ slots: 0, rows: 1 });
    },
    LOAD.timeout,
  );
});
