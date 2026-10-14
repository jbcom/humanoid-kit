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
let changeRecipe: (recipe: Recipe) => void;
let changeYaw: (yaw: number) => void;
let settled = 0;
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
function Fixture() {
  const [recipe, setRecipe] = useState(baseline);
  const [yaw, setYaw] = useState(0);
  changeRecipe = setRecipe;
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
        onSettled={() => {
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

it("routes independent colours through the actual live Humanoid worker path without resource or source changes", async () => {
  await page.viewport(760, 720);
  await client.ready;
  const screen = await render(
    <HumanoidProvider client={client}>
      <Fixture />
    </HumanoidProvider>,
  );
  await expect.poll(() => settled, { timeout: 60_000 }).toBeGreaterThan(0);
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
  const before = settled;
  changeRecipe(independent);
  await expect.poll(() => settled, { timeout: 60_000 }).toBeGreaterThan(before);
  await expect.poll(() => tint(BEARD)).toEqual(expected(HAIR_COLOURS.white as HairColour));
  await expect.poll(() => tint(MOUSTACHE)).toEqual(expected(HAIR_COLOURS.red as HairColour));
  expect(
    requests.some(
      (request) =>
        request.type === "evaluate" &&
        JSON.stringify(request.recipe.facialHairColour) ===
          JSON.stringify(independent.facialHairColour),
    ),
  ).toBe(true);
  for (const id of ids) {
    const old = original.get(id);
    if (!old) throw new Error(`Missing original facial colour geometry for ${id}`);
    expect(mesh(id).geometry).toBe(old?.geometry);
    expect(mesh(id).material).toBe(old?.material);
    expectSameArray(mesh(id).geometry.index?.array ?? [], old.index, {
      what: `${id} source indices after colour change`,
    });
    expectSameArray(mesh(id).geometry.getAttribute("uv").array, old.uvs, {
      what: `${id} source UVs after colour change`,
    });
    if (id !== BEARD && id !== MOUSTACHE) expect(tint(id)).toEqual(old?.colour);
  }
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
  changeRecipe(
    createRecipe({
      ...independent,
      facialHairColour: { ...independent.facialHairColour, [BEARD]: BLACK },
    }),
  );
  await expect.poll(() => tint(BEARD)).toEqual(expected(BLACK));
  expect(tint(MOUSTACHE)).toEqual(expected(HAIR_COLOURS.red as HairColour));
  changeRecipe(baseline);
  await expect.poll(() => tint(MOUSTACHE)).toEqual(expected(BLACK));
  expect(tint(BEARD)).toEqual(original.get(BEARD)?.colour);
  await screen.unmount();
}, 120_000);
