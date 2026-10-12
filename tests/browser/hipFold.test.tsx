/**
 * The hip fold through the whole path (docs/ARCHITECTURE.md, "The hip fold"): a
 * figure whose hips are flexed past the fold's start asks the worker for the
 * fold, which reaches the body's geometry (a slot per vertex) and the bone
 * texture's fold (a row per moved vertex), and the figure settles only after.
 * The picture shows it.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import {
  type BufferAttribute,
  type Object3D,
  type Scene,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import {
  DualBones,
  FOLD_ROWS_PER_LINE,
  FOLD_SLOT_ATTRIBUTE,
  noFoldTexture,
} from "../../src/render/dualSkinning.ts";
import { yieldWorkerTask } from "../../src/worker/task.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 180_000 };
/** The side (pixels) of the pictures drawn: close enough on the lap for the groin to be most of one. */
const SIDE = 512;

const client = inlineWorkerClient({ subdivision: 1 });
beforeAll(async () => {
  await client.ready;
});
afterAll(() => client.dispose());

/** Hands the test the canvas's state before its first browser paint. */
function Probe({ onReady }: { onReady: (state: RootState) => (() => void) | undefined }) {
  const state = useThree();
  useLayoutEffect(() => {
    return onReady(state);
  }, [onReady, state]);
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

/** How many vertices of the scene's geometries have a fold slot, and how many rows the fold texture holds (`FOLD_ROWS_PER_LINE` a line). */
function foldOf(scene: Scene) {
  let slots = 0;
  scene.traverse((o: Object3D) => {
    const g = (o as { geometry?: { getAttribute(n: string): BufferAttribute | undefined } })
      .geometry;
    const a = g?.getAttribute(FOLD_SLOT_ATTRIBUTE);
    if (a) for (const s of a.array) if ((s as number) >= 0) slots++;
  });
  const dual = bonesOf(scene);
  return {
    slots,
    rows: dual ? (dual.fold.value.image as { height: number }).height * FOLD_ROWS_PER_LINE : 0,
  };
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
      const started = performance.now();
      const marks: Partial<
        Record<
          | "request"
          | "reply"
          | "modelHipFold"
          | "solveYield"
          | "solveDone"
          | "setFold"
          | "fadeDone"
          | "settled"
          | "initialDrawStart"
          | "initialDrawComplete"
          | "bodyAttachedDrawStart"
          | "bodyAttachedDrawComplete"
          | "postFoldDrawStart"
          | "postFoldDrawComplete",
          number
        >
      > = {};
      const mark = (phase: keyof typeof marks) => {
        if (marks[phase] !== undefined) return;
        const ms = performance.now() - started;
        marks[phase] = ms;
        console.info("hip-fold-inline-phase-diagnostic", JSON.stringify({ phase, ms }));
      };
      let watched: DualBones | null = null;
      let restoreDraw = () => {};
      const restoreStepNext: Array<() => void> = [];
      let solveNextCalls = 0;
      let solveNextMs = 0;
      let waitingRenderCount = 0;
      let waitingRenderMs = 0;
      let waitingRenderMaxMs = 0;
      const traceNext = (phase: "enter" | "exit", call: number, elapsed?: number) => {
        // Keep CI output bounded while retaining the first resumption and progress through later keys.
        if (call > 2 && (call & (call - 1)) !== 0) return;
        console.info(
          "hip-fold-inline-phase-diagnostic",
          JSON.stringify({
            phase: `solveNext${phase}`,
            call,
            wallMs: performance.now() - started,
            elapsed,
            cumulativeMs: solveNextMs,
          }),
        );
      };
      const originalHipFold = client.hipFold;
      const originalModelHipFold = HumanoidModel.prototype.hipFold;
      const originalSetFold = DualBones.prototype.setFold;
      const originalAdvanceFold = DualBones.prototype.advanceFold;
      console.info(
        "hip-fold-inline-runtime-diagnostic",
        JSON.stringify({
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          messageChannelAvailable: typeof MessageChannel !== "undefined",
        }),
      );
      const controlStarted = performance.now();
      await yieldWorkerTask();
      const firstControlYieldMs = performance.now() - controlStarted;
      const secondControlStarted = performance.now();
      await yieldWorkerTask();
      console.info(
        "hip-fold-inline-yield-control",
        JSON.stringify({
          firstControlYieldMs,
          secondControlYieldMs: performance.now() - secondControlStarted,
        }),
      );
      client.hipFold = async (...args) => {
        mark("request");
        const result = await originalHipFold.call(client, ...args);
        mark("reply");
        return result;
      };
      // This inline test invokes the handler in this realm, rather than crossing Worker/IPC.
      HumanoidModel.prototype.hipFold = function (...args) {
        mark("modelHipFold");
        const steps = originalModelHipFold.apply(this, args);
        const originalNext = steps.next;
        const originalNextDescriptor = Object.getOwnPropertyDescriptor(steps, "next");
        const tracedNext = (...nextArgs: Parameters<typeof steps.next>) => {
          const call = ++solveNextCalls;
          if (call <= 2) traceNext("enter", call);
          const started = performance.now();
          try {
            const result = originalNext.apply(steps, nextArgs);
            mark(result.done ? "solveDone" : "solveYield");
            return result;
          } finally {
            const elapsed = performance.now() - started;
            solveNextMs += elapsed;
            traceNext("exit", call, elapsed);
          }
        };
        steps.next = tracedNext;
        restoreStepNext.push(() => {
          if (steps.next !== tracedNext) return;
          if (originalNextDescriptor) Object.defineProperty(steps, "next", originalNextDescriptor);
          else delete (steps as unknown as Record<string, unknown>).next;
        });
        return steps;
      };
      DualBones.prototype.setFold = function (...args) {
        watched ??= this;
        if (this === watched) mark("setFold");
        return originalSetFold.apply(this, args);
      };
      DualBones.prototype.advanceFold = function (...args) {
        const active = originalAdvanceFold.apply(this, args);
        if (this === watched && marks.setFold !== undefined && !active) mark("fadeDone");
        return active;
      };
      let get: (() => RootState) | null = null;
      let settled = false;
      let atSettle = { slots: 0, rows: 0, blend: -1 };
      try {
        await render(
          <HumanoidProvider client={client}>
            <div style={{ width: 240, height: 240 }}>
              <Canvas>
                <Probe
                  onReady={(state) => {
                    get = state.get;
                    const originalRender = state.gl.render;
                    state.gl.render = function (...args) {
                      const phase = marks.setFold === undefined ? "initialDraw" : "postFoldDraw";
                      mark(`${phase}Start`);
                      const bodyAttached = bonesOf(state.scene) !== null;
                      if (bodyAttached) mark("bodyAttachedDrawStart");
                      const renderStarted = performance.now();
                      try {
                        return originalRender.apply(this, args);
                      } finally {
                        const renderMs = performance.now() - renderStarted;
                        if (marks.request !== undefined && marks.reply === undefined) {
                          waitingRenderCount++;
                          waitingRenderMs += renderMs;
                          waitingRenderMaxMs = Math.max(waitingRenderMaxMs, renderMs);
                        }
                        if (bodyAttached) mark("bodyAttachedDrawComplete");
                        mark(`${phase}Complete`);
                      }
                    };
                    let restored = false;
                    restoreDraw = () => {
                      if (restored) return;
                      state.gl.render = originalRender;
                      restored = true;
                    };
                    return restoreDraw;
                  }}
                />
                <Lights />
                <Humanoid
                  recipe={createRecipe()}
                  pose={{ body: "tucked" }}
                  onSettled={() => {
                    mark("settled");
                    settled = true;
                    if (get) {
                      const scene = get().scene;
                      atSettle = { ...foldOf(scene), blend: bonesOf(scene)?.foldBlend.value ?? -1 };
                    }
                  }}
                />
              </Canvas>
            </div>
          </HumanoidProvider>,
        );
        await expect.poll(() => settled, LOAD).toBe(true);
        expect(atSettle.slots).toBeGreaterThan(50);
        expect(atSettle.rows).toBeGreaterThan(50);
        // The fold fades in when it arrives, and the figure is not settled before it is whole.
        expect(atSettle.blend).toBe(1);
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
        expect(Math.max(...seen.map((s) => s.lit)), "pixels the figure lights").toBeGreaterThan(
          1500,
        );
        expect(
          Math.max(...seen.map((s) => s.differing)),
          `pixels the fold changes, per view ${JSON.stringify(seen)}`,
        ).toBeGreaterThan(40);
      } finally {
        restoreDraw();
        client.hipFold = originalHipFold;
        for (const restore of restoreStepNext) restore();
        HumanoidModel.prototype.hipFold = originalModelHipFold;
        DualBones.prototype.setFold = originalSetFold;
        DualBones.prototype.advanceFold = originalAdvanceFold;
        console.info(
          "hip-fold-inline-phase-diagnostic",
          JSON.stringify({
            ...marks,
            solveNextCalls,
            solveNextMs,
            waitingRenderCount,
            waitingRenderMs,
            waitingRenderMaxMs,
          }),
        );
      }
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
              <Probe
                onReady={(state) => {
                  get = state.get;
                  return undefined;
                }}
              />
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
      expect(foldOf((get as unknown as () => RootState)().scene)).toEqual({
        slots: 0,
        rows: FOLD_ROWS_PER_LINE,
      });
    },
    LOAD.timeout,
  );
});
