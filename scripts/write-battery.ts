/**
 * Writes scripts/sheets/battery.json from src/foundation/battery.ts, the one
 * source of the figure battery (docs/evidence/BATTERY.md). `hk-sheets` reads
 * the file; tests and the foundation read the module.
 *
 *   node scripts/write-battery.ts
 */
import fs from "node:fs";
import path from "node:path";
import { batteryJson } from "../src/foundation/battery.ts";

const out = path.resolve(import.meta.dirname, "sheets/battery.json");
fs.writeFileSync(out, `${JSON.stringify(batteryJson(), null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
