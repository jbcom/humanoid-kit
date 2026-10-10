/**
 * The joint folds through the whole path (docs/ARCHITECTURE.md, "The hip
 * fold", "The knee fold"): a figure whose hips or knees are flexed past where
 * their folds start asks the worker for the folds, which reach the body's
 * geometry (a slot per vertex, per joint) and the bone texture's folds (a row
 * per moved vertex), and the figure settles only after. The picture shows it.
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
  foldRowsPerLine,
  foldSlotAttribute,
  noFoldTexture,
} from "../../src/render/dualSkinning.ts";
import { FOLD_JOINTS, type FoldJointName } from "../../src/rig/folds.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 180_000 };
/** The side (pixels) of the pictures drawn: close enough on the lap for the groin to be most of one. */
const SIDE = 512;

const client = inlineWorkerClient({ subdivision: 1 });
beforeAll(async () => {
  await client.ready;
  // The tucked figure's joint folds, solved once before any canvas draws: the model keeps them by shape, so the
  // figure's own request is answered at once. Solved in the page while a canvas renders, the solve's steps wait
  // on the frames between them, and the figure took longer than the test is given to settle (as it did before
  // the knee's fold, the hip's alone, on the render hosts).
  await client.folds(createRecipe());
}, LOAD.timeout);
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

/**
 * Per joint, how many vertices of the scene's geometries have a slot in its
 * fold, and how many rows its fold texture holds (`foldRowsPerLine` a line).
 */
function foldsOf(scene: Scene): Record<FoldJointName, { slots: number; rows: number }> {
  const dual = bonesOf(scene);
  const of = (joint: (typeof FOLD_JOINTS)[number]) => {
    let slots = 0;
    scene.traverse((o: Object3D) => {
      const g = (o as { geometry?: { getAttribute(n: string): BufferAttribute | undefined } })
        .geometry;
      const a = g?.getAttribute(foldSlotAttribute(joint));
      if (a) for (const s of a.array) if ((s as number) >= 0) slots++;
    });
    const image = dual?.folds[joint.name].value.image as { height: number } | undefined;
    return { slots, rows: image ? image.height * foldRowsPerLine(joint) : 0 };
  };
  return Object.fromEntries(FOLD_JOINTS.map((j) => [j.name, of(j)])) as Record<
    FoldJointName,
    { slots: number; rows: number }
  >;
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

describe("the joint folds in <Humanoid>", () => {
  it(
    "reach the geometry and the bone texture before the figure settles, and the picture shows them, when the hips and knees are flexed",
    async () => {
      let get: (() => RootState) | null = null;
      let settled = false;
      let atSettle: { folds: ReturnType<typeof foldsOf> | null; blend: number } = {
        folds: null,
        blend: -1,
      };
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
                  if (get) {
                    const scene = get().scene;
                    atSettle = {
                      folds: foldsOf(scene),
                      blend: bonesOf(scene)?.foldBlend.value ?? -1,
                    };
                  }
                }}
              />
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => settled, LOAD).toBe(true);
      // The tuck flexes the hips 120° and the knees 130°: both joints' folds arrive.
      for (const joint of FOLD_JOINTS) {
        expect(atSettle.folds?.[joint.name].slots, joint.name).toBeGreaterThan(50);
        expect(atSettle.folds?.[joint.name].rows, joint.name).toBeGreaterThan(50);
      }
      // The folds fade in when they arrive, and the figure is not settled before they are whole.
      expect(atSettle.blend).toBe(1);
      // The same figure drawn with the folds and without differs where the groin is: seen from the front, the side, above and below.
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
      const held = FOLD_JOINTS.map((joint) => dual.folds[joint.name].value);
      const folded = views.map(draw);
      for (const joint of FOLD_JOINTS) dual.folds[joint.name].value = noFoldTexture(joint);
      const bare = views.map(draw);
      FOLD_JOINTS.forEach((joint, j) => {
        dual.folds[joint.name].value.dispose();
        dual.folds[joint.name].value = held[j] as (typeof held)[number];
      });
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
        `pixels the folds change, per view ${JSON.stringify(seen)}`,
      ).toBeGreaterThan(40);
    },
    LOAD.timeout,
  );

  it(
    "asks for no fold while neither the hips nor the knees are flexed",
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
      expect(foldsOf((get as unknown as () => RootState)().scene)).toEqual(
        Object.fromEntries(
          FOLD_JOINTS.map((joint) => [joint.name, { slots: 0, rows: foldRowsPerLine(joint) }]),
        ),
      );
    },
    LOAD.timeout,
  );
});
