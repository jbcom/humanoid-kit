import { describe, expect, it } from "vitest";
import {
  type AssetLicenceRecord,
  DEFAULT_ASSET_LICENCE_PROFILE,
  escapeTableCell,
  isCc0Licence,
  parseAssetLicenceProfile,
  renderAssetAttribution,
  requireAssetForProfile,
  selectAssetForProfile,
} from "../scripts/lib/assetLicenceProfile.ts";

const cc0: AssetLicenceRecord = {
  id: "body-base",
  licence: {
    selected: "CC0-1.0",
    permitsCommercialUse: true,
    permitsRedistribution: true,
    attribution: "none",
    shareAlike: "none",
  },
  source: "https://example.test/body",
  author: "Example author",
};

/** NIH 3D entry retained by the adult-pack recovery lane. */
const nihClitoralFeature: AssetLicenceRecord = {
  id: "nih-3dpx-017321-clitoral-feature",
  licence: {
    selected: "CC-BY-4.0",
    permitsCommercialUse: true,
    permitsRedistribution: true,
    attribution: "required",
    shareAlike: "none",
  },
  source: "https://3d.nih.gov/entries/3DPX-017321",
  author: "Emullen45",
  attribution: "National Institute of Allergy and Infectious Disease",
  modifications: "Transferred from the retained source cut into the adult pack format.",
};

/** Source-inspected candidate; this fixture does not claim the asset ships. */
const dwarfFixedBeard: AssetLicenceRecord = {
  id: "dwarf-fixed",
  licence: {
    selected: "CC-BY 3.0",
    permitsCommercialUse: true,
    permitsRedistribution: true,
    attribution: "required",
    shareAlike: "none",
  },
  source: "https://opengameart.org/content/dwarf-fixed",
  author: "Beast; original model by thecubber for the OpenGameArt.org community",
  attribution:
    "Beard geometry derived from “Dwarf - fixed” by Beast, a modification of “Rigged, textured Dwarf model” by thecubber, commissioned by the OpenGameArt.org community, licensed CC-BY 3.0. Modified by jbcom for hm08 attachment.",
  modifications:
    "Modified by jbcom for humanoid-kit: isolated the facial-beard component; omitted the source figure, armature, non-beard meshes, and unrelated texture texels; authored a separate hm08 binding.",
};

