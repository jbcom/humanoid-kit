/**
 * The adult pack's own detail: the targets generated on the adult surface's
 * lattice, the modifiers that drive them, their sliders, and the manifest's
 * `anatomy.detail` that pins them to the refinement and to the figure's scale
 * (docs/research/ADULT-SCULPT-PLAN.md, section 6a).
 *
 * These modifiers are the pack's own, not MakeHuman's, so the packer adds them to
 * the ones it reads from upstream; their ids follow MakeHuman's
 * `group/target-lo|hi` form so the recipe, the age policy and the creator treat
 * them like any other adult modifier.
 */
import type {
  AdultDetailSpec,
  ShapeModifierEntry,
  SliderEntry,
  SliderTask,
} from "../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../src/model/humanoidModel.ts";
import { moundTargets } from "./detail/mound.ts";
import { type EncodedTarget, encodeSparseTarget } from "./targetEncoding.ts";

/** The modifiers of the generated detail. All are adult-only. */
export const DETAIL_MODIFIERS: readonly ShapeModifierEntry[] = [
  {
    id: "pelvis/mound-decr|incr",
    group: "pelvis",
    lo: "pelvis/mound-decr",
    hi: "pelvis/mound-incr",
    adultOnly: true,
  },
];

/** The slider of each detail modifier, placed after the upstream slider named by `after`. */
const DETAIL_SLIDERS = [
  {
    mod: "pelvis/mound-decr|incr",
    after: "pelvis/bulge-decr|incr",
    label: "Mound",
    description: "The fullness of the mound over the pubic bone, flatter to fuller.",
  },
] as const;

/** Every target name the detail adds. */
export const DETAIL_TARGET_NAMES: readonly string[] = DETAIL_MODIFIERS.flatMap((m) =>
  m.lo ? [m.lo, m.hi] : [m.hi],
);

/** Control vertices whose distance is the figure's pelvic breadth (the left and right hip joints). */
export function pelvicBreadth(
  joints: Readonly<Record<string, readonly number[]>>,
  distance: (a: number, b: number) => number,
): { a: number; b: number; rest: number } {
  const a = joints["upperleg01.L____head"]?.[0];
  const b = joints["upperleg01.R____head"]?.[0];
  if (a === undefined || b === undefined) throw new Error("detail scale: no hip joint vertices");
  return { a, b, rest: distance(a, b) };
}

/** The generated targets, encoded, and the manifest spec that goes with them. */
export function authorDetail(
  lattice: AdultDetailLattice,
  scale: { a: number; b: number; rest: number },
): { targets: EncodedTarget[]; spec: AdultDetailSpec } {
  const mound = moundTargets(lattice);
  const targets = [
    encodeSparseTarget("pelvis/mound-incr", mound.fuller.indices, mound.fuller.xyz),
    encodeSparseTarget("pelvis/mound-decr", mound.flatter.indices, mound.flatter.xyz),
  ];
  const names = targets.map((t) => t.name).sort();
  const declared = [...DETAIL_TARGET_NAMES].sort();
  if (names.join() !== declared.join())
    throw new Error(`detail targets ${names} do not match the modifiers' ${declared}`);
  return { targets, spec: { targets: names, surfaceKey: lattice.key, scale } };
}

/**
 * Adds the detail modifiers' sliders to the adult sliders, each after the slider
 * it sits beside. The order is the sibling's plus half a step, so the merged
 * taxonomy keeps upstream's order.
 */
export function addDetailSliders(tasks: SliderTask[]): void {
  for (const s of DETAIL_SLIDERS) {
    const sibling = tasks
      .flatMap((t) => t.groups)
      .find((g) => g.sliders.some((x) => x.id === s.after));
    const at = sibling?.sliders.findIndex((x) => x.id === s.after) ?? -1;
    if (!sibling || at < 0)
      throw new Error(`detail slider ${s.mod}: no slider ${s.after} to sit by`);
    const next = sibling.sliders[at] as SliderEntry;
    sibling.sliders.splice(at + 1, 0, {
      kind: "modifier",
      id: s.mod,
      label: s.label,
      camera: next.camera,
      description: s.description,
      order: next.order + 0.5,
    });
  }
}
