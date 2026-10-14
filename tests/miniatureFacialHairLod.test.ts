import { type InstancedMesh, type MeshStandardMaterial, OrthographicCamera } from "three";
import { expect, it } from "vitest";
import type { MiniatureBake } from "../src/bake/miniature.ts";
import { MiniatureCrowd } from "../src/render/miniature.ts";

function fixture(): MiniatureBake {
  const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const index = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return {
    body: "fixture",
    vertexCount: 4,
    frameCount: 1,
    clips: [],
    positions,
    min: [-0.5, 0, 0],
    max: [0.5, 1, 0],
    colour: new Uint8Array(12).fill(255),
    channel: new Uint8Array(4),
    lods: [
      { target: 2, index, normals },
      { target: 1, index: index.slice(0, 3), normals },
    ],
    alphaCards: [
      {
        id: "source",
        vertexCount: 4,
        index,
        positions,
        normals,
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        tint: [1, 1, 1],
        texture: { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) },
      },
    ],
  };
}
const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
camera.position.set(0, 0.5, 5);
camera.lookAt(0, 0.5, 0);

it("leaves the default near-only path unchanged and retains full source costs when opted in", () => {
  const bake = fixture();
  for (const facialHairLod of [undefined, "near-only", "all"] as const) {
    const crowd = new MiniatureCrowd([bake], { facialHairLod, levelPixels: [64, 0] });
    crowd.setFigures([
      { archetype: 0, x: -0.5, z: 0 },
      { archetype: 0, x: 0.5, z: 0, scale: 0.2 },
    ]);
    expect(crowd.update(camera, 0, 400)).toEqual({
      visible: 2,
      perLevel: [1, 1],
      triangles: facialHairLod === "all" ? 7 : 5,
      drawCalls: 3,
    });
    const card = crowd.object.children[2] as InstancedMesh;
    expect(card.count).toBe(facialHairLod === "all" ? 2 : 1);
    crowd.dispose();
  }
});

it("counts cards before spending a tight budget on body upgrades, including unavoidable excess", () => {
  for (const budget of [1, 6, 7, 8]) {
    const crowd = new MiniatureCrowd([fixture()], {
      facialHairLod: "all",
      triangleBudget: budget,
      levelPixels: [0, 0],
    });
    crowd.setFigures([
      { archetype: 0, x: -0.5, z: 0 },
      { archetype: 0, x: 0.5, z: 0 },
    ]);
    const stats = crowd.update(camera, 0, 400);
    expect(stats.triangles).toBe(Math.max(6, budget));
    expect(stats.perLevel[0]).toBe(Math.max(0, budget - 6));
    expect((crowd.object.children[2] as InstancedMesh).count).toBe(2);
    crowd.dispose();
  }
});

it("shares one card mesh across body levels without allocating or disposing its map twice", () => {
  const near = new MiniatureCrowd([fixture()]);
  const all = new MiniatureCrowd([fixture()], { facialHairLod: "all" });
  expect(all.object.children.length).toBe(near.object.children.length);
  expect(all.textureBytes).toBe(near.textureBytes);
  const material = (all.object.children[2] as InstancedMesh).material as MeshStandardMaterial;
  let disposals = 0;
  material.map?.addEventListener("dispose", () => disposals++);
  all.dispose();
  near.dispose();
  expect(disposals).toBe(1);
});
