/**
 * The posed-fluid anchor against the exact body shader: the three GPU vertices
 * of its source triangle are read back after the body's eight-place dual
 * skinning and folds, then mixed by the anchor's barycentrics in world space.
 */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { useEffect } from "react";
import { type Scene, type SkinnedMesh, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import bodyManifest from "../../packs/body/data/manifest.json";
import { fluidAnchorPoint, fluidFrameFromPose } from "../../src/fluid/posedSurfaceFrame.ts";
import { FluidState, type FluidSurfaceAnchor } from "../../src/fluid/state.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { REST_POSE } from "../../src/foundation/permutations.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { type DualBones, Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { SKIN_INDEX_ATTRIBUTE_1, SKIN_WEIGHT_ATTRIBUTE_1 } from "../../src/render/dualSkinning.ts";
import { gpuWorldVertices } from "./fluidGpuReadback.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 300_000 };
const DIAGNOSTIC_TIMEOUT_MS = 30_000;
/** Float-target readback and the live shader agree within this measured float32 budget. */
const EXACT = 2e-6;
const client = inlineWorkerClient({ subdivision: 1 });
const recipe = createRecipe({ macros: { age: 25 } });

beforeAll(async () => {
  await client.ready;
  // The flexed body asks this cached solve; rest correctly has no active fold.
  await client.folds(recipe);
}, LOAD.timeout);

function Probe({ onReady }: { onReady: (get: () => RootState) => void }) {
  const get = useThree((state) => state.get);
  useEffect(() => onReady(get), [get, onReady]);
  return null;
}

function bodyOf(scene: Scene): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  scene.traverse((object) => {
    if (object.userData.hkPart === "body" && object.visible) found = object as SkinnedMesh;
  });
  if (!found) throw new Error("posed-fluid probe: no drawn base body");
  return found;
}

function bonesOf(scene: Scene): DualBones {
  let found: DualBones | null = null;
  scene.traverse((object) => {
    const bones = (object.userData as { dualBones?: DualBones }).dualBones;
    if (bones) found = bones;
  });
  if (!found) throw new Error("posed-fluid probe: no live dual bones");
  return found;
}

function phaseReceipt(state: RootState | null, evaluated: boolean) {
  if (!state) return { evaluated, canvas: false };
  const body = (() => {
    try {
      return bodyOf(state.scene);
    } catch {
      return null;
    }
  })();
  const dual = (() => {
    try {
      return bonesOf(state.scene);
    } catch {
      return null;
    }
  })();
  return {
    evaluated,
    canvas: true,
    body: body
      ? {
          vertices: body.geometry.getAttribute("position")?.count ?? 0,
          skin0: body.geometry.getAttribute("skinIndex")?.count ?? 0,
          skin1: body.geometry.getAttribute(SKIN_INDEX_ATTRIBUTE_1)?.count ?? 0,
          weights0: body.geometry.getAttribute("skinWeight")?.count ?? 0,
          weights1: body.geometry.getAttribute(SKIN_WEIGHT_ATTRIBUTE_1)?.count ?? 0,
        }
      : null,
    dual: dual ? { foldBlend: dual.foldBlend.value } : null,
  };
}

async function waitForPhase(
  name: string,
  ready: () => boolean,
  receipt: () => unknown,
): Promise<void> {
  const end = performance.now() + DIAGNOSTIC_TIMEOUT_MS;
  while (performance.now() < end) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`posed-fluid probe ${name} timed out: ${JSON.stringify(receipt())}`);
}

async function sourceFrames() {
  const assets = await loadHumanoidAssets({ body: bodyPack });
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const state = new FluidState({
    figureId: "gpu-posed-fluid-proof",
    seed: 1,
    fixedStepSeconds: 1 / 60,
    topology: {
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      triangleCount: model.bodyIndex("base").length / 3,
    },
    recipe,
    assets,
  });
  const rest = fluidFrameFromPose(state, model, recipe, REST_POSE);
  const flexed = fluidFrameFromPose(state, model, recipe, "flexed");
  let vertex = 0;
  for (let candidate = 1; candidate < rest.positions.length / 3; candidate++) {
    const at = candidate * 3;
    const best = vertex * 3;
    if (
      Math.hypot(
        (flexed.positions[at] as number) - (rest.positions[at] as number),
        (flexed.positions[at + 1] as number) - (rest.positions[at + 1] as number),
        (flexed.positions[at + 2] as number) - (rest.positions[at + 2] as number),
      ) >
      Math.hypot(
        (flexed.positions[best] as number) - (rest.positions[best] as number),
        (flexed.positions[best + 1] as number) - (rest.positions[best + 1] as number),
        (flexed.positions[best + 2] as number) - (rest.positions[best + 2] as number),
      )
    )
      vertex = candidate;
  }
  const index = rest.index.indexOf(vertex);
  if (index < 0) throw new Error("posed-fluid probe: motion vertex has no triangle");
  const corner = index % 3;
  const anchor: FluidSurfaceAnchor = {
    kind: "surface",
    topology: bodyManifest.topology,
    bodySha256: bodyManifest.body.sha256,
    triangle: Math.floor(index / 3),
    barycentric: [corner === 0 ? 1 : 0, corner === 1 ? 1 : 0, corner === 2 ? 1 : 0],
  };
  return { anchor, rest, flexed };
}

