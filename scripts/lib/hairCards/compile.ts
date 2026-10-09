/**
 * Authored cards as a compiled asset: the same record `compileAsset` makes of a MakeHuman style,
 * so the packer, the worker and the renderer treat them alike. The cards are bound to the base
 * mesh (`bindToBody`) and scaled by the head's own proportions, so a style made for the default
 * head fits a wide or a long one as a MakeHuman style does.
 */
import type { CompiledAsset } from "../compileAsset.ts";
import { type BodyMesh, bindToBody } from "./bind.ts";
import type { Cards } from "./ropes.ts";

/** Layer at which hair is drawn behind or over other attachments (what MakeHuman's own hair uses). */
const Z_DEPTH = 50;

/** The base vertices whose distances the offsets scale by: the head's extremes on each axis. */
function scaleReferences(
  rest: BodyMesh & { head: Uint8Array },
): NonNullable<CompiledAsset["scale"]> {
  const extreme = (axis: number) => {
    let lo = -1;
    let hi = -1;
    for (let v = 0; v < rest.head.length; v++) {
      if (!rest.head[v]) continue;
      const x = rest.positions[v * 3 + axis] as number;
      if (lo < 0 || x < (rest.positions[lo * 3 + axis] as number)) lo = v;
      if (hi < 0 || x > (rest.positions[hi * 3 + axis] as number)) hi = v;
    }
    const d = Math.abs(
      (rest.positions[hi * 3 + axis] as number) - (rest.positions[lo * 3 + axis] as number),
    );
    return [lo, hi, d] as [number, number, number];
  };
  return { x: extreme(0), y: extreme(1), z: extreme(2) };
}

export function compileAuthored(
  id: string,
  name: string,
  cards: Cards,
  rest: BodyMesh & { head: Uint8Array },
  texture: string,
  provenance: string,
): CompiledAsset {
  const binding = bindToBody(Float32Array.from(cards.positions), rest);
  const scale = scaleReferences(rest);
  // With a scale, `evaluateBinding` multiplies the offsets by (current / reference) head extent
  // per axis: at rest that is 1, so the offsets are as measured and a bigger head grows them.
  return {
    id,
    kind: "hair",
    name,
    zDepth: Z_DEPTH,
    vertexCount: cards.positions.length / 3,
    faceCount: cards.faceVerts.length / 4,
    scale,
    material: {
      color: [1, 1, 1],
      roughness: 0.5,
      texture,
      transparent: true,
      alphaToCoverage: true,
      backfaceCull: false,
    },
    arrays: {
      refVerts: binding.refVerts,
      weights: binding.weights,
      offsets: binding.offsets,
      faceVerts: Uint32Array.from(cards.faceVerts),
      faceUvs: Uint32Array.from(cards.faceUvs),
      uvs: Float32Array.from(cards.uvs),
      deleteVerts: new Uint32Array(0),
    },
    evidence: { [id]: provenance },
    textures: new Map(),
  };
}
