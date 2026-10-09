import type {
  AdultAnatomyData,
  AdultAnatomyManifest,
  AdultReservoirSpec,
  ShapeModifierEntry,
} from "../src/format/assetFormat.ts";
import { adultManifest, adultPackData } from "./fixtures.ts";

/**
 * Builds adult packs with synthetic reservoirs and detail targets on real
 * adult-pack data, so the engine is proven before any anatomy is authored on it.
 */
export const STEP = 1e-4; // metres per int16 step

export interface SyntheticTarget {
  name: string;
  /** Indices into the detail's vertices (the region's, then each reservoir's rings), ascending. */
  indices: readonly number[];
  /** xyz per index, metres. */
  xyz: ArrayLike<number>;
}

/** One target of the `TARGET_ENCODING` file: ascending index deltas, then x, y, z planes. */
function encodeTarget(t: SyntheticTarget): Uint8Array {
  const n = t.indices.length;
  const bytes = new ArrayBuffer(n * 8);
  const view = new DataView(bytes);
  let prev = 0;
  t.indices.forEach((v, i) => {
    view.setUint16(i * 2, v - prev, true);
    prev = v;
  });
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < n; i++)
      view.setInt16(n * 2 + (k * n + i) * 2, Math.round((t.xyz[i * 3 + k] as number) / STEP), true);
  return new Uint8Array(bytes);
}

function concat(a: ArrayBuffer, parts: Uint8Array[]): ArrayBuffer {
  const out = new Uint8Array(a.byteLength + parts.reduce((s, p) => s + p.byteLength, 0));
  out.set(new Uint8Array(a), 0);
  let at = a.byteLength;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out.buffer;
}

export interface SyntheticPack {
  reservoirs?: AdultReservoirSpec[];
  targets?: SyntheticTarget[];
  modifiers?: ShapeModifierEntry[];
  /** False when the targets are control targets (on the base's vertices), not detail: no `anatomy.detail`. */
  detail?: boolean;
  /** `AdultDetailSpec.gates`: detail targets whose weight is multiplied by other values. */
  gates?: Record<string, string[]>;
  /** The lattice key the targets were authored on, when there are targets. */
  surfaceKey?: string;
  scale?: { a: number; b: number; rest: number };
}

/** The shipped adult pack with a reservoir spec and, if given, detail targets and their modifiers added. */
export function adultPackWith(o: SyntheticPack = {}): AdultAnatomyData {
  const base = adultPackData();
  const manifest: AdultAnatomyManifest = structuredClone(adultManifest);
  const spec = manifest.anatomy;
  if (!spec) throw new Error("no anatomy spec");
  // The shipped pack's own detail is replaced, so the surface is the synthetic one alone.
  delete spec.detail;
  delete spec.reservoirs;
  if (o.reservoirs) spec.reservoirs = o.reservoirs;
  const parts: Uint8Array[] = [];
  let at = base.targets.byteLength;
  for (const t of o.targets ?? []) {
    const bytes = encodeTarget(t);
    manifest.targets.entries.push({
      name: t.name,
      offset: at,
      count: t.indices.length,
      scale: STEP,
    });
    parts.push(bytes);
    at += bytes.byteLength;
  }
  for (const m of o.modifiers ?? []) manifest.modifiers.push(m);
  if (o.targets?.length && o.detail !== false)
    spec.detail = {
      targets: o.targets.map((t) => t.name),
      surfaceKey: o.surfaceKey ?? "",
      ...(o.scale && { scale: o.scale }),
      ...(o.gates && { gates: o.gates }),
    };
  return { manifest, targets: concat(base.targets, parts) };
}

/** Triangles of a surface as sorted vertex-position keys, the degenerate ones counted apart. */
export function surfaceTriangles(
  index: Uint32Array,
  positions: Float32Array,
): { real: string[]; degenerate: number; largestDegenerate: number } {
  const key = (r: number) =>
    [0, 1, 2].map((k) => (positions[r * 3 + k] as number).toFixed(7)).join(",");
  const area = (a: number, b: number, c: number) => {
    const ux = (positions[b * 3] as number) - (positions[a * 3] as number);
    const uy = (positions[b * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const uz = (positions[b * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const vx = (positions[c * 3] as number) - (positions[a * 3] as number);
    const vy = (positions[c * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const vz = (positions[c * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  };
  const real: string[] = [];
  let degenerate = 0;
  let largestDegenerate = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => index[t + k] as number) as [number, number, number];
    const m = area(a, b, c);
    if (m > 1e-12) real.push([key(a), key(b), key(c)].sort().join("|"));
    else {
      degenerate++;
      largestDegenerate = Math.max(largestDegenerate, m);
    }
  }
  return { real: real.sort(), degenerate, largestDegenerate };
}
