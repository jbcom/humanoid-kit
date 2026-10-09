/**
 * The licence rule every packed MakeHuman-format source must pass
 * (docs/licence-history.md §4). Pure: it judges file heads and a captured asset
 * page, and never touches the filesystem or the network.
 *
 * A — team asset: every text file carries the header MakeHuman's CC0 release
 *     wrote on 2020-09-26 ("This asset was explicitly released as CC0").
 * B — community asset, page captured: the page says CC0, and every file's own
 *     statements are compatible with the uploader having dedicated it:
 *     B2 each licence line is CC0, or MakeClothes 1's untouched default AGPL3
 *        line with the author being the submitter or unknown; no licence line
 *        at all only on a target, material or texture (recorded as page-only);
 *     B3 no file names a third-party author or copyright (the MakeHuman team,
 *        Bastioni, Larsson), whose work the 2020 release did not reach unless
 *        the file was bundled (and then it passes A);
 *     B4 no file shares a uuid with an asset known to fail;
 *     B5 the page record names what the asset was derived from, and none of it
 *        fails; a description that reads like a derivation must be recorded.
 * C — nothing in the download states a stricter licence (CC-BY, NC, GPL/AGPL
 *     other than the B2 default). That is checked inside B2.
 */

/** A text file's head (the first few KB are enough; headers live there) or a binary file. */
export interface SourceFile {
  name: string;
  /** null for a binary file (texture, thumbnail). */
  text: string | null;
}

/** An asset page on makehumancommunity.org, as captured by a person who read it. */
export interface CommunityPage {
  url: string;
  /** The "Submitted by <user>" name. */
  submitter: string;
  /** ISO date of the "Submitted by … on <date>" line. */
  submitted: string;
  /** The page's "License:" value, verbatim. */
  licence: string;
  description: string;
  /** ISO date the page was read. */
  retrieved: string;
  /**
   * What this asset is derived from, as its description or files say, with the
   * licence the source itself states (read at the source, not taken from this
   * page). Empty when it is the uploader's own work.
   */
  derivedFrom: Derivation[];
  /**
   * Why the asset is the uploader's own work although its description reads
   * like a derivation (e.g. a skin "made for the … Remapped topology" names the
   * UV layout it was painted to, not a source it copies).
   */
  notDerivedBecause?: string;
}

export interface Derivation {
  /** Asset id, page URL or other locator of the source. */
  source: string;
  /** The licence the source states, verbatim, e.g. "CC0" or "the MakeHuman base mesh (CC0 since 2020-09-26)". */
  licence: string;
}

export type Clause = "A" | "B";

export type Judgement =
  | {
      pass: true;
      clause: Clause;
      /** Per-file evidence, keyed by file name. */
      evidence: Record<string, string>;
      /** Files whose only licence evidence is the page (targets, materials, textures). */
      pageOnly: string[];
    }
  | { pass: false; reason: string };

/** The exact line MakeClothes 1 wrote when its licence field was left at the default (makeclothes.py:1938). */
export const MAKECLOTHES_DEFAULT =
  "AGPL3 (see also http://www.makehuman.org/doc/node/external_tools_license.html)";

const TEAM_HEADER = /released as CC0/;
const THIRD_PARTY =
  /\b(MHteam|Manuel Bastioni|Bastioni|Thomas Larsson|Makehuman\.org|Data Collection AB)\b/i;
const DERIVATION_WORDS =
  /\b(taken from|remapped|re-?map|healed|derivative|derived from|based on|modified version of|fix of|copy of|original(?:ly)?(?: [\w-]+){0,3} by|downloaded from|created from)\b/i;
/** Files that may carry no licence line of their own; the page is then their only evidence. */
const PAGE_ONLY_KINDS = /\.(target|mhmat|thumb|png|jpe?g|webp|tga|bmp)$/i;
/**
 * A BVH has no place for a licence line: MakeHuman's pose and animation files
 * carry it in the `.meta` beside them (`license CC0`). The `.meta` is judged as
 * a file of its own; the BVH is accepted only with it present, and is recorded
 * as having the page and its `.meta` as its evidence.
 */
