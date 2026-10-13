/**
 * The adults-only coverage battery: an honest inventory of what the kit can show
 * today, one test per row of the matrix, for the integrator to judge. Like the other
 * sheets it runs against the playground's dev server through the `sheets` project, so
 * on the agents' machines it goes to the render pool (the file goes first: `--project`
 * takes every name after it):
 *
 *   heavy-slot pnpm exec playwright test e2e/sheets/coverage-battery.sheet.ts --project sheets [-g "01 "]
 *
 * Rows, by test name:
 *   01 male genitals with pubic hair (density 0 / 1 / 2 and the default, flaccid and erect)
 *   02 axillary and body hair across the body battery, arms raised, with a beard
 *   03 female genitals as they render today, pubic density 0 / 1 / 2
 *   04 canals open against closed (what the adult pack exposes)
 *   05 arousal and the other skin states, both sexes
 *   06 body art: piercings, tattoos, scars, birthmarks, vitiligo
 *   07 expressions, authored poses and animation clips
 *
 * Every figure is an adult aged 25 to 60. `assertAdult` runs before every figure
 * reaches the page, on the recipe that is about to be drawn, and fails the run on any
 * age under 18 (or outside 25..60); the page always loads the adult pack, so no figure
 * is ever drawn for an age the policy does not allow. The run records no trace, video
 * or failure screenshot.
 *
 * Sheets are written to the test output the render pool returns (and to
 * `HK_COVERAGE_OUT` when a local run sets it); they are never committed or published.
 * Move them to `~/.cache/hk-coverage` as soon as they return.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { IRIS_PALETTE } from "../../src/editor/randomize.ts";
import { BATTERY_BODIES } from "../../src/foundation/battery.ts";
import { landmarkVertices } from "../../src/foundation/landmarks.ts";
import { ADULT_AGE } from "../../src/makehuman/macro.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { EXPRESSIONS } from "../../src/rig/expressions.ts";
import { restBones } from "../../src/rig/pose.ts";
import type { BodyHairRecipe } from "../../src/surface/bodyHair.ts";
import { HAIR_COLOURS } from "../../src/surface/hairTone.ts";
import type { Rgb } from "../../src/surface/skinTone.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";

// Never a trace, a video or a failure screenshot: nothing but the sheets is written.
test.use({ screenshot: "off", video: "off", trace: "off" });

const outDir = process.env.HK_COVERAGE_OUT;

type Input = NonNullable<Parameters<typeof createRecipe>[0]>;
type Signals = Record<string, number>;
/** A shot's pose: a body pose by name, face units, or a clip held at a time. */
interface Pose {
  body?: string;
  faceUnits?: Record<string, number>;
  animation?: { clip: string; time?: number; paused?: boolean; rootMotion?: boolean };
}

// ---------------------------------------------------------------------------
// The adults-only rule
// ---------------------------------------------------------------------------

/** Thrown, never swallowed, when a figure outside the battery's age rule is asked for. */
class AgeRuleError extends Error {}

const MIN_AGE = 25;
const MAX_AGE = 60;

