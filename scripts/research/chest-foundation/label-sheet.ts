/**
 * Labels a rendered contact sheet: the integrator's sheet is a bare grid of tiles, so
 * this cuts it into its tiles and writes each one's label lines (the sampled values)
 * in a strip under it, with a title over the sheet.
 *
 *   node scripts/research/chest-foundation/label-sheet.ts <sheet.png> <labels.json> <key> <title>
 *
 * `<key>` names a list in the candidate's labels.json (scatter, extremes, posed,
 * strips). The request's columns and tile size are read from the request JSON
 * hk-sheets writes beside the sheet (`<sheet>.json`). The labelled sheet goes beside
 * labels.json.
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

async function main() {
  const [sheet, labelsFile, key, title] = process.argv.slice(2);
  if (!sheet || !labelsFile || !key || !title)
    throw new Error("usage: label-sheet.ts <sheet.png> <labels.json> <key> <title>");
  const req = JSON.parse(fs.readFileSync(sheet.replace(/\.png$/, ".json"), "utf8")) as {
    columns: number;
    width: number;
    height: number;
  };
  const all = JSON.parse(fs.readFileSync(labelsFile, "utf8")) as Record<string, string[][]>;
  const labels = all[key];
  if (!labels) throw new Error(`${labelsFile} has no ${key}`);
  const out = path.join(
    path.dirname(labelsFile),
    path.basename(sheet).replace(/\.png$/, "-labelled.png"),
  );
  await labelSheet(sheet, labels, title, out, req.columns, req.width, req.height);
  console.log(out);
}

if (import.meta.main) await main();
