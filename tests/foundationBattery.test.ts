/**
 * The figure battery in the core (src/foundation/battery.ts): the file
 * `hk-sheets` reads is the module's, each body's adult flag is the age
 * policy's, and every name the cross set uses exists.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BATTERY_BODIES,
  BATTERY_CROSS,
  BATTERY_TONES,
  batteryJson,
  isAdultBody,
} from "../src/foundation/battery.ts";

const file = path.resolve(import.meta.dirname, "../scripts/sheets/battery.json");

describe("the figure battery", () => {
  it("is what scripts/sheets/battery.json holds, so sheets and tests share one source", () => {
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(batteryJson());
  });

  it("flags as adult exactly the bodies the age policy counts as adults", () => {
    for (const b of BATTERY_BODIES) expect(b.adult, b.name).toBe(isAdultBody(b));
    expect(BATTERY_BODIES.filter((b) => !b.adult).map((b) => b.name)).toEqual(["teen", "child"]);
  });

  it("names each body and tone once, and uses only those in the cross set", () => {
    const bodies = BATTERY_BODIES.map((b) => b.name);
    const tones = BATTERY_TONES.map((t) => t.name);
    expect(new Set(bodies).size).toBe(18);
    expect(new Set(tones).size).toBe(6);
    for (const b of BATTERY_CROSS.bodies) expect(bodies).toContain(b);
    for (const t of BATTERY_CROSS.tones) expect(tones).toContain(t);
  });
});
