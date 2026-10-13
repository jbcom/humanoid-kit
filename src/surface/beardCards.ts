/**
 * A recipe's beard as cards (docs/ARCHITECTURE.md, "Beards"): generated at
 * runtime from the resolved beard (`resolveBeard`) over the coat's beard masks,
 * so its length, volume, fork and part are continuous numbers and a beard can
 * grow during play without swapping assets. The hair pack ships only the
 * cards' strand map; the geometry is this project's own, from the base mesh
 * and a seed (`generateCards`).
 */
import { groupFaces, type HumanoidAssets } from "../format/assetFormat.ts";
import type { ResolvedBeard } from "./beard.ts";
import { type CardSpec, type Cards, generateCards } from "./bodyHairCards.ts";
import { type BeardPart, beardMasks } from "./regions/bodyHairCoat.ts";

/** The shortest part that grows cards, metres: below it the coat alone draws the hair. */
export const BEARD_CARD_MIN_LENGTH = 0.005;

/**
 * The cards' numbers at a volume of 1, as the packed full beard had them: cards
 * per cm², width (metres), lift (the slope a card leaves the skin at), and how
 * far a card may turn from the comb (radians). Choices.
 */
const BEARD_CARD = { density: 0.9, width: 0.005, lift: 0.3, spread: 0.45, seed: 0x5eed } as const;

const PARTS: readonly BeardPart[] = ["moustache", "chin", "cheeks"];

const bodyCache = new WeakMap<
  HumanoidAssets,
  { positions: Float32Array; triangles: Uint32Array }
>();

/** The body at rest as the cards are generated on it: the base mesh's body triangles. */
function restBody(assets: HumanoidAssets) {
  const known = bodyCache.get(assets);
  if (known) return known;
  const faces = groupFaces(assets, "body");
  const triangles = new Uint32Array(faces.length * 6);
  faces.forEach((f, i) => {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    triangles.set([q[0], q[1], q[2], q[0], q[2], q[3]] as number[], i * 6);
  });
  const body = { positions: assets.positions, triangles };
  bodyCache.set(assets, body);
  return body;
}

/**
 * The beard the cards are drawn for: lengths down to the millimetre (never up,
 * so no card outgrows the recipe), the other controls to a twentieth. Grey is
 * the material's, not the geometry's, so it is left out. Equal beards give
 * equal cards and keys, and growing one by a hair does not regenerate them.
 */
function quantised(beard: ResolvedBeard): ResolvedBeard {
  const mm = (x: number) => Math.floor(x * 1000 + 1e-6) / 1000;
  const step = (x: number) => Math.round(x * 20) / 20;
  return {
    style: beard.style,
    length: mm(beard.length),
    parts: {
      moustache: mm(beard.parts.moustache),
      chin: mm(beard.parts.chin),
      cheeks: mm(beard.parts.cheeks),
    },
    volume: step(beard.volume),
    grey: 0,
    fork: step(beard.fork),
    part: step(beard.part),
  };
}

/** The key the beard's cards are kept and sent under: equal for beards with equal cards. */
export function beardCardKey(beard: ResolvedBeard): string {
  const q = quantised(beard);
  const mm = (x: number) => Math.round(x * 1000);
  return [
    q.style,
    mm(q.parts.moustache),
    mm(q.parts.chin),
    mm(q.parts.cheeks),
    q.volume.toFixed(2),
    q.fork.toFixed(2),
    q.part.toFixed(2),
  ].join(":");
}

/**
 * The card spec for a beard, or null when it grows no cards: clean-shaven,
 * stubble, no part `BEARD_CARD_MIN_LENGTH` long, or a volume of 0. Cards root
 * on the parts that grow them, each at its part's length (blended where parts
 * meet), and volume thickens the beard: more cards, standing further out.
 */
export function beardCardSpec(assets: HumanoidAssets, resolved: ResolvedBeard): CardSpec | null {
  const beard = quantised(resolved);
  const grown = PARTS.filter((p) => beard.parts[p] >= BEARD_CARD_MIN_LENGTH);
  if (grown.length === 0 || beard.volume <= 0) return null;
  const masks = beardMasks(assets);
  const n = masks.chin.length;
  const mask = new Float32Array(n);
  const lengthField = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let sum = 0;
    let length = 0;
    for (const p of grown) {
      const m = masks[p][v] as number;
      sum += m;
      length += m * beard.parts[p];
    }
    mask[v] = Math.min(1, sum);
    lengthField[v] = sum > 0 ? length / sum : 0;
  }
  return {
    id: `beard:${beardCardKey(beard)}`,
    mask,
    lengthField,
    density: BEARD_CARD.density * beard.volume,
    length: Math.max(...grown.map((p) => beard.parts[p])),
    width: BEARD_CARD.width,
    lift: BEARD_CARD.lift * Math.sqrt(beard.volume),
    spread: BEARD_CARD.spread,
    seed: BEARD_CARD.seed,
    drape: {
      body: restBody(assets),
      forkMask: masks.chin,
      fork: beard.fork,
      partMask: masks.moustache,
      part: beard.part,
    },
  };
}

/** The beard's cards, bound to the base mesh at rest, or null when it grows none (`beardCardSpec`). */
export function generateBeardCards(assets: HumanoidAssets, beard: ResolvedBeard): Cards | null {
  const spec = beardCardSpec(assets, beard);
  if (!spec) return null;
  const cards = generateCards(assets, spec);
  return cards.cardCount > 0 ? cards : null;
}
