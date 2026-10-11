/**
 * Issue #21 body-hair response sheet. This is a narrowed, test-only copy of
 * the coverage-battery harness: it proves the explicit controls reach an adult
 * draw before it writes a labelled, silent review sheet. It has no anatomical
 * QA wrapper, no baseline-comparison output, and never names an omitted
 * control as a "default".
 *
 * Root runs it manually after reviewing this branch:
 *
 *   HK_BODY_HAIR_RESPONSE_OUT="/Users/jbogaty/.cache/hk-body-hair-response" \
 *     heavy-slot --priority --rule hardware --reason "Issue #21 body-hair visual gate" \
 *     pnpm exec playwright test e2e/sheets/body-hair-response.sheet.ts --project sheets
 *
 * Every page uses `openSilentGame`; it cannot change saved audio settings.
 * Output is test-only, separate from the historical coverage baseline, and is
 * never committed or published. See https://github.com/jbcom/humanoid-kit/issues/21.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { ADULT_AGE } from "../../src/makehuman/macro.ts";
import { coatPaintFor } from "../../src/react/CoatMesh.tsx";
import { createRecipe } from "../../src/recipe/recipe.ts";
import type { BodyHairRecipe } from "../../src/surface/bodyHair.ts";
import { HAIR_COLOURS } from "../../src/surface/hairTone.ts";

// Never a trace, video or framework failure screenshot: only the review sheets are written.
test.use({ screenshot: "off", video: "off", trace: "off" });

const outDir = process.env.HK_BODY_HAIR_RESPONSE_OUT;
const MID_TONE = 0.5;
const RESPONSE_COVERAGE = [0.1, 0.25, 0.5, 0.75, 0.85, 0.95, 1] as const;
const RESPONSE_FOLLICLES = [1, 2] as const;
const RESPONSE_GROUPS = ["face", "chest", "axillary", "pubic"] as const;

type Input = NonNullable<Parameters<typeof createRecipe>[0]>;
type Pose = { body?: string };

interface View {
  name: string;
  /** Fixed lighting and a camera appropriate for this view. */
  camera: string;
  pose?: Pose;
}

interface Column {
  label: string;
  input: Input;
}

interface Cell {
  label: string;
  png: string;
}

interface Sheet {
  file: string;
  title: string;
  size: { width: number; height: number };
  views: readonly View[];
  columns: readonly Column[];
  perRow?: number;
}

/** All response figures are adults. This remains a hair response sheet, never a minor-body capture. */
function assertAdult(input: Input, label: string): void {
  const age = createRecipe(input).macros.age;
  if (!(age >= ADULT_AGE)) throw new Error(`${label}: age ${age} is not adult`);
}

/** Every visible group has the same explicit coverage; no gender-derived baseline is being compared. */
function explicitHair(coverage: number, follicleDensity: number): BodyHairRecipe {
  return {
    coverage: Object.fromEntries(RESPONSE_GROUPS.map((group) => [group, coverage])),
    follicleDensity: Object.fromEntries(RESPONSE_GROUPS.map((group) => [group, follicleDensity])),
    // Coverage controls the beard's occupancy; this controls its worn shape/length.
    beard: "full",
  } as BodyHairRecipe;
}

function figure(
  gender: number,
  bodyHair: BodyHairRecipe,
  macros: Record<string, number> = {},
): Input {
  return {
    macros: { age: 35, gender, ...macros },
    // Fixed mid tone and brown hair make each response cell comparable.
    skin: { melanin: MID_TONE },
    hair: { style: "short01", colour: { ...HAIR_COLOURS.brown } },
    bodyHair,
  };
}

const STABLE = "tm=neutral&exp=1&light=camera";
const CLOSE_VIEWS: readonly View[] = [
  { name: "face", camera: `frame=head&view=0,0.05,1&span=0.32&${STABLE}` },
  { name: "chest", camera: `frame=spine02&view=0,0.1,1&span=0.6&${STABLE}` },
  {
    name: "raised underarm",
    camera: `frame=upperarm01.L&view=0.7,-0.3,1&span=0.28&${STABLE}`,
    pose: { body: "overhead" },
  },
  {
    name: "pelvis",
    camera: `frame=root&view=0,0.1,1&span=0.3&at=0,-0.07,0&${STABLE}`,
  },
];