/** Fails the run before a figure that is not an adult of 25 to 60 reaches the page. */
function assertAdult(input: Input, what: string): void {
  const age = createRecipe(input).macros.age;
  if (!(age >= ADULT_AGE) || age < MIN_AGE || age > MAX_AGE)
    throw new AgeRuleError(`${what}: age ${age} is outside the battery's adults-only 25..60`);
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

const BROWN_IRIS = IRIS_PALETTE.find((c) => c.name === "Brown");
if (!BROWN_IRIS) throw new Error("the iris palette has no Brown");

/** The three battery tones this inventory uses: light, mid, deep (battery tones 2, 4 and 6). */
const TONES = [
  { name: "light", melanin: 0.2 },
  { name: "mid", melanin: 0.5 },
  { name: "deep", melanin: 0.9 },
] as const;
const MID = TONES[1];

interface Figure {
  gender: number;
  melanin: number;
  age?: number;
  macros?: Record<string, number>;
  bodyHair?: BodyHairRecipe;
  bodyArt?: Input["bodyArt"];
}

/** An uncovered adult: brown hair and eyes, short hair, brows and lashes, no outfit. */
const figure = (f: Figure): Input => ({
  macros: { age: f.age ?? 30, gender: f.gender, ...f.macros },
  skin: { melanin: f.melanin },
  eyes: { iris: [...BROWN_IRIS.rgb] as Rgb },
  hair: {
    style: "short01",
    colour: { ...HAIR_COLOURS.brown },
    brows: "eyebrow001",
    lashes: "eyelashes01",
  },
  ...(f.bodyHair && { bodyHair: f.bodyHair }),
  ...(f.bodyArt && { bodyArt: f.bodyArt }),
});

const male = (melanin: number, rest: Partial<Figure> = {}) =>
  figure({ gender: 1, melanin, ...rest });
const female = (melanin: number, rest: Partial<Figure> = {}) =>
  figure({ gender: 0, melanin, ...rest });

// ---------------------------------------------------------------------------
// Views (the playground's camera queries)
// ---------------------------------------------------------------------------

interface View {
  name: string;
  camera: string;
  /** The pose every cell of this view takes unless it names its own. */
  pose?: Pose;
}

const WHOLE = "cam=0,0.9,4.4,0,0.9,0&span=2.1";
const WHOLE_BACK = "cam=0,0.9,-4.4,0,0.9,0&span=2.1";
const HIPS = "frame=root&view=0,0.05,1&span=0.65&at=0,0.05,0";
const PELVIS_FRONT = "frame=root&view=0,0.1,1&span=0.3&at=0,-0.07,0&light=camera";
// The near thigh hides the organ from the side of a figure standing with its legs
// together, so the oblique and profile views take the legs-apart pose (`APART`).
const PELVIS_OBLIQUE = "frame=root&view=0.75,0.1,0.65&span=0.3&at=0,-0.07,0.08&light=camera";
const PELVIS_SIDE = "frame=root&view=1,0.3,0.1&span=0.3&at=0,-0.05,0.1&light=camera";
const APART: Pose = { body: "abducted" };
const FACE = "frame=head&view=0,0.05,1&span=0.32";
const CHEST = "frame=spine02&view=0,0.1,1&span=0.6";
const UNDERARM_RAISED = "frame=upperarm01.L&view=1,-0.4,0.25&span=0.28&at=0,-0.04,0&light=camera";

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

interface Col {
  label: string;
  input: Input;
  pose?: Pose;
  signals?: Signals;
}

interface Cell {
  label: string;
  /** base64 PNG; absent when the cell failed, then `error` says why. */
  png?: string;
  error?: string;
}

interface Row {
  label: string;
  cells: Cell[];
}

interface Sheet {
  file: string;
  title: string;
  /** The canvas size of one cell. */
  size: { width: number; height: number };
  views: View[];
  cols: Col[];
  /** Cells per row: a view's columns wrap to rows of this many. */
  perRow?: number;
}

/** Four animation frames, so what is on the canvas is what was last drawn. */
const frames = (page: Page, n = 4) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let seen = 0;
        const tick = () => (++seen >= count ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

const parts = (page: Page) =>
  page.evaluate(() => {
    const drawn = window.hkDrawn;
    if (!drawn) throw new Error("the QA shot is not mounted");
    return drawn().map((p) => String(p.part));
  });

/** Draws one figure and returns its canvas as base64, or the reason it could not. */
async function showCell(page: Page, col: Col, view: View, errors: string[]): Promise<Cell> {
  // The rule, on the recipe about to be drawn, before it reaches the page.
  assertAdult(col.input, col.label);
  const before = errors.length;
  try {
    const generation = await page.evaluate(
      ({ recipe, pose, signals }) => {
        const set = window.hkSetRecipe;
        if (!set) throw new Error("the QA shot is not mounted");
        const next =
          Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
        set(recipe as never, pose as never, signals);
        return next;
      },
      { recipe: col.input, pose: col.pose ?? view.pose, signals: col.signals },
    );
    await page
      .locator(`[data-figure="ready"][data-generation="${generation}"]`)
      .waitFor({ timeout: 120_000 });
    await frames(page);
    const drawn = await parts(page);
    if (!drawn.includes("adultBody"))
      return { label: col.label, error: "the page drew no adult surface" };
    const png = (await page.locator("canvas").screenshot()).toString("base64");
    const fresh = errors.slice(before);
    return fresh.length
      ? { label: col.label, png, error: fresh.join(" | ").slice(0, 200) }
      : { label: col.label, png };
  } catch (e) {
    if (e instanceof AgeRuleError) throw e;
    const fresh = errors.slice(before);
    return {
      label: col.label,
      error: `${String((e as Error).message).split("\n")[0]} ${fresh.join(" | ")}`.slice(0, 240),
    };
  }
}

/** Draws rows of cells with a label strip under each, and returns the PNG as base64. */
async function composite(
  page: Page,
  rows: Row[],
  title: string,
  size: { width: number; height: number },
): Promise<string> {
  return page.evaluate(
    async ({ rows, title, size }) => {
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const lead = rows.flatMap((r) => r.cells).find((c) => c.png);
      const w = size.width;
      const h = size.height;
      const strip = 40;
      const head = 52;
      const columns = Math.max(...rows.map((r) => r.cells.length));
      const sheet = document.createElement("canvas");
      sheet.width = w * columns;
      sheet.height = head + rows.length * (h + strip);
      const ctx = sheet.getContext("2d") as CanvasRenderingContext2D;
      let fill = "rgb(40, 44, 52)";
      if (lead?.png) {
        const first = await decode(lead.png);
        const probe = new OffscreenCanvas(1, 1).getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
        probe.drawImage(first, 2, 2, 1, 1, 0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        fill = `rgb(${r}, ${g}, ${b})`;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = "#fff";
      ctx.font = "600 26px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(title, 14, head / 2);
      for (const [ri, row] of rows.entries()) {
        const top = head + ri * (h + strip);
        for (const [ci, c] of row.cells.entries()) {
          if (c.png) ctx.drawImage(await decode(c.png), ci * w, top);
          else {
            ctx.fillStyle = "rgba(160, 30, 30, 0.35)";
            ctx.fillRect(ci * w, top, w, h);
            ctx.fillStyle = "#fff";
            ctx.font = "500 18px system-ui, sans-serif";
            ctx.textAlign = "left";
            const words = (c.error ?? "failed").split(" ");
            let line = "";
            let y = top + 28;
            for (const word of words) {
              if (ctx.measureText(`${line} ${word}`).width > w - 20) {
                ctx.fillText(line, ci * w + 10, y);
                y += 22;
                line = word;
              } else line = `${line} ${word}`;
            }
            ctx.fillText(line, ci * w + 10, y);
          }
          ctx.fillStyle = "#fff";
          ctx.font = "600 22px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            c.label + (c.png && c.error ? " (!)" : ""),
            ci * w + w / 2,
            top + h + strip / 2,
          );
          ctx.textAlign = "left";
        }
        // The row's name sits in the first cell's corner.
        ctx.font = "600 18px system-ui, sans-serif";
        const tw = ctx.measureText(row.label).width;
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(0, top, tw + 14, 26);
        ctx.fillStyle = "#fff";
        ctx.fillText(row.label, 7, top + 14);
      }
      return sheet.toDataURL("image/png").split(",")[1] as string;
    },
    { rows, title, size },
  );
}

const chunk = <T>(items: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
};

const seenPages = new WeakSet<Page>();

/** Renders one sheet: every view over every column, then writes it. Returns the errors the page raised. */
async function renderSheet(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  sheet: Sheet,
): Promise<string[]> {
  const errors: string[] = [];
  if (!seenPages.has(page)) {
    seenPages.add(page);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("Outdated Optimize Dep"))
        errors.push(m.text());
    });
  }
  await page.setViewportSize(sheet.size);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const rows: Row[] = [];
  for (const view of sheet.views) {
    const lead = sheet.cols[0] as Col;
    // The page's first figure is the first cell of the view, held to the same rule.
    assertAdult(lead.input, `${sheet.file}/${view.name}`);
    const query = `adult&${view.camera}&recipe=${encodeURIComponent(JSON.stringify(lead.input))}`;
    expect(query.includes("adult"), "every sheet loads the adult pack").toBe(true);
    await openSilentGame(page, `/?${query}`, {}, { markerTimeout: 120_000 });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 300_000 });
    const cells: Cell[] = [];
    for (const col of sheet.cols) cells.push(await showCell(page, col, view, errors));
    chunk(cells, sheet.perRow ?? cells.length).forEach((group, i, all) => {
      rows.push({ label: all.length > 1 ? `${view.name} ${i + 1}` : view.name, cells: group });
    });
  }
  const png = Buffer.from(await composite(page, rows, sheet.title, sheet.size), "base64");
  if (outDir) fs.writeFileSync(path.join(outDir, `${sheet.file}.png`), png);
  const out = testInfo.outputPath(`${sheet.file}.png`);
  fs.writeFileSync(out, png);
  await testInfo.attach(sheet.file, { path: out, contentType: "image/png" });
  if (errors.length) {
    const note = testInfo.outputPath(`${sheet.file}.errors.txt`);
    fs.writeFileSync(note, [...new Set(errors)].join("\n"));
    await testInfo.attach(`${sheet.file}.errors`, { path: note, contentType: "text/plain" });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Body anchors for tattoos, scars and birthmarks (base-mesh vertices found in Node)
// ---------------------------------------------------------------------------

type P3 = readonly [number, number, number];
const anchorsOf = (() => {
  let found: Record<string, number> | undefined;
  return () => {
    if (found) return found;
    const assets = loadFixtureAssets(true);
    const bones = restBones(assets, assets.positions);
    const head = (name: string): P3 => {
      const b = bones.names.indexOf(name);
      if (b < 0) throw new Error(`no bone ${name}`);
      return [
        bones.heads[b * 3] as number,
        bones.heads[b * 3 + 1] as number,
        bones.heads[b * 3 + 2] as number,
      ];
    };
    const mid = (a: string, b: string): P3 => {
      const p = head(a);
      const q = head(b);
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    };
    const P = assets.positions;
    /** The base vertex nearest a point: put the point just outside the skin where the mark goes. */
    const nearest = (at: P3): number => {
      let best = -1;
      let d = Number.POSITIVE_INFINITY;
      for (let v = 0; v < assets.manifest.vertexCount; v++) {
        const dx = (P[v * 3] as number) - at[0];
        const dy = (P[v * 3 + 1] as number) - at[1];
        const dz = (P[v * 3 + 2] as number) - at[2];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < d) {
          d = dd;
          best = v;
        }
      }
      return best;
    };
    const out = (p: P3, dx: number, dy: number, dz: number): number =>
      nearest([p[0] + dx, p[1] + dy, p[2] + dz]);
    const arm = mid("upperarm01.L", "lowerarm01.L");
    const arm2 = mid("upperarm01.R", "lowerarm01.R");
    const fore = mid("lowerarm01.L", "wrist.L");
    const thigh = mid("upperleg01.L", "lowerleg01.L");
    const calf = mid("lowerleg01.L", "foot.L");
    const spine = head("spine02");
    const lumbar = head("spine04");
    found = {
      chest: out(spine, 0, 0.04, 0.2),
      "upper-arm.L": out(arm, 0.12, 0, 0),
      "upper-arm.R": out(arm2, -0.12, 0, 0),
      "forearm.L": out(fore, 0.1, 0, 0.05),
      back: out(spine, 0, 0.02, -0.2),
      "lower-back": out(lumbar, 0, -0.06, -0.2),
      "thigh.L": out(thigh, 0, 0, 0.2),
      "calf.L": out(calf, 0, 0, -0.12),
      shoulder: out(head("upperarm01.R"), -0.04, 0.06, -0.08),
      sternum: landmarkVertices(assets)["sternum-notch"],
      navel: landmarkVertices(assets).navel,
    };
    return found;
  };
})();

