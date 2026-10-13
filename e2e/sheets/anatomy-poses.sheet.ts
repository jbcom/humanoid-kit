/**
 * Adult anatomy QA in the two loaded poses the standing rows cannot show (#71, #73):
 * the standing forward fold (hands to toes) from the rear and the front, and the
 * lithotomy position (on the back, hips and knees flexed, thighs abducted) from the
 * foot end, below and obliquely. Both are posed through the rig: joint channels laid
 * over the rest pose (`HumanoidPose.joints`), never a rigid turn of the model, so the
 * skin weights, folds and reservoir roots are what the sheets show.
 *
 * Each sheet is a scatter: rows are adult ages (25, 40, 55, 70), columns are camera
 * directions, and every tile draws its build, skin tone and anatomical configuration
 * from a seeded space-filling sample (Latin hypercube per scalar axis, the
 * configurations cycled in a seeded order), so each sheet covers the ranges evenly.
 * The configurations set each feature explicitly (rulings 1 and 5): female, male,
 * gender 0.5 with its blended defaults, a female form with a phallus, a male form with
 * a vulva. Every figure is hairless. Each tile is labelled with its values.
 *
 *   heavy-slot --remote-render pnpm exec playwright test e2e/sheets/anatomy-poses.sheet.ts --project sheets [-g "fold"]
 *
 * `assertAdult` runs on every recipe before it reaches the page, and the page always
 * loads the adult pack. Sheets go to the test output only: they are anatomical QA,
 * kept in a private cache and never committed or published.
 */
import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { ADULT_AGE } from "../../src/makehuman/macro.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";

test.use({ screenshot: "off", video: "off", trace: "off" });

type Input = NonNullable<Parameters<typeof createRecipe>[0]>;
type Joints = Record<string, Partial<Record<"Xrotation" | "Yrotation" | "Zrotation", number>>>;

/**
 * Hands to toes with the knees straight: the pelvis pitched 90 degrees forward over
 * thighs that stay upright, the spine and neck rounding 10 degrees a joint, the arms
 * hanging toward the feet (the #67 lane's spec).
 */
export const FORWARD_FOLD: Joints = {
  root: { Xrotation: 90 },
  "upperleg01.L": { Xrotation: -90 },
  "upperleg01.R": { Xrotation: -90 },
  spine01: { Xrotation: 10 },
  spine02: { Xrotation: 10 },
  spine03: { Xrotation: 10 },
  spine04: { Xrotation: 10 },
  spine05: { Xrotation: 10 },
  neck01: { Xrotation: 10 },
  "clavicle.L": { Xrotation: -32.5 },
  "clavicle.R": { Xrotation: -32.5 },
  "shoulder01.L": { Xrotation: -13 },
  "shoulder01.R": { Xrotation: -13 },
  "upperarm01.L": { Xrotation: -84.5, Yrotation: 30 },
  "upperarm01.R": { Xrotation: -84.5, Yrotation: -30 },
};

/**
 * The lithotomy position: the root laid back 90 degrees, the hips flexed 95 and
 * abducted 40 (the authored `abducted` pose's channel and sign), the knees flexed 90
 * (the `seated` pose's channel and sign), so the thighs rise and part and the shins lie
 * level, as in stirrups.
 */
export const LITHOTOMY: Joints = {
  root: { Xrotation: -90 },
  "upperleg01.L": { Xrotation: -95, Yrotation: -40 },
  "upperleg01.R": { Xrotation: -95, Yrotation: 40 },
  "lowerleg01.L": { Xrotation: 90 },
  "lowerleg01.R": { Xrotation: 90 },
};

const AGES = [25, 40, 55, 70];

const HAIRLESS = {
  density: { pubic: 0, axillary: 0, chest: 0, abdomen: 0, arms: 0, legs: 0, face: 0 },
};

