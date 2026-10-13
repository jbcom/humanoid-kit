/**
 * A bounding volume hierarchy over an indexed triangle mesh that leaves the caller's index as it
 * was and answers in the caller's triangle order.
 *
 * `three-mesh-bvh` builds in place by default: it sorts the triangles of the index it is given
 * into its leaves, so after the build triangle `i` of that array is no longer the caller's
 * triangle `i`. Code that reads a hit's `faceIndex` against its own per-triangle data (a card's
 * quad and half, a face normal, a corner's weight) then reads the wrong triangle, and an array
 * shared between several BVHs (the model's body triangles, which the hair packer's head frame,
 * body surface, bindings and fields all build over) is reordered under every BVH already built on
 * it, which then searches stale leaves. Built indirect, the BVH keeps its own order in a separate
 * buffer and resolves every query (`raycast`, `shapecast`, `closestPointToPoint`) back to the
 * caller's triangle index.
 */
import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH } from "three-mesh-bvh";

/** A BVH over `index` (three vertex indices per triangle into `positions`) that never reorders it. */
export function meshBvh(positions: Float32Array, index: Uint32Array): MeshBVH {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return new MeshBVH(geometry, { indirect: true, verbose: false });
}
