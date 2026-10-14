/** Internal, posed-surface attached-fluid transport. No renderer or mesh authoring. */
import { type FluidState, FluidStateError, type FluidSurfaceAnchor } from "./state.ts";

export interface PosedSurfaceFrame {
  topology: string;
  bodySha256: string;
  surface: "base" | "adult";
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
}

export interface AttachedFluidCell {
  triangle: number;
  barycentric: readonly [number, number, number];
  materialId: string;
  massKg: number;
}

export interface AttachedFieldOptions {
  maxCells: number;
  /** CHOICE: fraction per second eligible to move toward the downhill neighbour. */
  mobilityPerSecond: number;
  gravity: readonly [number, number, number];
}

const finitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0)
    throw new FluidStateError(`${label} must be finite and > 0`);
};
const finiteNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0)
    throw new FluidStateError(`${label} must be finite and >= 0`);
};
const keyOf = (triangle: number, materialId: string) => `${triangle}\u0000${materialId}`;

function assertFrame(frame: PosedSurfaceFrame, state: FluidState): void {
  if (frame.topology !== state.topology.topology || frame.bodySha256 !== state.topology.bodySha256)
    throw new FluidStateError("posed fluid frame does not match this figure topology");
  if (frame.index.length !== state.topology.triangleCount * 3)
    throw new FluidStateError("posed fluid frame triangle count does not match fluid state");
  if (frame.positions.length % 3 !== 0 || frame.positions.length !== frame.normals.length)
    throw new FluidStateError(
      "posed fluid frame positions and normals must be matching xyz arrays",
    );
  const vertices = frame.positions.length / 3;
  for (const value of frame.positions)
    if (!Number.isFinite(value)) throw new FluidStateError("posed fluid positions must be finite");
  for (const value of frame.normals)
    if (!Number.isFinite(value)) throw new FluidStateError("posed fluid normals must be finite");
  for (const vertex of frame.index)
    if (!Number.isSafeInteger(vertex) || vertex >= vertices)
      throw new FluidStateError("posed fluid frame index is outside its vertices");
}

function triangleCentre(frame: PosedSurfaceFrame, triangle: number): [number, number, number] {
  const at = triangle * 3;
  const vertices = [frame.index[at], frame.index[at + 1], frame.index[at + 2]] as const;
  return [0, 1, 2].map(
    (axis) =>
      ((frame.positions[(vertices[0] as number) * 3 + axis] as number) +
        (frame.positions[(vertices[1] as number) * 3 + axis] as number) +
        (frame.positions[(vertices[2] as number) * 3 + axis] as number)) /
      3,
  ) as [number, number, number];
}

function neighbours(index: Uint32Array): readonly number[][] {
  const out = Array.from({ length: index.length / 3 }, () => new Set<number>());
  const edges = new Map<string, number>();
  for (let triangle = 0; triangle < out.length; triangle++) {
    const at = triangle * 3;
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const x = index[at + a] as number;
      const y = index[at + b] as number;
      const edge = x < y ? `${x}:${y}` : `${y}:${x}`;
      const previous = edges.get(edge);
      if (previous === undefined) edges.set(edge, triangle);
      else {
        out[triangle]?.add(previous);
        out[previous]?.add(triangle);
      }
    }
  }
  return out.map((set) => [...set].sort((a, b) => a - b));
}

function sameAnchor(a: FluidSurfaceAnchor, b: FluidSurfaceAnchor): boolean {
  return (
    a.topology === b.topology &&
    a.bodySha256 === b.bodySha256 &&
    a.triangle === b.triangle &&
    a.barycentric.every((weight, index) => weight === b.barycentric[index])
  );
}
function mergeCell(
  cell: AttachedFluidCell,
  barycentric: readonly [number, number, number],
  addedKg: number,
): AttachedFluidCell {
  const total = cell.massKg + addedKg;
  return {
    ...cell,
    massKg: total,
    barycentric: cell.barycentric.map(
      (weight, index) => (weight * cell.massKg + (barycentric[index] as number) * addedKg) / total,
    ) as [number, number, number],
  };
}