// ---------------------------------------------------------------------------
// 01 male genitals with pubic hair
// ---------------------------------------------------------------------------

const GENITAL_VIEWS: View[] = [
  { name: "hips", camera: HIPS },
  { name: "front", camera: PELVIS_FRONT },
  { name: "oblique, legs apart", camera: PELVIS_OBLIQUE, pose: APART },
  { name: "profile, legs apart", camera: PELVIS_SIDE, pose: APART },
];

/** The pubic coat's four states: the figure's default, then the density set explicitly. */
const COAT = [
  { label: "default", bodyHair: undefined },
  { label: "pubic 0", bodyHair: { density: { pubic: 0 } } },
  { label: "pubic 1", bodyHair: { density: { pubic: 1 } } },
  { label: "pubic 2", bodyHair: { density: { pubic: 2 } } },
] as const;

for (const tone of TONES) {
  test(`01 male genitals with hair, ${tone.name} tone`, async ({ page }, testInfo) => {
    const cols: Col[] = [
      ...COAT.map((c) => ({
        label: `flaccid ${c.label}`,
        input: male(tone.melanin, c.bodyHair && { bodyHair: c.bodyHair }),
        signals: { arousal: 0 },
      })),
      ...COAT.map((c) => ({
        label: `erect ${c.label}`,
        input: male(tone.melanin, c.bodyHair && { bodyHair: c.bodyHair }),
        signals: { arousal: 1 },
      })),
    ];
    await renderSheet(page, testInfo, {
      file: `01-male-genitals-${tone.name}`,
      title: `01 male, age 30, ${tone.name} tone: pubic hair default / 0 / 1 / 2, flaccid then erect (arousal 0 / 1)`,
      size: { width: 250, height: 250 },
      views: GENITAL_VIEWS,
      cols,
    });
  });
}

