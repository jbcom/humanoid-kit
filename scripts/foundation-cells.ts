/**
 * Prints a foundation tier's contact-sheet cells and the named views as JSON
 * (src/foundation/sheet.ts), for `hk-sheets`, which runs it in its checkout of
 * the ref it renders to expand a `{"$foundation": "<tier>"}` request. Nothing
 * is written: the module is the one source, and the full tier is too large to
 * keep as a file.
 *
 *   node scripts/foundation-cells.ts smoke|full
 */
import { foundationSheet } from "../src/foundation/sheet.ts";

const tier = process.argv[2];
if (tier !== "smoke" && tier !== "full") {
  console.error("usage: node scripts/foundation-cells.ts smoke|full");
  process.exit(2);
}
process.stdout.write(`${JSON.stringify(foundationSheet(tier))}\n`);
