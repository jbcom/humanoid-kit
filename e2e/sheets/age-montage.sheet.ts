/**
 * The age-progression montage: what the kit does BY DEFAULT as a figure ages, for the
 * integrator to judge. Like the other sheets it runs against the playground's dev
 * server through the `sheets` project, so on the agents' machines it goes to the
 * render pool (the file goes first: `--project` takes every name after it):
 *
 *   heavy-slot pnpm exec playwright test e2e/sheets/age-montage.sheet.ts --project sheets [-g adult|under-18]
 *
 * The recipe is the default one with only the kit's own brown hair colour
 * (`HAIR_COLOURS.brown`) and brown iris (`IRIS_PALETTE`) set, one short hair style and
 * the brows and lashes the style needs to be judged, and a mid skin tone: no wrinkle,
 * sag, grey or body-hair control is touched. Two sexes (`gender` 0 and 1) by two groups:
 *
 *   - **adult** (18, 25, 35, 45, 55, 65, 75, 90): uncovered, on the page that loads the
 *     adult anatomy pack (`?adult`, the dev server only), so the default anatomy and the
 *     default pubic and axillary hair draw;
 *   - **under-18** (1, 4, 7, 10, 12, 14, 16): ALWAYS covered, on a page that never loads
 *     the adult pack. The clothing pack of this branch has no underwear kind (its one
 *     underwear garment lives on an unmerged branch), so the cover is its
 *     "T-shirt and denim shorts" suit, a top and short legs in one fitted garment, the
 *     same on both sexes so the cells compare.
 *
 * The cover rule the kit exposes (`wearsCover` over the wardrobe of the clothing
 * manifest) is asserted on every under-18 recipe before it reaches the page, and what
 * the page draws is asserted again before every capture: the cover garment is on the
 * figure and no adult surface is. A failure stops the run before another figure is
 * drawn. Every recipe the page ever holds (its initial one included) is covered, and
 * the run records no trace, video or failure screenshot, so an uncovered figure under
 * 18 is never on screen or on disk.
 *
 * Sheets are written to the test output the render pool returns (and to `HK_MONTAGE_OUT`
 * when a local run sets it); they are never committed or published. Move them to
 * `~/.cache/hk-montage` as soon as they return. Per sex
 * and group: `<sex>-<group>.png` (front over three-quarter, whole figure, one camera
 * for every age so size and proportion progress honestly) and `<sex>-<group>-detail.png`
 * (face and chest, with the pelvis and the underarm for adults only, each framed on its
 * own figure's bone). The age is labelled under each cell.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { wearsCover } from "../../src/editor/cover.ts";
import { IRIS_PALETTE } from "../../src/editor/randomize.ts";
import { wardrobeOf } from "../../src/editor/wardrobe.ts";
import type { ClothingManifest } from "../../src/format/assetFormat.ts";
import { ADULT_AGE } from "../../src/recipe/agePolicy.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { HAIR_COLOURS } from "../../src/surface/hairTone.ts";
import type { Rgb } from "../../src/surface/skinTone.ts";

// Never a trace, a video or a failure screenshot: nothing but the sheets is written.
test.use({ screenshot: "off", video: "off", trace: "off" });

const root = path.resolve(import.meta.dirname, "../..");
/** A local run can name a second place for the sheets; the render pool forwards no environment, so it returns them through the test output. */
const outDir = process.env.HK_MONTAGE_OUT;

const ADULT_AGES = [18, 25, 35, 45, 55, 65, 75, 90] as const;
const MINOR_AGES = [1, 4, 7, 10, 12, 14, 16] as const;
const SEXES = [
  { name: "female", gender: 0 },
  { name: "male", gender: 1 },
] as const;

/** The cover of every figure under 18: a top and short legs, fitted, the same on both sexes. */
const COVER = ["suits/female_casualsuit02"] as const;

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "packs/clothing/data/manifest.json"), "utf8"),
) as ClothingManifest;
const wardrobe = wardrobeOf(manifest);

const BROWN_IRIS = IRIS_PALETTE.find((c) => c.name === "Brown");
if (!BROWN_IRIS) throw new Error("the iris palette has no Brown");

