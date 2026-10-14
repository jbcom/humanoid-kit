/** Native source-body contact, separation and retained terminal receiver support. */
import { Canvas, type RootState, useThree } from "@react-three/fiber";
import { bodyPack } from "humanoid-kit-body";
import { useEffect } from "react";
import {
  Box3,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type SkinnedMesh,
  Vector3,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import bodyManifest from "../../packs/body/data/manifest.json";
import { AttachedFluidField } from "../../src/fluid/attachedField.ts";
import { fluidAnchorPoint, fluidFrameFromPose } from "../../src/fluid/posedSurfaceFrame.ts";
import { FluidState, type FluidSurfaceAnchor } from "../../src/fluid/state.ts";
import { resolveFluidSurfaceContact } from "../../src/fluid/surfaceContact.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { REST_POSE } from "../../src/foundation/permutations.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { Humanoid, HumanoidProvider, StudioStage } from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import {
  bindFluidWetFilmCoverage,
  FLUID_COVERAGE_TEXTURE_SIZE,
} from "../../src/render/fluidCoverage.ts";
import { SkinMaterial } from "../../src/render/skinMaterial.ts";
import { gpuWorldVertices } from "./fluidGpuReadback.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 300_000 };
const CAPTURE = import.meta.env.MODE === "fluid-wet-film-capture";
const recipe = createRecipe({ macros: { age: 25 } });
const client = inlineWorkerClient({ subdivision: 1 });

beforeAll(async () => {
  await client.ready;
  await client.folds(recipe);
}, LOAD.timeout);
afterAll(() => client.dispose());

function Probe({ onReady }: { onReady: (get: () => RootState) => void }) {
  const get = useThree((state) => state.get);
  useEffect(() => onReady(get), [get, onReady]);
  return null;
}

function nativeBodies(scene: Scene): [SkinnedMesh, SkinnedMesh, SkinnedMesh] {
  const found: SkinnedMesh[] = [];
  scene.traverse((object) => {
    if (object.userData.hkPart === "body" && object.visible) found.push(object as SkinnedMesh);
  });
  if (found.length !== 3)
    throw new Error(`contact proof requires three visible native bodies, found ${found.length}`);
  scene.updateMatrixWorld(true);
  // Source stands at +z, receiver at -z, independent third figure off to -x.
  const third = found.find((body) => body.matrixWorld.elements[12] < -1);
  const pair = found
    .filter((body) => body !== third)
    .sort((a, b) => b.matrixWorld.elements[14] - a.matrixWorld.elements[14]);
  if (!third || pair.length !== 2)
    throw new Error("contact proof source identities are not placed");
  return [pair[0] as SkinnedMesh, pair[1] as SkinnedMesh, third];
}

function pixels(state: RootState, camera = state.camera): Uint8Array {
  state.gl.render(state.scene, camera);
  const canvas = state.gl.domElement;
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  const gl = state.gl.getContext();
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function changed(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let at = 0; at < a.length; at += 4)
    if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) count++;
  return count;
}
function skin(body: SkinnedMesh): SkinMaterial {
  if (!(body.material instanceof SkinMaterial))
    throw new Error("contact proof requires native SkinMaterial");
  return body.material;
}

function figureRoot(body: SkinnedMesh): Object3D {
  let parent: Object3D | null = body;
  while (parent) {
    if (parent.userData.dualBones) return parent;
    parent = parent.parent;
  }
  throw new Error("native contact body has no own figure root");
}

