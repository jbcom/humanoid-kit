/**
 * The contact-sheet project (e2e/sheets/) is never part of the suite: the
 * Playwright config adds it, with the dev server that can load the adult pack,
 * only when the command line selects it.
 */
import { describe, expect, it } from "vitest";
import config, { selectsSheets } from "../playwright.config.ts";

describe("the sheets Playwright project", () => {
  it("is selected only by --project sheets, in either spelling", () => {
    expect(selectsSheets(["playwright", "test", "--project", "sheets"])).toBe(true);
    expect(selectsSheets(["playwright", "test", "--project=sheets", "-g", "groin"])).toBe(true);
    expect(selectsSheets(["playwright", "test"])).toBe(false);
    expect(selectsSheets(["playwright", "test", "--project", "desktop"])).toBe(false);
    expect(selectsSheets(["playwright", "test", "e2e/sheets"])).toBe(false);
  });

  it("is absent from a run that does not select it, which serves the production build", () => {
    const names = (config.projects ?? []).map((p) => p.name);
    expect(names).not.toContain("sheets");
    expect(names.length).toBeGreaterThan(0);
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    expect(server?.command).toContain("vite preview");
  });
});