/** The recipe input of one cell: the default figure, brown hair and eyes, a mid skin tone. */
const cell = (age: number, gender: number, outfit: readonly string[] | null) => ({
  macros: { age, gender },
  skin: { melanin: 0.5 },
  eyes: { iris: [...BROWN_IRIS.rgb] as Rgb },
  hair: {
    style: "short01",
    colour: { ...HAIR_COLOURS.brown },
    brows: "eyebrow001",
    lashes: "eyelashes01",
  },
  ...(outfit && { outfit: [...outfit] }),
});

/**
 * The cover check, before a figure is ever handed to a page: a minor must be covered by
 * the kit's own rule, in the cover this sheet names, and an adult must not be asked to be.
 */
function assertCovered(input: ReturnType<typeof cell>): void {
  const recipe = createRecipe(input);
  const age = recipe.macros.age;
  if (age >= ADULT_AGE) return;
  for (const id of COVER)
    expect(
      wardrobe.some((g) => g.id === id),
      `cover garment ${id} is in the clothing pack`,
    ).toBe(true);
  expect(wearsCover(recipe, wardrobe), `age ${age} is covered by the kit's own rule`).toBe(true);
  expect(recipe.outfit, `age ${age} wears the cover`).toEqual([...COVER]);
}

interface View {
  name: string;
  /** The playground's camera query. */
  camera: string;
}

const WHOLE_FRONT = "cam=0,0.9,4.4,0,0.9,0&span=2.1";
// Thirty-five degrees round from the front, at the same distance and height.
const WHOLE_THREE_QUARTER = "cam=2.52,0.9,3.6,0,0.9,0&span=2.1";

const WHOLE: View[] = [
  { name: "front", camera: WHOLE_FRONT },
  { name: "three-quarter", camera: WHOLE_THREE_QUARTER },
];
/** Each view frames a body region on the figure's own bone, so a short body and a tall one are both centred. */
const FACE: View = { name: "face", camera: "frame=head&view=0,0.05,1&span=0.32" };
const CHEST: View = { name: "chest", camera: "frame=spine02&view=0,0.1,1&span=0.6" };
// Close views of adult anatomy and body hair: adults only, never framed on a figure under 18.
const PELVIS: View = {
  name: "pelvis",
  camera: "frame=root&view=0,0.1,1&span=0.3&at=0,-0.07,0&light=camera",
};
const UNDERARM: View = {
  name: "underarm",
  camera: "frame=upperarm01.L&view=0.7,-0.3,1&span=0.25&light=camera",
};
const DETAIL = (adult: boolean): View[] =>
  adult ? [FACE, CHEST, PELVIS, UNDERARM] : [FACE, CHEST];

/** Two animation frames, so what is on the canvas is what was last drawn. */
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

/** What the page draws for the current figure, to check against what it was asked for. */
async function drawnParts(page: Page) {
  return page.evaluate(() => {
    const drawn = window.hkDrawn;
    if (!drawn) throw new Error("the QA shot is not mounted");
    return drawn().map((p) => ({
      part: String(p.part),
      garment: p.garment,
      triangles: p.triangles,
    }));
  });
}

async function showCell(
  page: Page,
  input: ReturnType<typeof cell>,
  adultPage: boolean,
): Promise<string> {
  assertCovered(input);
  const generation = await page.evaluate((r) => {
    const set = window.hkSetRecipe;
    if (!set) throw new Error("the QA shot is not mounted");
    const next =
      Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
    set(r as never);
    return next;
  }, input);
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 300_000 });
  await frames(page);
  const age = input.macros.age;
  const parts = await drawnParts(page);
  const garments = parts.filter((p) => p.garment);
  if (age < ADULT_AGE) {
    // The page draws the cover and never the adult surface, before anything is captured.
    expect(adultPage, `age ${age} is on a page without the adult pack`).toBe(false);
    for (const id of COVER)
      expect(
        garments.some((p) => p.garment === id && p.triangles > 0),
        `age ${age} draws ${id}`,
      ).toBe(true);
    expect(
      parts.some((p) => p.part === "adultBody"),
      `age ${age} draws no adult surface`,
    ).toBe(false);
  } else {
    expect(adultPage, `age ${age} is on the adult page`).toBe(true);
    expect(
      parts.some((p) => p.part === "adultBody"),
      `age ${age} draws the adult surface`,
    ).toBe(true);
    expect(garments, `age ${age} wears nothing`).toEqual([]);
  }
  return (await page.locator("canvas").screenshot()).toString("base64");
}

interface Labelled {
  label: string;
  png: string;
}

