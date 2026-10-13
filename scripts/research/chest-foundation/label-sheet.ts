/**
 * Labels rendered contact sheets: a rendered sheet is a bare grid of tiles, so this
 * cuts it into its tiles and writes each one's label lines (the sampled values) in a
 * strip under it, with the sheet's name over it.
 *
 *   node scripts/research/chest-foundation/label-sheet.ts <candidate-dir> <renders-dir>
 *
 * The candidate's job.json gives each sheet's columns and tile count, its labels.json
 * the label lines by sheet name; `<name>-labelled.png` goes to the candidate directory.
 */
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function labelSheet(
  sheet: string,
  labels: string[][],
  title: string,
  out: string,
  columns: number,
  w: number,
  h: number,
): Promise<void> {
  const lines = Math.max(...labels.map((l) => l.length));
  const line = 13;
  const strip = lines * line + 8;
  const head = 34;
  const rows = Math.ceil(labels.length / columns);
  const W = columns * w;
  const H = head + rows * (h + strip);
  const tiles: OverlayOptions[] = [];
  const text: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const c = i % columns,
      r = Math.floor(i / columns);
    const tile = await sharp(sheet)
      .extract({ left: c * w, top: r * h, width: w, height: h })
      .png()
      .toBuffer();
    const top = head + r * (h + strip);
    tiles.push({ input: tile, left: c * w, top });
    (labels[i] ?? []).forEach((l, k) => {
      text.push(`<text x="${c * w + 4}" y="${top + h + 12 + k * line}">${esc(l)}</text>`);
    });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<style>text{font-family:Menlo,monospace;font-size:10.5px;fill:#e8e8e8}.t{font-size:18px;font-weight:600}</style>
<text class="t" x="8" y="24">${esc(title)}</text>
${text.join("\n")}
</svg>`;
  await sharp({ create: { width: W, height: H, channels: 4, background: "#26282c" } })
    .composite([...tiles, { input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toFile(out);
}

/** Labels every rendered sheet of a candidate's job that is in `renders`. */
async function main() {
  const [candidate, renders] = process.argv.slice(2);
  if (!candidate || !renders)
    throw new Error("usage: label-sheet.ts <candidate-dir> <renders-dir>");
  const job = JSON.parse(fs.readFileSync(path.join(candidate, "job.json"), "utf8")) as {
    sheets: { name: string; columns: number; recipes: unknown[] }[];
  };
  const all = JSON.parse(fs.readFileSync(path.join(candidate, "labels.json"), "utf8")) as Record<
    string,
    string[][]
  >;
  const pngs = fs.readdirSync(renders).filter((f) => f.endsWith(".png"));
  for (const s of job.sheets) {
    // The pool names a sheet `<name>.png`, a collected copy `v<n>-<name>.png`.
    const png = pngs.find(
      (f) => f === `${s.name}.png` || new RegExp(`^v\\d+-${s.name}\\.png$`).test(f),
    );
    if (!png) {
      console.log(`${s.name}: not rendered`);
      continue;
    }
    const labels = all[s.name];
    if (!labels) throw new Error(`labels.json has no ${s.name}`);
    const file = path.join(renders, png);
    const { width = 0, height = 0 } = await sharp(file).metadata();
    const rows = Math.ceil(s.recipes.length / s.columns);
    const out = path.join(candidate, `${s.name}-labelled.png`);
    await labelSheet(file, labels, s.name, out, s.columns, width / s.columns, height / rows);
    console.log(out);
  }
}

if (import.meta.main) await main();
