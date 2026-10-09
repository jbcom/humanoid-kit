/**
 * The adult anatomy's skin layers: the colour of genital skin, one layer per
 * independent anatomy feature. Their code is in the core so the skin shader is
 * compiled once with every layer; their data is not. The core names no adult
 * target or modifier (the public build ships the core and no adult pack, and
 * `pnpm check:pages` fails if one appears): each layer's masks are measured
 * from targets the adult anatomy pack's manifest names for it
 * (`AdultAnatomySpec.skinLayers`), so their fields are zero until that pack's
 * last load stage arrives and the worker posts them (docs/ARCHITECTURE.md,
 * "Adult-pack layers").
 *
 * Each layer declares `adult: { feature }`, and `paintStopTable` paints it only
 * for an adult figure whose recipe applies that feature, so nothing here checks
 * age or anatomy. The colours are uncalibrated (src/surface/genitalTone.ts).
 *
 * Phase 1 builds on today's CC0 targets, and those deform MakeHuman's
 * helper-genital group, which the render surface (the body group) leaves out:
 * the penis and testes masks sit on vertices that are not drawn, so they show
 * nothing until the sculpt phase puts adult geometry on the surface
 * (docs/research/ADULT-SCULPT-PLAN.md). The mound's target moves body skin, so
 * it is the one that shows today.
 */
import {
  type AdultSkinLayerSpec,
  AssetFormatError,
  type HumanoidAssets,
} from "../../format/assetFormat.ts";
import { type GenitalSite, genitalAlbedo } from "../genitalTone.ts";
import {
  type SkinLayer,
  type SkinLayerFields,
  type SkinLayerPaint,
  type SkinPaintInput,
  targetCoordinate,
  targetMask,
} from "../layers.ts";
import type { Rgb } from "../skinTone.ts";

/** The pack's measurement spec for an adult layer, or undefined without the pack or its spec. */
const specOf = (assets: HumanoidAssets, id: string): AdultSkinLayerSpec | undefined =>
  assets.adultAnatomyManifest?.anatomy?.skinLayers.find((l) => l.id === id);

/** Every target a spec measures. */
const specTargets = (spec: AdultSkinLayerSpec): string[] => [
  ...spec.masks,
  ...(spec.coordinate ? [spec.coordinate] : []),
];

/** A layer's fields, measured from the targets its spec in the adult pack names. */
function adultFields(assets: HumanoidAssets, id: string): SkinLayerFields {
  const spec = specOf(assets, id);
  if (!spec) throw new AssetFormatError(`the adult anatomy pack has no skin layer ${id}`);
  return {
    mask: targetMask(assets, spec.masks, spec.lo, spec.hi),
    coord: spec.coordinate ? targetCoordinate(assets, spec.coordinate) : null,
  };
}

/** Builds an adult layer: gated by `feature`, its data the adult pack's, its colour `paint`. */
const adultLayer = (
  id: string,
  feature: string,
  paint: (input: SkinPaintInput) => SkinLayerPaint,
): SkinLayer => ({
  id,
  adult: { feature },
  blend: "mix",
  targets: [],
  available: (assets) => {
    const spec = specOf(assets, id);
    return spec !== undefined && specTargets(spec).every((t) => assets.targets.has(t));
  },
  fields: (assets) => adultFields(assets, id),
  paint,
});

/** A single-colour paint at a genital site, deepening with the arousal signal. */
const sitePaint =
  (site: GenitalSite, strength: number) =>
  ({ tone, signals }: SkinPaintInput): SkinLayerPaint => ({
    strength,
    stops: [genitalAlbedo(tone, site, signals.arousal ?? 0)],
  });

/** Stops along the penis's coordinate: the shaft's colour to 5/7 of the way, then shading to the glans. */
const SHAFT_STOPS = 6;

/** Penis skin: shaft colour from the root, shading to the glans toward the tip. */
export const PENIS_LAYER: SkinLayer = adultLayer("penis-skin", "penis", ({ tone, signals }) => {
  const arousal = signals.arousal ?? 0;
  const shaft = genitalAlbedo(tone, "shaft", arousal);
  const glans = genitalAlbedo(tone, "glans", arousal);
  const mid = shaft.map((c, k) => (c + (glans[k] as number)) / 2) as Rgb;
  return {
    strength: 0.9,
    stops: [...Array.from({ length: SHAFT_STOPS }, () => shaft), mid, glans],
  };
});

/** Scrotal skin over the testes. */
export const TESTES_LAYER: SkinLayer = adultLayer(
  "testes-skin",
  "testes",
  sitePaint("scrotum", 0.9),
);

/** The genital mound (the "genital volume" modifier's skin): a small shift, over body skin. */
export const MOUND_LAYER: SkinLayer = adultLayer("mound-skin", "mound", sitePaint("mound", 0.6));
