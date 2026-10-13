/**
 * The numeric companion of the scatter sheet: chest relief (RMS mm of the tissue the
 * generator adds above the flat baseline) against age, coloured by frame direction.
 * Points are the scatter's own samples (radius by sampled size); lines are the
 * controlled curves from age-probe.ts (size 1 and size .5, firmness .5).
 *
 *   node scripts/research/chest-foundation/plot.ts <candidate-dir>
 *
 * Writes relief-vs-age.png and relief-vs-age.md (the samples as a table) there.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { FRAME_DIRECTIONS } from "./conditions.ts";

const PALETTE = [
  "#e6194b",
  "#f58231",
  "#ffe119",
  "#3cb44b",
  "#4363d8",
  "#911eb4",
  "#f032e6",
  "#42d4f4",
  "#bfef45",
];

interface Sample {
  index: number;
  age: number;
  frame: string;
  values: { size: number; firmness: number; melanin: number };
  reliefRms: number;
  share: number;
}
interface ProbeCell {
  age: number;
  frame: string;
  s05: { rms: number };
  s1: { rms: number };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: plot.ts <candidate-dir>");
  const samples = (
    JSON.parse(fs.readFileSync(path.join(dir, "scatter.conditions.json"), "utf8")) as {
      conditions: Sample[];
    }
  ).conditions;
  const probe = (
    JSON.parse(fs.readFileSync(path.join(dir, "age-tables.json"), "utf8")) as { cells: ProbeCell[] }
  ).cells;
  const W = 1000,
    H = 620,
    L = 70,
    R = 230,
    T = 40,
    B = 60;
  const maxAge = 75,
    maxRms =
      Math.ceil(Math.max(...probe.map((c) => c.s1.rms), ...samples.map((s) => s.reliefRms)) / 5) *
      5;
  const x = (a: number) => L + (a / maxAge) * (W - L - R);
  const y = (r: number) => H - B - (r / maxRms) * (H - T - B);
  const el: string[] = [];
  for (let a = 0; a <= maxAge; a += 5)
    el.push(
      `<line x1="${x(a)}" y1="${T}" x2="${x(a)}" y2="${H - B}" stroke="#3a3d42"/><text x="${x(a)}" y="${H - B + 18}" text-anchor="middle">${a}</text>`,
    );
  for (let r = 0; r <= maxRms; r += 5)
    el.push(
      `<line x1="${L}" y1="${y(r)}" x2="${W - R}" y2="${y(r)}" stroke="#3a3d42"/><text x="${L - 8}" y="${y(r) + 4}" text-anchor="end">${r}</text>`,
    );
  FRAME_DIRECTIONS.forEach((f, i) => {
    const colour = PALETTE[i % PALETTE.length] as string;
    for (const key of ["s1", "s05"] as const) {
      const pts = probe
        .filter((c) => c.frame === f.id)
        .sort((a, b) => a.age - b.age)
        .map((c) => `${x(c.age)},${y(c[key].rms)}`)
        .join(" ");
      el.push(
        `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="1.5" ${key === "s05" ? 'stroke-dasharray="5 4"' : ""} opacity="0.75"/>`,
      );
    }
    for (const s of samples.filter((s) => s.frame === f.id))
      el.push(
        `<circle cx="${x(s.age) + (i - 4) * 1.6}" cy="${y(s.reliefRms)}" r="${2.5 + 5 * s.values.size}" fill="${colour}" stroke="#111" stroke-width="0.8"/>`,
      );
    el.push(
      `<rect x="${W - R + 20}" y="${T + i * 22}" width="14" height="14" fill="${colour}"/><text x="${W - R + 42}" y="${T + i * 22 + 12}">${f.label}</text>`,
    );
  });
  el.push(
    `<text x="${W - R + 20}" y="${T + FRAME_DIRECTIONS.length * 22 + 24}">line: size 1 (dashed .5),</text>`,
    `<text x="${W - R + 20}" y="${T + FRAME_DIRECTIONS.length * 22 + 40}">firmness .5, controlled</text>`,
    `<text x="${W - R + 20}" y="${T + FRAME_DIRECTIONS.length * 22 + 60}">dot: scatter sample,</text>`,
    `<text x="${W - R + 20}" y="${T + FRAME_DIRECTIONS.length * 22 + 76}">radius = sampled size</text>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="#202226"/>
<style>text{font-family:Menlo,monospace;font-size:12px;fill:#ddd}</style>
<text x="${L}" y="24" style="font-size:16px">Chest relief above the flat baseline (RMS mm) against age, by frame direction</text>
<text x="${(L + W - R) / 2}" y="${H - 16}" text-anchor="middle">age (years)</text>
${el.join("\n")}
</svg>`;
  const png = path.join(dir, "relief-vs-age.png");
  await sharp(Buffer.from(svg)).png().toFile(png);
  const md = [
    "| # | age | frame | size | firm | melanin | share | relief RMS mm |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...samples.map(
      (s) =>
        `| ${s.index} | ${s.age} | ${s.frame} | ${s.values.size.toFixed(2)} | ${s.values.firmness.toFixed(2)} | ${s.values.melanin.toFixed(2)} | ${s.share.toFixed(2)} | ${s.reliefRms.toFixed(1)} |`,
    ),
  ];
  fs.writeFileSync(path.join(dir, "relief-vs-age.md"), `${md.join("\n")}\n`);
  console.log(png);
}

await main();