const BVH = /\.bvh$/i;

/**
 * Uuids of assets that fail this rule, so a re-upload or edit of one cannot
 * pass under a new name. Each entry names its source.
 */
export const FAILING_UUIDS: Record<string, string> = {
  "ece8ae91-d8d7-4e98-a737-dd1f5f08519a":
    "adult_male_genitalia.proxy (author MHteam, licence AGPL3; Bastioni, uploaded by wolgade 2015-09-15 as AGPL)",
  "a68d9183-6abd-4a11-95a9-f082efd5d25b":
    "adult_female_genitalia_remapped.proxy (author MHteam, licence AGPL3)",
  "c6bf1f69-1a82-42fc-818f-3470e61554da":
    "adult_female_2020_v_01.proxy (author MHteam, licence AGPL3)",
};

/** Assets (ids or page URLs) known to fail; a derivation of one fails too. */
export const FAILING_SOURCES: Record<string, string> = {
  adult_male_genitalia: "AGPL (Bastioni; page licence AGPL)",
  adult_female_genitalia: "AGPL (Bastioni; page licence AGPL)",
  adult_female_genitalia_old: "AGPL (page licence AGPL)",
  adult_female_genitalia_new_healed: "AGPL (page licence AGPL)",
  penis01: "AGPL (removed from MakeHuman 2016-05-15, before the CC0 release)",
};

/**
 * A statement is CC0 when it begins by naming CC0 ("CC0", "CC-0", "CC0 - Creative
 * Commons Zero", "Creative Commons Zero") and names no other licence. Free text
 * that merely mentions CC0 ("undetermined; the uploader quotes CC-0") is not.
 */
export const isCc0 = (value: string) =>
  /^\s*(CC-?0|Creative Commons Zero)\b/i.test(value) &&
  !/\b(BY|NC|SA|A?GPL)\b/i.test(value.replace(/Creative Commons Zero/gi, ""));

interface Statements {
  licences: string[];
  authors: string[];
  uuids: string[];
  thirdParty: string[];
}

/** The first capture group of the first pattern that matches, trimmed. */
const capture = (line: string, ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const value = line.match(p)?.[1];
    if (value !== undefined) return value.trim();
  }
  return undefined;
};

function statements(text: string): Statements {
  const s: Statements = { licences: [], authors: [], uuids: [], thirdParty: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const licence = capture(
      line,
      /^(?:#|\/\/)\s*licen[cs]e:?\s*(.*)$/i,
      /^licen[cs]e\s+(.*)$/i,
      /"licen[cs]e"\s*:\s*"([^"]*)"/i,
    );
    if (licence !== undefined) s.licences.push(licence);
    const author = capture(
      line,
      /^(?:#|\/\/)\s*author:?\s*(.*)$/i,
      /^author\s+(.*)$/i,
      /"author"\s*:\s*"([^"]*)"/i,
    );
    if (author !== undefined) s.authors.push(author);
    const uuid = capture(line, /^(?:\/\/\s*)?uuid\s+([0-9a-f-]{36})/i);
    if (uuid !== undefined) s.uuids.push(uuid.toLowerCase());
    if (/author|copyright/i.test(line) && THIRD_PARTY.test(line)) s.thirdParty.push(line);
  }
  return s;
}