/** Each configuration names its features, never derives them from the gender value alone. */
const CONFIGS: { label: string; gender: number; modifiers: Record<string, number> }[] = [
  { label: "F", gender: 0, modifiers: {} },
  { label: "M", gender: 1, modifiers: {} },
  { label: "X", gender: 0.5, modifiers: {} },
  {
    label: "F+P",
    gender: 0,
    modifiers: { "genitals/phallus-size": 0.65, "genitals/testes-size": 0 },
  },
  { label: "M+V", gender: 1, modifiers: { "genitals/vulva-size": 1, "genitals/testes-size": 0 } },
];

/** Fails the run before a figure under the adult age reaches the page. */
function assertAdult(input: Input): void {
  const age = createRecipe(input).macros.age;
  if (!(age >= ADULT_AGE)) throw new Error(`age ${age} is under the adult pack's ${ADULT_AGE}`);
}

/** A seeded uniform generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** N Latin-hypercube values in [lo, hi]: one per stratum, jittered, in a seeded order. */
const lhs = (n: number, lo: number, hi: number, r: () => number) =>
  shuffle(
    Array.from({ length: n }, (_, i) => lo + ((i + r()) / n) * (hi - lo)),
    r,
  );

interface Tile {
  label: string;
  input: Input;
}

/** The scatter's tiles, row by row: one per (age, direction), each with its sampled values. */
export function scatter(seed: number, directions: number): Tile[] {
  const n = AGES.length * directions;
  const r = rng(seed);
  const weight = lhs(n, 0.1, 0.9, r);
  const muscle = lhs(n, 0.1, 0.9, r);
  const melanin = lhs(n, 0.05, 0.95, r);
  const configs = shuffle(
    Array.from({ length: n }, (_, i) => CONFIGS[i % CONFIGS.length] as (typeof CONFIGS)[number]),
    r,
  );
  return Array.from({ length: n }, (_, i) => {
    const age = AGES[Math.floor(i / directions)] as number;
    const c = configs[i] as (typeof CONFIGS)[number];
    const w = weight[i] as number;
    const m = muscle[i] as number;
    const mel = melanin[i] as number;
    return {
      label: `${c.label} ${age}y w${w.toFixed(2)} m${m.toFixed(2)} mel${mel.toFixed(2)}`,
      input: {
        macros: { age, gender: c.gender, weight: w, muscle: m },
        modifiers: c.modifiers,
        skin: { melanin: mel },
        hair: { style: "short01", brows: "eyebrow001", lashes: "eyelashes01" },
        bodyHair: HAIRLESS,
      },
    };
  });
}

interface View {
  name: string;
  camera: string;
}

const LIGHT = "light=camera";

const SHEETS: { name: string; pose: Joints; seed: number; size: number; views: View[] }[] = [
  {
    name: "fold rear",
    pose: FORWARD_FOLD,
    seed: 7101,
    size: 300,
    views: [
      { name: "rear", camera: `frame=root&view=0,0.15,-1&span=1.3&at=0,-0.35,0&${LIGHT}` },
      { name: "rear close", camera: `frame=root&view=0,0.1,-1&span=0.4&${LIGHT}` },
      { name: "rear oblique", camera: `frame=root&view=0.6,0.1,-0.8&span=0.45&${LIGHT}` },
    ],
  },
  {
    name: "fold front",
    pose: FORWARD_FOLD,
    seed: 7102,
    size: 300,
    views: [
      { name: "front", camera: `frame=root&view=0,-0.2,1&span=1.5&at=0,-0.3,0&${LIGHT}` },
      // Folded, the chest faces the thighs: seen from the side and a little below.
      { name: "chest", camera: `frame=spine02&view=1,-0.3,0.15&span=0.55&${LIGHT}` },
      { name: "side", camera: `frame=root&view=1,0,0&span=1.6&at=0,-0.3,0.2&${LIGHT}` },
    ],
  },
  {
    name: "lithotomy",
    pose: LITHOTOMY,
    seed: 7301,
    size: 300,
    views: [
      // Laid back, the figure's front faces up (+y) and the perineum the foot end (+z);
      // the external anatomy sits about 7 cm above the root's head.
      { name: "wide", camera: `frame=root&view=0.35,0.5,1&span=1.5&at=0,0.2,0.2&${LIGHT}` },
      { name: "foot end", camera: `frame=root&view=0,0.25,1&span=0.3&at=0,0.07,0.03&${LIGHT}` },
      { name: "below", camera: `frame=root&view=0,-0.35,1&span=0.3&at=0,0.06,0.03&${LIGHT}` },
      { name: "oblique", camera: `frame=root&view=0.6,0.45,0.65&span=0.3&at=0,0.07,0.03&${LIGHT}` },
    ],
  },
];

