import { describe, expect, it } from "vitest";
import { expressionUnits } from "../src/rig/expressions.ts";
import { FACE_SIGNAL_KEYS, faceSignalBasis, faceSignals } from "../src/rig/faceSignals.ts";
import { faceUnitRotations, IDENTITY_POSE, rigData } from "../src/rig/pose.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const rig = rigData(assets);
const basis = faceSignalBasis(rig);
const signalsOf = (units: Record<string, number>) =>
  faceSignals(basis, faceUnitRotations(rig, units));
const names = FACE_SIGNAL_KEYS.map((k) => `face.${k.id}`);

describe("the face signals", () => {
  it("are named face.<key> and use only units the pack has", () => {
    expect(names).toEqual([
      "face.browRaise",
      "face.browFurrow",
      "face.smile",
      "face.squint",
      "face.noseWrinkle",
      "face.nasolabial",
    ]);
    for (const k of FACE_SIGNAL_KEYS)
      for (const u of Object.keys(k.faceUnits))
        expect(bodyManifest.faceUnits.names, `${k.id}: ${u}`).toContain(u);
  });

  it("are all 0 at rest", () => {
    const s = faceSignals(basis, IDENTITY_POSE(rig.bones.length));
    for (const n of names) expect(s[n], n).toBe(0);
  });

  it("read each key's own pose as 1 and the others as nothing", () => {
    for (const k of FACE_SIGNAL_KEYS) {
      const s = signalsOf(k.faceUnits);
      for (const n of names)
        expect(s[n], `${k.id} pose, ${n}`).toBeCloseTo(n === `face.${k.id}` ? 1 : 0, 1);
    }
  });

  it("follow how much of a key is held", () => {
    for (const w of [0.25, 0.5, 0.75]) {
      const s = signalsOf(
        Object.fromEntries(
          Object.entries(expressionUnits("surprise", w)).filter(([u]) => /Brow/.test(u)),
        ),
      );
      expect(s["face.browRaise"], `at ${w}`).toBeCloseTo(w, 1);
    }
  });

  it("read the expressions as what they are", () => {
    const smile = signalsOf(expressionUnits("smile"));
    expect(smile["face.smile"]).toBeGreaterThan(0.6);
    expect(smile["face.squint"]).toBeGreaterThan(0.3);
    expect(smile["face.browFurrow"]).toBeLessThan(0.05);
    expect(signalsOf(expressionUnits("surprise"))["face.browRaise"]).toBeGreaterThan(0.8);
    expect(signalsOf(expressionUnits("anger"))["face.browFurrow"]).toBeGreaterThan(0.8);
    expect(signalsOf(expressionUnits("disgust"))["face.noseWrinkle"]).toBeGreaterThan(0.8);
    expect(signalsOf(expressionUnits("squint"))["face.squint"]).toBeGreaterThan(0.6);
    const blink = signalsOf(expressionUnits("blink"));
    for (const n of names) expect(blink[n], `blink, ${n}`).toBeLessThan(0.15);
  });

  it("stay between 0 and 1 for a pose past the keys", () => {
    const s = signalsOf({ LeftBrowDown: 1, RightBrowDown: 1, JawDrop: 1, NoseWrinkler: 1 });
    for (const n of names) {
      expect(s[n]).toBeGreaterThanOrEqual(0);
      expect(s[n]).toBeLessThanOrEqual(1);
    }
  });
});
