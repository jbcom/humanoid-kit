/**
 * The adult anatomy's skin layers: the colour of genital skin, one layer per
 * independent anatomy feature (`ANATOMY_FEATURES`). Their code is in the core
 * so the skin shader is compiled once with every layer; their data is not:
 * each layer's masks are measured from targets of the adult anatomy pack, so
 * their fields are zero until that pack's last load stage arrives and the
 * worker posts them (docs/ARCHITECTURE.md, "Adult-pack layers").
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
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { type GenitalSite, genitalAlbedo } from "../genitalTone.ts";
import {
  type SkinLayer,
  type SkinLayerPaint,
  type SkinPaintInput,
  targetCoordinate,
  targetMask,
} from "../layers.ts";
import type { Rgb } from "../skinTone.ts";

/** The target the penis's coordinate is measured from: a length target stretches it from its root. */
const PENIS_AXIS = "genitals/penis-length-incr";
const PENIS_TARGETS = [PENIS_AXIS, "genitals/penis-circ-incr"] as const;

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
export const PENIS_LAYER: SkinLayer = {
  id: "penis-skin",
  adult: { feature: "penis" },
  blend: "mix",
  targets: PENIS_TARGETS,
  fields: (assets: HumanoidAssets) => ({
    mask: targetMask(assets, PENIS_TARGETS, 0.05, 0.4),
    coord: targetCoordinate(assets, PENIS_AXIS),
  }),
  paint: ({ tone, signals }) => {
    const arousal = signals.arousal ?? 0;
    const shaft = genitalAlbedo(tone, "shaft", arousal);
    const glans = genitalAlbedo(tone, "glans", arousal);
    const mid = shaft.map((c, k) => (c + (glans[k] as number)) / 2) as Rgb;
    return {
      strength: 0.9,
      stops: [...Array.from({ length: SHAFT_STOPS }, () => shaft), mid, glans],
    };
  },
};

/** Scrotal skin over the testes. */
export const TESTES_LAYER: SkinLayer = {
  id: "testes-skin",
  adult: { feature: "testes" },
  blend: "mix",
  targets: ["genitals/penis-testicles-incr"],
  fields: (assets) => ({
    mask: targetMask(assets, ["genitals/penis-testicles-incr"], 0.05, 0.4),
    coord: null,
  }),
  paint: sitePaint("scrotum", 0.9),
};

/** The genital mound (the "genital volume" modifier's skin): a small shift, over body skin. */
export const MOUND_LAYER: SkinLayer = {
  id: "mound-skin",
  adult: { feature: "mound" },
  blend: "mix",
  targets: ["pelvis/bulge-incr"],
  fields: (assets) => ({
    mask: targetMask(assets, ["pelvis/bulge-incr"], 0.25, 0.8),
    coord: null,
  }),
  paint: sitePaint("mound", 0.6),
};
