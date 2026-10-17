/** Actual worker-to-live-material routing and bounded native source colour captures. */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useState } from "react";
import {
  Box3,
  type Group,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type SkinnedMesh,
  Vector3,
} from "three";
import { afterAll, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Evaluation } from "../../src/model/humanoidModel.ts";
import {
  Humanoid,
  HumanoidProvider,
  STUDIO_EXPOSURE,
  STUDIO_SHADOWS,
  STUDIO_TONE_MAPPING,
  StudioStage,
} from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import {
  agedHairColour,
  HAIR_COLOURS,
  type HairColour,
  hairTint,
} from "../../src/surface/hairTone.ts";
import type { WorkerRequest } from "../../src/worker/protocol.ts";
import { expectSameArray } from "./arrays.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const BEARD = "beard-viking",
  MOUSTACHE = "moustache-viking";
const CAPTURE_PNG = import.meta.env.MODE === "facial-colour-capture";
const BLACK = HAIR_COLOURS.black as HairColour;
const requests: WorkerRequest[] = [];
const client = inlineWorkerClient(
  { subdivision: 0 },
  { hair: true, onRequest: (request) => requests.push(request) },
);
afterAll(() => client.dispose());
const baseline = createRecipe({
  hair: { style: "short02", brows: "eyebrow002", lashes: "eyelashes03", colour: BLACK },
  facialHair: [BEARD, MOUSTACHE],
});
const independent = createRecipe({
  ...baseline,
  facialHairColour: {
    [BEARD]: HAIR_COLOURS.white as HairColour,
    [MOUSTACHE]: HAIR_COLOURS.red as HairColour,
  },
});
let group: Group | null = null;
let changeYaw: (yaw: number) => void;
let settled = 0;
let evaluated: Evaluation | null = null;
let settledEvaluation: Evaluation | null = null;
let portraitCentre: Vector3 | null = null;
function Aim({ yaw }: { yaw: number }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  useFrame(() => {
    if (!portraitCentre) return;
    const centre = portraitCentre;
    camera.position.set(centre.x + Math.sin(yaw) * 2, centre.y, centre.z + Math.cos(yaw) * 2);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
  });
  return null;
}
function Fixture({ recipe }: { recipe: Recipe }) {
  const [yaw, setYaw] = useState(0);
  changeYaw = setYaw;
  return (
    <Canvas
      style={{ width: 600, height: 600 }}
      shadows={STUDIO_SHADOWS}
      dpr={1}
      camera={{ fov: 22 }}
      gl={{ toneMapping: STUDIO_TONE_MAPPING, toneMappingExposure: STUDIO_EXPOSURE }}
    >
      <Aim yaw={yaw} />
      <StudioStage contactShadowOpacity={0.2} />
      <Humanoid
        ref={(value) => {
          group = value;
        }}
        recipe={recipe}
        onEvaluated={(evaluation) => {
          evaluated = evaluation;
        }}
        onSettled={(evaluation) => {
          settledEvaluation = evaluation;
          settled++;
        }}
      />
    </Canvas>
  );
}
function mesh(id: string): SkinnedMesh {
  const topology = client.hairTopology(id);
  if (!topology || !group) throw new Error(`missing live topology ${id}`);
  const matches: SkinnedMesh[] = [];
  group.traverse((object) => {
    const m = object as SkinnedMesh;
    if (
      m.isSkinnedMesh &&
      m.geometry.getAttribute("position").count === topology.vertexCount &&
      m.geometry.index?.count === topology.index.length
    )
      matches.push(m);
  });
  if (matches.length !== 1) throw new Error(`expected one live ${id}, got ${matches.length}`);
  return matches[0] as SkinnedMesh;
}
function tint(id: string): number[] {
  return (mesh(id).material as MeshStandardMaterial).color.toArray();
}
const expected = (colour: HairColour) =>
  hairTint(agedHairColour(colour, baseline.macros.age, "scalp"));

