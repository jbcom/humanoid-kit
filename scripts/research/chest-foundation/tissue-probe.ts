/**
 * Numbers behind the data-first generator: how far MakeHuman's breast contribution
 * reaches outside the support, legacy identity, the evaluator's linearity in size,
 * the measured carried-tissue share per figure, the relaxation operator's size, and
 * whether fill weights taken from a fixed REST mesh (one linear map for every figure)
 * match each figure's own fill.
 *
 *   node scripts/research/chest-foundation/tissue-probe.ts
 */
import { HumanoidModel } from "../../../src/model/humanoidModel.ts";
import { bodyManifest, loadFixtureAssets } from "../../../tests/fixtures.ts";
import { anchors, frameRecipe, type Lab } from "./figure.ts";
import { biharmonicFill, bodyMesh, neighbours } from "./mesh.ts";
import { chooseSupport, trunkMask } from "./support.ts";
import { chestTissue, legacyControl, type TissueCtx, tissueLibrary } from "./tissue.ts";

const assets = loadFixtureAssets();
const lab: Lab = {
  assets,
  manifest: bodyManifest,
  model: new HumanoidModel(assets, { subdivision: 0, attachments: [] }),
};
const mesh = bodyMesh(assets, bodyManifest);
const cellRecipe = frameRecipe({ gender: 0 });
const canonical = lab.model.evaluate(cellRecipe).control;
const support = chooseSupport(
  mesh,
  canonical,
  anchors(bodyManifest, canonical),
  trunkMask(assets, bodyManifest),
);
const ctx: TissueCtx = { mesh, support, manifest: bodyManifest };
const t0 = performance.now();
const lib = tissueLibrary(ctx, lab, cellRecipe, frameRecipe({ gender: 1 }));
console.log(
  "library build",
  (performance.now() - t0).toFixed(0),
  "ms, reach",
  lib.reach.length,
  "verts",
);
const free = new Set(support.free);
const freeList = Array.from(support.free);
const d3 = (a: Float32Array, b: Float32Array, v: number) =>
  Math.hypot(
    (a[v * 3] as number) - (b[v * 3] as number),
    (a[v * 3 + 1] as number) - (b[v * 3 + 1] as number),
    (a[v * 3 + 2] as number) - (b[v * 3 + 2] as number),
  );
const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs((a[i] as number) - (b[i] as number)));
  return m;
};

let ring = 0;
for (const v of mesh.vertices)
  if (!free.has(v) && neighbours(mesh, v).some((w) => free.has(w))) ring++;
console.log(
  "free",
  support.free.length,
  "inside",
  support.inside.reduce((s, x) => s + x, 0),
  "first fixed ring",
  ring,
);

for (const gender of [0, 1]) {
  const r = frameRecipe({ gender });
  const avg = legacyControl(lab, r, 0.5, 0.5);
  for (const [s, f] of [
    [0, 0.5],
    [1, 0.5],
    [0.5, 0],
    [0.5, 1],
    [1, 1],
  ] as const) {
    const e = legacyControl(lab, r, s, f);
    let inMax = 0,
      outMax = 0,
      outCount = 0;
    for (const v of mesh.vertices) {
      const d = d3(e, avg, v);
      if (free.has(v)) inMax = Math.max(inMax, d);
      else {
        if (d > 1e-4) outCount++;
        outMax = Math.max(outMax, d);
      }
    }
    console.log(
      `frame${gender} E(${s},${f})-E(.5,.5): free max ${(inMax * 1000).toFixed(2)} mm | outside max ${(outMax * 1000).toFixed(3)} mm, ${outCount} verts > 0.1 mm`,
    );
  }
}

for (const [s, f] of [
  [0.5, 0.5],
  [1, 0.5],
  [1, 0],
  [1, 1],
  [0.5, 0],
  [0.75, 0.25],
] as const) {
  const got = chestTissue(ctx, lib, canonical, { size: s, firmness: f }).positions;
  console.log(
    `identity cell (${s},${f}) max |diff| ${maxDiff(got, legacyControl(lab, cellRecipe, s, f)).toExponential(3)} m`,
  );
}

{
  const a = legacyControl(lab, cellRecipe, 0.5, 0.25),
    b = legacyControl(lab, cellRecipe, 1, 0.25),
    c = legacyControl(lab, cellRecipe, 0.75, 0.25);
  let m = 0;
  for (const v of support.free)
    for (let k = 0; k < 3; k++)
      m = Math.max(
        m,
        Math.abs(
          (c[v * 3 + k] as number) - 0.5 * ((a[v * 3 + k] as number) + (b[v * 3 + k] as number)),
        ),
      );
  console.log("E(.75,.25) vs midpoint of E(.5,.25),E(1,.25): max", (m * 1000).toFixed(3), "mm");
}

// Size vs firmness delta: cosine and volume change proxy (sum of normal displacement).
{
  const T = (key: string) => lib.grid.get(key) as Float32Array;
  for (const s of [0.5, 1]) {
    const size = new Float32Array(T("1/0.5").length);
    const firm = new Float32Array(size.length);
    for (let i = 0; i < size.length; i++) {
      size[i] = (T("1/0.5")[i] as number) - (T("0.5/0.5")[i] as number);
      firm[i] = (T(`${s}/1`)[i] as number) - (T(`${s}/0`)[i] as number);
    }
    let d = 0,
      a = 0,
      b = 0;
    for (let i = 0; i < size.length; i++) {
      d += (size[i] as number) * (firm[i] as number);
      a += (size[i] as number) ** 2;
      b += (firm[i] as number) ** 2;
    }
    console.log(
      `cos(size delta, firmness delta at s=${s}) = ${(d / Math.sqrt(a * b)).toFixed(3)}; |firm|/|size| = ${Math.sqrt(b / a).toFixed(2)}`,
    );
  }
}

console.log("measured carried share (L/R) and relief RMS mm -> remainder RMS mm:");
const restRecipe = frameRecipe({ gender: 0.5 });
const rest = lab.model.evaluate(restRecipe).control;
for (const over of [
  { gender: 0 },
  { gender: 0.5 },
  { gender: 1 },
  { gender: 0, weight: 1 },
  { gender: 0, weight: 0 },
  { gender: 0, height: 0 },
  { gender: 0, height: 1 },
  { gender: 1, muscle: 1 },
  { gender: 0, muscle: 1 },
]) {
  const control = lab.model.evaluate(frameRecipe(over)).control;
  const t = performance.now();
  const r = chestTissue(ctx, lib, control, { size: 0.5, firmness: 0.5 });
  const ms = performance.now() - t;
  const own = biharmonicFill(mesh, control, freeList);
  const fixed = biharmonicFill(mesh, control, freeList, rest);
  console.log(
    `${JSON.stringify(over).padEnd(26)} k ${r.k.toFixed(3)} share ${r.sides.L.share.toFixed(3)}/${r.sides.R.share.toFixed(3)} relief ${r.sides.L.reliefRms.toFixed(2)} -> ${r.sides.L.remainderRms.toFixed(2)} | own-vs-rest-weight fill ${(maxDiff(own, fixed) * 1000).toFixed(3)} mm | generator ${ms.toFixed(0)} ms`,
  );
}
