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
});

describe("clause M: a CC0 mesh whose binding is not CC0 (owner ruling 2026-10-09)", () => {
  const files = (obj: string, proxy: string): SourceFile[] => [
    { name: "a.proxy", text: `${proxy}name a\n` },
    { name: "a.obj", text: `${obj}v 0 0 0\n` },
    { name: "a.mhmat", text: "name aMaterial\n" },
    { name: "a_diffuse.png", text: null },
  ];

  it("passes a CC0 .obj with an AGPL .proxy, marking the proxy for regeneration", () => {
    const j = judgeAsset(
      files("# license CC0\n", AGPL),
      page("AGPL - Affero General Public License"),
    );
    expect(j.pass && j.clause).toBe("M");
    expect(j.pass && j.regenerate).toEqual(["a.proxy"]);
    expect(j.pass && j.evidence["a.obj"]).toBe('M: file states "CC0"');
  });

  it("leaves out materials and textures that are not CC0 on their own", () => {
    const j = judgeAsset(files("# license CC0\n", AGPL));
    expect(j.pass && j.exclude).toEqual(["a.mhmat", "a_diffuse.png"]);
  });

  it("ships a binding that is CC0 on its own instead of regenerating it", () => {
    const j = judgeAsset(files("# license CC0\n", "# license: CC0\n"));
    expect(j.pass && j.regenerate).toEqual([]);
  });

  it("refuses when the mesh itself is not CC0, whatever the page says short of CC0", () => {
    expect(
      verdict(files(AGPL, "# license CC0\n"), page("CC-BY - Creative Commons Attribution")),
    ).toMatch(/^a\.obj does not prove CC0 \(page licence is "CC-BY/);
    expect(verdict(files("", "# license CC0\n"))).toMatch(
      /a\.obj does not prove CC0 \(no captured asset page/,
    );
  });

  it("refuses an asset with no mesh, such as a target, unless its page says CC0", () => {
    expect(verdict([{ name: "ears.target", text: "1 0.1 0 0\n" }])).toMatch(/no mesh to judge/);
  });
});

describe("clause B: the asset page's licence governs (owner ruling 2026-10-09)", () => {
  it("passes when the page says CC0, even though a file says AGPL3", () => {
    const j = judgeAsset(asset(AGPL), page("CC0 - Creative Commons Zero"));
    expect(j.pass && j.clause).toBe("B");
    expect(j.pass && j.evidence["a.obj"]).toBe('B: page licence "CC0 - Creative Commons Zero"');
  });

  it("does not pass on a page that says CC-BY or AGPL: only the asset's own CC0 mesh can", () => {
    for (const licence of [
      "CC-BY - Creative Commons Attribution",
      "AGPL - Affero General Public License",
    ]) {
      expect(verdict(asset(AGPL), page(licence))).toMatch(
        /^a\.obj does not prove CC0 \(page licence is/,
      );
      expect(verdict(asset("# license CC0\n"), page(licence))).toBe("PASS M");
    }
  });
});
