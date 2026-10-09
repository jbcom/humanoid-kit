/**
 * The shipped pre-integrated diffusion table against its generator. Rebuilding
 * it integrates every entry, which coverage instrumentation slows several times
 * over, so it runs in the uninstrumented `bake` project (vitest.config.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateScatterTable, scatterTableSource } from "../../scripts/generate-scatter-table.ts";
import { SCATTER_TABLE } from "../../src/surface/scatterTable.ts";

// About 6 s alone; the budget leaves room for a loaded machine.
describe("the pre-integrated diffusion table", { timeout: 120_000 }, () => {
  it("ships exactly the table the generator writes", () => {
    const shipped = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../src/surface/scatterTable.ts"),
      "utf8",
    );
    expect(scatterTableSource(generateScatterTable())).toBe(shipped);
    expect(SCATTER_TABLE.cosSteps * SCATTER_TABLE.uSteps * 2).toBe(atob(SCATTER_TABLE.data).length);
  });
});
