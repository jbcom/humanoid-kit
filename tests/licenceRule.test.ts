import { describe, expect, it } from "vitest";
import {
  type CommunityPage,
  isCc0,
  judgeAsset,
  MAKECLOTHES_DEFAULT,
  type SourceFile,
} from "../scripts/lib/licenceRule.ts";

// File heads and page records below are quoted from real downloads and pages read
// on 2026-10-08/09 (docs/licence-history.md §3).
const TEAM = "# This asset was explicitly released as CC0 in september 2020. The license\n";
const DEFAULT = (author: string) =>
  `# Exported from MakeClothes (TM)\n# author ${author}\n# license ${MAKECLOTHES_DEFAULT}\n`;

const page = (over: Partial<CommunityPage> = {}): CommunityPage => ({
  url: "http://www.makehumancommunity.org/node/1769",
  submitter: "WDG",
  submitted: "2019-02-03",
  licence: "CC0 - Creative Commons Zero",
  description: "A beard that is slightly messy.",
  retrieved: "2026-10-09",
  derivedFrom: [],
  ...over,
});

const asset = (mhclo: string, obj: string, extra: SourceFile[] = []): SourceFile[] => [
  { name: "a.mhclo", text: `${mhclo}name a\n` },
  { name: "a.obj", text: `${obj}v 0 0 0\n` },
  { name: "a.mhmat", text: "name aMaterial\n" },
  { name: "a_diffuse.png", text: null },
  ...extra,
];

const reason = (files: SourceFile[], p?: CommunityPage) => {
  const j = judgeAsset(files, p);
  return j.pass ? `PASS ${j.clause}` : j.reason;
};

describe("isCc0", () => {
  it("accepts the spellings the files and pages use", () => {
    for (const s of ["CC0", "CC-0", "CC0 - Creative Commons Zero", "cc0", "Creative Commons Zero"])
      expect(isCc0(s), s).toBe(true);
  });
  it("refuses other licences and free text that only mentions CC0", () => {
    for (const s of [
      "CC-BY - Creative Commons Attribution",
      "AGPL3",
      MAKECLOTHES_DEFAULT,
      "CC0 or CC-BY",
      'undetermined: the page is gone; only the uploader\'s quote "License CC-0" remains',
      "",
    ])
      expect(isCc0(s), s).toBe(false);
  });
});

describe("clause A: MakeHuman's own CC0 release", () => {
  it("passes a team asset with no page, every text file carrying the 2020 header", () => {
    const files = asset(TEAM, TEAM).map((f) => (f.name === "a.mhmat" ? { ...f, text: TEAM } : f));
    expect(reason(files)).toBe("PASS A");
  });
  it("refuses anything without the header when no page was captured", () => {
    expect(reason(asset("# license CC0\n", "# license CC0\n"))).toMatch(/no captured asset page/);
  });
});