// ---------------------------------------------------------------------------
// 02 armpit and body hair across the body battery
// ---------------------------------------------------------------------------

/** Every region at its default (1) and a full beard, set explicitly. */
const FULL_HAIR: BodyHairRecipe = {
  density: { axillary: 1, chest: 1, abdomen: 1, arms: 1, legs: 1, face: 1 },
  beard: "full",
};

/** The adult battery bodies inside the battery's 25..60 rule (the 75-year-old elders are left out). */
const ADULT_BODIES = BATTERY_BODIES.filter(
  (b) => b.adult && b.macros.age >= MIN_AGE && b.macros.age <= MAX_AGE,
);

const bodyCol = (name: string, melanin: number): Col => {
  const body = ADULT_BODIES.find((b) => b.name === name);
  if (!body) throw new Error(`no adult battery body ${name}`);
  return {
    label: name,
    input: figure({
      gender: body.macros.gender ?? 0.5,
      melanin,
      age: body.macros.age,
      macros: { ...body.macros },
      bodyHair: FULL_HAIR,
    }),
  };
};

const OVERHEAD: Pose = { body: "overhead" };
const BODYHAIR_VIEWS: View[] = [
  { name: "arms raised", camera: WHOLE, pose: OVERHEAD },
  { name: "armpit", camera: UNDERARM_RAISED, pose: OVERHEAD },
  { name: "torso", camera: CHEST, pose: { body: "relaxed" } },
  { name: "back", camera: WHOLE_BACK, pose: { body: "relaxed" } },
  { name: "face", camera: FACE, pose: { body: "relaxed" } },
];

