/**
 * Named places on the body for body art (docs/ARCHITECTURE.md, "Body art"),
 * found on the base mesh rather than stored, each the peak of the MakeHuman
 * target that shapes its feature (`targetPeak`). A site is a base-mesh vertex,
 * so it follows every shape and pose of the figure.
 */
import type { AdultPiercingSiteSpec, HumanoidAssets } from "../format/assetFormat.ts";
import { MIDLINE, namedTarget, targetPeak } from "../model/targetPeak.ts";
import {
  type BodyAnchor,
  isBodyPiercingSite,
  PIERCING_SITES,
  type PiercingSite,
} from "../recipe/bodyArt.ts";

/**
 * Which way a piercing's channel runs through the skin at a site: along the
 * surface normal (through an ear lobe), across the body (through the septum,
 * left to right) or vertically along the surface (through the brow's ridge or
 * the navel's upper rim).
 */
export type PiercingChannel = "normal" | "across" | "vertical";

export interface BodySite {
  /** The base-mesh vertex at the site. */
  vertex: number;
  channel: PiercingChannel;
}

/** How each site is found: the peak of a target, on one side of the body or the midline. */
const SITE_RULES: Readonly<
  Record<PiercingSite, { target: string; side: 1 | -1 | 0; channel: PiercingChannel }>
> = {
  "ear-lobe.L": { target: "ears/l-ear-lobe-incr", side: 1, channel: "normal" },
  "ear-lobe.R": { target: "ears/r-ear-lobe-incr", side: -1, channel: "normal" },
  // The pointed-ear target lifts the helix's rim most at its top.
  "ear-helix.L": { target: "ears/l-ear-shape-pointed", side: 1, channel: "normal" },
  "ear-helix.R": { target: "ears/r-ear-shape-pointed", side: -1, channel: "normal" },
  "nostril.L": { target: "nose/nose-nostrils-width-incr", side: 1, channel: "normal" },
  "nostril.R": { target: "nose/nose-nostrils-width-incr", side: -1, channel: "normal" },
  // Replaced below: the midline vertex between the nostrils.
  septum: { target: "nose/nose-volume-incr", side: 0, channel: "across" },
  // The brow-angle target raises the brow's lateral end, where brow piercings sit.
  "brow.L": { target: "eyebrows/eyebrows-angle-up", side: 1, channel: "vertical" },
  "brow.R": { target: "eyebrows/eyebrows-angle-up", side: -1, channel: "vertical" },
  "lower-lip": { target: "mouth/mouth-lowerlip-middle-down", side: 0, channel: "normal" },
  // The navel target moves the hole's upper lip most.
  navel: { target: "stomach/stomach-navel-in", side: 0, channel: "vertical" },
};

/**
 * The septum: the midline vertex of the nose nearest the point between the
 * nostrils, which is the columella, where a septum piercing passes.
 */
function septum(assets: HumanoidAssets, left: number, right: number): number {
  const P = assets.positions;
  const c = [0, 1, 2].map((k) => ((P[left * 3 + k] as number) + (P[right * 3 + k] as number)) / 2);
  let best = -1;
  let dist = Number.POSITIVE_INFINITY;
  for (const v of namedTarget(assets, SITE_RULES.septum.target).indices) {
    if (Math.abs(P[v * 3] as number) > MIDLINE) continue;
    const d = Math.hypot(
      (P[v * 3] as number) - (c[0] as number),
      (P[v * 3 + 1] as number) - (c[1] as number),
      (P[v * 3 + 2] as number) - (c[2] as number),
    );
    if (d < dist) {
      dist = d;
      best = v;
    }
  }
  return best;
}

const cache = new WeakMap<HumanoidAssets, Readonly<Record<PiercingSite, BodySite>>>();

/** Every piercing site of the body, found on these assets (cached). */
export function bodySites(assets: HumanoidAssets): Readonly<Record<PiercingSite, BodySite>> {
  const known = cache.get(assets);
  if (known) return known;
  const out = {} as Record<PiercingSite, BodySite>;
  for (const site of PIERCING_SITES) {
    const rule = SITE_RULES[site];
    out[site] = { vertex: targetPeak(assets, rule.target, rule.side), channel: rule.channel };
  }
  out.septum = {
    vertex: septum(assets, out["nostril.L"].vertex, out["nostril.R"].vertex),
    channel: SITE_RULES.septum.channel,
  };
  cache.set(assets, out);
  return out;
}

/**
 * The adult anatomy's piercing site `name`, as the loaded adult pack declares
 * it (`AdultAnatomySpec.piercingSites`), or null: the core names none itself.
 */
export function adultPiercingSite(
  assets: HumanoidAssets,
  name: string,
): AdultPiercingSiteSpec | null {
  return assets.adultAnatomyManifest?.anatomy?.piercingSites?.find((s) => s.name === name) ?? null;
}

/**
 * The base-mesh vertex a `BodyAnchor` names: a body site's, or the vertex
 * itself. An unknown site or a vertex past the mesh is an error, never a guess.
 */
export function resolveAnchor(assets: HumanoidAssets, at: BodyAnchor): number {
  if (typeof at === "number") {
    if (!Number.isInteger(at) || at < 0 || at >= assets.manifest.vertexCount)
      throw new RangeError(`body-art anchor ${at} is not a vertex of the base mesh`);
    return at;
  }
  if (!isBodyPiercingSite(at)) throw new RangeError(`body-art anchor ${at} is not a body site`);
  return bodySites(assets)[at].vertex;
}
