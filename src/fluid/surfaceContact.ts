/** Explicit paired-surface contact evidence. It neither searches for contacts nor solves a pose. */
import type { PosedSurfaceFrame } from "./attachedField.ts";
import { fluidAnchorPoint } from "./posedSurfaceFrame.ts";
import { type FluidState, FluidStateError, type FluidSurfaceAnchor } from "./state.ts";

export interface FluidContactEndpoint {
  readonly state: FluidState;
  /** Caller-completed posed surface, including any contact solve. Never recomputed here. */
  readonly frame: PosedSurfaceFrame;
  readonly poseId: string;
  readonly generation: object;
  /** Column-major affine placement, including the renderer's ground lift. */
  readonly figureToWorld: readonly number[];
  readonly anchor: FluidSurfaceAnchor;
}

export interface FluidSurfaceContact {
  readonly id: string;
  readonly source: FluidContactEndpoint;
  readonly receiver: FluidContactEndpoint;
  /** Caller-authored contact tolerance in world metres. No default or inferred proximity. */
  readonly maxGapM: number;
  readonly gapM: number;
  readonly sourceWorldM: readonly [number, number, number];
  readonly receiverWorldM: readonly [number, number, number];
}

const resolved = new WeakSet<FluidSurfaceContact>();

function endpointPoint(endpoint: FluidContactEndpoint): [number, number, number] {
  if (endpoint.anchor.kind !== "surface")
    throw new FluidStateError("fluid contact requires explicit surface anchors");
  if (
    typeof endpoint.poseId !== "string" ||
    !endpoint.poseId.trim() ||
    typeof endpoint.generation !== "object" ||
    endpoint.generation === null
  )
    throw new FluidStateError("fluid contact requires completed pose identity");
  if (
    endpoint.frame.topology !== endpoint.state.topology.topology ||
    endpoint.frame.bodySha256 !== endpoint.state.topology.bodySha256 ||
    endpoint.frame.index.length !== endpoint.state.topology.triangleCount * 3
  )
    throw new FluidStateError("fluid contact endpoint does not match its figure topology");
  const m = endpoint.figureToWorld;
  if (
    m.length !== 16 ||
    m.some((value) => !Number.isFinite(value)) ||
    m[3] !== 0 ||
    m[7] !== 0 ||
    m[11] !== 0 ||
    m[15] !== 1
  )
    throw new FluidStateError("fluid contact placement must be a finite affine matrix");
  const determinant =
    (m[0] as number) *
      ((m[5] as number) * (m[10] as number) - (m[9] as number) * (m[6] as number)) -
    (m[4] as number) *
      ((m[1] as number) * (m[10] as number) - (m[9] as number) * (m[2] as number)) +
    (m[8] as number) * ((m[1] as number) * (m[6] as number) - (m[5] as number) * (m[2] as number));
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new FluidStateError("fluid contact placement must be invertible");
  const p = fluidAnchorPoint(endpoint.frame, endpoint.anchor);
  const point = [0, 1, 2].map(
    (axis) =>
      (m[axis] as number) * p[0] +
      (m[4 + axis] as number) * p[1] +
      (m[8 + axis] as number) * p[2] +
      (m[12 + axis] as number),
  ) as [number, number, number];
  if (point.some((value) => !Number.isFinite(value)))
    throw new FluidStateError("fluid contact point must be finite");
  return point;
}

function copyEndpoint(endpoint: FluidContactEndpoint): FluidContactEndpoint {
  return Object.freeze({
    ...endpoint,
    figureToWorld: Object.freeze([...endpoint.figureToWorld]),
    anchor: Object.freeze({
      ...endpoint.anchor,
      barycentric: Object.freeze([...endpoint.anchor.barycentric]) as readonly [
        number,
        number,
        number,
      ],
    }),
  });
}

/** Verifies the two expressly selected surface anchors on the caller's completed poses. */
export function resolveFluidSurfaceContact(
  input: Omit<FluidSurfaceContact, "gapM" | "sourceWorldM" | "receiverWorldM">,
): FluidSurfaceContact {
  if (typeof input.id !== "string" || !input.id.trim())
    throw new FluidStateError("fluid contact id must be non-empty");
  if (!Number.isFinite(input.maxGapM) || input.maxGapM < 0)
    throw new FluidStateError("fluid contact maxGapM must be explicit, finite and non-negative");
  if (
    input.source.state === input.receiver.state ||
    input.source.state.figureId === input.receiver.state.figureId
  )
    throw new FluidStateError("fluid contact requires two distinct figure states");
  const source = copyEndpoint(input.source);
  const receiver = copyEndpoint(input.receiver);
  const sourceWorldM = endpointPoint(source);
  const receiverWorldM = endpointPoint(receiver);
  const gapM = Math.hypot(
    ...sourceWorldM.map((value, axis) => value - (receiverWorldM[axis] as number)),
  );
  if (!Number.isFinite(gapM) || gapM > input.maxGapM)
    throw new FluidStateError(
      "selected fluid surface anchors are outside caller contact tolerance",
    );
  const contact = Object.freeze({
    id: input.id,
    source,
    receiver,
    maxGapM: input.maxGapM,
    gapM,
    sourceWorldM: Object.freeze(sourceWorldM),
    receiverWorldM: Object.freeze(receiverWorldM),
  });
  resolved.add(contact);
  return contact;
}

/** Rejects forged evidence and any selected point changed since contact resolution. */
export function assertFluidSurfaceContact(
  contact: FluidSurfaceContact,
  source: FluidState,
  receiver: FluidState,
): void {
  if (
    !resolved.has(contact) ||
    contact.source.state !== source ||
    contact.receiver.state !== receiver
  )
    throw new FluidStateError("fluid contact does not belong to this source/receiver pair");
  for (const [endpoint, original] of [
    [contact.source, contact.sourceWorldM],
    [contact.receiver, contact.receiverWorldM],
  ] as const)
    if (endpointPoint(endpoint).some((value, axis) => value !== original[axis]))
      throw new FluidStateError(
        "fluid contact selected surface point changed after pose completion",
      );
}
