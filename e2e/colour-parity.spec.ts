/**
 * Colour parity: the studio stage must reproduce any surface colour with the
 * same small error, whatever the colour. Faces are rendered across the measured
 * human skin range and a set of non-human colours (fur, scales, fantasy), and
 * each render's lightness, hue and chroma are compared with the albedo it was
 * given. A pipeline tuned to one tone fails here: it is the spread of the error
 * across the palette that is bounded, not just its size.
 */
import { expect, type Page, test } from "@playwright/test";
import { type Rgb, skinAlbedo } from "../src/surface/skinTone.ts";
import { chroma, hueDeg, hueDiff, type Lab, labFromLinear, summarise } from "./lib/colour.ts";

interface Swatch {
  name: string;
  skin: { melanin?: number; override?: Rgb };
}

const natural = (m: number): Swatch => ({ name: `skin melanin ${m}`, skin: { melanin: m } });
const PALETTE: Swatch[] = [
  ...[0, 0.25, 0.5, 0.75, 1].map(natural),
  { name: "white fur", skin: { override: [0.78, 0.76, 0.72] } },
  { name: "near-black scales", skin: { override: [0.025, 0.025, 0.03] } },
  { name: "green scales", skin: { override: [0.07, 0.22, 0.06] } },
  { name: "blue skin", skin: { override: [0.06, 0.11, 0.36] } },
  { name: "red fur", skin: { override: [0.42, 0.06, 0.035] } },
  { name: "violet", skin: { override: [0.2, 0.06, 0.3] } },
  { name: "golden fur", skin: { override: [0.55, 0.36, 0.1] } },
];

const BACKGROUND: [number, number, number] = [0x1b, 0x25, 0x30];
const CAMERA = "0,1.5,0.85,0,1.48,0";
/** The face, in fractions of the viewport (camera above). */
const FACE = { x0: 0.36, x1: 0.64, y0: 0.14, y1: 0.6 };

async function renderFace(page: Page, s: Swatch): Promise<Lab> {
  // No flush, so the comparison is with the surface's own albedo. Swatches are
  // swapped into one loaded page; generation tells this figure from the last.
  const generation = await page.evaluate(
    (skin) => {
      const set = window.hkSetRecipe;
      if (!set) throw new Error("the QA shot is not mounted");
      const next =
        Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
      set({ skin });
      return next;
    },
    { ...s.skin, flush: 0 },
  );
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 60_000 });
  // Ready means evaluated, not drawn: wait out a few animation frames so the
  // renderer (slow under software WebGL) has drawn the new figure.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = () => (++frames >= 4 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  const rgba = await page.locator("canvas").evaluate((el, box) => {
    const c = el as HTMLCanvasElement;
    const w = Math.round(c.width * (box.x1 - box.x0));
    const h = Math.round(c.height * (box.y1 - box.y0));
    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(c, c.width * box.x0, c.height * box.y0, w, h, 0, 0, w, h);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  }, FACE);
  const lab = summarise(rgba, BACKGROUND);
  if (!lab) throw new Error(`${s.name}: no figure in the face region`);
  return lab;
}

const albedo = (s: Swatch): Rgb =>
  s.skin.override ??
  skinAlbedo({ melanin: s.skin.melanin ?? 0.35, haemoglobin: 0.5, undertone: 0, override: null });

test.describe("colour parity under the studio stage", () => {
  test.use({ viewport: { width: 360, height: 420 } });
  test.setTimeout(10 * 60_000);

  test("every colour renders with the same small error", async ({ page }) => {
    const rows: { name: string; dL: number; dC: number; dH: number | null }[] = [];
    await page.goto(`/?muted&cam=${CAMERA}`);
    // The first figure (and its textures) loads with the page.
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    for (const s of PALETTE) {
      const got = await renderFace(page, s);
      const want = labFromLinear(albedo(s));
      // Hue is only meaningful for chromatic colours.
      const dH = chroma(want) > 8 ? hueDiff(hueDeg(got), hueDeg(want)) : null;
      rows.push({ name: s.name, dL: got[0] - want[0], dC: chroma(got) - chroma(want), dH });
    }
    console.table(
      rows.map((r) => ({
        ...r,
        dL: r.dL.toFixed(1),
        dC: r.dC.toFixed(1),
        dH: r.dH?.toFixed(1) ?? "-",
      })),
    );

    const dLs = rows.map((r) => r.dL);
    // The bound that matters for fairness: no colour is lifted or crushed relative to the others.
    // Measured 2026-10-08 (Neutral, exposure 1.05): dL -2.0..+3.5, dC +1.5..+6.8, dH within 3 deg.
    expect(
      Math.max(...dLs) - Math.min(...dLs),
      "lightness error spread across the palette",
    ).toBeLessThanOrEqual(7);
    for (const r of rows) {
      expect(Math.abs(r.dL), `${r.name}: lightness error`).toBeLessThanOrEqual(5);
      expect(Math.abs(r.dC), `${r.name}: chroma error`).toBeLessThanOrEqual(9);
      if (r.dH !== null) expect(Math.abs(r.dH), `${r.name}: hue error`).toBeLessThanOrEqual(6);
    }
  });
});
