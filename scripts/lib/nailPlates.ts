/**
 * The nail plates the body pack carries (docs/ARCHITECTURE.md, "Hands"): CC0
 * community nail meshes from MakeHuman's bodyparts04 pack, vendored under
 * `vendor/makehuman-bodyparts04/` (geometry and binding only: the kit draws
 * them with its own translucent plate material, over the painted nail bed).
 * Each passes the licence rule's clause B with its captured asset page
 * (`licenceRule.ts`; provenance in `vendor/makehuman-bodyparts04/PROVENANCE.md`).
 */
import path from "node:path";
import type { CommunityPage } from "./licenceRule.ts";

export const VENDOR_BODYPARTS04 = path.resolve(
  import.meta.dirname,
  "../../vendor/makehuman-bodyparts04",
);

/**
 * A Mindfront asset page as read on 2026-10-09 (each page's description: short
 * low-poly nails, and toe nails, "Looks best with subsurf level 1"; the
 * uploader's own work). The byline is not in the page's HTML text; the pack's
 * JSON record (bodyparts04.json, "author" and "created") gives the submitter
 * and date.
 */
const page = (node: number): CommunityPage => ({
  url: `http://www.makehumancommunity.org/node/${node}`,
  submitter: "Mindfront",
  submitted: "2018-02-15",
  licence: "CC0 - Creative Commons Zero",
  retrieved: "2026-10-09",
});

/** [asset id, attachment kind, .mhclo path under the vendor folder, its page]. */
export const NAIL_PLATES: readonly [string, string, string, CommunityPage][] = [
  [
    "nails/fingers",
    "fingernails",
    "mindfront_nails_01_short/mindfront_nails_01_short.mhclo",
    page(1368),
  ],
  ["nails/toes", "toenails", "mindfront_nails_toes_01/mindfront_nails_toes_01.mhclo", page(1371)],
];