describe("asset licence build profiles", () => {
  it("defaults to commercial and leaves pack arguments intact", () => {
    expect(DEFAULT_ASSET_LICENCE_PROFILE).toBe("commercial");
    expect(parseAssetLicenceProfile(["input", "output"])).toEqual({
      profile: "commercial",
      args: ["input", "output"],
    });
  });

  it("parses the profile switch without changing the remaining command line", () => {
    expect(parseAssetLicenceProfile(["in", "--asset-license-profile", "cc0-only", "out"])).toEqual({
      profile: "cc0-only",
      args: ["in", "out"],
    });
  });

  it("rejects missing, duplicate and unknown profile values", () => {
    expect(() => parseAssetLicenceProfile(["--asset-license-profile"])).toThrow(/requires/);
    expect(() =>
      parseAssetLicenceProfile([
        "--asset-license-profile",
        "cc0-only",
        "--asset-license-profile",
        "commercial",
      ]),
    ).toThrow(/only once/);
    expect(() => parseAssetLicenceProfile(["--asset-license-profile", "copyleft"])).toThrow(
      /unknown/,
    );
  });

  it("includes CC0 under both profiles", () => {
    expect(selectAssetForProfile("cc0-only", cc0).included).toBe(true);
    expect(selectAssetForProfile("commercial", cc0).included).toBe(true);
  });

  it("recognizes only complete canonical CC0 aliases", () => {
    for (const selected of ["CC0", "CC0-1.0", "CC0 1.0", "CC-0", "Creative Commons Zero"]) {
      expect(isCc0Licence({ ...cc0.licence, selected }), selected).toBe(true);
    }
    for (const selected of ["CC0-1.0-or-later", "CC01.0", "CC-BY-4.0", "CC0 or CC-BY"]) {
      expect(isCc0Licence({ ...cc0.licence, selected }), selected).toBe(false);
    }
  });

  it("reports the NIH-derived feature unavailable in cc0-only instead of substituting it", () => {
    expect(selectAssetForProfile("cc0-only", nihClitoralFeature)).toEqual({
      included: false,
      unavailable: {
        id: "nih-3dpx-017321-clitoral-feature",
        licence: "CC-BY-4.0",
        source: "https://3d.nih.gov/entries/3DPX-017321",
        reason: "profile-excludes-attributed-asset",
      },
    });
  });

  it("includes complete CC-BY 4.0 attribution only in commercial", () => {
    const decision = selectAssetForProfile("commercial", nihClitoralFeature);
    expect(decision.included && decision.attribution).toBe(nihClitoralFeature.attribution);
    const attribution = renderAssetAttribution([
      requireAssetForProfile("commercial", nihClitoralFeature),
    ]);
    expect(attribution).toContain("National Institute of Allergy and Infectious Disease");
    expect(attribution).toContain("| Share-alike |");
    expect(attribution).toContain("| none | Transferred from the retained source cut");
  });

  it("refuses an incomplete attribution record and a licence without redistribution", () => {
    expect(
      selectAssetForProfile("commercial", { ...nihClitoralFeature, attribution: "" }),
    ).toMatchObject({
      included: false,
      unavailable: { reason: "incomplete-attribution" },
    });
    expect(
      selectAssetForProfile("commercial", {
        ...nihClitoralFeature,
        licence: { ...nihClitoralFeature.licence, permitsRedistribution: false },
      }),
    ).toMatchObject({
      included: false,
      unavailable: { reason: "licence-not-permitted" },
    });
  });

  it("rejects unverified CC0 permissions and incomplete provenance before the CC0 shortcut", () => {
    expect(
      selectAssetForProfile("cc0-only", {
        ...cc0,
        licence: { ...cc0.licence, permitsCommercialUse: false },
      }),
    ).toMatchObject({ included: false, unavailable: { reason: "licence-not-permitted" } });
    for (const record of [
      { ...cc0, id: "" },
      { ...cc0, source: "" },
      { ...cc0, licence: { ...cc0.licence, selected: "" } },
    ])
      expect(selectAssetForProfile("cc0-only", record)).toMatchObject({
        included: false,
        unavailable: { reason: "incomplete-provenance" },
      });
  });

  it("permits a verified CC-BY 3.0 selected from a multi-licence grant", () => {
    const commercial = selectAssetForProfile("commercial", dwarfFixedBeard);
    expect(commercial.included).toBe(true);
    expect(selectAssetForProfile("cc0-only", dwarfFixedBeard)).toMatchObject({
      included: false,
      unavailable: { id: "dwarf-fixed", reason: "profile-excludes-attributed-asset" },
    });
    expect(
      renderAssetAttribution([requireAssetForProfile("commercial", dwarfFixedBeard)]),
    ).toContain("Rigged, textured Dwarf model” by thecubber");
  });

  it("permits an unknown selected licence only when its actual verified grant allows it", () => {
    expect(
      selectAssetForProfile("commercial", {
        ...nihClitoralFeature,
        licence: { ...nihClitoralFeature.licence, selected: "Custom commercial grant" },
      }).included,
    ).toBe(true);
  });

  it("escapes pipes and line breaks in generated attribution rows", () => {
    expect(escapeTableCell("Creator | archive\nline two")).toBe("Creator \\| archive<br>line two");
    const output = renderAssetAttribution([
      requireAssetForProfile("commercial", {
        ...nihClitoralFeature,
        author: "Emullen45 | archive",
        source: "https://3d.nih.gov/a|b\nentry",
        attribution: "Credit\nsecond line",
        modifications: "Transfer | normalized",
      }),
    ]);
    expect(output).toContain("Emullen45 \\| archive");
    expect(output).toContain("https://3d.nih.gov/a\\|b<br>entry");
    expect(output).toContain("Credit<br>second line");
    expect(output).toContain("Transfer \\| normalized");
  });

  it("retains a share-alike obligation even when attribution is not required", () => {
    const shareAlike = requireAssetForProfile("commercial", {
      ...cc0,
      id: "commercial-share-alike-grant",
      licence: {
        selected: "Verified commercial share-alike grant",
        permitsCommercialUse: true,
        permitsRedistribution: true,
        attribution: "none",
        shareAlike: "required",
      },
      modifications: "none",
    });
    expect(renderAssetAttribution([shareAlike])).toContain(
      "commercial-share-alike-grant | Verified commercial share-alike grant",
    );
    expect(renderAssetAttribution([shareAlike])).toContain("| None required | required | none |");
    expect(renderAssetAttribution([requireAssetForProfile("cc0-only", cc0)])).toBe(
      "# Asset attribution\n\nNo attribution-licensed asset data is included.\n",
    );
  });
});
