import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { loadFixtureAssets } from "./fixtures.ts";

describe("an attachment's delete_verts", () => {
  const assets = loadFixtureAssets();
  const id = "eyes/high-poly";
  const eyes = assets.attachments.get(id);
  if (!eyes) throw new Error("no eyes");
  const bodyQuads = (deleteVerts: number[]) => {
    const attachments = new Map(assets.attachments);
    attachments.set(id, { ...eyes, deleteVerts: Uint32Array.from(deleteVerts) });
    const model = new HumanoidModel(
      { ...assets, attachments },
      { subdivision: 0, attachments: [id] },
    );
    return model.topology().body.index.length / 6;
  };
  // Two body quads sharing an edge: all of the first's corners, and three of the second's.
  const body = assets.manifest.groups.find((g) => g.name === "body");
  if (!body) throw new Error("no body group");
  const quad = (f: number) => [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
  const first = body.faceStart + 100;
  const a = quad(first);
  let second = -1;
  for (let f = body.faceStart; f < body.faceStart + body.faceCount && second < 0; f++)
    if (f !== first && quad(f).filter((v) => a.includes(v)).length === 2) second = f;
  const b = quad(second).filter((v) => !a.includes(v));

  it("hides a body face only when every one of its corners is deleted, as MakeHuman does", () => {
    const all = bodyQuads([]);
    expect(bodyQuads(a)).toBe(all - 1);
    // The neighbour keeps its fourth corner, so it stays: no gap ring at a garment's edge.
    expect(bodyQuads([...a, (b as number[])[0] as number])).toBe(all - 1);
    expect(bodyQuads([...a, ...b])).toBe(all - 2);
  });
});
