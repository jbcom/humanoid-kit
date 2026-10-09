import { describe, expect, it } from "vitest";
import {
  createPresenceRegistry,
  type FigurePresence,
  faceMetering,
  groundOcclusion,
  type ProximityEvent,
  presenceGroups,
  sampleGroundOcclusion,
} from "../src/presence/presence.ts";

/** A figure standing at (x, z), facing +z, with feet a shoulder-width apart. */
function figure(id: string, x: number, z: number, luminance = 0.2): FigurePresence {
  return {
    id,
    position: [x, 0, z],
    facing: [0, 0, 1],
    bounds: { min: [x - 0.3, 0, z - 0.15], max: [x + 0.3, 1.7, z + 0.15] },
    anchors: {
      head: [x, 1.6, z],
      face: [x, 1.55, z + 0.08],
      chest: [x, 1.3, z],
      leftHand: [x + 0.35, 0.8, z],
      rightHand: [x - 0.35, 0.8, z],
      leftFoot: [x + 0.1, 0.05, z],
      rightFoot: [x - 0.1, 0.05, z],
    },
    footprint: {
      points: [
        [x + 0.1, z],
        [x - 0.1, z],
      ],
      radius: 0.15,
    },
    appearance: { albedo: [luminance, luminance, luminance], luminance, specular: 0.028 },
    faceRadius: 0.11,
    adult: true,
  };
}

describe("the presence registry", () => {
  it("publishes what figures set and measures their velocity between ticks", () => {
    const r = createPresenceRegistry();
    r.set(figure("a", 0, 0));
    r.tick(1);
    expect(r.get("a")?.velocity).toEqual([0, 0, 0]);
    r.set(figure("a", 0.5, 0));
    r.tick(1.5);
    expect(r.get("a")?.velocity).toEqual([1, 0, 0]);
    expect(r.all().map((p) => p.id)).toEqual(["a"]);
    r.remove("a");
    expect(r.all()).toEqual([]);
  });

  it("raises proximity events on enter and leave, with hysteresis, and only for subscribers", () => {
    const r = createPresenceRegistry();
    const events: ProximityEvent[] = [];
    const stop = r.onProximity(1.5, (e) => events.push(e));
    r.set(figure("a", 0, 0));
    r.set(figure("b", 3, 0));
    r.tick(0);
    expect(events).toEqual([]);
    r.set(figure("b", 1.4, 0));
    r.tick(0.1);
    expect(events).toMatchObject([{ type: "enter", ids: ["a", "b"] }]);
    // Just past the radius but inside the hysteresis band: still together.
    r.set(figure("b", 1.6, 0));
    r.tick(0.2);
    expect(events).toHaveLength(1);
    r.set(figure("b", 1.7, 0));
    r.tick(0.3);
    expect(events.at(-1)).toMatchObject({ type: "leave", ids: ["a", "b"] });
    // A removed figure leaves the pairs it was in.
    r.set(figure("b", 1, 0));
    r.tick(0.4);
    r.remove("b");
    r.tick(0.5);
    expect(events.map((e) => e.type)).toEqual(["enter", "leave", "enter", "leave"]);
    stop();
    r.set(figure("c", 0.5, 0));
    r.tick(0.6);
    expect(events).toHaveLength(4);
  });
});

describe("presence helpers", () => {
  it("groups figures by single linkage on the ground", () => {
    const groups = presenceGroups(
      [figure("a", 0, 0), figure("b", 1, 0), figure("c", 2, 0), figure("d", 6, 0)],
      1.2,
    );
    expect(groups.map((g) => g.sort())).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("pools contact shadows with max, so overlapping figures darken the ground once", () => {
    const one = groundOcclusion([figure("a", 0, 0)]);
    const two = groundOcclusion([figure("a", 0, 0), figure("b", 0.05, 0)]);
    const under = (pts: ReturnType<typeof groundOcclusion>) => sampleGroundOcclusion(pts, 0.1, 0);
    expect(under(one)).toBeGreaterThan(0);
    // A second figure on the same spot adds nothing: max, not sum.
    expect(under(two)).toBeCloseTo(under(one), 6);
    // Between two figures walking side by side the shadows meet and fill the gap…
    const pair = groundOcclusion([figure("a", -0.25, 0), figure("b", 0.25, 0)]);
    expect(sampleGroundOcclusion(pair, 0, 0)).toBeGreaterThan(0);
    // …and as they part, the ground between them clears.
    const apart = groundOcclusion([figure("a", -1.5, 0), figure("b", 1.5, 0)]);
    expect(sampleGroundOcclusion(apart, 0, 0)).toBe(0);
    expect(sampleGroundOcclusion(one, 5, 5)).toBe(0);
  });

  it("meters faces by their own zone and names the deepest, never one target for all", () => {
    const viewer = { position: [0, 1.6, 3] as [number, number, number] };
    const faces = faceMetering(
      [figure("fair", -0.5, 0, 0.355), figure("deep", 0.5, 0, 0.05)],
      viewer,
    );
    const byId = Object.fromEntries(faces.faces.map((f) => [f.id, f]));
    expect(byId.fair?.skinZoneEV).toBeCloseTo(Math.log2(0.355 / 0.18), 6);
    expect(byId.deep?.skinZoneEV).toBeCloseTo(Math.log2(0.05 / 0.18), 6);
    expect(faces.deepest).toBe("deep");
    // Nearer faces weigh more.
    const near = faceMetering([figure("near", 0, 2), figure("far", 0, -4)], viewer);
    expect(near.faces[0]?.id).toBe("near");
    expect(near.faces[0]?.weight).toBeGreaterThan(near.faces[1]?.weight as number);
  });
});