function diagnostic<T>(read: () => T): { value: T } | { error: string } {
  try {
    return { value: read() };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

it("keeps failed diagnostic reads from masking the original assertion", () => {
  expect(diagnostic(() => [0, 1])).toEqual({ value: [0, 1] });
  expect(
    diagnostic(() => {
      throw new Error("missing live mesh");
    }),
  ).toEqual({
    error: "Error: missing live mesh",
  });
  const original = new Error("original settlement assertion");
  let caught: unknown;
  try {
    try {
      throw original;
    } finally {
      diagnostic(() => {
        throw new Error("telemetry output failure");
      });
    }
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(original);
});

it("routes independent colours through the actual live Humanoid worker path without resource or source changes", async () => {
  const initialSettled = settled;
  await page.viewport(760, 720);
  await client.ready;
  const screen = await render(
    <HumanoidProvider client={client}>
      <Fixture recipe={baseline} />
    </HumanoidProvider>,
  );
  await expect.poll(() => settled, { timeout: 60_000 }).toBeGreaterThan(initialSettled);
  expect(settledEvaluation).toBe(evaluated);
  await expect.poll(() => tint(BEARD)).toEqual(expected(BLACK));
  const portraitBounds = new Box3();
  for (const id of ["short02", BEARD, MOUSTACHE]) {
    const part = mesh(id);
    part.updateWorldMatrix(true, false);
    part.computeBoundingBox();
    if (!part.boundingBox) throw new Error(`missing actual live facial bounds ${id}`);
    portraitBounds.union(part.boundingBox.clone().applyMatrix4(part.matrixWorld));
  }
  portraitCentre = portraitBounds.getCenter(new Vector3());
  const ids = ["short02", "eyebrow002", "eyelashes03", BEARD, MOUSTACHE];
  const original = new Map(
    ids.map((id) => [
      id,
      {
        colour: tint(id),
        geometry: mesh(id).geometry,
        material: mesh(id).material,
        index: Array.from(mesh(id).geometry.index?.array ?? []),
        uvs: Array.from(mesh(id).geometry.getAttribute("uv").array),
      },
    ]),
  );
  async function updateRecipe(phase: string, recipe: Recipe) {
    const before = settled;
    const previousEvaluation = evaluated;
    const requestStart = requests.length;
    // rerender flushes React's update with act before observing the worker or material.
    // Each colour assertion must observe this recipe's completed evaluation.
    try {
      await screen.rerender(
        <HumanoidProvider client={client}>
          <Fixture recipe={recipe} />
        </HumanoidProvider>,
      );
      await expect.poll(() => settled, { timeout: 60_000 }).toBeGreaterThan(before);
      expect(evaluated).not.toBe(previousEvaluation);
      expect(settledEvaluation).toBe(evaluated);
      const updates = requests.slice(requestStart).filter((request) => request.type === "evaluate");
      expect(updates).toHaveLength(1);
      expect(updates[0]?.recipe).toEqual(recipe);
    } finally {
      diagnostic(() =>
        console.info("facial-colour transition", {
          phase,
          requestRange: [requestStart, requests.length],
          evaluateRequests: requests
            .slice(requestStart)
            .filter((request) => request.type === "evaluate"),
          settlements: [before, settled],
          newEvaluation: evaluated !== previousEvaluation,
          exactSettlement: settledEvaluation === evaluated,
          beardTint: diagnostic(() => tint(BEARD)),
          moustacheTint: diagnostic(() => tint(MOUSTACHE)),
          resourcesUnchanged: diagnostic(() =>
            ids.every((id) => {
              const old = original.get(id);
              return mesh(id).geometry === old?.geometry && mesh(id).material === old?.material;
            }),
          ),
        }),
      );
    }
  }
  function expectUnchangedSource() {
    for (const id of ids) {
      const old = original.get(id);
      if (!old) throw new Error(`Missing original facial colour geometry for ${id}`);
      expect(mesh(id).geometry).toBe(old.geometry);
      expect(mesh(id).material).toBe(old.material);
      expectSameArray(mesh(id).geometry.index?.array ?? [], old.index, {
        what: `${id} source indices after colour change`,
      });
      expectSameArray(mesh(id).geometry.getAttribute("uv").array, old.uvs, {
        what: `${id} source UVs after colour change`,
      });
      if (id !== BEARD && id !== MOUSTACHE) expect(tint(id)).toEqual(old.colour);
    }
  }
  await updateRecipe("independent white/red", independent);
  await expect.poll(() => tint(BEARD)).toEqual(expected(HAIR_COLOURS.white as HairColour));
  await expect.poll(() => tint(MOUSTACHE)).toEqual(expected(HAIR_COLOURS.red as HairColour));
  expectUnchangedSource();
  if (CAPTURE_PNG)
    for (const [view, yaw] of [
      ["front", 0],
      ["oblique", Math.PI / 4],
      ["profile", Math.PI / 2],
    ] as const) {
      changeYaw(yaw);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await page.screenshot({ path: `../../test-results/facial-colour-live/${view}.png` });
    }
  await updateRecipe(
    "restore black beard",
    createRecipe({
      ...independent,
      facialHairColour: { ...independent.facialHairColour, [BEARD]: BLACK },
    }),
  );
  await expect.poll(() => tint(BEARD)).toEqual(expected(BLACK));
  expect(tint(MOUSTACHE)).toEqual(expected(HAIR_COLOURS.red as HairColour));
  expectUnchangedSource();
  await updateRecipe("restore baseline", baseline);
  await expect.poll(() => tint(MOUSTACHE)).toEqual(expected(BLACK));
  expect(tint(BEARD)).toEqual(original.get(BEARD)?.colour);
  expectUnchangedSource();
  expect(settled - initialSettled).toBe(4);
  await screen.unmount();
}, 120_000);
