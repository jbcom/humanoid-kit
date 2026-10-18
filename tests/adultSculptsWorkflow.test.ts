import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The default CI is hermetic (no network, no Blender); the real download, Blender cut and
 * byte-for-byte check against cuts.json is an opt-in script and workflow.
 */
const text = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the adult sculpts' opt-in real path", () => {
  it("keeps the default CI hermetic: no job fetches the sculpts or provisions Blender", () => {
    const ci = text(".github/workflows/ci.yml");
    for (const needle of [
      "adult-sculpt",
      "fetch-adult-sources",
      "provisionBlender",
      "pack:adult-sources",
      "test:adult-sculpts",
      "download.blender.org",
      "makehumancommunity.org",
      "HK_REQUIRE_ADULT_SCULPTS",
    ])
      expect(ci, needle).not.toContain(needle);
  });

  it("runs on request, weekly and on a change to what decides the cuts, and is not part of the gate", () => {
    const workflow = text(".github/workflows/adult-sculpts.yml");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/schedule:\n\s+- cron: /);
    expect(workflow).toContain("scripts/blender/cut_sculpt.py");
    expect(workflow).toContain("run: pnpm test:adult-sculpts");
    expect(text(".github/workflows/ci.yml")).not.toContain("adult-sculpts");
  });

  it("makes a missing cache a failure, not a skip, and runs exactly the files that skip without it", () => {
    const script = (JSON.parse(text("package.json")) as { scripts: Record<string, string> })
      .scripts["test:adult-sculpts"] as string;
    expect(script).toContain("node scripts/fetch-adult-sources.ts");
    expect(script).toContain("HK_REQUIRE_ADULT_SCULPTS=1");
    const ledger = text("scripts/ci/vitestSkipLedger.ts");
    for (const file of ["phallus", "scrotum", "arousal", "adultReservoirs"]) {
      expect(script, file).toContain(`tests/${file}.test.ts`);
      expect(ledger, file).toContain(`/tests/${file}.test.ts`);
    }
  });
});
