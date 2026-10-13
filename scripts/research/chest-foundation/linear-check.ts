/**
 * Can the measured generator (`chestTissue`) ship as plain weighted targets?
 *
 * The LINEAR form a pack can carry: on a frame evaluated at MakeHuman's average cup
 * and firmness (where no breast target is weighted, so the frame is its macro bodies
 * alone),
 *
 *   final(s, f) = E(frame) + D(s, f) + (c(s) - carried) * M
 *
 * - M: the average mound, the female-anchor cell's relief from its own fill (the
 *   library's T(.5, .5)), a fixed delta per age.
 * - D(s, f): MakeHuman's own breast deltas at full weight, read off the cell
 *   (E(cell, s, f) - E(cell, .5, .5)); below size .5 the average-cup firmness delta
 *   ramped by 2s.
 * - c(s) = min(1, 2s): how much of the mound the size asks for (0 = flat).
 * - carried: the frame's own female-anchor share, (1 - gender) of each body region,
 *   blended by the evaluator's region masks: what the macro bodies already put there.
 *
 * Printed per frame direction and age: the lab's k (frame width over cell width) and
 * the RMS and max difference (mm, over the reach) between the linear form and the
 * measured generator, with and without k applied to the linear form.
 */
import { buildRegionField } from "../../../src/makehuman/regions.ts";
import { FRAME_DIRECTIONS, REVIEW_AGES } from "./conditions.ts";
import { anchors } from "./figure.ts";
import { cellRecipeAt, directionRecipe, labSetup } from "./setup.ts";
import { chestTissue, legacyControl, libraryAt } from "./tissue.ts";

const { lab, ctx, ages } = labSetup();
const regions = buildRegionField(lab.assets);
const reach = Array.from(ages.cells[0]?.reach ?? []);
const CASES = [
  [0, 0.5],
  [0.25, 0.5],
  [0.5, 0.5],
  [1, 0],
  [1, 0.5],
  [1, 1],
] as const;

function diff(a: Float32Array, b: Float32Array) {
  let ss = 0;
  let peak = 0;
  for (const v of reach) {
    const d = Math.hypot(
      (a[v * 3] as number) - (b[v * 3] as number),
      (a[v * 3 + 1] as number) - (b[v * 3 + 1] as number),
      (a[v * 3 + 2] as number) - (b[v * 3 + 2] as number),
    );
    ss += d * d;
    peak = Math.max(peak, d);
  }
  return { rms: Math.sqrt(ss / reach.length) * 1000, peak: peak * 1000 };
}

console.log(
  "| age | frame | k | worst (s,f) | linear vs lab RMS/max mm | linear·k vs lab RMS/max mm |",
);
console.log("| --- | --- | --- | --- | --- | --- |");
for (const age of REVIEW_AGES) {
  const lib = libraryAt(ages, age);
  const mound = lib.grid.get("0.5/0.5") as Float32Array;
  const cell = cellRecipeAt(age);
  const cellAvg = lab.model.evaluate(cell).control;
  const delta = (s: number, f: number) => {
    const ss = s < 0.5 ? 0.5 : s;
    const e = legacyControl(lab, cell, ss, f);
    const ramp = s < 0.5 ? s / 0.5 : 1;
    const d = new Float32Array(e.length);
    for (let i = 0; i < d.length; i++) d[i] = ((e[i] as number) - (cellAvg[i] as number)) * ramp;
    return d;
  };
  const deltas = CASES.map(([s, f]) => delta(s, f));
  const cellSpan = anchors(lab.manifest, cellAvg).halfSpan;
  for (const dir of FRAME_DIRECTIONS) {
    const recipe = directionRecipe(dir, age);
    const control = lab.model.evaluate(recipe).control;
    const k = anchors(lab.manifest, control).halfSpan / cellSpan;
    // The frame's female-anchor share per vertex, through the evaluator's own masks.
    const genderOf = (r: number) => {
      const region = regions.names[r] as keyof typeof recipe.regionalMacros;
      return Math.min(
        1,
        Math.max(0, recipe.regionalMacros[region]?.gender ?? recipe.macros.gender),
      );
    };
    let worst = { key: "", plain: { rms: 0, peak: 0 }, scaled: { rms: 0, peak: 0 } };
    CASES.forEach(([s, f], ci) => {
      const lab3 = chestTissue(ctx, lib, control, { size: s, firmness: f }).positions;
      const plain = new Float32Array(control);
      const scaled = new Float32Array(control);
      const c = Math.min(1, 2 * s);
      const d = deltas[ci] as Float32Array;
      for (const v of reach) {
        let carried = 0;
        for (let r = 0; r < regions.names.length; r++)
          carried += ((regions.masks[r] as Float32Array)[v] as number) * (1 - genderOf(r));
        for (let a = 0; a < 3; a++) {
          const i = v * 3 + a;
          const m = mound[i] as number;
          plain[i] = (control[i] as number) + (d[i] as number) + (c - carried) * m;
          scaled[i] = (control[i] as number) + k * ((d[i] as number) + c * m) - carried * k * m;
        }
      }
      const p = diff(plain, lab3);
      const q = diff(scaled, lab3);
      if (p.peak > worst.plain.peak) worst = { key: `(${s},${f})`, plain: p, scaled: q };
    });
    console.log(
      `| ${age} | ${dir.id} | ${k.toFixed(3)} | ${worst.key} | ${worst.plain.rms.toFixed(2)}/${worst.plain.peak.toFixed(1)} | ${worst.scaled.rms.toFixed(2)}/${worst.scaled.peak.toFixed(1)} |`,
    );
  }
}
