/**
 * The licence rule every packed MakeHuman-format source must pass
 * (docs/licence-history.md, "The governing rule"). Pure: it judges file heads and
 * a captured asset page, and never touches the filesystem or the network.
 *
 * A — team asset: every text file carries the header MakeHuman's CC0 release
 *     wrote on 2020-09-26 ("This asset was explicitly released as CC0").
 * B — community asset: its page on makehumancommunity.org states CC0. The page's
 *     licence governs (owner ruling, 2026-10-09: "If the website says cc0 then
 *     it's cc0"); file headers are not weighed against it.
 * M — CC0 mesh: the mesh itself (`.obj`) is CC0 by its own header, whatever its
 *     binding says (owner ruling, 2026-10-09: "a cc0 mesh with a agpl proxy is
 *     not a reason to reject"). Binding files that are not CC0 are regenerated
 *     from the mesh and never shipped; materials and textures that are not CC0
 *     are left out.
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

export type Clause = "A" | "B" | "M";

export type Judgement =
  | {
      pass: true;
      clause: Clause;
      /** Per-file evidence for the files that ship, keyed by file name. */
      evidence: Record<string, string>;
      /** Binding files that are not CC0: rebuild the binding from the mesh, never ship these. */
      regenerate: string[];
      /** Materials and textures that are not CC0: not shipped. */
      exclude: string[];
    }
  | { pass: false; reason: string };

const TEAM_HEADER = /released as CC0/;
/** The mesh itself. */
const MESH = /\.obj$/i;
/** Files that only tie a mesh to the body: MHCLO/proxy bindings, skeletons, skin weights. */
const BINDING = /\.(mhclo|proxy|mhskel|mhw)$/i;

/**
 * A statement is CC0 when it begins by naming CC0 ("CC0", "CC-0", "CC0 - Creative
 * Commons Zero", "Creative Commons Zero") and names no other licence. Free text
 * that merely mentions CC0 ("undetermined; the uploader quotes CC-0") is not.
 */
export const isCc0 = (value: string) =>
  /^\s*(CC-?0|Creative Commons Zero)\b/i.test(value) &&
  !/\b(BY|NC|SA|A?GPL)\b/i.test(value.replace(/Creative Commons Zero/gi, ""));

/** The licence a file states about itself: the 2020 team header, or its `license` line. */
function ownLicence(text: string): string | null {
  if (TEAM_HEADER.test(text)) return "CC0 (MakeHuman's 2020 release header)";
  for (const raw of text.split(/\r?\n/)) {
    const value = raw
      .trim()
      .match(/^(?:#|\/\/)?\s*licen[cs]e:?\s+(.*)$|"licen[cs]e"\s*:\s*"([^"]*)"/i);
    if (value) return (value[1] ?? value[2] ?? "").trim();
  }
  return null;
}

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
    return { pass: true, clause: "A", evidence, regenerate: [], exclude: [] };
  }

  if (page && isCc0(page.licence)) {
    const evidence: Record<string, string> = {};
    for (const f of files) evidence[f.name] = `B: page licence "${page.licence}"`;
    return { pass: true, clause: "B", evidence, regenerate: [], exclude: [] };
  }

  const meshes = texts.filter((f) => MESH.test(f.name));
  const why = page ? `page licence is "${page.licence}"` : "no captured asset page";
  const notCc0 = meshes.find((f) => !isCc0(ownLicence(f.text) ?? ""));
  if (meshes.length === 0 || notCc0)
    return {
      pass: false,
      reason: notCc0
        ? `${notCc0.name} does not prove CC0 (${why}; the mesh states "${ownLicence(notCc0.text) ?? "no licence"}")`
        : `no CC0 header and no mesh to judge (${why})`,
    };

  const evidence: Record<string, string> = {};
  const regenerate: string[] = [];
  const exclude: string[] = [];
  for (const f of files) {
    const licence = f.text === null ? null : ownLicence(f.text);
    if (licence !== null && isCc0(licence)) evidence[f.name] = `M: file states "${licence}"`;
    else if (BINDING.test(f.name)) regenerate.push(f.name);
    else exclude.push(f.name);
  }
  return { pass: true, clause: "M", evidence, regenerate, exclude };
}
