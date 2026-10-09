/**
 * The licence rule every packed MakeHuman-format source must pass
 * (docs/licence-history.md, "The governing rule"). Pure: it judges file heads and a captured asset
 * page, and never touches the filesystem or the network.
 *
 * A — team asset: every text file carries the header MakeHuman's CC0 release
 *     wrote on 2020-09-26 ("This asset was explicitly released as CC0").
 * B — community asset: its page on makehumancommunity.org states CC0. The
 *     page's licence governs (owner ruling, 2026-10-09: "If the website says
 *     cc0 then it's cc0"); file headers are not weighed against it.
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
  /** ISO date the page was read. */
  retrieved: string;
}

export type Clause = "A" | "B";

export type Judgement =
  | {
      pass: true;
      clause: Clause;
      /** Per-file evidence, keyed by file name. */
      evidence: Record<string, string>;
    }
  | { pass: false; reason: string };

const TEAM_HEADER = /released as CC0/;

/**
 * A statement is CC0 when it begins by naming CC0 ("CC0", "CC-0", "CC0 - Creative
 * Commons Zero", "Creative Commons Zero") and names no other licence. Free text
 * that merely mentions CC0 ("undetermined; the uploader quotes CC-0") is not.
 */
export const isCc0 = (value: string) =>
  /^\s*(CC-?0|Creative Commons Zero)\b/i.test(value) &&
  !/\b(BY|NC|SA|A?GPL)\b/i.test(value.replace(/Creative Commons Zero/gi, ""));

/** Judge one asset's files, with the asset page when it is a community asset. */
export function judgeAsset(files: SourceFile[], page?: CommunityPage): Judgement {
  const texts = files.filter((f): f is { name: string; text: string } => f.text !== null);
  if (texts.length > 0 && texts.every((f) => TEAM_HEADER.test(f.text))) {
    const evidence: Record<string, string> = {};
    for (const f of files)
      evidence[f.name] =
        f.text === null
          ? "A: binary file of a team asset"
          : 'A: file header "This asset was explicitly released as CC0"';
    return { pass: true, clause: "A", evidence };
  }
  if (!page) return { pass: false, reason: "no team CC0 header and no captured asset page" };
  if (!isCc0(page.licence)) return { pass: false, reason: `B: page licence is "${page.licence}"` };
  const evidence: Record<string, string> = {};
  for (const f of files) evidence[f.name] = `B: page licence "${page.licence}"`;
  return { pass: true, clause: "B", evidence };
}
