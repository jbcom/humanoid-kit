/**
 * Builds the chest lab's real-renderer sheets: the generator's output for each
 * sampled condition becomes a MakeHuman custom target (`custom/<name>`) that the
 * playground registers before the figure is evaluated (`$customTargets`), so skin,
 * rig and subdivision all come from the kit's own pipeline.
 *
 *   node scripts/research/chest-foundation/sheets.ts [seed]
 *
 * Writes, to the candidate directory: `job.json`, a sheets job for the Playwright
 * `sheets` project (e2e/sheets/render.sheet.ts; copy it to a clean worktree's
 * `.sheets/job.json` and run it on the render pool), `<sheet>.conditions.json` (the
 * seed and the full condition list, so any tile can be re-rendered, plus coverage
 * and each tile's measured share and relief) and `labels.json` for label-sheet.ts.
 *
 * The lab verifies the chest's development across ages, so every figure is shown
 * uncovered at every age (rulings 4 and 6: breast development follows MakeHuman at
 * every age, and a child's natural form is not restricted). The sheets live in the
 * private cache and are never committed.
 */
import fs from "node:fs";
import path from "node:path";
import {
  type CustomTarget,
  customTargetId,
  customTargetOf,
} from "../../../src/makehuman/customTargets.ts";
import { createRecipe } from "../../../src/recipe/recipe.ts";
import { FRAME_DIRECTIONS, type FrameDirection } from "./conditions.ts";
import {
  type Condition,
  coverage,
  faceModifiers,
  type SheetKind,
  type SheetSample,
  sampleSheet,
} from "./sampler.ts";
import { candidateDir, labSetup } from "./setup.ts";
import { chestTissue, libraryAt } from "./tissue.ts";

/**
 * The playground cameras, each framed on the figure's own chest bone. A side view
 * at rest shows only the near arm, so side views pose the arms out of the way
 * (`SIDE_POSE`) and look slightly from the front.
 */
export const VIEWS = {
  front: "frame=spine02&view=0,0.1,1&span=0.55",
  "three-quarter": "frame=spine02&view=0.75,0.1,0.66&span=0.55",
  side: "frame=spine02&view=1,0.05,0.12&span=0.6",
} as const;
export type ViewName = keyof typeof VIEWS;

/** The body pose of a side view: the arms lifted clear of the chest's profile. */
export const SIDE_POSE = "abducted";

export interface Tile {
  label: string[];
  input: Parameters<typeof createRecipe>[0];
  share: number;
  reliefRms: number;
  reliefPeak: number;
  target: CustomTarget;
}

const fmt = (x: number, d = 2) => (x < 0 ? "-" : "") + Math.abs(x).toFixed(d).replace(/^0\./, ".");

/** The recipe input of a condition: its frame, macros, skin and face. */
export function conditionInput(c: {
  age: number;
  frame: FrameDirection;
  values: Condition["values"];
  ethnic: Condition["ethnic"];
}): Parameters<typeof createRecipe>[0] {
  const v = c.values;
  return {
    macros: {
      gender: c.frame.gender,
      age: c.age,
      muscle: v.muscle,
      weight: v.weight,
      height: v.height,
      proportions: 0.5,
      african: c.ethnic[0],
      asian: c.ethnic[1],
      caucasian: c.ethnic[2],
      breastSize: 0.5,
      breastFirmness: 0.5,
    },
    ...(c.frame.regionalMacros && { regionalMacros: c.frame.regionalMacros }),
    modifiers: faceModifiers(v),
    skin: { melanin: v.melanin, undertone: v.undertone },
  };
}

/** Runs the generator on a condition and packs its output as a custom target. */
export function makeTile(
  setup: ReturnType<typeof labSetup>,
  name: string,
  c: Parameters<typeof conditionInput>[0],
  label: string[],
): Tile {
  const input = conditionInput(c);
  const control = setup.lab.model.evaluate(createRecipe(input)).control;
  const r = chestTissue(setup.ctx, libraryAt(setup.ages, c.age), control, {
    size: c.values.size,
    firmness: c.values.firmness,
  });
  const offsets = new Float32Array(control.length);
  for (let i = 0; i < offsets.length; i++)
    offsets[i] = (r.positions[i] as number) - (control[i] as number);
  let ss = 0,
    peak = 0;
  const reach = setup.ages.cells[0]?.reach ?? new Uint32Array();
  for (const vtx of reach) {
    const d = Math.hypot(
      r.tissue[vtx * 3] as number,
      r.tissue[vtx * 3 + 1] as number,
      r.tissue[vtx * 3 + 2] as number,
    );
    ss += d * d;
    peak = Math.max(peak, d);
  }
  const target = customTargetOf(name, offsets);
  return {
    label,
    input: { ...input, modifiers: { ...(input?.modifiers ?? {}), [customTargetId(name)]: 1 } },
    share: (r.sides.L.share + r.sides.R.share) / 2,
    reliefRms: Math.sqrt(ss / Math.max(1, reach.length)) * 1000,
    reliefPeak: peak * 1000,
    target,
  };
}

