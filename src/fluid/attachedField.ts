/** Internal, posed-surface attached-fluid transport. No renderer or mesh authoring. */
import {
  FLUID_MASS_EPSILON_KG,
  type FluidState,
  FluidStateError,
  type FluidSurfaceAnchor,
} from "./state.ts";

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

/** An explicit caller-selected amount to release from one attached surface cell. */
export interface FluidDetachmentRequest {
  triangle: number;
  materialId: string;
  /** Conserved mass to transfer to the detached ledger, in kilograms. */
  massKg: number;
}

/** Immutable, posed release data for a later detached-particle adapter. */
export interface DetachedFluidRelease {
  readonly triangle: number;
  readonly sourceVertices: readonly [number, number, number];
  readonly materialId: string;
  /** Conserved released mass, in kilograms. */
  readonly massKg: number;
  /** Posed barycentric release location in model-local metres. */
  readonly positionM: readonly [number, number, number];
  /** Interpolated posed unit normal, dimensionless. */
  readonly normal: readonly [number, number, number];
}

/**
 * One material's occupied posed triangle. `coverage` is triangle support
 * occupancy, not an optical alpha or a guessed film thickness.
 */
export interface FluidCoverageCell {
  readonly triangle: number;
  /** Stable source-frame vertex IDs for `triangle`, in winding order. */
  readonly sourceVertices: readonly [number, number, number];
  readonly materialId: string;
  /** Conserved attached mass, in kilograms. */
  readonly massKg: number;
  /** Posed triangle area occupied by this sparse cell, in square metres. */
  readonly supportAreaM2: number;
  /** `massKg / supportAreaM2`, in kilograms per square metre. */
  readonly arealMassDensityKgPerM2: number;
  /** Unitless triangle support occupancy. A present sparse cell occupies its whole triangle. */
  readonly coverage: 1;
  /** Barycentric cell location in posed model-local metres. */
  readonly positionM: readonly [number, number, number];
  /** Interpolated posed surface normal; dimensionless and zero only for a zero input normal. */
  readonly normal: readonly [number, number, number];
}

/** Material-separated vertex coverage for a renderer's future per-figure field input. */
export interface FluidMaterialCoverage {
  readonly materialId: string;
  /** Conserved attached mass represented by this material, in kilograms. */
  readonly attachedKg: number;
  /** Sum of sparse triangle support areas for this material, in square metres. */
  readonly coveredAreaM2: number;
  /** One unitless support coverage value per posed render vertex. */
  readonly vertexCoverage: readonly number[];
}

