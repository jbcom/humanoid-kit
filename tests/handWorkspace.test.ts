import { describe, expect, it } from "vitest";
import { fitGripMeeting, fitGripSlots, gripWorkspaceRadius } from "../src/interaction/contacts.ts";
import { clonePresence, placePresence } from "../src/presence/fromEvaluation.ts";
import {
  createPresenceRegistry,
  type FigurePresence,
  type HandWorkspace,
} from "../src/presence/presence.ts";

const workspace = (x: number): HandWorkspace => ({
  shoulder: [x, 1.4, 0],
  upperLength: 0.32,
  forearmLength: 0.28,
  palmOffset: [0.05, 0, 0.03],
});
const figure = (id: string, x: number): FigurePresence => ({
  id,
  position: [x, 0, 0],
  facing: [0, 0, 1],
  bounds: { min: [x - 0.2, 0, -0.1], max: [x + 0.2, 1.8, 0.1] },
  anchors: {
    head: [x, 1.7, 0],
    face: [x, 1.6, 0],
    chest: [x, 1.3, 0],
    leftHand: [x, 0.8, 0],
    rightHand: [x, 0.8, 0],
    leftFoot: [x, 0, 0],
    rightFoot: [x, 0, 0],
  },
  measures: { reach: 0.65, shoulderHeight: 1.4, hipHeight: 0.9, eyeHeight: 1.6 },
  footprint: { points: [[x, 0]], radius: 0.1 },
  appearance: { albedo: [0.3, 0.2, 0.1], luminance: 0.2, specular: 0.03 },
  faceRadius: 0.1,
  adult: true,
  handWorkspaces: { L: workspace(x + 0.15), R: workspace(x - 0.15) },
});

describe("measured hand workspace planning", () => {
  it("reserves the palm offset for orientation instead of treating it as extra reach", () => {
    const w = workspace(0);
    const straight = w.upperLength + w.forearmLength;
    expect(gripWorkspaceRadius(w)).toBeLessThan(straight - Math.hypot(...w.palmOffset));
    expect(
      gripWorkspaceRadius({ ...w, palmOffset: [0, 0, 0] }) - gripWorkspaceRadius(w),
    ).toBeCloseTo(Math.hypot(...w.palmOffset), 12);
  });
  it("moves and deep-copies side-specific sockets, preserving palm-frame offsets", () => {
    const source = figure("a", 2),
      copy = clonePresence(source);
    const transformed = placePresence(source, { id: "b", position: [5, 2, 3], facing: [1, 0, 0] });
    expect(transformed.handWorkspaces?.R.shoulder).toEqual([5, 3.4, 3.15]);
    expect(transformed.handWorkspaces?.R.palmOffset).toEqual(source.handWorkspaces?.R.palmOffset);
    expect(transformed.handWorkspaces?.R.palmOffset).not.toBe(source.handWorkspaces?.R.palmOffset);
    placePresence(copy, { id: "c", position: [5, 2, 3], facing: [1, 0, 0] }, copy);
    expect(copy.handWorkspaces).toEqual(transformed.handWorkspaces);
    expect(source.handWorkspaces?.R.shoulder).toEqual([1.85, 1.4, 0]);
  });
  it("fits one symmetric target and distinguishes missing metadata from an empty envelope", () => {
    const a = figure("a", -0.3),
      b = figure("b", 0.3),
      out: [number, number, number] = [0, 0, 0];
    expect(fitGripMeeting(a, b, "L", "R", out)).toBe("fitted");
    const reversed: [number, number, number] = [0, 0, 0];
    expect(fitGripMeeting(b, a, "R", "L", reversed)).toBe("fitted");
    for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(reversed[k] as number, 12);
    expect(fitGripMeeting(figure("a", -3), figure("b", 3), "R", "R", out)).toBe(
      "outside-workspace",
    );
    delete a.handWorkspaces;
    expect(fitGripMeeting(a, b, "L", "R", out)).toBe("uncertified");
  });
  it("fits both requested placements together without mutating published geometry", () => {
    const a = figure("a", -3),
      b = figure("b", 3),
      before = structuredClone([a, b]);
    const sa = {
      position: [-0.6, 0, 0] as [number, number, number],
      facing: [1, 0, 0] as [number, number, number],
    };
    const sb = {
      position: [0.6, 0, 0] as [number, number, number],
      facing: [-1, 0, 0] as [number, number, number],
    };
    expect(fitGripSlots(a, b, "R", "R", sa, sb, [0, 0, 0])).toBe(true);
    expect(sa.position[0]).toBeGreaterThan(-0.6);
    expect(sb.position[0]).toBeLessThan(0.6);
    expect([a, b]).toEqual(before);
  });
  it("invalidates publication caches and removes geometry omitted by a later publication", () => {
    const registry = createPresenceRegistry(),
      p = figure("a", 0);
    registry.set(p);
    const first = registry.revision;
    delete p.handWorkspaces;
    registry.set(p);
    expect(registry.revision).toBeGreaterThan(first as number);
    expect(registry.get("a")?.handWorkspaces).toBeUndefined();
    const bad = figure("bad", 0);
    (bad.handWorkspaces?.L as HandWorkspace).upperLength = NaN;
    expect(() => registry.set(bad)).toThrow("finite geometry");
  });
});