describe("clause B: a community asset judged with its page", () => {
  it("B1: refuses a page that does not say CC0, whatever the files say", () => {
    expect(
      reason(
        asset("# license CC-0\n", "# license CC0\n"),
        page({ licence: "CC-BY - Creative Commons Attribution" }),
      ),
    ).toMatch(/^B1/);
  });

  it("B2: accepts MakeClothes 1's default AGPL3 line written under the submitter's own name", () => {
    expect(reason(asset(DEFAULT("WDG"), DEFAULT("WDG")), page())).toBe("PASS B");
  });

  it("B2: matches an exporter's spaced author to the site's run-together user name", () => {
    expect(
      reason(
        asset("# license CC0\n", DEFAULT("Rehman Polanski")),
        page({ submitter: "RehmanPolanski" }),
      ),
    ).toBe("PASS B");
  });

  it("B2: accepts the default line with author Unknown", () => {
    expect(
      reason(asset(DEFAULT("Unknown"), DEFAULT("Unknown")), page({ submitter: "FreezyChan" })),
    ).toBe("PASS B");
  });

  it("B2: refuses the default line under someone other than the submitter", () => {
    expect(reason(asset(DEFAULT("SomeoneElse"), DEFAULT("SomeoneElse")), page())).toMatch(
      /^B2: .*SomeoneElse/,
    );
  });

  it("B2: refuses a mesh file with no licence line, but lets a target, material or texture rely on the page", () => {
    expect(reason(asset("", DEFAULT("Unknown")), page())).toMatch(
      /^B2: a\.mhclo has no licence line/,
    );
    const target = judgeAsset(
      [{ name: "ears.target", text: "# written by MakeTarget2\n1 0.1 0 0\n" }],
      page(),
    );
    expect(target.pass && target.pageOnly).toEqual(["ears.target"]);
  });

  it("C: refuses a file that states a stricter licence, even under a CC0 page", () => {
    expect(reason(asset("# license CC0\n", "# license CC-BY\n"), page())).toMatch(
      /^C: a\.obj states "CC-BY"/,
    );
    expect(reason(asset("# license CC0\n", "# license AGPL3\n"), page())).toMatch(
      /^C: a\.obj states "AGPL3"/,
    );
  });

  it("B3: refuses a re-upload whose files name the MakeHuman team as author (adult_male_genitalia_xsuprem3x)", () => {
    const files = [
      {
        name: "adult_male_genitalia.proxy",
        text: "# author MHteam\n# license AGPL3 (see also http://www.makehuman.org/doc/node/external_tools_license.html)\n",
      },
      { name: "adult_male_genitalia.obj", text: "# author MHteam\n" },
    ];
    expect(reason(files, page({ submitter: "XSuprem3X" }))).toMatch(/^B3: .*MHteam/);
  });

  it("B3: refuses weights that carry Bastioni's copyright (adult_female_2020)", () => {
    const files = [
      { name: "x.proxy", text: "# license CC0\n" },
      {
        name: "x.mhw",
        text: '{\n    "copyright": "(c) Manuel Bastioni 2014",\n    "license": "CC0"\n}',
      },
    ];
    expect(reason(files, page())).toMatch(/^B3: x\.mhw/);
  });

  it("B4: refuses a file sharing a uuid with a failing asset (adult_male_genitalia_breast_fix)", () => {
    const files = [
      {
        name: "fix.proxy",
        text: "# license: CC0\nname fix\nuuid ece8ae91-d8d7-4e98-a737-dd1f5f08519a\n",
      },
      { name: "fix.obj", text: "# license: CC0\n" },
    ];
    expect(reason(files, page({ submitter: "ieroglif" }))).toMatch(/^B4: fix\.proxy uuid ece8ae91/);
  });

  it("B5: refuses a description that reads like a derivation unless the source is recorded", () => {
    const desc =
      'proxy and obj for this modification were taken from "Adult Female Genitalia (new) HEALED"';
    expect(
      reason(asset("# license CC0\n", "# license CC0\n"), page({ description: desc })),
    ).toMatch(/^B5: .*taken from/);
  });

  it("B5: accepts a derivation-sounding description once the reader records why it is own work", () => {
    const p = page({
      description:
        "The Alana Caucasian Female with Genitals skin was made for the the Adult Female Genitalia Remapped topology",
    });
    const files = asset("# license CC0\n", "# license CC0\n");
    expect(reason(files, p)).toMatch(/^B5: .*Remapped/);
    expect(
      reason(files, {
        ...p,
        notDerivedBecause: "a texture painted to that topology's UV layout; no geometry copied",
      }),
    ).toBe("PASS B");
  });

  it("B5: refuses a recorded source that is known to fail, or whose licence is not CC0", () => {
    const files = asset("# license CC0\n", "# license CC0\n");
    expect(
      reason(
        files,
        page({ derivedFrom: [{ source: "proxy/adult_male_genitalia.html", licence: "CC0" }] }),
      ),
    ).toMatch(/^B5: derived from adult_male_genitalia/);
    expect(
      reason(files, page({ derivedFrom: [{ source: "Pepper&Carrot", licence: "CC-BY 4.0" }] })),
    ).toMatch(/^B5: .*CC-BY 4\.0/);
    expect(
      reason(
        files,
        page({
          derivedFrom: [
            { source: "blendswap 24099", licence: 'undetermined; uploader quotes "License CC-0"' },
          ],
        }),
      ),
    ).toMatch(/^B5/);
  });

  it("B5: passes a derivation of a CC0 source once it is recorded (culturalibre_magic_sceptre)", () => {
    const p = page({
      submitter: "culturalibre",
      description: "Magic sceptre for a wizard.Original 3d model by quaternius.",
      derivedFrom: [{ source: "https://opengameart.org/content/lowpoly-rpg", licence: "CC0" }],
    });
    expect(reason(asset("# author culturalibre\n# license CC-0\n", DEFAULT("Unknown")), p)).toBe(
      "PASS B",
    );
  });

  it("lists the files whose only evidence is the page", () => {
    const j = judgeAsset(asset(DEFAULT("WDG"), DEFAULT("WDG")), page());
    expect(j.pass && j.pageOnly).toEqual(["a.mhmat", "a_diffuse.png"]);
  });
});

describe("a MakeHuman BVH, whose licence is its .meta", () => {
  // Quoted from makehuman2_additional_assets_cc0.zip, poses/walk_normal.meta (read 2026-10-09).
  const META =
    "tag Walking\ntag Animation\nname Walking-Normal\ndescription Walking animation (normal)\nauthor punkduck\nlicense CC0\n";
  const BVH = "HIERARCHY\nROOT root\n{\n OFFSET 0.0 0.6 8.7\n}\nMOTION\nFrames: 1\n";
  const listing = page({
    url: "https://files2.makehumancommunity.org/functional/assetpacks.json",
    submitter: "MakeHuman Community asset pack listing",
    submitted: "2026-06-25",
    licence: "cc0",
    description: "Makehuman2 additional assets",
  });
  const clip = (meta: string | null): SourceFile[] => [
    ...(meta === null ? [] : [{ name: "walk_normal.meta", text: meta }]),
    { name: "walk_normal.bvh", text: BVH },
    { name: "walk_normal.thumb", text: null },
  ];

  it("passes with the page and a .meta that states CC0, recording the BVH as page and .meta evidence", () => {
    const j = judgeAsset(clip(META), listing);
    expect(j.pass && j.clause).toBe("B");
    expect(j.pass && j.evidence["walk_normal.bvh"]).toMatch(/its walk_normal\.meta/);
    expect(j.pass && j.evidence["walk_normal.meta"]).toMatch(/license CC0/);
  });

  it("refuses a BVH with no .meta beside it, whatever the page says", () => {
    expect(reason(clip(null), listing)).toMatch(/no walk_normal\.meta beside it/);
  });

  it("refuses a .meta that states another licence, or no licence, or the page not saying CC0", () => {
    expect(reason(clip(META.replace("license CC0", "license CC-BY")), listing)).toMatch(/^C: /);
    expect(reason(clip(META.replace("license CC0\n", "")), listing)).toMatch(
      /^B2: .*no licence line/,
    );
    expect(reason(clip(META), { ...listing, licence: "cc-by" })).toMatch(/^B1/);
  });

  it("refuses a .meta naming a third party as author", () => {
    expect(reason(clip(META.replace("punkduck", "MHteam")), listing)).toMatch(/^B3/);
  });
});