/** The two label lines under a scatter tile. */
export function conditionLabel(c: Condition): string[] {
  const v = c.values;
  const e = c.ethnic;
  return [
    `#${c.index} ${c.age}y ${c.frame.id} size${fmt(v.size)} firm${fmt(v.firmness)}`,
    `mel${fmt(v.melanin)} ut${fmt(v.undertone, 1)} Af${fmt(e[0], 1)} As${fmt(e[1], 1)} Ca${fmt(e[2], 1)}`,
    `mu${fmt(v.muscle, 1)} wt${fmt(v.weight, 1)} ht${fmt(v.height, 1)} n${fmt(v.nose, 1)} l${fmt(v.lips, 1)} j${fmt(v.jaw, 1)} e${fmt(v.eyes, 1)}`,
  ];
}

/** One sheet of the Playwright `sheets` job (e2e/sheets/render.sheet.ts). */
export interface JobSheet {
  name: string;
  query: string;
  recipes: Record<string, unknown>[];
  columns: number;
  width: number;
  height: number;
}

/** A sheet of tiles in a view; a side view poses the arms clear unless a pose is given. */
export function jobSheet(
  name: string,
  view: ViewName,
  tiles: readonly Tile[],
  columns: number,
  pose: string | null = view === "side" ? SIDE_POSE : null,
): JobSheet {
  return {
    name,
    query: VIEWS[view],
    recipes: tiles.map((t) => ({
      ...t.input,
      $customTargets: [t.target],
      ...(pose && { $pose: { body: pose } }),
    })),
    columns,
    width: 300,
    height: 300,
  };
}

/** A sampled sheet's name before its view: `chest-scatter`, `chest-extremes`, `body-extremes`. */
const sheetPrefix = (kind: SheetKind) => (kind === "scatter" ? "chest-scatter" : kind);

