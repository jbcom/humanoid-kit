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
import type {
  AdultAnatomySpec,
  AdultDetailSpec,
  AdultReservoirSpec,
  HumanoidAssets,
} from "../../src/format/assetFormat.ts";
import { AUTHORED_MODIFIERS } from "./adultAuthored.ts";
import { adultCoatRegions } from "./adultCoat.ts";
import { PHALLUS_GIRTH, PHALLUS_LENGTH, PHALLUS_SIZE } from "./detail/phallus.ts";
import { TESTES_SIZE } from "./detail/scrotum.ts";
import { pelvicRefinement } from "./pelvicRegion.ts";

/** The part of the spec that does not depend on the base mesh. */
export const ADULT_ANATOMY_SPEC: Omit<AdultAnatomySpec, "surface" | "detail" | "reservoirs"> = {
  features: [
    // The organ drawn out of the phallic reservoir (scripts/lib/detail/phallus.ts): its skin is
    // the layer on that reservoir's island (`AdultReservoirSpec.layer`).
    {
      id: "phallus",
      modifiers: [PHALLUS_SIZE, PHALLUS_LENGTH, PHALLUS_GIRTH],
    },
    // The sacs and testes drawn out of the labioscrotal pair (scripts/lib/detail/scrotum.ts).
    { id: "scrotum", modifiers: [TESTES_SIZE] },
    // The mound has MakeHuman's one control (the body's bulge, a control target) and this
    // pack's own (a generated control target, scripts/lib/control/mound.ts).
    { id: "mound", modifiers: ["pelvis/bulge-decr|incr", "pelvis/mound-decr|incr"] },
  ],
  skinLayers: [
    // The penis and testes layers' fields are the islands of the reservoirs they colour
    // (`AdultReservoirSpec.island`, `layer`), not measured from targets: the CC0 penis
    // targets deform the helper-genital group, which the surface never draws.
    { id: "penis-skin", masks: [], lo: 0.05, hi: 0.4 },
    { id: "testes-skin", masks: [], lo: 0.05, hi: 0.4 },
    { id: "mound-skin", masks: ["pelvis/bulge-incr"], lo: 0.25, hi: 0.8 },
  ],
  // Arousal changes the organ through the detail's drives (`detail/phallus.ts`: erect against
  // flaccid is length +43% and circumference +25%, docs/research/ADULT-ANATOMY-DATA.md, F), which
  // read the signal, not through state morphs on the CC0 penis targets that this replaces.
  stateMorphs: [],
};

/**
 * The whole spec for a base body: the fixed part and the surface refinement
 * round the pelvis (`pelvicRefinement`), which is a choice of that body's faces.
 */
export function adultAnatomySpec(
  base: HumanoidAssets,
  detail?: AdultDetailSpec,
  reservoirs?: AdultReservoirSpec[],
): AdultAnatomySpec {
  return {
    ...ADULT_ANATOMY_SPEC,
    surface: pelvicRefinement(base),
    ...(reservoirs && { reservoirs }),
    ...(detail && { detail }),
    coatRegions: adultCoatRegions(base),
  };
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

/** The modifiers the spec names that MakeHuman ships: the packer checks these against upstream's. */
export const ADULT_SPEC_UPSTREAM_MODIFIERS: readonly string[] = ADULT_SPEC_MODIFIERS.filter(
  (id) => !AUTHORED_MODIFIERS.some((m) => m.id === id),
);
