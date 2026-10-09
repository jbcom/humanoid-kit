import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AssetFormatError,
  addTargetFiles,
  BODY_TARGET_FILES,
  type BodyManifest,
  gunzip,
  parseHumanoidAssets,
  pendingTargetFiles,
  type TargetFile,
  targetLoadOrder,
} from "../src/format/assetFormat.ts";
import { macroTargetAgeAnchor, macroTargetNames } from "../src/makehuman/macro.ts";
import { SKIN_MASK_TARGETS } from "../src/makehuman/skinMasks.ts";
import {
  adultManifest,
  adultPackData,
  bodyDir,
  bodyManifest,
  bodyPackData,
  bodyTargetFiles,
  readGzipPackFile,
  readPackFile,
} from "./fixtures.ts";

const pack = (manifest: BodyManifest = bodyManifest) => ({ ...bodyPackData(), manifest });
const clone = (): BodyManifest => structuredClone(bodyManifest);
const fileOf = (id: string) => bodyManifest.targets.find((f) => f.id === id) as TargetFile;

describe("parseHumanoidAssets", () => {
  it("parses the shipped body pack", () => {
    const a = parseHumanoidAssets(pack());
    expect(a.positions.length).toBe(bodyManifest.vertexCount * 3);
    expect(a.attachments.size).toBeGreaterThan(0);
  });

  it("decodes every target to ascending in-range indices", () => {
    const a = parseHumanoidAssets(pack());
    expect(a.targetFilesPending.size).toBe(0);
    expect(a.targets.size).toBe(bodyManifest.targets.reduce((n, f) => n + f.entries.length, 0));
    const bad: string[] = [];
    for (const t of a.targets.values()) {
      let ok = t.deltas.length === t.indices.length * 3;
      for (let i = 1; ok && i < t.indices.length; i++)
        ok = (t.indices[i] as number) > (t.indices[i - 1] as number);
      if (!ok || (t.indices.at(-1) ?? 0) >= bodyManifest.vertexCount) bad.push(t.name);
    }
    expect(bad).toEqual([]);
  });

  it("decompresses with the platform's gzip decoder exactly as zlib does", async () => {
    const file = path.join(bodyDir, fileOf("young").file);
    const viaPlatform = new Uint8Array(await gunzip(readPackFile(file)));
    expect(Buffer.from(viaPlatform).equals(Buffer.from(readGzipPackFile(file)))).toBe(true);
  });

  it("rejects a range that runs past the buffer", () => {
    const m = clone();
    m.body.layout.positions.byteLength += 4096 * 1024 * 1024;
    expect(() => parseHumanoidAssets(pack(m))).toThrow(AssetFormatError);
  });

  it("names a buffer range missing from an older pack", () => {
    const m = clone();
    const a = m.attachments.entries[0];
    if (!a) throw new Error("no attachments");
    delete (a.layout as Partial<typeof a.layout>).occlusion;
    expect(() => parseHumanoidAssets(pack(m))).toThrow(
      new AssetFormatError(`attachment ${a.id} occlusion: the pack has no buffer range for it`),
    );
  });

  it("rejects a misaligned range instead of truncating it", () => {
    const m = clone();
    m.body.layout.uvs.byteLength -= 2;
    expect(() => parseHumanoidAssets(pack(m))).toThrow(/misaligned/);
  });

  const young = () => bodyTargetFiles(["young"]).young as ArrayBuffer;
  /** The pack with the young file replaced. */
  const withYoung = (bin: ArrayBuffer, m = bodyManifest) => ({
    ...pack(m),
    targets: { ...bodyTargetFiles(), young: bin },
  });

  it("rejects target indices beyond the base mesh", () => {
    const t = fileOf("young").entries[0];
    if (!t) throw new Error("no targets");
    // One index delta of 65000 into an otherwise blank targets file.
    const corrupt = new Uint8Array(young().byteLength);
    new DataView(corrupt.buffer).setUint16(t.offset, 65000, true);
    expect(() => parseHumanoidAssets(withYoung(corrupt.buffer))).toThrow(/out of range/);
  });

  it("rejects index deltas that run past 65535", () => {
    const t = fileOf("young").entries.find((e) => e.count >= 2);
    if (!t) throw new Error("no multi-vertex target");
    const corrupt = new Uint8Array(young().byteLength);
    const view = new DataView(corrupt.buffer);
    view.setUint16(t.offset, 60000, true);
    view.setUint16(t.offset + 2, 60000, true);
    expect(() => parseHumanoidAssets(withYoung(corrupt.buffer))).toThrow(/65535/);
  });

  it("rejects a truncated targets file, an unknown encoding and a missing core", () => {
    const full = young();
    expect(() => parseHumanoidAssets(withYoung(full.slice(0, full.byteLength - 8)))).toThrow(
      /exceeds/,
    );
    const m = clone();
    (m.targets[0] as { encoding: string }).encoding = "raw";
    expect(() => parseHumanoidAssets(pack(m))).toThrow(/unsupported target encoding/);
    const { core: _, ...noCore } = bodyTargetFiles();
    expect(() => parseHumanoidAssets({ ...pack(), targets: noCore })).toThrow(/core targets/);
  });

  it("rejects attachment face indices beyond the attachment", () => {
    const m = clone();
    const a = m.attachments.entries[0];
    if (!a) throw new Error("no attachments");
    a.vertexCount = 3; // faces now index past the declared vertex count
    expect(() => parseHumanoidAssets(pack(m))).toThrow(AssetFormatError);
  });

  it("rejects a slider that drives nothing in the loaded packs", () => {
    const m = clone();
    const s = m.sliders[0]?.groups[0]?.sliders[0];
    if (!s) throw new Error("no sliders");
    s.id = "not-a-macro";
    expect(() => parseHumanoidAssets(pack(m))).toThrow(/drives nothing/);
    // An adult slider merged without its modifier, e.g. from a mismatched manifest.
    const adult = structuredClone(adultManifest);
    adult.modifiers = [];
    expect(() => parseHumanoidAssets(pack(), { ...adultPackData(), manifest: adult })).toThrow(
      /drives nothing/,
    );
  });

  it("refuses an adult anatomy pack built for another body", () => {
    const other = { ...adultManifest, bodySha256: "0".repeat(64) };
    expect(() =>
      parseHumanoidAssets(pack(), { manifest: other, targets: new ArrayBuffer(0) }),
    ).toThrow(/different body pack/);
  });
});