test("02 body hair across the body battery", async ({ page }, testInfo) => {
  const groups: [string, string[]][] = [
    ["A", ["f-slim", "f-average", "f-heavy", "f-muscular", "x-average", "tall", "short"]],
    ["B", ["m-slim", "m-average", "m-heavy", "m-muscular", "african", "asian", "caucasian"]],
  ];
  for (const [group, names] of groups)
    await renderSheet(page, testInfo, {
      file: `02-bodyhair-battery-${group}`,
      title: `02 body battery ${group}, mid tone: axillary, chest, abdomen, arms, legs, face at 1, full beard`,
      size: { width: 240, height: 420 },
      views: BODYHAIR_VIEWS,
      cols: names.map((n) => bodyCol(n, MID.melanin)),
    });
  // Light and deep skin on the two average bodies: hair colour reads against the tone.
  await renderSheet(page, testInfo, {
    file: "02-bodyhair-tones",
    title: "02 f-average and m-average at light, mid and deep tones, same hair settings",
    size: { width: 240, height: 420 },
    views: BODYHAIR_VIEWS.filter((v) => v.name !== "back"),
    cols: TONES.flatMap((t) =>
      ["f-average", "m-average"].map((n) => ({
        ...bodyCol(n, t.melanin),
        label: `${n} ${t.name}`,
      })),
    ),
  });
});

// ---------------------------------------------------------------------------
// 03 female genitals, the default today
// ---------------------------------------------------------------------------

for (const tone of TONES)
  test(`03 female genitals, ${tone.name} tone`, async ({ page }, testInfo) => {
    await renderSheet(page, testInfo, {
      file: `03-female-genitals-${tone.name}`,
      title: `03 female (gender 0), age 30, ${tone.name} tone: the default as it renders today; pubic default / 0 / 1 / 2`,
      size: { width: 250, height: 250 },
      views: [
        ...GENITAL_VIEWS,
        { name: "front, legs apart", camera: PELVIS_FRONT, pose: { body: "abducted" } },
      ],
      cols: COAT.map((c) => ({
        label: `pubic ${c.label}`.replace("pubic pubic", "pubic"),
        input: female(tone.melanin, c.bodyHair && { bodyHair: c.bodyHair }),
      })),
    });
  });

// ---------------------------------------------------------------------------
// 04 canals open and closed
// ---------------------------------------------------------------------------

test("04 canals open against closed", async ({ page }, testInfo) => {
  // The adult pack of this branch declares no canal affordance or closure (its manifest
  // has no `affordances`, and `CanalClosureSpec` and `closedLoop` do not exist here), so
  // there is no open or closed state to set. The sheet shows the perineum and the cleft
  // as the kit draws them, with the legs together, apart and squatting, so the absence
  // is on record: nothing a recipe or a signal can do opens anything.
  const poses: [string, Pose][] = [
    ["relaxed", { body: "relaxed" }],
    ["legs apart", { body: "abducted" }],
    ["squat", { body: "squat" }],
  ];
  const cols: Col[] = poses.flatMap(([name, pose]) => [
    { label: `F ${name}`, input: female(MID.melanin), pose },
    { label: `M ${name}`, input: male(MID.melanin), pose },
  ]);
  await renderSheet(page, testInfo, {
    file: "04-canals",
    title:
      "04 canals: no open or closed state exists on integration; the perineum from below and the cleft from behind, mid tone",
    size: { width: 250, height: 250 },
    views: [
      {
        name: "from below",
        camera: "frame=root&view=0,-1,0.45&span=0.32&at=0,-0.08,0&light=camera",
      },
      {
        name: "from behind",
        camera: "frame=root&view=0,-0.2,-1&span=0.32&at=0,-0.07,0&light=camera",
      },
    ],
    cols,
  });
});

