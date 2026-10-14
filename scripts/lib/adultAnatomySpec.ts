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
  AdultSurfacePatch,
  HumanoidAssets,
} from "../../src/format/assetFormat.ts";
import { AUTHORED_MODIFIERS } from "./adultAuthored.ts";
import { adultCoatRegions } from "./adultCoat.ts";
import { ANAL_CANAL } from "./detail/canal.ts";
import { PHALLUS_GIRTH, PHALLUS_LENGTH, PHALLUS_SIZE } from "./detail/phallus.ts";
import { TESTES_SIZE } from "./detail/scrotum.ts";
import { VULVA_SIZE } from "./detail/vulva.ts";
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
    // The labia and the cleft, folds of the skin itself (scripts/lib/detail/vulva.ts).
    { id: "vulva", modifiers: [VULVA_SIZE] },
    // The anal canal, drawn inward from its reservoir (scripts/lib/detail/canal.ts).
    { id: "anus", modifiers: [ANAL_CANAL] },
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
    // The vulva's mask is authored per base vertex from its detail target (`vulvaSkinMask`),
    // which moves the lattice and leaves no footprint on the base to measure.
    { id: "vulva-skin", masks: [], lo: 0, hi: 1 },
  ],
  // Arousal changes the organ through the detail's drives (`detail/phallus.ts`: erect against
  // flaccid is length +43% and circumference +25%, docs/research/ADULT-ANATOMY-DATA.md, F), which
  // read the signal, not through state morphs on the CC0 penis targets that this replaces.
  // Elsewhere it drives body targets (#118), from this pack so the core names no arousal
  // response: the lips fill with blood (vasocongestion; no measured volume change was found,
  // so 0.15 of each lip's volume target, under a millimetre, is a CHOICE), the nipple
  // becomes erect (cold's measured rise, 0.37 of `nipple-point-incr`: the same smooth-muscle
  // response, B3) and the areola swells (0.1 of `nipple-size-incr`, a CHOICE: areolar
  // tumescence at plateau, Masters and Johnson, unmeasured in size).
  stateMorphs: [
    {
      signal: "arousal",
      targets: [
        { name: "mouth/mouth-upperlip-volume-incr", weight: 0.15 },
        { name: "mouth/mouth-lowerlip-volume-incr", weight: 0.15 },
        { name: "breast/nipple-point-incr", weight: 0.37 },
        { name: "breast/nipple-size-incr", weight: 0.1 },
      ],
    },
  ],
  // An adult with this pack loaded is anatomically complete without the recipe naming any of
  // it (docs/FOUNDATION.md, "both forms"): the organ's size runs from none (0) at the female
  // end to the pooled mean (0.65, 9.2 cm, Veale 2015) at the male end, the testes from none
  // to their mean key, and the vulva from the whole sculpt to none. At the female end the
  // reservoir is at rest: the clitoral hood and glans are the vulva's, transferred onto the
  // skin from the 2020 sculpt behind the phallic loop (`detail/phallus.ts`, #75).
  // Between gender 0.35 and 0.65 they blend, the vulva fading as the sac grows, so an
  // androgynous figure is drawn with an intermediate, intersex anatomy by default. A recipe's
  // own value always wins.
  defaults: {
    [PHALLUS_SIZE]: "0.35,0;0.65,0.65",
    [TESTES_SIZE]: "0.35,0;0.65,0.6",
    [VULVA_SIZE]: "0.35,1;0.65,0",
    // Every adult has an anal canal, whatever the gender.
    [ANAL_CANAL]: "0,1;1,1",
  },
};

/**
 * The whole spec for a base body: the fixed part and the surface refinement
 * round the pelvis (`pelvicRefinement`), which is a choice of that body's faces;
 * with `vulvaMask`, the vulva layer's authored mask (`vulvaSkinMask`).
 */
export function adultAnatomySpec(
  base: HumanoidAssets,
  detail?: AdultDetailSpec,
  reservoirs?: AdultReservoirSpec[],
  patches?: AdultSurfacePatch[],
  vulvaMask?: { indices: number[]; weights: number[] },
): AdultAnatomySpec {
  return {
    ...ADULT_ANATOMY_SPEC,
    skinLayers: ADULT_ANATOMY_SPEC.skinLayers.map((l) =>
      l.id === "vulva-skin" && vulvaMask ? { ...l, vertexMask: vulvaMask } : l,
    ),
    surface: { ...pelvicRefinement(base), ...(patches?.length && { patches }) },
    ...(reservoirs && { reservoirs }),
    ...(detail && { detail }),
    coatRegions: adultCoatRegions(base),
  };
}

/**
 * The targets the spec's state morphs drive: the adult pack's own, or body targets
 * the body pack ships (the lips and nipples under arousal), which the packer checks
 * there instead.
 */
export const ADULT_STATE_MORPH_TARGETS: ReadonlySet<string> = new Set(
  ADULT_ANATOMY_SPEC.stateMorphs.flatMap((m) => m.targets.map((t) => t.name)),
);

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