function main() {
  const args = process.argv.slice(2);
  const seed = Number(args.find((a) => !a.startsWith("--")) ?? 20261013);
  const setup = labSetup();
  const dir = candidateDir();
  fs.mkdirSync(dir, { recursive: true });
  const job: JobSheet[] = [];

  const kinds: SheetKind[] = ["scatter", "chest-extremes", "body-extremes"];
  const sheets: [SheetKind, SheetSample][] = kinds.map((k, i) => [k, sampleSheet(k, seed + i)]);
  for (const [name, sample] of sheets) {
    const tiles = sample.conditions.map((c) =>
      makeTile(setup, `chestlab-${name}-${c.index}`, c, conditionLabel(c)),
    );
    fs.writeFileSync(
      path.join(dir, `${name}.conditions.json`),
      JSON.stringify(
        {
          kind: sample.kind,
          seed: sample.seed,
          rows: sample.rows,
          cols: sample.cols,
          coverage: coverage(sample),
          conditions: sample.conditions.map((c, i) => ({
            index: c.index,
            row: c.row,
            col: c.col,
            age: c.age,
            frame: c.frame.id,
            values: c.values,
            ethnic: c.ethnic,
            ethnicFixed: c.ethnicFixed,
            recipe: tiles[i]?.input,
            share: tiles[i]?.share,
            reliefRms: tiles[i]?.reliefRms,
            reliefPeak: tiles[i]?.reliefPeak,
          })),
        },
        null,
        1,
      ),
    );
    const views: ViewName[] =
      name === "scatter" ? ["front", "three-quarter", "side"] : ["front", "side"];
    for (const view of views)
      job.push(jobSheet(`${sheetPrefix(name)}-${view}`, view, tiles, sample.cols));
  }

  // Posed set: adult figures across the frame directions in three poses.
  const posedFrames = ["g0", "g50", "g100", "fchest-mbody", "mframe-fchest", "g0", "g25"];
  const posedTiles = posedFrames.flatMap((id, i) => {
    const frame = FRAME_DIRECTIONS.find((f) => f.id === id) as FrameDirection;
    const age = [25, 40, 70, 25, 55, 13, 18][i] as number;
    const values = {
      ...sheets[0]?.[1].conditions[0]?.values,
      size: [0.75, 1, 0.5, 1, 0.25, 0.6, 0.9][i] as number,
      firmness: [0.5, 0.2, 0.8, 0.5, 0.5, 0.6, 0.3][i] as number,
      melanin: [0.9, 0.15, 0.6, 0.45, 0.8, 0.3, 0.95][i] as number,
      undertone: 0,
      muscle: 0.5,
      weight: 0.5,
      height: 0.5,
      nose: 0,
      lips: 0,
      jaw: 0,
      eyes: 0,
      ears: 0,
      cheek: 0,
    } as Condition["values"];
    const ethnic = (
      [
        [1, 0, 0],
        [0, 0, 1],
        [0, 1, 0],
        [1 / 3, 1 / 3, 1 / 3],
        [0.5, 0, 0.5],
        [0, 0.5, 0.5],
        [0.5, 0.5, 0],
      ] as const
    )[i] as Condition["ethnic"];
    return [
      makeTile(setup, `chestlab-posed-${i}`, { age, frame, values, ethnic }, [
        `${age}y ${id} size${fmt(values.size)} firm${fmt(values.firmness)} mel${fmt(values.melanin)}`,
      ]),
    ];
  });
  // The posed set: the specimen is a custom target, so it rides the rig; every pose
  // is read at rest too, from the front and three-quarter, to compare.
  for (const pose of ["rest", "overhead", "twisted", "seated"])
    for (const view of ["front", "three-quarter"] as const)
      job.push(
        jobSheet(
          `chest-posed-${pose}-${view}`,
          view,
          posedTiles,
          posedTiles.length,
          pose === "rest" ? null : pose,
        ),
      );

  // Sweep strips: one figure each, size 0..1 at firmness .5, then firmness 0..1 at size 1.
  const strips = [
    { id: "g0", age: 25, melanin: 0.9, ethnic: [1, 0, 0] },
    { id: "g100", age: 25, melanin: 0.1, ethnic: [0, 0, 1] },
    { id: "mframe-fchest", age: 40, melanin: 0.5, ethnic: [0, 1, 0] },
    { id: "g50", age: 13, melanin: 0.7, ethnic: [1 / 3, 1 / 3, 1 / 3] },
    { id: "g0", age: 70, melanin: 0.3, ethnic: [0.5, 0.5, 0] },
  ] as const;
  const sizes = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const firms = [0, 0.25, 0.5, 0.75, 1];
  const stripTiles: Tile[] = [];
  for (const [si, s] of strips.entries()) {
    const frame = FRAME_DIRECTIONS.find((f) => f.id === s.id) as FrameDirection;
    const base = {
      undertone: 0,
      muscle: 0.5,
      weight: 0.5,
      height: 0.5,
      nose: 0,
      lips: 0,
      jaw: 0,
      eyes: 0,
      ears: 0,
      cheek: 0,
      melanin: s.melanin,
    };
    for (const [k, size] of sizes.entries())
      stripTiles.push(
        makeTile(
          setup,
          `chestlab-strip-${si}-s${k}`,
          {
            age: s.age,
            frame,
            values: { ...base, size, firmness: 0.5 },
            ethnic: [...s.ethnic] as Condition["ethnic"],
          },
          [`${s.age}y ${s.id} size ${size}`],
        ),
      );
    for (const [k, firmness] of firms.entries())
      stripTiles.push(
        makeTile(
          setup,
          `chestlab-strip-${si}-f${k}`,
          {
            age: s.age,
            frame,
            values: { ...base, size: 1, firmness },
            ethnic: [...s.ethnic] as Condition["ethnic"],
          },
          [`${s.age}y ${s.id} firm ${firmness}`],
        ),
      );
  }
  fs.writeFileSync(
    path.join(dir, "strips.conditions.json"),
    JSON.stringify(
      stripTiles.map((t) => ({
        label: t.label,
        recipe: t.input,
        share: t.share,
        reliefRms: t.reliefRms,
      })),
      null,
      1,
    ),
  );
  // Sweep strips: each row one figure, size 0 to 1 at firmness .5, then firmness 0 to
  // 1 at size 1, the controlled comparison the scatter cannot give.
  for (const view of ["front", "side"] as const)
    job.push(jobSheet(`chest-strips-${view}`, view, stripTiles, sizes.length + firms.length));

  // The labels of every sheet's tiles, by sheet name, for label-sheet.ts.
  const labelsOf: Record<string, string[][]> = {
    ...Object.fromEntries(
      sheets.map(([kind, sample]) => [sheetPrefix(kind), sample.conditions.map(conditionLabel)]),
    ),
    "chest-posed": posedTiles.map((t) => t.label),
    "chest-strips": stripTiles.map((t) => t.label),
  };
  const labels = Object.fromEntries(
    job.map((s) => {
      const key = Object.keys(labelsOf).find((k) => s.name.startsWith(`${k}-`));
      if (!key) throw new Error(`no labels for ${s.name}`);
      return [s.name, labelsOf[key]];
    }),
  );
  fs.writeFileSync(path.join(dir, "labels.json"), JSON.stringify(labels, null, 1));
  const file = path.join(dir, "job.json");
  fs.writeFileSync(file, JSON.stringify({ sheets: job }));
  console.log(
    `${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB): ${job.map((s) => `${s.name} ${s.recipes.length}`).join(", ")}`,
  );
}

if (import.meta.main) main();