describe("the target files", () => {
  const names = (id: string) => new Set(fileOf(id).entries.map((e) => e.name));
  const modifierTargets = new Set(
    bodyManifest.modifiers.flatMap((m) => (m.lo ? [m.lo, m.hi] : [m.hi])),
  );
  const macros = macroTargetNames();

  it("are the core, one per age anchor and the modifiers, in that order", () => {
    expect(bodyManifest.targets.map((f) => f.id)).toEqual([...BODY_TARGET_FILES]);
  });

  it("pack every driven target exactly once and nothing that no control drives", () => {
    const all = bodyManifest.targets.flatMap((f) => f.entries.map((e) => e.name));
    expect(all.length).toBe(new Set(all).size);
    const packed = new Set(all);
    const driven = new Set([...macros, ...modifierTargets]);
    expect([...driven].filter((n) => !packed.has(n))).toEqual([]);
    expect([...packed].filter((n) => !driven.has(n))).toEqual([]);
  });

  it("put each macro target with its age anchor, and only what needs no anchor in the core", () => {
    for (const id of ["baby", "child", "young", "old"] as const)
      for (const n of names(id)) {
        expect(macros.has(n), n).toBe(true);
        expect(macroTargetAgeAnchor(n), n).toBe(id);
      }
    for (const n of names("core"))
      expect(SKIN_MASK_TARGETS.includes(n) || (macros.has(n) && !macroTargetAgeAnchor(n)), n).toBe(
        true,
      );
    expect(SKIN_MASK_TARGETS.filter((n) => !names("core").has(n))).toEqual([]);
    for (const n of names("modifiers")) expect(modifierTargets.has(n), n).toBe(true);
  });

  it("parse a figure from the core and its anchor, taking the rest as it arrives", () => {
    const { targets: adultTargets, ...adultFirstStage } = adultPackData();
    const a = parseHumanoidAssets(bodyPackData(["core", "young"]), adultFirstStage);
    expect([...a.targetFilesPending].sort()).toEqual(
      ["adult", "baby", "child", "modifiers", "old"].sort(),
    );
    expect(a.targets.size).toBe(names("core").size + names("young").size);
    // The controls are all known up front, so the editor can show them at once.
    expect(a.modifiers.size).toBe(bodyManifest.modifiers.length + adultManifest.modifiers.length);
    addTargetFiles(a, bodyTargetFiles(["old"]));
    expect(a.targetFilesPending.has("old")).toBe(false);
    addTargetFiles(a, { ...bodyTargetFiles(["baby", "child", "modifiers"]), adult: adultTargets });
    expect(a.targetFilesPending.size).toBe(0);
    expect(() => addTargetFiles(a, bodyTargetFiles(["old"]))).toThrow(/already loaded/);
  });

  it("refuse a file that no loaded pack has", () => {
    const a = parseHumanoidAssets(bodyPackData(["core"]));
    expect(() => addTargetFiles(a, { adult: adultPackData().targets as ArrayBuffer })).toThrow(
      /no target file adult/,
    );
    expect(() => addTargetFiles(a, { elderly: new ArrayBuffer(0) })).toThrow(/no target file/);
  });

  it("report which files a list of targets still needs", () => {
    const a = parseHumanoidAssets(bodyPackData(["core", "young"]));
    const someOld = [...names("old")][0] as string;
    const someYoung = [...names("young")][0] as string;
    expect([...pendingTargetFiles(a, [someOld, someYoung, "no/such-target"])].sort()).toEqual(
      ["", "old"].sort(),
    );
  });

  it("validate late targets as strictly as the first, and leave the assets as they were on failure", () => {
    const a = parseHumanoidAssets(bodyPackData(["core", "young"]));
    const old = bodyTargetFiles(["old"]).old as ArrayBuffer;
    expect(() => addTargetFiles(a, { old: old.slice(0, old.byteLength - 8) })).toThrow(/exceeds/);
    expect(a.targetFilesPending.has("old")).toBe(true);
    expect(a.targets.size).toBe(names("core").size + names("young").size);
  });
});

describe("targetLoadOrder", () => {
  it("brings the first figure's anchors, then the modifiers, then the other anchors nearest first", () => {
    expect(targetLoadOrder(25)).toEqual([
      ["core", "young"],
      ["modifiers"],
      ["child"],
      ["old"],
      ["baby"],
      ["adult"],
    ]);
    expect(targetLoadOrder(60)).toEqual([
      ["core", "young", "old"],
      ["modifiers"],
      ["child"],
      ["baby"],
      ["adult"],
    ]);
    expect(targetLoadOrder(5)[0]).toEqual(["core", "baby", "child"]);
  });
});
