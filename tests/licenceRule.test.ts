import { describe, expect, it } from "vitest";
import {
  type CommunityPage,
  isCc0,
  judgeAsset,
  type SourceFile,
} from "../scripts/lib/licenceRule.ts";

const TEAM = "# This asset was explicitly released as CC0 in september 2020. The license\n";
const AGPL =
  "# license AGPL3 (see also http://www.makehuman.org/doc/node/external_tools_license.html)\n";

const page = (licence: string): CommunityPage => ({
  url: "http://www.makehumancommunity.org/node/1769",
  submitter: "WDG",
  submitted: "2019-02-03",
  licence,
  retrieved: "2026-10-09",
});

const asset = (header: string): SourceFile[] => [
  { name: "a.mhclo", text: `${header}name a\n` },
  { name: "a.obj", text: `${header}v 0 0 0\n` },
  { name: "a.mhmat", text: `${header}name aMaterial\n` },
  { name: "a_diffuse.png", text: null },
];

const verdict = (files: SourceFile[], p?: CommunityPage) => {
  const j = judgeAsset(files, p);
  return j.pass ? `PASS ${j.clause}` : j.reason;
};

describe("isCc0", () => {
  it("accepts the spellings pages and files use", () => {
    for (const s of ["CC0", "CC-0", "CC0 - Creative Commons Zero", "cc0", "Creative Commons Zero"])
      expect(isCc0(s), s).toBe(true);
  });

  it("refuses other licences and free text that only mentions CC0", () => {
    for (const s of [
      "CC-BY - Creative Commons Attribution",
      "AGPL - Affero General Public License",
      "CC0 or CC-BY",
      'undetermined: the page is gone; only the uploader\'s quote "License CC-0" remains',
      "",
    ])
      expect(isCc0(s), s).toBe(false);
  });
});

describe("clause A: MakeHuman's own CC0 release", () => {
  it("passes a team asset with no page when every text file carries the 2020 header", () => {
    expect(verdict(asset(TEAM))).toBe("PASS A");
  });

  it("refuses an asset without the header when no page was captured", () => {
    expect(verdict(asset("# license CC0\n"))).toMatch(/no captured asset page/);
  });
});

describe("clause B: the asset page's licence governs (owner ruling 2026-10-09)", () => {
  it("passes when the page says CC0, even though a file says AGPL3", () => {
    const j = judgeAsset(asset(AGPL), page("CC0 - Creative Commons Zero"));
    expect(j.pass && j.clause).toBe("B");
    expect(j.pass && j.evidence["a.obj"]).toBe('B: page licence "CC0 - Creative Commons Zero"');
  });

  it("refuses when the page says CC-BY or AGPL, even though the files say CC0", () => {
    expect(verdict(asset("# license CC0\n"), page("CC-BY - Creative Commons Attribution"))).toMatch(
      /^B: page licence is "CC-BY/,
    );
    expect(verdict(asset("# license CC0\n"), page("AGPL - Affero General Public License"))).toMatch(
      /^B: page licence is "AGPL/,
    );
  });
});