async function liveState(body?: string): Promise<RootState> {
  let get: (() => RootState) | null = null;
  let evaluated = false;
  await render(
    <HumanoidProvider client={client}>
      <div style={{ width: 160, height: 160 }}>
        <Canvas>
          <Probe onReady={(state) => (get = state)} />
          <Humanoid
            recipe={recipe}
            {...(body && { pose: { body } })}
            onEvaluated={() => (evaluated = true)}
          />
        </Canvas>
      </div>
    </HumanoidProvider>,
  );
  const state = () => (get ? get() : null);
  await waitForPhase(
    `${body ?? "rest"} evaluated body`,
    () => {
      const shown = state();
      if (!shown || !evaluated) return false;
      const receipt = phaseReceipt(shown, evaluated);
      return Boolean(
        receipt.body &&
          receipt.dual &&
          receipt.body.vertices === receipt.body.skin0 &&
          receipt.body.vertices === receipt.body.skin1 &&
          receipt.body.vertices === receipt.body.weights0 &&
          receipt.body.vertices === receipt.body.weights1,
      );
    },
    () => phaseReceipt(state(), evaluated),
  );
  const shown = state() as RootState;
  if (body) {
    await waitForPhase(
      `${body} settled fold`,
      () => bonesOf(shown.scene).foldBlend.value === 1,
      () => phaseReceipt(state(), evaluated),
    );
  }
  return shown;
}

function gpuAnchorWorld(state: RootState, anchor: FluidSurfaceAnchor): [number, number, number] {
  const mesh = bodyOf(state.scene);
  const triangle = mesh.geometry.index;
  if (!triangle) throw new Error("posed-fluid probe: body has no index");
  const first = anchor.triangle * 3;
  const vertices = [triangle.getX(first), triangle.getX(first + 1), triangle.getX(first + 2)];
  const gpu = gpuWorldVertices(state, mesh, vertices);
  return [0, 1, 2].map((axis) =>
    anchor.barycentric.reduce(
      (sum, weight, corner) => sum + weight * (gpu[corner * 3 + axis] as number),
      0,
    ),
  ) as [number, number, number];
}

function sourceAnchorWorld(
  state: RootState,
  frame: ReturnType<typeof fluidFrameFromPose>,
  anchor: FluidSurfaceAnchor,
): [number, number, number] {
  const local = fluidAnchorPoint(frame, anchor);
  const mesh = bodyOf(state.scene);
  state.scene.updateMatrixWorld(true);
  const world = new Vector3(...local).applyMatrix4(mesh.matrixWorld);
  return [world.x, world.y, world.z];
}

afterAll(() => client.dispose());

describe("posed fluid surface anchors against the live body shader", () => {
  it(
    "reads the live eight-influence dual-and-fold shader triangle in world space for rest and flexed poses",
    async () => {
      const restState = await liveState();
      const flexedState = await liveState("flexed");
      const { anchor, rest, flexed } = await sourceFrames();
      for (const [name, state, frame] of [
        ["rest", restState, rest],
        ["flexed", flexedState, flexed],
      ] as const) {
        const gpu = gpuAnchorWorld(state, anchor);
        const source = sourceAnchorWorld(state, frame, anchor);
        const error = Math.max(
          ...gpu.map((value, axis) => Math.abs(value - (source[axis] as number))),
        );
        expect(
          error,
          `${name}: GPU barycentric point versus posed-fluid source`,
        ).toBeLessThanOrEqual(EXACT);
      }
    },
    LOAD.timeout,
  );
});