/** A sparse field whose mass is accounted for by its supplied FluidState only. */
export class AttachedFluidField {
  private readonly cells = new Map<string, AttachedFluidCell>();
  private readonly adjacent: readonly number[][];
  private readonly state: FluidState;
  private readonly options: AttachedFieldOptions;
  private readonly index: Uint32Array;
  private readonly surface: PosedSurfaceFrame["surface"];
  private readonly vertexCount: number;

  constructor(state: FluidState, posedFrame: PosedSurfaceFrame, options: AttachedFieldOptions) {
    assertFrame(posedFrame, state);
    if (!Number.isSafeInteger(options.maxCells) || options.maxCells < 1)
      throw new FluidStateError("maxCells must be a positive safe integer");
    finiteNonNegative(options.mobilityPerSecond, "mobilityPerSecond");
    if (options.gravity.length !== 3 || options.gravity.some((value) => !Number.isFinite(value)))
      throw new FluidStateError("gravity must have three finite components");
    if (state.snapshot().ledger.attachedKg !== 0)
      throw new FluidStateError(
        "attached field requires a fluid state with no unplaced attached mass",
      );
    this.state = state;
    this.options = { ...options, gravity: [...options.gravity] as [number, number, number] };
    this.index = Uint32Array.from(posedFrame.index);
    this.surface = posedFrame.surface;
    this.vertexCount = posedFrame.positions.length / 3;
    this.adjacent = neighbours(this.index);
  }

  inject(sourceId: string, anchor: FluidSurfaceAnchor, materialId: string, massKg: number): void {
    this.assertSynchronized();
    finitePositive(massKg, "massKg");
    const registered = this.state.snapshot().sources.find((source) => source.id === sourceId);
    if (registered?.anchor.kind !== "surface")
      throw new FluidStateError(
        `attached field source ${sourceId} is not a registered surface source`,
      );
    if (registered.materialId !== materialId)
      throw new FluidStateError(`attached field material does not match source ${sourceId}`);
    if (!sameAnchor(registered.anchor, anchor))
      throw new FluidStateError(`attached field anchor does not match source ${sourceId}`);
    this.assertAnchor(anchor);
    const key = keyOf(anchor.triangle, materialId);
    if (!this.cells.has(key) && this.cells.size >= this.options.maxCells)
      throw new FluidStateError("attached field capacity would discard incompatible cell identity");
    // The sole ledger mutation occurs only after every field-side rejection is impossible.
    this.state.injectKg(sourceId, massKg);
    const current = this.cells.get(key);
    this.cells.set(
      key,
      current
        ? mergeCell(current, anchor.barycentric, massKg)
        : {
            triangle: anchor.triangle,
            barycentric: [...anchor.barycentric] as [number, number, number],
            materialId,
            massKg,
          },
    );
  }