const unknownAuthor = (a: string) => a === "" || /^unknown$/i.test(a);
/** Site user names drop the spaces an exporter's author field keeps ("Rehman Polanski" = "RehmanPolanski"). */
const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Judge one asset's files, with the asset page when it is a community asset. */
export function judgeAsset(files: SourceFile[], page?: CommunityPage): Judgement {
  const texts = files.filter((f): f is { name: string; text: string } => f.text !== null);
  if (texts.length === 0) return { pass: false, reason: "no text file to judge" };

  // A: MakeHuman's own CC0 release header on every text file.
  if (texts.every((f) => TEAM_HEADER.test(f.text))) {
    const evidence: Record<string, string> = {};
    for (const f of texts)
      evidence[f.name] = 'A: file header "This asset was explicitly released as CC0"';
    for (const f of files) if (f.text === null) evidence[f.name] = "A: binary file of a team asset";
    return { pass: true, clause: "A", evidence, pageOnly: [] };
  }

  // B: a community asset needs its page.
  if (!page) return { pass: false, reason: "no team CC0 header and no captured asset page" };
  if (!isCc0(page.licence)) return { pass: false, reason: `B1: page licence is "${page.licence}"` };
  for (const d of page.derivedFrom) {
    const id = d.source.replace(/^.*\//, "").replace(/\.html$/, "");
    const known = FAILING_SOURCES[id];
    if (known) return { pass: false, reason: `B5: derived from ${id}: ${known}` };
    if (!isCc0(d.licence))
      return {
        pass: false,
        reason: `B5: derived from ${d.source}, whose licence is "${d.licence}"`,
      };
  }
  if (
    page.derivedFrom.length === 0 &&
    !page.notDerivedBecause &&
    DERIVATION_WORDS.test(page.description)
  )
    return {
      pass: false,
      reason: `B5: the description reads like a derivation ("${page.description.match(DERIVATION_WORDS)?.[0]}"); record derivedFrom or notDerivedBecause`,
    };

  const evidence: Record<string, string> = {};
  const pageOnly: string[] = [];
  for (const f of files) {
    if (f.text === null) {
      evidence[f.name] = `B: binary file, page "${page.licence}"`;
      pageOnly.push(f.name);
      continue;
    }
    if (TEAM_HEADER.test(f.text)) {
      evidence[f.name] = 'A: file header "This asset was explicitly released as CC0"';
      continue;
    }
    const s = statements(f.text);
    if (s.thirdParty.length)
      return { pass: false, reason: `B3: ${f.name} names a third party: "${s.thirdParty[0]}"` };
    const failing = s.uuids.find((u) => FAILING_UUIDS[u]);
    if (failing)
      return { pass: false, reason: `B4: ${f.name} uuid ${failing} is ${FAILING_UUIDS[failing]}` };
    if (s.licences.length === 0 && BVH.test(f.name)) {
      const meta = f.name.replace(BVH, ".meta");
      if (!files.some((g) => g.name === meta))
        return {
          pass: false,
          reason: `B2: ${f.name} has no licence line and no ${meta} beside it`,
        };
      evidence[f.name] = `B: BVH licence is its ${meta}; page "${page.licence}"`;
      pageOnly.push(f.name);
      continue;
    }
    if (s.licences.length === 0) {
      if (!PAGE_ONLY_KINDS.test(f.name))
        return { pass: false, reason: `B2: ${f.name} has no licence line` };
      evidence[f.name] = `B: no licence line; page "${page.licence}"`;
      pageOnly.push(f.name);
      continue;
    }
    for (const lic of s.licences) {
      if (isCc0(lic)) continue;
      if (lic === MAKECLOTHES_DEFAULT) {
        const author = s.authors[0] ?? "";
        if (unknownAuthor(author) || sameName(author, page.submitter)) continue;
        return {
          pass: false,
          reason: `B2: ${f.name} carries the MakeClothes default AGPL3 line with author "${author}", not the submitter "${page.submitter}"`,
        };
      }
      return { pass: false, reason: `C: ${f.name} states "${lic}"` };
    }
    evidence[f.name] = s.licences.every(isCc0)
      ? `B: file "license ${s.licences[0]}"`
      : `B: MakeClothes default AGPL3 line, author "${s.authors[0] ?? "unknown"}" = submitter or unknown; page "${page.licence}"`;
  }
  return { pass: true, clause: "B", evidence, pageOnly };
}