/** Four animation frames, so what is on the canvas is what was last drawn. */
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let seen = 0;
        const tick = () => (++seen >= 4 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );

async function shot(page: Page, tile: Tile, pose: Joints): Promise<string> {
  assertAdult(tile.input);
  const generation = await page.evaluate(
    ({ recipe, pose }) => {
      const set = window.hkSetRecipe;
      if (!set) throw new Error("the QA shot is not mounted");
      const next =
        Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
      set(recipe as never, { joints: pose } as never);
      return next;
    },
    { recipe: tile.input, pose },
  );
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 300_000 });
  await frames(page);
  return (await page.locator("canvas").screenshot()).toString("base64");
}

/** The cells in a grid, each with its label strip, under a title. */
const composite = (
  page: Page,
  cells: { png: string; label: string }[],
  columns: number,
  size: number,
  title: string,
) =>
  page.evaluate(
    async ({ cells, columns, size, title }) => {
      const strip = 22;
      const head = 34;
      const rows = Math.ceil(cells.length / columns);
      const sheet = document.createElement("canvas");
      sheet.width = columns * size;
      sheet.height = head + rows * (size + strip);
      const ctx = sheet.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "rgb(38, 40, 44)";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = "#eee";
      ctx.font = "600 17px system-ui, sans-serif";
      ctx.fillText(title, 8, 23);
      ctx.font = "12px ui-monospace, monospace";
      for (const [i, c] of cells.entries()) {
        const x = (i % columns) * size;
        const y = head + Math.floor(i / columns) * (size + strip);
        const img = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${c.png}`)).blob(),
        );
        ctx.drawImage(img, x, y, size, size);
        ctx.fillText(c.label, x + 4, y + size + 15);
      }
      return sheet.toDataURL("image/png").split(",")[1] as string;
    },
    { cells, columns, size, title },
  );

for (const sheet of SHEETS)
  test(`anatomy pose ${sheet.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60 * 60_000);
    const tiles = scatter(sheet.seed, sheet.views.length);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: sheet.size, height: sheet.size });
    // Column by column: one camera query per page, every age in it.
    const cells: { png: string; label: string }[] = new Array(tiles.length);
    for (const [col, view] of sheet.views.entries()) {
      const lead = tiles[col] as Tile;
      assertAdult(lead.input);
      await openSilentGame(
        page,
        `/?adult&${view.camera}&recipe=${encodeURIComponent(JSON.stringify(lead.input))}`,
        {},
        { markerTimeout: 120_000 },
      );
      await page.locator('[data-figure="ready"]').waitFor({ timeout: 300_000 });
      for (let i = col; i < tiles.length; i += sheet.views.length) {
        const tile = tiles[i] as Tile;
        cells[i] = {
          png: await shot(page, tile, sheet.pose),
          label: `${view.name}: ${tile.label}`,
        };
      }
    }
    const png = await composite(
      page,
      cells,
      sheet.views.length,
      sheet.size,
      `${sheet.name}, posed through the rig; rows age 25/40/55/70, hairless, adults only`,
    );
    const file = testInfo.outputPath(`anatomy-pose-${sheet.name.replace(/ /g, "-")}.png`);
    fs.writeFileSync(file, Buffer.from(png, "base64"));
    expect(errors, errors.join("\n")).toEqual([]);
  });