  step(frame: PosedSurfaceFrame, seconds: number): void {
    this.assertSynchronized();
    this.assertCompatibleFrame(frame);
    finiteNonNegative(seconds, "seconds");
    if (seconds === 0 || this.options.mobilityPerSecond === 0 || this.cells.size === 0) return;
    const input = [...this.cells.values()].map((cell) => structuredClone(cell));
    const deltas = new Map<string, number>();
    const arrivals = new Map<string, AttachedFluidCell>();
    const fraction = Math.min(1, this.options.mobilityPerSecond * seconds);
    for (const cell of input.sort(
      (a, b) => a.triangle - b.triangle || a.materialId.localeCompare(b.materialId),
    )) {
      const target = this.downhillNeighbour(frame, cell.triangle);
      if (target === undefined) continue;
      const transfer = cell.massKg * fraction;
      if (transfer === 0) continue;
      const from = keyOf(cell.triangle, cell.materialId);
      const to = keyOf(target, cell.materialId);
      deltas.set(from, (deltas.get(from) ?? 0) - transfer);
      deltas.set(to, (deltas.get(to) ?? 0) + transfer);
      if (!this.cells.has(to))
        arrivals.set(to, {
          triangle: target,
          barycentric: [1 / 3, 1 / 3, 1 / 3],
          materialId: cell.materialId,
          massKg: 0,
        });
    }
    if (this.cells.size + arrivals.size > this.options.maxCells)
      throw new FluidStateError("attached field capacity would discard incompatible cell identity");
    const next = new Map<string, AttachedFluidCell>();
    for (const cell of input) {
      const key = keyOf(cell.triangle, cell.materialId);
      const massKg = cell.massKg + (deltas.get(key) ?? 0);
      if (massKg < 0 || !Number.isFinite(massKg))
        throw new FluidStateError("attached field transport produced invalid mass");
      if (massKg > 0) next.set(key, { ...cell, massKg });
    }
    for (const [key, cell] of arrivals) next.set(key, { ...cell, massKg: deltas.get(key) ?? 0 });
    const total = [...next.values()].reduce((sum, cell) => sum + cell.massKg, 0);
    if (Math.abs(total - this.state.snapshot().ledger.attachedKg) > 1e-12)
      throw new FluidStateError("attached field transport does not conserve mass");
    this.cells.clear();
    for (const [key, cell] of next) this.cells.set(key, cell);
  }

  frame(): readonly AttachedFluidCell[] {
    this.assertSynchronized();
    return [...this.cells.values()]
      .sort((a, b) => a.triangle - b.triangle || a.materialId.localeCompare(b.materialId))
      .map((cell) => structuredClone(cell));
  }

  private assertAnchor(anchor: FluidSurfaceAnchor): void {
    if (
      anchor.topology !== this.state.topology.topology ||
      anchor.bodySha256 !== this.state.topology.bodySha256 ||
      !Number.isSafeInteger(anchor.triangle) ||
      anchor.triangle < 0 ||
      anchor.triangle >= this.adjacent.length ||
      anchor.barycentric.length !== 3 ||
      anchor.barycentric.some((weight) => !Number.isFinite(weight) || weight < 0) ||
      Math.abs(anchor.barycentric[0] + anchor.barycentric[1] + anchor.barycentric[2] - 1) > 1e-9
    )
      throw new FluidStateError("attached field anchor is invalid for this figure topology");
  }

  private assertCompatibleFrame(frame: PosedSurfaceFrame): void {
    assertFrame(frame, this.state);
    if (
      frame.surface !== this.surface ||
      frame.positions.length / 3 !== this.vertexCount ||
      frame.index.length !== this.index.length ||
      frame.index.some((value, index) => value !== this.index[index])
    )
      throw new FluidStateError("posed fluid frame topology differs from attached field topology");
  }

  private downhillNeighbour(frame: PosedSurfaceFrame, triangle: number): number | undefined {
    const centre = triangleCentre(frame, triangle);
    let selected: number | undefined;
    let score = 0;
    for (const candidate of this.adjacent[triangle] ?? []) {
      const other = triangleCentre(frame, candidate);
      const downhill =
        (other[0] - centre[0]) * this.options.gravity[0] +
        (other[1] - centre[1]) * this.options.gravity[1] +
        (other[2] - centre[2]) * this.options.gravity[2];
      if (downhill > score) {
        score = downhill;
        selected = candidate;
      }
    }
    return selected;
  }

  private assertSynchronized(): void {
    const mass = [...this.cells.values()].reduce((total, cell) => total + cell.massKg, 0);
    if (Math.abs(mass - this.state.snapshot().ledger.attachedKg) > 1e-12)
      throw new FluidStateError("attached field mass is not synchronized with fluid ledger");
  }
}
