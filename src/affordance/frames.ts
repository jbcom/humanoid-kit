/**
 * Affordances framed on a posed body (docs/ARCHITECTURE.md, "Affordances: the
 * registry"): evaluated from that body's landmarks, never stored, so an
 * affordance is never out of step with the skin it belongs to.
 *
 * Each kind's frame means one thing. An aperture's normal points out of the
 * opening (its channel runs the other way); a mount's and a contact's leave the
 * skin; a grip's leaves the gripping surface, its tangent runs along the hand
 * toward the fingers, and its bitangent is the axis of what it closes round.
 */
import { type LandmarkFrame, landmarks, type Vec3 } from "../foundation/landmarks.ts";
import type { PosedBody } from "../foundation/posed.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import type { FigureAffordances } from "./registry.ts";

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** A frame on `normal` whose tangent is `along` made square to it. */
function frame(position: Vec3, normal: Vec3, along: Vec3): LandmarkFrame {
  const n = unit(normal);
  const d = along[0] * n[0] + along[1] * n[1] + along[2] * n[2];
  const t = unit([along[0] - n[0] * d, along[1] - n[1] * d, along[2] - n[2] * d]);
  return { position, normal: n, tangent: t, bitangent: cross(n, t) };
}

/**
 * Each of a figure's own affordances (`affordances(recipe)`) framed on its
 * posed body (`posedSurface`) of this model.
 */
export function affordanceFrames(
  model: HumanoidModel,
  body: PosedBody,
  own: FigureAffordances,
): Readonly<Record<string, LandmarkFrame>> {
  const marks = landmarks(model, body);
  const out: Record<string, LandmarkFrame> = {};
  for (const a of own) {
    if ("between" in a.at) {
      // An opening between two landmarks (the lips) lies across the line from one to the
      // other: the tangent runs along that line, from the second to the first, and the
      // normal is the two skins' facing made square to it.
      const [p, q] = a.at.between.map((id) => marks[id]) as [LandmarkFrame, LandmarkFrame];
      const span: Vec3 = [
        p.position[0] - q.position[0],
        p.position[1] - q.position[1],
        p.position[2] - q.position[2],
      ];
      const t = unit(span);
      const facing: Vec3 = [
        p.normal[0] + q.normal[0],
        p.normal[1] + q.normal[1],
        p.normal[2] + q.normal[2],
      ];
      const d = facing[0] * t[0] + facing[1] * t[1] + facing[2] * t[2];
      const n = unit([facing[0] - t[0] * d, facing[1] - t[1] * d, facing[2] - t[2] * d]);
      out[a.id] = {
        position: [
          (p.position[0] + q.position[0]) / 2,
          (p.position[1] + q.position[1]) / 2,
          (p.position[2] + q.position[2]) / 2,
        ],
        normal: n,
        tangent: t,
        bitangent: cross(n, t),
      };
      continue;
    }
    const at = marks[a.at.landmark];
    if (a.kind === "grip") {
      // Along the hand: from the wrist the palm's landmark sits on toward the fingers.
      const wrist = marks[a.at.landmark.endsWith(".R") ? "wrist.R" : "wrist.L"].position;
      out[a.id] = frame(at.position, at.normal, [
        at.position[0] - wrist[0],
        at.position[1] - wrist[1],
        at.position[2] - wrist[2],
      ]);
      continue;
    }
    out[a.id] = at;
  }
  return out;
}