/** The fixed spans are deliberately different: full height stays in frame at both battery extremes. */
const WHOLE_TALL: View = {
  name: "whole tall",
  camera: `cam=0,1.1,5.2,0,1.1,0&span=2.65&${STABLE}`,
};
const WHOLE_SHORT: View = {
  name: "whole short",
  camera: `cam=0,0.72,3.4,0,0.72,0&span=1.72&${STABLE}`,
};
const WHOLE_AVERAGE: View = {
  name: "whole average",
  camera: `cam=0,0.9,4.4,0,0.9,0&span=2.1&${STABLE}`,
};

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

/** A response cell must draw the adult surface, no garment, and a non-empty coat request. */
async function assertDrawn(page: Page, input: Input, label: string): Promise<void> {
  const expectedCoat = coatPaintFor(createRecipe(input));
  expect(expectedCoat, `${label}: explicit hair asks the coat to draw`).not.toBeNull();
  const drawn = await page.evaluate(() => {
    const probe = window.hkDrawn;
    if (!probe) throw new Error("the QA shot is not mounted");
    return probe().map((part) => ({
      part: String(part.part),
      garment: part.garment,
      triangles: part.triangles,
    }));
  });
  expect(
    drawn.some((part) => part.part === "adultBody" && part.triangles > 0),
    `${label}: adult surface draws`,
  ).toBe(true);
  expect(
    drawn.some((part) => part.garment !== undefined),
    `${label}: no garment masks hair`,
  ).toBe(false);
}

async function showCell(page: Page, column: Column, view: View): Promise<Cell> {
  assertAdult(column.input, column.label);
  const generation = await page.evaluate(
    ({ recipe, pose }) => {
      const set = window.hkSetRecipe;
      if (!set) throw new Error("the QA shot is not mounted");
      const next =
        Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
      set(recipe as never, pose as never);
      return next;
    },
    { recipe: column.input, pose: view.pose },
  );
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 300_000 });
  await frames(page);
  await assertDrawn(page, column.input, `${view.name}/${column.label}`);
  return {
    label: column.label,
    png: (await page.locator("canvas").screenshot()).toString("base64"),
  };
}

async function composite(
  page: Page,
  rows: readonly { label: string; cells: readonly Cell[] }[],
  title: string,
) {
  return page.evaluate(
    async ({ rows, title }) => {
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const first = await decode(rows[0]?.cells[0]?.png ?? "");
      const width = first.width;
      const height = first.height;
      const labelHeight = 40;
      const headerHeight = 56;
      const columns = Math.max(...rows.map((row) => row.cells.length));
      const sheet = document.createElement("canvas");
      sheet.width = width * columns;
      sheet.height = headerHeight + rows.length * (height + labelHeight);
      const ctx = sheet.getContext("2d") as CanvasRenderingContext2D;
      const sample = new OffscreenCanvas(1, 1).getContext(
        "2d",
      ) as OffscreenCanvasRenderingContext2D;
      sample.drawImage(first, 2, 2, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = sample.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = "#fff";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(title, 14, headerHeight / 2);
      for (const [rowIndex, row] of rows.entries()) {
        const top = headerHeight + rowIndex * (height + labelHeight);
        for (const [columnIndex, cell] of row.cells.entries()) {
          ctx.drawImage(await decode(cell.png), columnIndex * width, top);
          ctx.font = "600 17px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(cell.label, columnIndex * width + width / 2, top + height + labelHeight / 2);
          ctx.textAlign = "left";
        }
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(0, top, ctx.measureText(row.label).width + 14, 24);
        ctx.fillStyle = "#fff";
        ctx.fillText(row.label, 7, top + 12);
      }
      return sheet.toDataURL("image/png").split(",")[1] as string;
    },
    { rows, title },
  );
}

const chunks = <T>(items: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / n) }, (_, index) =>
    items.slice(index * n, (index + 1) * n),
  );

