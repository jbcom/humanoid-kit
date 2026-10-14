/**
 * What the generators that bake shapes at several sizes share (`phallus.ts`,
 * `scrotum.ts`): the hat of a size modifier that blends a key with its
 * neighbours, a collector of targets and the factor lists that drive them, and
 * shape arithmetic.
 */
import type { Vec3 } from "./disc.ts";
import { type ReservoirRoot, type RootShape, shapeDifference } from "./root.ts";

/**
 * The size at which a reservoir lies flat on the skin it covers (`flatShape`), the shape
 * a generator's smallest key grows out of. From rest to here the rings spread from their
 * loop vertices across the skin, which shows nothing; from here to the smallest key the
 * organ or sac rises from the middle of the disc and narrows as it rises. Grown out of
 * rest instead, a size under the smallest key was a cylinder as wide as the loop with a
 * flat end (#75): every ring left its loop vertex together and the cap was carried out
 * flat.
 */
export const FLAT_SIZE = 0.01;

/** A detail target as the generators make it: indices into the root's detail space and xyz deltas. */
export interface DetailTarget {
  name: string;
  indices: number[];
  xyz: number[];
}

/**
 * The factor that is 1 at key `k` of a modifier's keyed sizes and falls to 0 at the keys
 * either side: held at 1 beyond the last key, and rising from 0 at size 0 to the first.
 */
export function sizeHat(modifier: string, sizes: readonly number[], k: number): string {
  const before = sizes[k - 1];
  const after = sizes[k + 1];
  const points = [
    before === undefined ? "0,0" : `${before},0`,
    `${sizes[k]},1`,
    ...(after === undefined ? [] : [`${after},0`]),
  ];
  return `ramp:${modifier}:${points.join(";")}`;
}

/** Collects targets (the difference of two shapes) and the factors that drive each. */
export function targetCollector(root: ReservoirRoot) {
  const targets: DetailTarget[] = [];
  const drives: Record<string, string[]> = {};
  return {
    targets,
    drives,
    add(name: string, from: RootShape, to: RootShape, factors: string[]) {
      if (drives[name]) throw new Error(`target ${name} is made twice`);
      targets.push({ name, ...shapeDifference(root, from, to) });
      drives[name] = factors;
    },
  };
}

/** a + (c - b) for shapes: `a` moved by what takes `b` to `c`. */
export function shapeSum(root: ReservoirRoot, a: RootShape, b: RootShape, c: RootShape): RootShape {
  if (a.length !== b.length || b.length !== c.length)
    throw new Error(`reservoir ${root.id}: shapes of different sizes`);
  return a.map((p, i) => {
    const q = b[i] as Vec3;
    const r = c[i] as Vec3;
    return [p[0] + r[0] - q[0], p[1] + r[1] - q[1], p[2] + r[2] - q[2]] as Vec3;
  });
}