async function sourceData() {
  const assets = await loadHumanoidAssets({ body: bodyPack });
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const state = (figureId: string) =>
    new FluidState({
      figureId,
      seed: 13,
      fixedStepSeconds: 1 / 60,
      recipe,
      assets,
      topology: {
        topology: bodyManifest.topology,
        bodySha256: bodyManifest.body.sha256,
        triangleCount: model.bodyIndex("base").length / 3,
      },
    });
  const source = state("contact-source");
  const receiver = state("contact-receiver");
  const third = state("independent-third");
  const rest = fluidFrameFromPose(source, model, recipe, REST_POSE);
  const flexed = fluidFrameFromPose(receiver, model, recipe, "flexed");
  const uvs = model.topology().body.uvs;
  // A front-facing arm/hand source cell with substantial native pose movement.
  let selected = -1;
  let displacement = -1;
  for (let triangle = 0; triangle < rest.index.length / 3; triangle++) {
    const vertices = Array.from(rest.index.subarray(triangle * 3, triangle * 3 + 3));
    const centre = (positions: Float32Array, axis: number) =>
      vertices.reduce((sum, vertex) => sum + (positions[vertex * 3 + axis] as number), 0) / 3;
    const x = centre(rest.positions, 0);
    const normalZ = centre(rest.normals, 2);
    const uv = vertices.map(
      (vertex) => [uvs[vertex * 2] as number, uvs[vertex * 2 + 1] as number] as const,
    );
    const uvAreaTexels =
      0.5 *
      Math.abs(
        ((uv[1]?.[0] as number) - (uv[0]?.[0] as number)) *
          ((uv[2]?.[1] as number) - (uv[0]?.[1] as number)) -
          ((uv[1]?.[1] as number) - (uv[0]?.[1] as number)) *
            ((uv[2]?.[0] as number) - (uv[0]?.[0] as number)),
      ) *
      FLUID_COVERAGE_TEXTURE_SIZE ** 2;
    // This frame is model-local before ground lift, so a grounded height range
    // cannot identify its limb. Lateral position and actual pose motion do.
    // An explicitly selected visible QA cell must survive the existing UV
    // texel-centre quantization; small fingertip triangles can rasterize empty.
    if (x < 0.25 || normalZ < 0.65 || uvAreaTexels < 8) continue;
    const moved = Math.hypot(
      ...[0, 1, 2].map((axis) => centre(flexed.positions, axis) - centre(rest.positions, axis)),
    );
    if (moved > displacement) {
      selected = triangle;
      displacement = moved;
    }
  }
  expect(displacement, "selected native limb support articulates").toBeGreaterThan(0.05);
  const anchor: FluidSurfaceAnchor = {
    kind: "surface",
    topology: bodyManifest.topology,
    bodySha256: bodyManifest.body.sha256,
    triangle: selected,
    barycentric: [1 / 3, 1 / 3, 1 / 3],
  };
  const point = fluidAnchorPoint(rest, anchor);
  console.info(
    "native-fluid-selected-contact",
    JSON.stringify({ triangle: selected, pointM: point, displacementM: displacement }),
  );
  const donor = new AttachedFluidField(source, rest, {
    maxCells: 1,
    mobilityPerSecond: 0,
    gravity: [0, -1, 0],
  });
  const target = new AttachedFluidField(receiver, rest, {
    maxCells: 1,
    mobilityPerSecond: 0,
    gravity: [0, -1, 0],
    maxDeposits: 1,
    acceptedDepositMaterials: ["water"],
  });
  source.registerSource({
    id: "selected-surface",
    anchor,
    materialId: "water",
    rateKgPerSecond: 0,
  });
  donor.inject("selected-surface", anchor, "water", 0.0005);
  return { source, receiver, third, rest, flexed, anchor, point, donor, target };
}

function gpuAnchor(state: RootState, body: SkinnedMesh, anchor: FluidSurfaceAnchor): Vector3 {
  const index = body.geometry.getIndex();
  if (!index) throw new Error("native contact body must be indexed");
  const vertices = [0, 1, 2].map((corner) => index.getX(anchor.triangle * 3 + corner));
  const gpu = gpuWorldVertices(state, body, vertices);
  return new Vector3(
    ...([0, 1, 2].map((axis) =>
      anchor.barycentric.reduce(
        (sum, weight, corner) => sum + weight * (gpu[corner * 3 + axis] as number),
        0,
      ),
    ) as [number, number, number]),
  );
}

