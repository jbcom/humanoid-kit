/**
 * MakeHuman's custom targets: the targets a user drops into its `data/custom`
 * folder, which its Modelling > Custom tab lists as one slider each. A custom
 * target is an ordinary sparse target with a one-sided modifier, `custom/<name>`,
 * whose value in [0, 1] is the target's weight, exactly as MakeHuman applies one.
 *
 * Adding custom targets never changes what any other recipe produces: a recipe
 * that does not name `custom/<name>` gives the same figure as before.
 */
import type { HumanoidAssets, SparseTarget } from "../format/assetFormat.ts";

export const CUSTOM_GROUP = "custom";

export class CustomTargetError extends Error {
  override name = "CustomTargetError";
}

/** The modifier id (and the target name) of the custom target `name`. */
export const customTargetId = (name: string): string => `${CUSTOM_GROUP}/${name}`;

/**
 * A custom target as it travels (JSON, a worker message): `name` is the bare
 * name, without the `custom/` group; `indices` ascend; `deltas` are quantised
 * xyz deltas, `scale` metres per unit, as in the packs (`SparseTarget`).
 */
export interface CustomTarget {
  name: string;
  indices: ArrayLike<number>;
  deltas: ArrayLike<number>;
  scale: number;
}

/**
 * Registers custom targets on loaded assets: each becomes the target and the
 * one-sided modifier `custom/<name>`. A name already registered is replaced
 * (MakeHuman reloads an edited custom target by name). Anything malformed is
 * refused before any target is added.
 */
export function addCustomTargets(assets: HumanoidAssets, targets: readonly CustomTarget[]): void {
  const n = assets.manifest.vertexCount;
  const parsed: SparseTarget[] = [];
  const names = new Set<string>();
  for (const t of targets) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t.name))
      throw new CustomTargetError(
        `custom target name ${JSON.stringify(t.name)} is not a file name`,
      );
    if (names.has(t.name)) throw new CustomTargetError(`custom target ${t.name} is given twice`);
    names.add(t.name);
    const id = customTargetId(t.name);
    const existing = assets.modifiers.get(id);
    // An adult-only modifier is never replaced, whatever group it claims: the loader
    // refuses such a pack, and this keeps the gate when one reached the table anyway.
    if (existing && (existing.group !== CUSTOM_GROUP || existing.adultOnly))
      throw new CustomTargetError(`${id} is a pack modifier, not a custom target`);
    if (!(Number.isFinite(t.scale) && t.scale > 0))
      throw new CustomTargetError(`custom target ${t.name}: scale must be positive`);
    if (t.deltas.length !== t.indices.length * 3)
      throw new CustomTargetError(`custom target ${t.name}: deltas must be three per index`);
    let last = -1;
    for (let i = 0; i < t.indices.length; i++) {
      const v = t.indices[i] as number;
      if (!Number.isInteger(v) || v <= last || v >= n)
        throw new CustomTargetError(
          `custom target ${t.name}: indices must ascend within the ${n} base vertices`,
        );
      last = v;
    }
    const deltas = Int16Array.from(t.deltas);
    for (let i = 0; i < deltas.length; i++)
      if (deltas[i] !== t.deltas[i])
        throw new CustomTargetError(`custom target ${t.name}: deltas must be 16-bit integers`);
    parsed.push({ name: id, indices: Uint16Array.from(t.indices), deltas, scale: t.scale });
  }
  for (const t of parsed) {
    assets.targets.set(t.name, t);
    assets.modifiers.set(t.name, {
      id: t.name,
      group: CUSTOM_GROUP,
      lo: null,
      hi: t.name,
      adultOnly: false,
    });
  }
}

/**
 * Quantises per-vertex metre offsets (`vertexCount * 3`) into a custom target:
 * every vertex that moves by more than `epsilon` metres, at the finest scale
 * the largest offset allows.
 */
export function customTargetOf(
  name: string,
  offsets: ArrayLike<number>,
  epsilon = 1e-7,
): CustomTarget {
  let max = 0;
  for (let i = 0; i < offsets.length; i++) max = Math.max(max, Math.abs(offsets[i] as number));
  const scale = max > 0 ? max / 32767 : 1;
  const indices: number[] = [];
  const deltas: number[] = [];
  for (let v = 0; v * 3 < offsets.length; v++) {
    const x = offsets[v * 3] as number,
      y = offsets[v * 3 + 1] as number,
      z = offsets[v * 3 + 2] as number;
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= epsilon) continue;
    indices.push(v);
    deltas.push(Math.round(x / scale), Math.round(y / scale), Math.round(z / scale));
  }
  return { name, indices, deltas, scale };
}
