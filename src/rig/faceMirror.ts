/**
 * The mirror of a face unit across the face (docs/ARCHITECTURE.md,
 * "Expressions"): `Left` and `Right` swapped wherever they occur
 * (`MouthLeftPullUp` is `MouthRightPullUp`'s mirror, `ChinLeft` is
 * `ChinRight`'s, and the left eye turning right is the right eye turning
 * left), or the unit itself when it has neither (`JawDrop`). The packer makes
 * every unit the mirror of its partner (`scripts/lib/faceUnits.ts`), and the
 * named expressions hold each left unit at the weight of its right.
 */
export function mirrorUnit(unit: string): string {
  return unit.replace(/Left|Right/g, (side) => (side === "Left" ? "Right" : "Left"));
}