// ---------------------------------------------------------------------------
// 05 arousal and the other skin states
// ---------------------------------------------------------------------------

test("08 face-up spread-leg anatomy baseline", async ({ page }, testInfo) => {
  const builds = [
    { label: "slim", macros: { weight: 0.2, muscle: 0.3 } },
    { label: "average", macros: { weight: 0.5, muscle: 0.5 } },
    { label: "heavy", macros: { weight: 0.9, muscle: 0.3 } },
  ];
  for (const tone of TONES) {
    await renderSheet(page, testInfo, {
      file: `08-face-up-${tone.name}`,
      title: `08 age 30, ${tone.name}: rigid face-up orientation, abducted legs; integration baseline, not accepted female anatomy`,
      size: { width: 360, height: 360 },
      views: [
        {
          name: "above, legs spread",
          camera: "supineQa&frame=root&view=0,1,0.4&span=0.7&light=camera",
          pose: APART,
        },
        {
          name: "perineum, foot end",
          camera: "supineQa&frame=root&view=0,0.7,1&span=0.5&at=0,0.05,0.02&light=camera",
          pose: APART,
        },
        {
          name: "oblique close",
          camera: "supineQa&frame=root&view=0.3,1,0.65&span=0.45&at=0,0.05,0.02&light=camera",
          pose: APART,
        },
      ],
      cols: builds.flatMap(({ label, macros }) => [
        {
          label: `F ${label}`,
          input: female(tone.melanin, { macros, bodyHair: { density: { pubic: 0 } } }),
        },
        {
          label: `M ${label}`,
          input: male(tone.melanin, { macros, bodyHair: { density: { pubic: 0 } } }),
        },
      ]),
    });
  }
});

const STATE_VIEWS: View[] = [
  { name: "hips", camera: HIPS },
  { name: "pelvis", camera: PELVIS_FRONT },
  { name: "profile, legs apart", camera: PELVIS_SIDE, pose: APART },
  { name: "chest", camera: "frame=spine02&view=0,0.1,1&span=0.4&light=camera" },
  { name: "face", camera: FACE },
];

for (const sex of [
  { name: "male", make: male },
  { name: "female", make: female },
] as const)
  test(`05 arousal, ${sex.name}`, async ({ page }, testInfo) => {
    const at = (tone: (typeof TONES)[number], arousal: number, what: string): Col => ({
      label: `${what} ${tone.name}`,
      input: sex.make(tone.melanin, { bodyHair: { density: { pubic: 1 } } }),
      signals: { arousal },
    });
    await renderSheet(page, testInfo, {
      file: `05-arousal-${sex.name}`,
      title: `05 ${sex.name}, age 30: arousal off / mid / full at the mid tone, full at light and deep`,
      size: { width: 250, height: 250 },
      views: STATE_VIEWS,
      cols: [
        at(MID, 0, "off"),
        at(MID, 0.5, "mid"),
        at(MID, 1, "full"),
        at(TONES[0], 1, "full"),
        at(TONES[2], 1, "full"),
      ],
    });
  });

for (const sex of [
  { name: "male", make: male },
  { name: "female", make: female },
] as const)
  test(`05 other skin states, ${sex.name}`, async ({ page }, testInfo) => {
    const states: [string, Signals][] = [
      ["rest", {}],
      ["cold", { cold: 1 }],
      ["heat", { heat: 1 }],
      ["exertion", { exertion: 1 }],
      ["blush", { blush: 1 }],
      ["fear", { fear: 1 }],
    ];
    await renderSheet(page, testInfo, {
      file: `05-states-${sex.name}`,
      title: `05 ${sex.name}, age 30, mid tone: cold / heat / exertion / blush / fear at 1`,
      size: { width: 250, height: 250 },
      views: STATE_VIEWS.filter((v) => ["chest", "face", "hips"].includes(v.name)),
      cols: states.map(([label, signals]) => ({
        label,
        input: sex.make(MID.melanin),
        signals,
      })),
    });
  });

