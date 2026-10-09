/**
 * What the adult anatomy pack's manifest says about its anatomy: the features
 * and the modifiers that apply them, how each adult skin layer's masks are
 * measured from the pack's targets, and the shape states (arousal).
 *
 * It is the pack's data, not the core's, so the core ships no adult target or
 * modifier name (the public build has the core and no adult pack, and
 * `pnpm check:pages` fails if one appears). The packer writes it into
 * `packs/adult-anatomy/data/manifest.json` as `anatomy`, after checking every
 * name against the targets and modifiers it packed; a test holds the shipped
 * manifest to this file.
 */
import type { AdultAnatomySpec, HumanoidAssets } from "../../src/format/assetFormat.ts";
import { pelvicRefinement } from "./pelvicRegion.ts";

/** The part of the spec that does not depend on the base mesh. */
export const ADULT_ANATOMY_SPEC: Omit<AdultAnatomySpec, "surface"> = {
  features: [
    {
      id: "penis",
      modifiers: ["genitals/penis-length-decr|incr", "genitals/penis-circ-decr|incr"],
    },
    { id: "testes", modifiers: ["genitals/penis-testicles-decr|incr"] },
    { id: "mound", modifiers: ["pelvis/bulge-decr|incr"] },
  ],
  skinLayers: [
    {
      id: "penis-skin",
      masks: ["genitals/penis-length-incr", "genitals/penis-circ-incr"],
      lo: 0.05,
      hi: 0.4,
      // A length target stretches the penis from its root, so its displacement runs root to tip.
      coordinate: "genitals/penis-length-incr",
    },
    { id: "testes-skin", masks: ["genitals/penis-testicles-incr"], lo: 0.05, hi: 0.4 },
    { id: "mound-skin", masks: ["pelvis/bulge-incr"], lo: 0.25, hi: 0.8 },
  ],
  stateMorphs: [
    {
      // Erect against flaccid: circumference +25% and length +43% (docs/research/SKIN-STATES.md, B4).
      signal: "arousal",
      targets: [
        { name: "genitals/penis-circ-incr", weight: 0.44 },
        { name: "genitals/penis-length-incr", weight: 0.25 },
      ],
    },
  ],
};

/**
 * The whole spec for a base body: the fixed part and the surface refinement
 * round the pelvis (`pelvicRefinement`), which is a choice of that body's faces.
 */
export function adultAnatomySpec(base: HumanoidAssets): AdultAnatomySpec {
  return { ...ADULT_ANATOMY_SPEC, surface: pelvicRefinement(base) };
}

/** Every target the spec names, for the packer to check against what it packed. */
export const ADULT_SPEC_TARGETS: readonly string[] = [
  ...new Set([
    ...ADULT_ANATOMY_SPEC.skinLayers.flatMap((l) => [
      ...l.masks,
      ...(l.coordinate ? [l.coordinate] : []),
    ]),
    ...ADULT_ANATOMY_SPEC.stateMorphs.flatMap((m) => m.targets.map((t) => t.name)),
  ]),
];

/** Every modifier the spec names. */
export const ADULT_SPEC_MODIFIERS: readonly string[] = ADULT_ANATOMY_SPEC.features.flatMap(
  (f) => f.modifiers,
);
