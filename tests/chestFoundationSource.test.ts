/** Product-facing source binding for the independent chest foundation. */
import { describe, expect, it } from "vitest";
import { cellRecipeAt, labSetup } from "../scripts/research/chest-foundation/setup.ts";
import { legacyControl } from "../scripts/research/chest-foundation/tissue.ts";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { chestAnchors } from "../src/makehuman/chestFoundation/anchors.ts";
import {
  applyChestFoundation,
  buildChestFoundation,
  type ChestFoundationContext,
} from "../src/makehuman/chestFoundation/foundation.ts";
import { bodyMesh } from "../src/makehuman/chestFoundation/mesh.ts";
import { chooseSupport, trunkMask } from "../src/makehuman/chestFoundation/support.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { bodyPackData } from "./fixtures.ts";

const { lab } = labSetup();
const age = 25;
const cell = cellRecipeAt(age);
const canonical = lab.model.evaluate(cell).control;
const mesh = bodyMesh(lab.assets, lab.manifest);
const ctx: ChestFoundationContext = {
  mesh,
  manifest: lab.manifest,
  support: chooseSupport(
    mesh,
    canonical,
    chestAnchors(lab.manifest, canonical),
    trunkMask(lab.assets, lab.manifest),
  ),
};
const foundation = buildChestFoundation(ctx, {
  female: (size, firmness) => legacyControl(lab, cell, size, firmness),
  bare: () => lab.model.evaluate({ ...cell, macros: { ...cell.macros, gender: 1 } }).control,
});

function maxDiff(a: Float32Array, b: Float32Array) {
  let max = 0;
  for (let i = 0; i < a.length; i++)
    max = Math.max(max, Math.abs((a[i] as number) - (b[i] as number)));
  return max;
}

describe("chest foundation source binding", () => {
  it("reproduces MakeHuman's average and maximum source controls exactly", () => {
    for (const [size, firmness] of [
      [0, 0],
      [0, 0.5],
      [0, 1],
      [0.5, 0.5],
      [1, 0.5],
      [1, 0],
      [1, 1],
    ] as const) {
      const got = applyChestFoundation(ctx, foundation, canonical, { size, firmness }).positions;
      expect(
        maxDiff(got, legacyControl(lab, cell, size, firmness)),
        `${size}/${firmness}`,
      ).toBeLessThan(1e-5);
    }
  });

  it("keeps a source control outside its source reach byte-identical", () => {
    const got = applyChestFoundation(ctx, foundation, canonical, { size: 0.5, firmness: 0.5 });
    const expected = legacyControl(lab, cell, 0.5, 0.5);
    for (let vertex = 0; vertex < lab.manifest.vertexCount; vertex++) {
      if ((foundation.side[vertex] as number) >= 0) continue;
      for (let axis = 0; axis < 3; axis++)
        expect(got.positions[vertex * 3 + axis] as number).toBe(
          expected[vertex * 3 + axis] as number,
        );
    }
  });
});

describe("chest foundation model path", () => {
  it("keeps the legacy control byte-identical when chest is absent and matches source when explicit", () => {
    const legacy = lab.model.evaluate(cell).control;
    const explicit = lab.model.evaluate({
      ...cell,
      regionalMacros: { breastL: { breastPresence: 1 }, breastR: { breastPresence: 1 } },
    }).control;
    expect(Buffer.from(explicit.buffer).equals(Buffer.from(legacy.buffer))).toBe(true);
  });

  it("keeps presence one at MakeHuman's minimum-cup source endpoint", () => {
    for (const firmness of [0, 0.5, 1]) {
      const source = {
        ...cell,
        macros: { ...cell.macros, breastSize: 0, breastFirmness: firmness },
      };
      const legacy = lab.model.evaluate(source).control;
      const explicit = lab.model.evaluate({
        ...source,
        regionalMacros: { breastL: { breastPresence: 1 }, breastR: { breastPresence: 1 } },
      }).control;
      expect(maxDiff(explicit, legacy), `firmness ${firmness}`).toBeLessThan(1e-5);
    }
  });

  it("can change one side without moving the other side's source reach", () => {
    const neutral = lab.model.evaluate({ ...cell, macros: { ...cell.macros, gender: 1 } }).control;
    const left = lab.model.evaluate({
      ...cell,
      macros: { ...cell.macros, gender: 1 },
      regionalMacros: { breastL: { breastPresence: 1 } },
    }).control;
    for (const vertex of foundation.reach) {
      if ((foundation.side[vertex] as number) !== 1) continue;
      for (let axis = 0; axis < 3; axis++)
        expect(left[vertex * 3 + axis] as number).toBe(neutral[vertex * 3 + axis] as number);
    }
    expect(maxDiff(left, neutral)).toBeGreaterThan(1e-3);
  });
});

it.each([13, 18, 25, 40, 70])("responds through the source age %i", (sourceAge) => {
  const base = lab.model.evaluate({
    ...cell,
    macros: { ...cell.macros, age: sourceAge, gender: 1 },
    regionalMacros: { breastL: { breastPresence: 0 }, breastR: { breastPresence: 0 } },
  }).control;
  const raised = lab.model.evaluate({
    ...cell,
    macros: { ...cell.macros, age: sourceAge, gender: 1 },
    regionalMacros: { breastL: { breastPresence: 1 }, breastR: { breastPresence: 1 } },
  }).control;
  expect(maxDiff(raised, base)).toBeGreaterThan(1e-3);
});

it("fails closed until the source reference targets have loaded", () => {
  const staged = new HumanoidModel(parseHumanoidAssets(bodyPackData(["core"])));
  const recipe = {
    ...cell,
    macros: { ...cell.macros, gender: 1 },
    regionalMacros: { breastL: { breastPresence: 1 } },
  };
  expect(staged.pendingTargetFiles(recipe)).toContain("young");
  expect(() => staged.evaluate(recipe)).toThrow(/target files that have not loaded yet: young/);
});
