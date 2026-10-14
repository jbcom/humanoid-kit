/** Independent geometry expectations for posed-fluid transport tests. */
import type { PosedSurfaceFrame } from "../src/fluid/attachedField.ts";

export function edgeNeighbours(index: Uint32Array): number[][] {
  const edges = new Map<string, number[]>();
  const neighbours = Array.from({ length: index.length / 3 }, () => [] as number[]);
  for (let triangle = 0; triangle < neighbours.length; triangle++) {
    const vertices = Array.from(index.subarray(triangle * 3, triangle * 3 + 3));
    for (let corner = 0; corner < 3; corner++) {
      const a = vertices[corner] as number;
      const b = vertices[(corner + 1) % 3] as number;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const joined = edges.get(key) ?? [];
      for (const other of joined) {
        neighbours[triangle]?.push(other);
        neighbours[other]?.push(triangle);
      }
      joined.push(triangle);
      edges.set(key, joined);
    }
  }
  return neighbours.map((joined) => [...new Set(joined)].sort((a, b) => a - b));
}

export function centreHeight(frame: PosedSurfaceFrame, triangle: number): number {
  let height = 0;
  for (let corner = 0; corner < 3; corner++) {
    const vertex = frame.index[triangle * 3 + corner] as number;
    height += frame.positions[vertex * 3 + 1] as number;
  }
  return height / 3;
}

/** Lowest shared-edge neighbour strictly below this triangle under world-down gravity. */
export function lowestNeighbour(
  frame: PosedSurfaceFrame,
  neighbours: readonly number[][],
  triangle: number,
): number | undefined {
  let height = centreHeight(frame, triangle);
  let result: number | undefined;
  for (const neighbour of neighbours[triangle] ?? []) {
    const candidateHeight = centreHeight(frame, neighbour);
    if (candidateHeight < height) {
      height = candidateHeight;
      result = neighbour;
    }
  }
  return result;
}