// ---------------------------------------------------------------------------
// 06 body art
// ---------------------------------------------------------------------------

const PIERCE_SITES = [
  "ear-lobe.L",
  "ear-lobe.R",
  "ear-helix.L",
  "ear-helix.R",
  "nostril.L",
  "nostril.R",
  "septum",
  "brow.L",
  "brow.R",
  "lower-lip",
  "navel",
] as const;

test("06 piercings", async ({ page }, testInfo) => {
  const designs = [
    { label: "stud steel", jewellery: "stud", metal: "steel" },
    { label: "ring gold", jewellery: "ring", metal: "gold" },
    { label: "barbell titanium", jewellery: "barbell", metal: "titanium" },
    { label: "stud rose-gold", jewellery: "stud", metal: "rose-gold" },
    { label: "ring silver", jewellery: "ring", metal: "silver" },
  ] as const;
  const pierced = (d: (typeof designs)[number], gender: number, melanin: number): Input =>
    figure({
      gender,
      melanin,
      bodyArt: {
        piercings: PIERCE_SITES.map((site) => ({ site, jewellery: d.jewellery, metal: d.metal })),
      },
    });
  for (const [name, gender] of [
    ["female", 0],
    ["male", 1],
  ] as const)
    await renderSheet(page, testInfo, {
      file: `06-piercings-${name}`,
      title: `06 ${name}, mid tone: every body piercing site (ear lobe and helix, nostril, septum, brow, lower lip, navel) in five jewellery designs`,
      size: { width: 250, height: 250 },
      views: [
        { name: "face", camera: "frame=head&view=0,0.05,1&span=0.2" },
        { name: "left ear", camera: "frame=head&view=1,0.05,0.1&span=0.22" },
        { name: "right ear", camera: "frame=head&view=-1,0.05,0.1&span=0.22" },
        { name: "navel", camera: "frame=root&view=0,0.1,1&span=0.3&at=0,0.1,0&light=camera" },
      ],
      cols: designs.map((d) => ({ label: d.label, input: pierced(d, gender, MID.melanin) })),
    });
});

test("06 tattoos", async ({ page }, testInfo) => {
  const a = anchorsOf();
  const sites: [string, number, number][] = [
    ["chest", a.chest as number, 0.1],
    ["upper-arm.L", a["upper-arm.L"] as number, 0.08],
    ["back", a.back as number, 0.12],
    ["thigh.L", a["thigh.L"] as number, 0.09],
  ];
  const inked = (image: string, melanin: number, density = 1): Input =>
    figure({
      gender: 1,
      melanin,
      bodyArt: { tattoos: sites.map(([, at, size]) => ({ image, at, size, density })) },
    });
  const cols: Col[] = [
    ...TONES.map((t) => ({ label: `compass ${t.name}`, input: inked("compass", t.melanin) })),
    ...TONES.map((t) => ({ label: `flash ${t.name}`, input: inked("flash", t.melanin) })),
    { label: "compass faded .4", input: inked("compass", MID.melanin, 0.4) },
  ];
  await renderSheet(page, testInfo, {
    file: "06-tattoos",
    title:
      "06 male, age 30: the playground's two designs (compass line work, colour flash) at four sites, three tones, one faded",
    size: { width: 240, height: 300 },
    views: [
      { name: "chest", camera: "frame=spine02&view=0,0.1,1&span=0.4&light=camera" },
      {
        name: "upper arm",
        camera: "frame=upperarm01.L&view=1,0,0.15&span=0.32&at=0,-0.12,0&light=camera",
      },
      { name: "back", camera: "frame=spine02&view=0,0.1,-1&span=0.45&light=camera" },
      { name: "thigh", camera: "frame=upperleg01.L&view=0,0,1&span=0.4&at=0,-0.2,0&light=camera" },
    ],
    cols,
  });
});

