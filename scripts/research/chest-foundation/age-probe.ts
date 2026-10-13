/**
 * The age-aware library's numbers: legacy identity at every age (the knots and ages
 * between them), and per age and frame direction the measured carried share and the
 * chest relief the generator adds above the flat baseline (RMS and peak, mm), with
 * the pairwise RMS between ages, so "a real difference between ages" is a number.
 *
 *   node scripts/research/chest-foundation/age-probe.ts
 *
 * Writes age-tables.md and age-tables.json to the candidate directory.
 */
import fs from "node:fs";
import path from "node:path";
import { FRAME_DIRECTIONS, REVIEW_AGES } from "./conditions.ts";
import { candidateDir, cellRecipeAt, directionRecipe, labSetup } from "./setup.ts";
import { AGE_KNOTS, chestTissue, legacyControl, libraryAt, type TissueResult } from "./tissue.ts";

const { lab, ctx, ages } = labSetup();
const both = (size: number, firmness: number) => ({
  L: { size, firmness },
  R: { size, firmness },
});
const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs((a[i] as number) - (b[i] as number)));
  return m;
};
const reach = Array.from(ages.cells[0]?.reach ?? []);

/** RMS and peak (mm) of the tissue the generator added above the flat baseline. */
function relief(r: TissueResult) {
  let ss = 0,
    peak = 0;
  for (const v of reach) {
    const d = Math.hypot(
      (r.tissue[v * 3] as number) || 0,
      (r.tissue[v * 3 + 1] as number) || 0,
      (r.tissue[v * 3 + 2] as number) || 0,
    );
    ss += d * d;
    peak = Math.max(peak, d);
  }
  return { rms: Math.sqrt(ss / reach.length) * 1000, peak: peak * 1000 };
}
const fieldRms = (a: Float32Array, b: Float32Array) => {
  let ss = 0;
  for (const v of reach)
    for (let k = 0; k < 3; k++) ss += ((a[v * 3 + k] as number) - (b[v * 3 + k] as number)) ** 2;
  return Math.sqrt(ss / reach.length) * 1000;
};

const out: string[] = [];
const log = (s: string) => {
  console.log(s);
  out.push(s);
};

log("# Chest lab: age-aware library numbers\n");
log("## Legacy identity on the average-tissue frame (max |diff|, m)\n");
log("| age | knot | (.5,.5) | (1,.5) | (1,0) | (1,1) | (.75,.25) |");
log("|---|---|---|---|---|---|---|");
const identity: Record<string, Record<string, number>> = {};
for (const age of [...new Set([...AGE_KNOTS, 7, 15, 21, 33, 60])].sort((a, b) => a - b)) {
  const recipe = cellRecipeAt(age);
  const control = lab.model.evaluate(recipe).control;
  const lib = libraryAt(ages, age);
  const row: Record<string, number> = {};
  for (const [s, f] of [
    [0.5, 0.5],
    [1, 0.5],
    [1, 0],
    [1, 1],
    [0.75, 0.25],
  ] as const)
    row[`${s},${f}`] = maxDiff(
      chestTissue(ctx, lib, control, both(s, f)).positions,
      legacyControl(lab, recipe, s, f),
    );
  identity[age] = row;
  log(
    `| ${age} | ${(AGE_KNOTS as readonly number[]).includes(age) ? "yes" : "no"} | ${Object.values(
      row,
    )
      .map((x) => x.toExponential(1))
      .join(" | ")} |`,
  );
}

