/** Figures, objects and a tick loop shared by the interaction tests. */
import type {
  createPresenceRegistry,
  FigureMeasures,
  FigurePresence,
  ObjectPresence,
} from "../src/presence/presence.ts";

export const v = (x = 0, y = 0, z = 0): [number, number, number] => [x, y, z];

export const AVERAGE: FigureMeasures = {
  reach: 0.7,
  shoulderHeight: 1.45,
  hipHeight: 0.9,
  eyeHeight: 1.58,
};

/** A figure standing at (x, 0, z), facing +z, with the given measures. */
export const figure = (
  id: string,
  adult: boolean,
  x = 0,
  measures: FigureMeasures = AVERAGE,
  z = 0,
): FigurePresence => ({
  id,
  measures: { ...measures },
  position: v(x, 0, z),
  facing: v(0, 0, 1),
  bounds: { min: v(x - 0.3, 0, z - 0.2), max: v(x + 0.3, 1.7, z + 0.2) },
  anchors: {
    head: v(x, 1.6, z),
    face: v(x, 1.55, z + 0.1),
    chest: v(x, 1.3, z + 0.1),
    leftHand: v(x - 0.3, 1, z),
    rightHand: v(x + 0.3, 1, z),
    leftFoot: v(x - 0.1, 0, z),
    rightFoot: v(x + 0.1, 0, z),
  },
  footprint: { points: [[x, z]], radius: 0.15 },
  appearance: { albedo: v(0.4, 0.3, 0.25), luminance: 0.3, specular: 0.028 },
  faceRadius: 0.1,
  adult,
});

export const apple = (id = "apple"): ObjectPresence => ({
  id,
  kind: "object",
  position: v(0.3, 1),
  rotation: [0, 0, 0, 1],
  bounds: { min: v(0.26, 0.96, -0.04), max: v(0.34, 1.04, 0.04) },
  frames: {},
  tags: ["food.fruit.apple"],
  state: { stage: 0 },
});

/** Ticks at 10 Hz from `from` for `seconds`. */
export function run(
  presence: ReturnType<typeof createPresenceRegistry>,
  from: number,
  seconds: number,
) {
  for (let i = 0; i <= Math.round(seconds * 10); i++) presence.tick(from + i / 10);
}
