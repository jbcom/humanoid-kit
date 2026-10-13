/**
 * Asset-licence build profiles. These govern which third-party asset data a
 * packer may include; they do not change this repository's MIT code licence.
 *
 * A packer owns its manifest and outputs. It supplies one record for each
 * candidate asset, calls `selectAssetForProfile`, then records either the
 * inclusion and generated attribution or the explicit unavailable feature.
 */

export const ASSET_LICENCE_PROFILES = ["cc0-only", "commercial"] as const;
export type AssetLicenceProfile = (typeof ASSET_LICENCE_PROFILES)[number];

/** The owner-approved broad profile: commercial-use licences with attribution. */
export const DEFAULT_ASSET_LICENCE_PROFILE: AssetLicenceProfile = "commercial";

/** The selected licence in a source's verified multi-licence grant. */
export interface AssetLicenceTerms {
  /** Exact selected licence identifier or source wording, e.g. `CC-BY-3.0`. */
  selected: string;
  /** Verified for this selected grant; never inferred from the licence name. */
  permitsCommercialUse: boolean;
  /** Verified for this selected grant; commercial use alone is insufficient. */
  permitsRedistribution: boolean;
  /** Whether the generated pack attribution must name the supplied credit. */
  attribution: "required" | "none";
  /** A packer records this obligation in provenance and its generated notice. */
  shareAlike: "required" | "none";
}

/**
 * The provenance needed before the commercial profile can include an
 * attribution-licensed asset. `attribution` is the exact credit text the
 * upstream licence or source requires; `modifications` says what this pack did
 * to the source bytes ("none" is a valid, explicit value).
 */
export interface AssetLicenceRecord {
  id: string;
  licence: AssetLicenceTerms;
  source: string;
  author: string;
  attribution?: string;
  modifications?: string;
}

export interface IncludedAsset {
  included: true;
  record: AssetLicenceRecord;
  /** A generated notice must include this for an attribution-licensed asset. */
  attribution?: string;
}

export interface UnavailableAsset {
  included: false;
  unavailable: {
    id: string;
    licence: string;
    source: string;
    reason:
      | "profile-excludes-attributed-asset"
      | "licence-not-permitted"
      | "incomplete-provenance"
      | "incomplete-attribution";
  };
}

export type AssetProfileSelection = IncludedAsset | UnavailableAsset;

/** `CC0` spelling varies between MakeHuman records and package manifests. */
export const isCc0Licence = (licence: AssetLicenceTerms): boolean =>
  licence.attribution === "none" &&
  licence.shareAlike === "none" &&
  /^\s*(?:CC0(?:[ -]1\.0)?|CC-0|Creative Commons Zero(?: 1\.0)?)\s*$/i.test(licence.selected);

/** A serializable decision still needs an unambiguous identity and actual selected grant. */
function hasRequiredProvenance(record: AssetLicenceRecord): boolean {
  return Boolean(
    record.id.trim() &&
      record.source.trim() &&
      record.author.trim() &&
      record.licence.selected.trim(),
  );
}

/** Selects an asset or returns serializable metadata explaining its absence. */
export function selectAssetForProfile(
  profile: AssetLicenceProfile,
  record: AssetLicenceRecord,
): AssetProfileSelection {
  if (!hasRequiredProvenance(record)) {
    return {
      included: false,
      unavailable: {
        id: record.id,
        licence: record.licence.selected,
        source: record.source,
        reason: "incomplete-provenance",
      },
    };
  }

  if (!record.licence.permitsCommercialUse || !record.licence.permitsRedistribution) {
    return {
      included: false,
      unavailable: {
        id: record.id,
        licence: record.licence.selected,
        source: record.source,
        reason: "licence-not-permitted",
      },
    };
  }

  if (isCc0Licence(record.licence)) return { included: true, record };

  if (profile === "cc0-only") {
    return {
      included: false,
      unavailable: {
        id: record.id,
        licence: record.licence.selected,
        source: record.source,
        reason: "profile-excludes-attributed-asset",
      },
    };
  }

  if (
    !record.modifications?.trim() ||
    !record.author.trim() ||
    (record.licence.attribution === "required" && !record.attribution?.trim())
  ) {
    return {
      included: false,
      unavailable: {
        id: record.id,
        licence: record.licence.selected,
        source: record.source,
        reason: "incomplete-attribution",
      },
    };
  }

  return {
    included: true,
    record,
    ...(record.licence.attribution === "required" ? { attribution: record.attribution } : {}),
  };
}

/** Raises a packer-facing error instead of permitting a hidden substitution. */
export function requireAssetForProfile(
  profile: AssetLicenceProfile,
  record: AssetLicenceRecord,
): IncludedAsset {
  const selection = selectAssetForProfile(profile, record);
  if (selection.included) return selection;
  throw new Error(
    `asset licence profile ${profile}: ${selection.unavailable.id} is unavailable (${selection.unavailable.reason})`,
  );
}

/** Stable Markdown for a pack-generated attribution file. CC0 records do not add a row. */
export function renderAssetAttribution(records: readonly IncludedAsset[]): string {
  const attributed = records
    .filter(
      (record) =>
        record.attribution !== undefined || record.record.licence.shareAlike === "required",
    )
    .sort((a, b) => a.record.id.localeCompare(b.record.id));
  if (attributed.length === 0)
    return "# Asset attribution\n\nNo attribution-licensed asset data is included.\n";
  return [
    "# Asset attribution",
    "",
    "Generated by the packer; do not edit.",
    "",
    "| Asset | Licence | Author | Source | Attribution | Share-alike | Modifications |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...attributed.map(
      ({ record, attribution }) =>
        `| ${escapeTableCell(record.id)} | ${escapeTableCell(record.licence.selected)} | ${escapeTableCell(record.author)} | ${escapeTableCell(record.source)} | ${escapeTableCell(attribution ?? "None required")} | ${escapeTableCell(record.licence.shareAlike)} | ${escapeTableCell(record.modifications ?? "")} |`,
    ),
    "",
  ].join("\n");
}

/** Preserve credit text in a Markdown table instead of splitting a row or line. */
export function escapeTableCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

export interface ParsedAssetLicenceProfile {
  profile: AssetLicenceProfile;
  /** Arguments left for the caller after this shared option is consumed. */
  args: string[];
}

/** Parses the common build switch and leaves pack-specific arguments untouched. */
export function parseAssetLicenceProfile(argv: readonly string[]): ParsedAssetLicenceProfile {
  let profile = DEFAULT_ASSET_LICENCE_PROFILE;
  let seen = false;
  const args: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg !== "--asset-license-profile") {
      args.push(arg as string);
      continue;
    }
    if (seen) throw new Error("--asset-license-profile may be supplied only once");
    seen = true;
    const value = argv[++index];
    if (!value) throw new Error("--asset-license-profile requires cc0-only or commercial");
    if (!(ASSET_LICENCE_PROFILES as readonly string[]).includes(value))
      throw new Error(`unknown asset licence profile: ${value}`);
    profile = value as AssetLicenceProfile;
  }
  return { profile, args };
}