test("06 scars, birthmarks, vitiligo", async ({ page }, testInfo) => {
  const a = anchorsOf();
  const marked = (melanin: number): Input =>
    figure({
      gender: 0.5,
      melanin,
      bodyArt: {
        scars: [
          { at: a.chest as number, length: 0.08, maturity: 0, raised: 1 },
          { at: a["forearm.L"] as number, length: 0.06, maturity: 1, raised: 0 },
          { at: a["lower-back"] as number, length: 0.1, maturity: 0.5, raised: 0.5, rotation: 90 },
        ],
        birthmarks: [
          { kind: "cafe-au-lait", at: a["upper-arm.L"] as number, size: 0.05, seed: 1 },
          { kind: "naevus", at: a["thigh.L"] as number, size: 0.02, seed: 2 },
          { kind: "port-wine", at: a.shoulder as number, size: 0.06, seed: 3 },
          { kind: "dermal-melanocytosis", at: a.back as number, size: 0.09, seed: 4 },
        ],
        vitiligo: { extent: 0.6, seed: 5 },
      },
    });
  await renderSheet(page, testInfo, {
    file: "06-scars-marks-vitiligo",
    title:
      "06 androgynous, age 30: scars (fresh raised, mature, mid), four birthmarks, vitiligo extent 0.6; light, mid, deep",
    size: { width: 240, height: 420 },
    views: [
      { name: "front", camera: WHOLE },
      { name: "back", camera: WHOLE_BACK },
      { name: "chest", camera: "frame=spine02&view=0,0.1,1&span=0.4&light=camera" },
      { name: "hands and face", camera: FACE },
    ],
    cols: TONES.map((t) => ({ label: t.name, input: marked(t.melanin) })),
  });
});

// ---------------------------------------------------------------------------
// 07 animation beyond the base form
// ---------------------------------------------------------------------------

test("07 expressions", async ({ page }, testInfo) => {
  for (const [name, gender] of [
    ["female", 0],
    ["male", 1],
  ] as const)
    await renderSheet(page, testInfo, {
      file: `07-expressions-${name}`,
      title: `07 ${name}, age 30, mid tone: rest and the kit's ${EXPRESSIONS.length} named expressions (src/rig/expressions.ts)`,
      size: { width: 240, height: 300 },
      views: [{ name: "face", camera: FACE }],
      perRow: 6,
      cols: [
        { label: "rest", input: figure({ gender, melanin: MID.melanin }) },
        ...EXPRESSIONS.map((e) => ({
          label: e.id,
          input: figure({ gender, melanin: MID.melanin }),
          pose: { faceUnits: { ...e.faceUnits } },
        })),
      ],
    });
});

const BODY_POSES = [
  "tpose",
  "benchmark",
  "relaxed",
  "abducted",
  "overhead",
  "flexed",
  "bent",
  "bowed",
  "twisted",
  "tucked",
  "seated",
  "squat",
] as const;

test("07 poses", async ({ page }, testInfo) => {
  await renderSheet(page, testInfo, {
    file: "07-poses",
    title: "07 age 30, mid tone: the body pack's twelve poses, female then male",
    size: { width: 280, height: 360 },
    views: [{ name: "female", camera: "cam=0,0.8,4.8,0,0.8,0&span=2.2" }],
    perRow: 6,
    cols: BODY_POSES.map((p) => ({
      label: p,
      input: female(MID.melanin),
      pose: { body: p },
    })),
  });
  await renderSheet(page, testInfo, {
    file: "07-poses-male",
    title: "07 male, age 30, mid tone: the body pack's twelve poses",
    size: { width: 280, height: 360 },
    views: [{ name: "male", camera: "cam=0,0.8,4.8,0,0.8,0&span=2.2" }],
    perRow: 6,
    cols: BODY_POSES.map((p) => ({
      label: p,
      input: male(MID.melanin),
      pose: { body: p },
    })),
  });
});

const CLIPS: [string, number][] = [
  ["idle_loop", 0.5],
  ["idle_talking_loop", 0.8],
  ["walk_normal", 0.4],
  ["jog_fwd_loop", 0.3],
  ["sprint_loop", 0.3],
  ["dance_loop", 1],
  ["sitting_idle_loop", 0.5],
  ["crouch_idle_loop", 0.5],
  ["punch_cross", 0.3],
  ["jump_loop", 0.3],
  ["swim_fwd_loop", 0.5],
  ["death01", 1],
];

test("07 animation clips", async ({ page }, testInfo) => {
  for (const [name, make] of [
    ["female", female],
    ["male", male],
  ] as const)
    await renderSheet(page, testInfo, {
      file: `07-clips-${name}`,
      title: `07 ${name}, age 30, mid tone: twelve of the animation pack's clips held at one time each (label: clip, seconds)`,
      size: { width: 280, height: 360 },
      views: [{ name: "clips", camera: "cam=0,0.9,5.2,0,0.9,0&span=2.3" }],
      perRow: 6,
      cols: CLIPS.map(([clip, time]) => ({
        label: `${clip} ${time}s`,
        input: make(MID.melanin),
        pose: { animation: { clip, time, paused: true, rootMotion: false } },
      })),
    });
});