interface Cell {
  age: number;
  frame: string;
  share: number;
  frameReliefRms: number;
  remainderRms: number;
  s05: { rms: number; peak: number };
  s1: { rms: number; peak: number };
}
const cells: Cell[] = [];
const fields = new Map<string, Float32Array>();
for (const dir of FRAME_DIRECTIONS)
  for (const age of REVIEW_AGES) {
    const control = lab.model.evaluate(directionRecipe(dir, age)).control;
    const lib = libraryAt(ages, age);
    const half = chestTissue(ctx, lib, control, both(0.5, 0.5));
    const full = chestTissue(ctx, lib, control, both(1, 0.5));
    fields.set(`${dir.id}/${age}/0.5`, half.tissue);
    fields.set(`${dir.id}/${age}/1`, full.tissue);
    cells.push({
      age,
      frame: dir.id,
      share: half.sides.L.share,
      frameReliefRms: half.sides.L.reliefRms,
      remainderRms: half.sides.L.remainderRms,
      s05: relief(half),
      s1: relief(full),
    });
  }

log("\n## Carried share and added relief per age and frame\n");
log(
  "share: measured fraction of the age's average mound the frame carries (L side). " +
    "relief: RMS / peak mm of the tissue added above the flat baseline, size .5 and size 1, firmness .5.\n",
);
log(`| frame | ${REVIEW_AGES.map((a) => `${a} y`).join(" | ")} |`);
log(`|---|${REVIEW_AGES.map(() => "---").join("|")}|`);
for (const dir of FRAME_DIRECTIONS) {
  const row = REVIEW_AGES.map((age) => {
    const c = cells.find((x) => x.frame === dir.id && x.age === age) as Cell;
    return `${c.share.toFixed(2)} · ${c.s05.rms.toFixed(1)}/${c.s05.peak.toFixed(0)} · ${c.s1.rms.toFixed(1)}/${c.s1.peak.toFixed(0)}`;
  });
  log(`| ${dir.label} | ${row.join(" | ")} |`);
}
log("\ncell format: share · size .5 RMS/peak mm · size 1 RMS/peak mm\n");

log("## Pairwise RMS (mm) between ages of the added tissue, size 1, firmness .5\n");
const pairs: Record<string, Record<string, number>> = {};
const flagged: string[] = [];
for (const dir of FRAME_DIRECTIONS) {
  log(`### ${dir.label}\n`);
  log(`| | ${REVIEW_AGES.join(" | ")} |`);
  log(`|---|${REVIEW_AGES.map(() => "---").join("|")}|`);
  const m: Record<string, number> = {};
  for (const a of REVIEW_AGES) {
    const row = REVIEW_AGES.map((b) => {
      const d = fieldRms(
        fields.get(`${dir.id}/${a}/1`) as Float32Array,
        fields.get(`${dir.id}/${b}/1`) as Float32Array,
      );
      m[`${a}-${b}`] = d;
      if (a < b) {
        const ra = (cells.find((x) => x.frame === dir.id && x.age === a) as Cell).s1.rms;
        const rb = (cells.find((x) => x.frame === dir.id && x.age === b) as Cell).s1.rms;
        const rel = d / Math.max(ra, rb, 1e-9);
        if (d < 0.5)
          flagged.push(`IDENTICAL ${dir.label}: ${a} y vs ${b} y differ by ${d.toFixed(2)} mm RMS`);
        else if (rel < 0.1)
          flagged.push(
            `subtle ${dir.label}: ${a} y vs ${b} y differ by ${d.toFixed(2)} mm RMS (${(rel * 100).toFixed(0)} % of the larger relief)`,
          );
      }
      return d.toFixed(1);
    });
    log(`| ${a} | ${row.join(" | ")} |`);
  }
  pairs[dir.id] = m;
  log("");
}
log(
  "## Pairs of ages that are numerically indistinguishable (IDENTICAL: < 0.5 mm RMS) or subtle (< 10 % of the larger relief)\n",
);
for (const f of flagged) log(`- ${f}`);
if (!flagged.length) log("- none");

const dir = candidateDir();
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "age-tables.md"), `${out.join("\n")}\n`);
fs.writeFileSync(
  path.join(dir, "age-tables.json"),
  JSON.stringify({ knots: AGE_KNOTS, identity, cells, pairs, flagged }, null, 1),
);
console.log(`\nwrote ${path.join(dir, "age-tables.md")}`);