describe("native paired contact terminal deposition", () => {
  it(
    "transfers at selected native skin contact, remains anchored after separation/articulation and leaves the third body exact",
    async () => {
      const proof = await sourceData();
      let get: (() => RootState) | null = null;
      const settled = new Set<string>();
      const onReady = (next: () => RootState) => (get = next);
      const sourcePosition: [number, number, number] = [-proof.point[2], 0, proof.point[0]];
      const receiverPosition: [number, number, number] = [proof.point[2], 0, -proof.point[0]];
      const scene = (separated: boolean, articulated: boolean) => (
        <HumanoidProvider client={client}>
          <div style={{ width: 400, height: 480 }}>
            <Canvas camera={{ fov: 28, position: [3, 1.6, 3] }} style={{ width: 400, height: 480 }}>
              <Probe onReady={onReady} />
              <StudioStage background="#1b2530" intensity={1.8} contactShadowOpacity={0} />
              <Humanoid
                recipe={recipe}
                position={[sourcePosition[0] - (separated ? 0.5 : 0), 0, sourcePosition[2]]}
                rotation={[0, Math.PI / 2, 0]}
                onSettled={() => settled.add("source")}
              />
              <Humanoid
                recipe={recipe}
                position={receiverPosition}
                rotation={[0, -Math.PI / 2, 0]}
                {...(articulated && { pose: { body: "flexed" } })}
                onSettled={() => settled.add("receiver")}
              />
              <Humanoid
                recipe={recipe}
                position={[-1.6, 0, 0]}
                onSettled={() => settled.add("third")}
              />
            </Canvas>
          </div>
        </HumanoidProvider>
      );
      const screen = await render(scene(false, false));
      const state = () => (get as unknown as () => RootState)();
      await expect.poll(() => settled.size, LOAD).toBe(3);
      await expect.poll(() => nativeBodies(state().scene).length, LOAD).toBe(3);
      state().setFrameloop("never");
      let [sourceBody, receiverBody, thirdBody] = nativeBodies(state().scene);
      const camera = state().camera as PerspectiveCamera;
      let thirdReferenceCamera = camera.clone();
      const overview = (articulated = false) => {
        const bounds = new Box3();
        const point = new Vector3();
        for (const [body, frame] of [
          [sourceBody, proof.rest],
          [receiverBody, articulated ? proof.flexed : proof.rest],
          [thirdBody, proof.rest],
        ] as const) {
          body.updateWorldMatrix(true, false);
          for (let at = 0; at < frame.positions.length; at += 3)
            bounds.expandByPoint(
              point.fromArray(frame.positions, at).applyMatrix4(body.matrixWorld),
            );
        }
        const centre = bounds.getCenter(new Vector3());
        const radius = bounds.getSize(new Vector3()).length() / 2;
        const halfFov = (camera.fov * Math.PI) / 360;
        const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
        camera.position
          .copy(centre)
          .addScaledVector(
            new Vector3(1, 0.1, 1.4).normalize(),
            (1.15 * radius) / Math.sin(limitingFov),
          );
        camera.lookAt(centre);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      };
      const capture = async (name: string) => {
        state().gl.render(state().scene, camera);
        if (CAPTURE)
          await page.screenshot({
            element: state().gl.domElement,
            path: `../../test-results/fluid-contact-figure/${name}.png`,
          });
      };
      const thirdPixels = () => {
        const source = figureRoot(sourceBody);
        const receiver = figureRoot(receiverBody);
        source.visible = false;
        receiver.visible = false;
        const read = pixels(state(), thirdReferenceCamera);
        source.visible = true;
        receiver.visible = true;
        return read;
      };
      const closeup = (frame: typeof proof.rest) => {
        const centre = receiverBody.localToWorld(
          new Vector3(...fluidAnchorPoint(frame, proof.anchor)),
        );
        const normal = new Vector3();
        for (let corner = 0; corner < 3; corner++) {
          const vertex = frame.index[proof.anchor.triangle * 3 + corner] as number;
          normal.addScaledVector(
            new Vector3().fromArray(frame.normals, vertex * 3),
            proof.anchor.barycentric[corner] as number,
          );
        }
        normal.normalize().transformDirection(receiverBody.matrixWorld);
        camera.position.copy(centre).addScaledVector(normal, 0.36);
        camera.lookAt(centre);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        return centre;
      };
      try {
        overview();
        const thirdStateBefore = proof.third.snapshot();
        const atlas = skin(thirdBody).hkUniforms.hkLayerAtlas.value;
        expect(skin(sourceBody).hkUniforms.hkLayerAtlas.value).toBe(atlas);
        expect(skin(receiverBody).hkUniforms.hkLayerAtlas.value).toBe(atlas);
        bindFluidWetFilmCoverage(
          skin(sourceBody),
          sourceBody.geometry,
          proof.donor.coverageSnapshot(proof.rest),
        );
        const donorMask = skin(sourceBody).hkUniforms.hkFluidCoverage.value as {
          image: { data: Uint8Array };
        };
        expect(
          donorMask.image.data.some((value) => value > 0),
          "native donor starts with rendered occupancy support",
        ).toBe(true);
        const sourceBefore = new Vector3(...proof.point).applyMatrix4(sourceBody.matrixWorld);
        const receiverBefore = new Vector3(...proof.point).applyMatrix4(receiverBody.matrixWorld);
        expect(gpuAnchor(state(), sourceBody, proof.anchor).distanceTo(sourceBefore)).toBeLessThan(
          2e-6,
        );
        expect(
          gpuAnchor(state(), receiverBody, proof.anchor).distanceTo(receiverBefore),
        ).toBeLessThan(2e-6);
        const sourceGeneration = {};
        const receiverGeneration = {};
        const contact = resolveFluidSurfaceContact({
          id: "explicit-native-pair",
          maxGapM: 0.00001,
          source: {
            state: proof.source,
            frame: proof.rest,
            poseId: "native-source-rest",
            generation: sourceGeneration,
            figureToWorld: sourceBody.matrixWorld.elements,
            anchor: proof.anchor,
          },
          receiver: {
            state: proof.receiver,
            frame: proof.rest,
            poseId: "native-receiver-rest",
            generation: receiverGeneration,
            figureToWorld: receiverBody.matrixWorld.elements,
            anchor: proof.anchor,
          },
        });
        await capture("contact-pair");
        // Establish the dry reference after first-paint/resource setup and the
        // selected native shader readbacks, immediately before the operation.
        thirdReferenceCamera = camera.clone();
        const thirdBefore = thirdPixels();
        const receipt = proof.donor.depositOn(proof.target, [
          { id: "retained-native-target", materialId: "water", massKg: 0.0005, contact },
        ]);
        bindFluidWetFilmCoverage(
          skin(sourceBody),
          sourceBody.geometry,
          proof.donor.coverageSnapshot(proof.rest),
        );
        bindFluidWetFilmCoverage(
          skin(receiverBody),
          receiverBody.geometry,
          proof.target.depositedCoverageSnapshot(proof.rest),
        );
        expect(skin(sourceBody).hkUniforms.hkFluidCoverage.value).toBeNull();
        expect(skin(receiverBody).hkUniforms.hkFluidCoverage.value).not.toBeNull();
        const thirdAfter = thirdPixels();
        expect(changed(thirdBefore, thirdAfter)).toBe(0);
        expect(proof.third.snapshot()).toEqual(thirdStateBefore);
        expect(proof.source.snapshot().ledger).toMatchObject({
          attachedKg: 0,
          injectedTotalKg: 0.0005,
          transferredTotalKg: 0.0005,
        });
        expect(proof.receiver.snapshot().ledger).toMatchObject({
          attachedKg: 0,
          injectedTotalKg: 0,
          depositedKg: 0.0005,
          receivedTotalKg: 0.0005,
        });
        expect(proof.source.snapshot().fixedSteps).toBe(0);
        expect(proof.receiver.snapshot().fixedSteps).toBe(0);
        expect(receipt[0]?.sourceGeneration).toBe(sourceGeneration);
        expect(receipt[0]?.receiverGeneration).toBe(receiverGeneration);
        await screen.rerender(scene(true, false));
        state().setFrameloop("never");
        [sourceBody, receiverBody, thirdBody] = nativeBodies(state().scene);
        overview();
        await capture("separated-pair");
        sourceBody.visible = false;
        thirdBody.visible = false;
        const separatedPoint = closeup(proof.rest);
        bindFluidWetFilmCoverage(skin(receiverBody), receiverBody.geometry, null);
        const dryReceiverPixels = pixels(state());
        bindFluidWetFilmCoverage(
          skin(receiverBody),
          receiverBody.geometry,
          proof.target.depositedCoverageSnapshot(proof.rest),
        );
        const wetReceiverPixels = pixels(state());
        console.info(
          "native-fluid-deposit-diagnostic",
          JSON.stringify({
            cameraSame: camera === state().camera,
            projectedPoint: separatedPoint.clone().project(state().camera).toArray(),
            captureProjectedPoint: separatedPoint.clone().project(camera).toArray(),
            canvas: [state().gl.domElement.width, state().gl.domElement.height],
            texels: (
              skin(receiverBody).hkUniforms.hkFluidCoverage.value as { image: { data: Uint8Array } }
            ).image.data.reduce((sum, value) => sum + Number(value > 0), 0),
            changedPixels: changed(dryReceiverPixels, wetReceiverPixels),
          }),
        );
        expect(
          changed(dryReceiverPixels, wetReceiverPixels),
          "native receiver deposit changes occupied GPU pixels",
        ).toBeGreaterThan(0);
        await capture("receiver-separated-closeup");
        sourceBody.visible = true;
        thirdBody.visible = true;
        state().setFrameloop("always");
        await screen.rerender(scene(true, true));
        [sourceBody, receiverBody, thirdBody] = nativeBodies(state().scene);
        sourceBody.visible = false;
        thirdBody.visible = false;
        const articulatedPoint = closeup(proof.flexed);
        expect(articulatedPoint.distanceTo(separatedPoint)).toBeGreaterThan(0.05);
        await expect
          .poll(
            () => gpuAnchor(state(), receiverBody, proof.anchor).distanceTo(articulatedPoint),
            LOAD,
          )
          .toBeLessThan(2e-6);
        state().setFrameloop("never");
        bindFluidWetFilmCoverage(
          skin(receiverBody),
          receiverBody.geometry,
          proof.target.depositedCoverageSnapshot(proof.flexed),
        );
        expect(proof.target.depositedFrame()).toEqual(receipt);
        await capture("receiver-flexed-closeup");
        const flexedWet = pixels(state());
        bindFluidWetFilmCoverage(skin(receiverBody), receiverBody.geometry, null);
        const flexedDry = pixels(state());
        expect(
          changed(flexedDry, flexedWet),
          "articulated native receiver still renders its retained deposit",
        ).toBeGreaterThan(0);
        bindFluidWetFilmCoverage(
          skin(receiverBody),
          receiverBody.geometry,
          proof.target.depositedCoverageSnapshot(proof.flexed),
        );
        sourceBody.visible = true;
        thirdBody.visible = true;
        overview(true);
        expect(changed(thirdBefore, thirdPixels())).toBe(0);
        expect(skin(thirdBody).hkUniforms.hkLayerAtlas.value).toBe(atlas);
        expect(skin(thirdBody).hkUniforms.hkFluidCoverage.value).toBeNull();
        console.info(
          "native-fluid-contact",
          JSON.stringify({
            sourceTriangle: proof.anchor.triangle,
            gapM: contact.gapM,
            transferredKg: receipt[0]?.massKg,
            depositedKg: proof.target.depositedCoverageSnapshot(proof.flexed).depositedKg,
            dryThirdChangedPixels: changed(thirdBefore, thirdAfter),
            articulatedDepositChangedPixels: changed(flexedDry, flexedWet),
            receiverDepositChangedPixels: changed(dryReceiverPixels, wetReceiverPixels),
            anchorMovementM: articulatedPoint.distanceTo(separatedPoint),
            fixedSteps: [proof.source.snapshot().fixedSteps, proof.receiver.snapshot().fixedSteps],
          }),
        );
      } finally {
        sourceBody.visible = true;
        receiverBody.visible = true;
        thirdBody.visible = true;
        state().setFrameloop("always");
      }
    },
    LOAD.timeout + 30_000,
  );
});