async function renderSheet(
  page: Page,
  info: import("@playwright/test").TestInfo,
  sheet: Sheet,
): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Outdated Optimize Dep"))
      errors.push(message.text());
  });
  await page.setViewportSize(sheet.size);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const rows: { label: string; cells: Cell[] }[] = [];
  for (const view of sheet.views) {
    const lead = sheet.columns[0];
    if (!lead) throw new Error(`${sheet.file} has no response columns`);
    assertAdult(lead.input, `${sheet.file}/${view.name}`);
    const query = `adult&${view.camera}&recipe=${encodeURIComponent(JSON.stringify(lead.input))}`;
    await openSilentGame(page, `/?${query}`, {}, { markerTimeout: 120_000 });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 300_000 });
    const cells: Cell[] = [];
    for (const column of sheet.columns) cells.push(await showCell(page, column, view));
    for (const [index, chunk] of chunks(cells, sheet.perRow ?? cells.length).entries())
      rows.push({
        label: `${view.name}${cells.length > chunk.length ? ` ${index + 1}` : ""}`,
        cells: chunk,
      });
  }
  const png = Buffer.from(await composite(page, rows, sheet.title), "base64");
  if (outDir) fs.writeFileSync(path.join(outDir, `${sheet.file}.png`), png);
  const output = info.outputPath(`${sheet.file}.png`);
  fs.writeFileSync(output, png);
  await info.attach(sheet.file, { path: output, contentType: "image/png" });
  expect(errors, `${sheet.file}: page errors while drawing`).toEqual([]);
}

test("01 coverage response matrix", async ({ page }, info) => {
  const columns = RESPONSE_FOLLICLES.flatMap((follicleDensity) =>
    RESPONSE_COVERAGE.map((coverage) => ({
      label: `cover ${coverage.toFixed(2)} / follicles ${follicleDensity}`,
      input: figure(0.5, explicitHair(coverage, follicleDensity)),
    })),
  );
  await renderSheet(page, info, {
    file: "01-coverage-response",
    title:
      "Issue #21: explicit coverage response (.10–1.00) and physical follicle density (1 / 2), mid tone",
    size: { width: 240, height: 320 },
    views: CLOSE_VIEWS,
    columns,
    perRow: RESPONSE_COVERAGE.length,
  });
});

test("02 gender endpoint response", async ({ page }, info) => {
  const columns = RESPONSE_FOLLICLES.flatMap((follicleDensity) =>
    (
      [
        { label: "female", gender: 0 },
        { label: "male", gender: 1 },
      ] as const
    ).map(({ label, gender }) => ({
      label: `${label} / cover .75 / follicles ${follicleDensity}`,
      input: figure(gender, explicitHair(0.75, follicleDensity)),
    })),
  );
  await renderSheet(page, info, {
    file: "02-gender-endpoints",
    title:
      "Issue #21: female and male endpoints, identical explicit face/chest/axillary/pubic coverage .75",
    size: { width: 300, height: 480 },
    views: [WHOLE_AVERAGE, ...CLOSE_VIEWS],
    columns,
  });
});

test("03 tall whole figure fits", async ({ page }, info) => {
  await renderSheet(page, info, {
    file: "03-tall-whole",
    title: "Issue #21: tall adult, explicit coverage .75, whole figure fitted to the tall camera",
    size: { width: 360, height: 600 },
    views: [WHOLE_TALL],
    columns: [
      { label: "tall / follicles 1", input: figure(0.5, explicitHair(0.75, 1), { height: 1 }) },
      { label: "tall / follicles 2", input: figure(0.5, explicitHair(0.75, 2), { height: 1 }) },
    ],
  });
});

test("04 short whole figure fits", async ({ page }, info) => {
  await renderSheet(page, info, {
    file: "04-short-whole",
    title: "Issue #21: short adult, explicit coverage .75, whole figure fitted to the short camera",
    size: { width: 360, height: 600 },
    views: [WHOLE_SHORT],
    columns: [
      { label: "short / follicles 1", input: figure(0.5, explicitHair(0.75, 1), { height: 0 }) },
      { label: "short / follicles 2", input: figure(0.5, explicitHair(0.75, 2), { height: 0 }) },
    ],
  });
});