/** Immutable renderer-neutral output from an attached field and one posed frame. */
export interface FluidCoverageSnapshot {
  readonly version: 1;
  readonly topology: string;
  readonly bodySha256: string;
  readonly surface: PosedSurfaceFrame["surface"];
  readonly units: Readonly<{
    mass: "kg";
    area: "m2";
    arealMassDensity: "kg/m2";
    position: "m";
  }>;
  /** Conserved total attached mass represented by `cells`, in kilograms. */
  readonly attachedKg: number;
  readonly cells: readonly FluidCoverageCell[];
  readonly materials: readonly FluidMaterialCoverage[];
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

function triangleCoverageGeometry(
  frame: PosedSurfaceFrame,
  cell: AttachedFluidCell,
): Pick<FluidCoverageCell, "positionM" | "normal" | "supportAreaM2"> {
  const at = cell.triangle * 3;
  const vertices = [frame.index[at], frame.index[at + 1], frame.index[at + 2]] as const;
  const point = [0, 1, 2].map((axis) =>
    vertices.reduce<number>(
      (sum, vertex, corner) =>
        sum +
        (frame.positions[(vertex as number) * 3 + axis] as number) *
          (cell.barycentric[corner] as number),
      0,
    ),
  ) as [number, number, number];
  const normal = [0, 1, 2].map((axis) =>
    vertices.reduce<number>(
      (sum, vertex, corner) =>
        sum +
        (frame.normals[(vertex as number) * 3 + axis] as number) *
          (cell.barycentric[corner] as number),
      0,
    ),
  ) as [number, number, number];
  const normalLength = Math.hypot(...normal);
  const unitNormal =
    normalLength === 0
      ? ([0, 0, 0] as [number, number, number])
      : (normal.map((component) => component / normalLength) as [number, number, number]);
  const verticesPosition = vertices.map((vertex) =>
    Array.from(frame.positions.subarray((vertex as number) * 3, (vertex as number) * 3 + 3)),
  ) as [[number, number, number], [number, number, number], [number, number, number]];
  const ab = verticesPosition[1].map(
    (component, axis) => component - (verticesPosition[0][axis] as number),
  );
  const ac = verticesPosition[2].map(
    (component, axis) => component - (verticesPosition[0][axis] as number),
  );
  const supportAreaM2 =
    0.5 *
    Math.hypot(
      (ab[1] as number) * (ac[2] as number) - (ab[2] as number) * (ac[1] as number),
      (ab[2] as number) * (ac[0] as number) - (ab[0] as number) * (ac[2] as number),
      (ab[0] as number) * (ac[1] as number) - (ab[1] as number) * (ac[0] as number),
    );
  if (!(supportAreaM2 > 0) || !Number.isFinite(supportAreaM2))
    throw new FluidStateError("posed fluid coverage triangle must have positive finite area");
  return { positionM: point, normal: unitNormal, supportAreaM2 };
}

const frozenVector = (vector: readonly number[]): readonly [number, number, number] =>
  Object.freeze([...vector]) as readonly [number, number, number];
const frozenNumbers = (values: readonly number[]): readonly number[] => Object.freeze([...values]);

function assertDetachmentRequest(request: FluidDetachmentRequest): void {
  if (!Number.isSafeInteger(request.triangle) || request.triangle < 0)
    throw new FluidStateError("fluid detachment triangle must be a non-negative safe integer");
  if (typeof request.materialId !== "string" || request.materialId.length === 0)
    throw new FluidStateError("fluid detachment materialId must be non-empty");
  finitePositive(request.massKg, "fluid detachment massKg");
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
    if (Math.abs(total - this.state.snapshot().ledger.attachedKg) > FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("attached field transport does not conserve mass");
    this.cells.clear();
    for (const [key, cell] of next) this.cells.set(key, cell);
  }

  /**
   * Transfers caller-selected sparse-cell mass to the detached ledger and
   * returns immutable release anchors from this exact posed frame. A future
   * particle adapter owns motion after this handoff.
   */
  detach(
    frame: PosedSurfaceFrame,
    requests: readonly FluidDetachmentRequest[],
  ): readonly DetachedFluidRelease[] {
    this.assertSynchronized();
    this.assertCompatibleFrame(frame);
    const requested = new Map<string, FluidDetachmentRequest>();
    for (const request of requests) {
      assertDetachmentRequest(request);
      const key = keyOf(request.triangle, request.materialId);
      const current = requested.get(key);
      requested.set(
        key,
        current ? { ...current, massKg: current.massKg + request.massKg } : { ...request },
      );
    }
    if (requested.size === 0) return Object.freeze([]);

    const releases: DetachedFluidRelease[] = [];
    const next = new Map<string, AttachedFluidCell>();
    let detachedKg = 0;
    for (const [key, cell] of this.cells) {
      const request = requested.get(key);
      if (!request) {
        next.set(key, cell);
        continue;
      }
      if (request.massKg > cell.massKg)
        throw new FluidStateError("cannot detach more fluid than triangle/material cell contains");
      const { positionM, normal } = triangleCoverageGeometry(frame, cell);
      const at = cell.triangle * 3;
      const sourceVertices = [
        frame.index[at] as number,
        frame.index[at + 1] as number,
        frame.index[at + 2] as number,
      ] as const;
      releases.push(
        Object.freeze({
          triangle: cell.triangle,
          sourceVertices: Object.freeze([...sourceVertices]) as readonly [number, number, number],
          materialId: cell.materialId,
          massKg: request.massKg,
          positionM: frozenVector(positionM),
          normal: frozenVector(normal),
        }),
      );
      detachedKg += request.massKg;
      const remainingKg = cell.massKg - request.massKg;
      if (remainingKg > 0) next.set(key, { ...cell, massKg: remainingKg });
    }
    if (releases.length !== requested.size)
      throw new FluidStateError("fluid detachment cell is not attached");
    const nextAttachedKg = [...next.values()].reduce((total, cell) => total + cell.massKg, 0);
    const ledger = this.state.snapshot().ledger;
    if (Math.abs(nextAttachedKg - (ledger.attachedKg - detachedKg)) > FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("fluid detachment does not conserve attached mass");
    this.state.detachKg(detachedKg);
    this.cells.clear();
    for (const [key, cell] of next) this.cells.set(key, cell);
    return Object.freeze(
      releases.sort((a, b) => a.triangle - b.triangle || a.materialId.localeCompare(b.materialId)),
    );
  }

  frame(): readonly AttachedFluidCell[] {
    this.assertSynchronized();
    return [...this.cells.values()]
      .sort((a, b) => a.triangle - b.triangle || a.materialId.localeCompare(b.materialId))
      .map((cell) => structuredClone(cell));
  }

  /**
   * A stable, immutable read model for a renderer. It derives every position,
   * normal and support area from this supplied posed frame; it does not choose
   * optics, thickness, or a material response.
   */
  coverageSnapshot(frame: PosedSurfaceFrame): FluidCoverageSnapshot {
    this.assertSynchronized();
    this.assertCompatibleFrame(frame);
    const byMaterial = new Map<
      string,
      { attachedKg: number; coveredAreaM2: number; vertexCoverage: number[] }
    >();
    const cells = this.frame().map((cell) => {
      const { positionM, normal, supportAreaM2 } = triangleCoverageGeometry(frame, cell);
      let material = byMaterial.get(cell.materialId);
      if (!material) {
        material = {
          attachedKg: 0,
          coveredAreaM2: 0,
          vertexCoverage: new Array<number>(this.vertexCount).fill(0),
        };
        byMaterial.set(cell.materialId, material);
      }
      material.attachedKg += cell.massKg;
      material.coveredAreaM2 += supportAreaM2;
      const at = cell.triangle * 3;
      for (let corner = 0; corner < 3; corner++)
        material.vertexCoverage[frame.index[at + corner] as number] = 1;
      const sourceVertices = [
        frame.index[at] as number,
        frame.index[at + 1] as number,
        frame.index[at + 2] as number,
      ] as const;
      return Object.freeze({
        triangle: cell.triangle,
        sourceVertices: Object.freeze([...sourceVertices]) as readonly [number, number, number],
        materialId: cell.materialId,
        massKg: cell.massKg,
        supportAreaM2,
        arealMassDensityKgPerM2: cell.massKg / supportAreaM2,
        coverage: 1 as const,
        positionM: frozenVector(positionM),
        normal: frozenVector(normal),
      });
    });
    const attachedKg = cells.reduce((total, cell) => total + cell.massKg, 0);
    if (Math.abs(attachedKg - this.state.snapshot().ledger.attachedKg) > FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("fluid coverage snapshot does not conserve attached mass");
    const materials = [...byMaterial]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([materialId, material]) =>
        Object.freeze({
          materialId,
          attachedKg: material.attachedKg,
          coveredAreaM2: material.coveredAreaM2,
          vertexCoverage: frozenNumbers(material.vertexCoverage),
        }),
      );
    return Object.freeze({
      version: 1 as const,
      topology: this.state.topology.topology,
      bodySha256: this.state.topology.bodySha256,
      surface: this.surface,
      units: Object.freeze({
        mass: "kg" as const,
        area: "m2" as const,
        arealMassDensity: "kg/m2" as const,
        position: "m" as const,
      }),
      attachedKg,
      cells: Object.freeze(cells),
      materials: Object.freeze(materials),
    });
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
    if (Math.abs(mass - this.state.snapshot().ledger.attachedKg) > FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("attached field mass is not synchronized with fluid ledger");
  }
}