/** Draws rows of cells with a label strip under each, and returns the PNG as base64. */
async function composite(page: Page, rows: Labelled[][], title: string): Promise<string> {
  return page.evaluate(
    async ({ rows, title }) => {
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const lead = rows[0]?.[0];
      if (!lead) throw new Error("a montage sheet needs a cell");
      const first = await decode(lead.png);
      const w = first.width;
      const h = first.height;
      const strip = 44;
      const head = 56;
      const columns = Math.max(...rows.map((r) => r.length));
      const sheet = document.createElement("canvas");
      sheet.width = w * columns;
      sheet.height = head + rows.length * (h + strip);
      const ctx = sheet.getContext("2d") as CanvasRenderingContext2D;
      const probe = new OffscreenCanvas(1, 1).getContext("2d") as OffscreenCanvasRenderingContext2D;
      probe.drawImage(first, 2, 2, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = "#fff";
      ctx.font = "600 30px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(title, 16, head / 2);
      for (const [ri, row] of rows.entries()) {
        const top = head + ri * (h + strip);
        for (const [ci, c] of row.entries()) {
          ctx.drawImage(await decode(c.png), ci * w, top);
          ctx.fillStyle = "#fff";
          ctx.font = "600 28px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(c.label, ci * w + w / 2, top + h + strip / 2);
          ctx.textAlign = "left";
        }
      }
      return sheet.toDataURL("image/png").split(",")[1] as string;
    },
    { rows, title },
  );
}

/** Renders a group: every sex at every age through every view, then writes its sheets. */
async function renderGroup(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  group: "adult" | "under-18",
): Promise<void> {
  const adult = group === "adult";
  const ages = adult ? ADULT_AGES : MINOR_AGES;
  const outfit = adult ? null : COVER;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // A cold dev server re-optimises its dependencies on the first visit and answers
    // the requests it outdated with a 504; the page reloads them. Not a figure's error.
    if (m.type() === "error" && !m.text().includes("Outdated Optimize Dep")) errors.push(m.text());
  });
  await page.setViewportSize({ width: 360, height: 660 });
  if (outDir) fs.mkdirSync(outDir, { recursive: true });

  const detail = DETAIL(adult);
  const views = [...WHOLE, ...detail];
  const shots = new Map<string, Labelled[]>();
  for (const view of views) {
    // The page's first figure is the first cell of the view, covered like every other.
    const first = cell(ages[0] as number, 0, outfit);
    assertCovered(first);
    const query = `${adult ? "adult" : "clothing"}&${view.camera}&recipe=${encodeURIComponent(
      JSON.stringify(first),
    )}`;
    // The adult pack never loads for a minor; the clothing pack never for an adult sheet.
    expect(query.includes("adult"), `${group} query loads the adult pack only for adults`).toBe(
      adult,
    );
    await openSilentGame(page, `/?${query}`, {}, { markerTimeout: 120_000 });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 300_000 });
    for (const sex of SEXES) {
      const row: Labelled[] = [];
      for (const age of ages) {
        const png = await showCell(page, cell(age, sex.gender, outfit), adult);
        row.push({ label: `${age} y`, png });
      }
      shots.set(`${sex.name}/${view.name}`, row);
    }
  }

  for (const sex of SEXES) {
    const sheets = [
      { file: `${sex.name}-${group}`, views: WHOLE, what: "front / three-quarter" },
      {
        file: `${sex.name}-${group}-detail`,
        views: detail,
        what: detail.map((v) => v.name).join(" / "),
      },
    ];
    for (const s of sheets) {
      const rows = s.views.map((v) => shots.get(`${sex.name}/${v.name}`) as Labelled[]);
      const png = await composite(
        page,
        rows,
        `${sex.name}, ${group}, default recipe: ${s.what}, mid skin tone`,
      );
      const buffer = Buffer.from(png, "base64");
      if (outDir) fs.writeFileSync(path.join(outDir, `${s.file}.png`), buffer);
      const out = testInfo.outputPath(`${s.file}.png`);
      fs.writeFileSync(out, buffer);
      await testInfo.attach(s.file, { path: out, contentType: "image/png" });
    }
  }
  // The sheets are written either way; a page that erred while drawing them is not to be trusted.
  expect(errors, `page errors while drawing ${group}`).toEqual([]);
}

test("adult", async ({ page }, testInfo) => {
  await renderGroup(page, testInfo, "adult");
});

test("under-18", async ({ page }, testInfo) => {
  await renderGroup(page, testInfo, "under-18");
});
