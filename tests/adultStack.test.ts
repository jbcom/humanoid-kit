import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADULT_ANATOMY_SPEC,
  ADULT_SPEC_MODIFIERS,
  ADULT_SPEC_TARGETS,
  adultAnatomySpec,
} from "../scripts/lib/adultAnatomySpec.ts";
import { groupFaces, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  buildLayerFields,
  isAdultLayer,
  paintStopTable,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import {
  ADULT_SKIN_LAYERS,
  SKIN_LAYER_TARGETS,
  SKIN_LAYERS,
} from "../src/surface/regions/index.ts";
import { adultManifest, bodyManifest, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const core = loadFixtureAssets();
const withAdult = loadFixtureAssets(true);
const inUnit = (a: ArrayLike<number>) => Array.from(a).every((x) => x >= 0 && x <= 1);
const adultNames = new Set(adultManifest.targets.entries.map((e) => e.name));
const bodyNames = new Set(bodyManifest.targets.flatMap((f) => f.entries.map((e) => e.name)));
const spec = adultManifest.anatomy;

describe("the adult anatomy spec in the pack's manifest", () => {
  it("is exactly what the packer writes", () => {
    // The core names no adult target or modifier, so the pack's manifest does;
    // the packer writes `adultAnatomySpec(base body)` into it, and this holds the two together.
    expect(spec).toEqual(adultAnatomySpec(core));
    expect(spec).toMatchObject(ADULT_ANATOMY_SPEC);
  });

  it("names only targets and modifiers the adult pack ships, and none of the body pack's", () => {
    expect(ADULT_SPEC_TARGETS.length).toBeGreaterThan(0);
    for (const t of ADULT_SPEC_TARGETS) {
      expect(adultNames.has(t), t).toBe(true);
      expect(bodyNames.has(t), t).toBe(false);
    }
    const modifiers = new Set(adultManifest.modifiers.map((m) => m.id));
    for (const id of ADULT_SPEC_MODIFIERS) expect(modifiers.has(id), id).toBe(true);
  });

  it("describes exactly the core's adult layers, each gated by a feature the spec lists", () => {
    const layers = spec?.skinLayers.map((l) => l.id).sort();
    expect(layers).toEqual(ADULT_SKIN_LAYERS.map((l) => l.id).sort());
    const features = new Set(spec?.features.map((f) => f.id));
    for (const l of ADULT_SKIN_LAYERS)
      expect(features.has(l.adult?.feature ?? ""), l.id).toBe(true);
  });
});

describe("the core names no adult target or modifier", () => {
  // The public build ships the core and no adult pack; `pnpm check:pages` fails
  // if a built site names one. This is the same check on the source, so it
  // fails before a build does.
  const forbidden = [
    ...adultManifest.targets.entries.map((e) => e.name),
    ...adultManifest.modifiers.map((m) => m.id),
  ];
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it("in any source file", () => {
    const src = path.resolve(import.meta.dirname, "../src");
    const files = walk(src).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((f) => {
      const text = fs.readFileSync(f, "utf8");
      return forbidden.filter((s) => text.includes(s)).map((s) => `${path.relative(src, f)}: ${s}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("the adult layers in the stack", () => {
  it("come last, after every body layer, and name no target themselves", () => {
    expect(ADULT_SKIN_LAYERS.length).toBeGreaterThan(0);
    const firstAdult = SKIN_LAYERS.findIndex(isAdultLayer);
    expect(SKIN_LAYERS.slice(firstAdult)).toEqual([...ADULT_SKIN_LAYERS]);
    expect(SKIN_LAYERS.slice(0, firstAdult).some(isAdultLayer)).toBe(false);
    expect(new Set(SKIN_LAYERS.map((l) => l.id)).size).toBe(SKIN_LAYERS.length);
    for (const l of ADULT_SKIN_LAYERS) expect(l.targets, l.id).toEqual([]);
    for (const t of SKIN_LAYER_TARGETS) expect(adultNames.has(t), t).toBe(false);
  });

  it("have zero fields in a body-only build, without needing any adult target", () => {
    const fields = buildLayerFields(core, SKIN_LAYERS);
    const n = core.manifest.vertexCount;
    SKIN_LAYERS.forEach((l, i) => {
      const block = fields.subarray(i * n * 3, (i + 1) * n * 3);
      const any = block.some((x) => x !== 0);
      expect(any, l.id).toBe(!isAdultLayer(l));
    });
    for (const l of ADULT_SKIN_LAYERS) expect(l.available?.(core), l.id).toBe(false);
  });

  it("are unavailable until the pack's targets load, and with a pack that has no spec", () => {
    const pending = parseHumanoidAssets(bodyPackData(), { manifest: adultManifest });
    const { anatomy: _spec, ...bare } = adultManifest;
    const noSpec = parseHumanoidAssets(bodyPackData(), { manifest: bare });
    for (const l of ADULT_SKIN_LAYERS) {
      expect(l.available?.(pending), `${l.id} before its stage`).toBe(false);
      expect(l.available?.(noSpec), `${l.id} without a spec`).toBe(false);
      expect(l.available?.(withAdult), `${l.id} loaded`).toBe(true);
      expect(() => l.fields(noSpec), l.id).toThrow(/has no skin layer/);
    }
    expect(new HumanoidModel(noSpec, { subdivision: 0 }).adultLayerFields()).toBeNull();
  });
});

describe("the adult layers' fields", () => {
  const n = withAdult.manifest.vertexCount;
  const genital = new Set<number>();
  for (const f of groupFaces(withAdult, "helper-genital"))
    for (let k = 0; k < 4; k++) genital.add(withAdult.faceVerts[f * 4 + k] as number);
  const fieldsOf = (id: string) => {
    const layer = SKIN_LAYERS.find((l) => l.id === id);
    if (!layer) throw new Error(id);
    return layer.fields(withAdult);
  };

  it("refuse to measure a target that has not loaded, or a pack that does not describe them", () => {
    const pending = parseHumanoidAssets(bodyPackData(), { manifest: adultManifest });
    for (const l of ADULT_SKIN_LAYERS) {
      expect(() => l.fields(pending), l.id).toThrow(/not loaded/);
      expect(() => l.fields(core), l.id).toThrow(/has no skin layer/);
    }
  });

  it("find the penis on its own footprint, with a coordinate from root (0) to tip (1)", () => {
    const { mask, coord } = fieldsOf("penis-skin");
    const covered = [...mask.keys()].filter((v) => (mask[v] as number) > 0);
    expect(covered.length).toBeGreaterThan(40);
    // The CC0 genital targets deform the base mesh's helper-genital group.
    for (const v of covered) expect(genital.has(v), `vertex ${v}`).toBe(true);
    expect(coord).not.toBeNull();
    const c = coord as Float32Array;
    expect(Math.max(...covered.map((v) => c[v] as number))).toBeCloseTo(1, 5);
    expect(Math.min(...covered.map((v) => c[v] as number))).toBeLessThan(0.3);
    expect(inUnit(c)).toBe(true);
  });

  it("find the testes apart from the penis's tip, and the mound on the body's own skin", () => {
    const penis = fieldsOf("penis-skin").mask;
    const testes = fieldsOf("testes-skin").mask;
    const mound = fieldsOf("mound-skin").mask;
    const hits = (m: Float32Array) => [...m.keys()].filter((v) => (m[v] as number) > 0.5);
    expect(hits(testes).length).toBeGreaterThan(20);
    for (const v of hits(testes)) expect(genital.has(v)).toBe(true);
    // The strongly shaded testes vertices are not the strongly shaded penis tip.
    const tip = new Set(
      hits(penis).filter(
        (v) => ((fieldsOf("penis-skin").coord as Float32Array)[v] as number) > 0.8,
      ),
    );
    expect(hits(testes).filter((v) => tip.has(v))).toEqual([]);
    const body = new Set<number>();
    for (const f of groupFaces(withAdult, "body"))
      for (let k = 0; k < 4; k++) body.add(withAdult.faceVerts[f * 4 + k] as number);
    expect(hits(mound).filter((v) => body.has(v)).length).toBeGreaterThan(10);
  });

  it("keep every value in [0, 1]", () => {
    const all = buildLayerFields(withAdult, ADULT_SKIN_LAYERS);
    expect(all.length).toBe(ADULT_SKIN_LAYERS.length * n * 3);
    expect(inUnit(all)).toBe(true);
  });
});

describe("the model and the adult layers", () => {
  const coreModel = new HumanoidModel(core, { subdivision: 1 });
  const adultModel = new HumanoidModel(withAdult, { subdivision: 1 });

  const blocks = (
    t: { layerFields: Float32Array; layers: string[] },
    vertexCount: number,
  ): Record<string, Float32Array> =>
    Object.fromEntries(
      t.layers.map((id, l) => [
        id,
        t.layerFields.subarray(l * vertexCount * 2, (l + 1) * vertexCount * 2),
      ]),
    );

  it("never put an adult layer's data in the static topology, even with the pack loaded", () => {
    for (const model of [coreModel, adultModel]) {
      const body = model.topology().body;
      expect(body.layers).toEqual(SKIN_LAYERS.map((l) => l.id));
      const b = blocks(body, body.vertexCount);
      for (const l of ADULT_SKIN_LAYERS)
        expect(
          b[l.id]?.every((x) => x === 0),
          l.id,
        ).toBe(true);
      expect(b.areola?.some((x) => x > 0)).toBe(true);
    }
  });

  it("has nothing to post without the adult pack's targets", () => {
    expect(coreModel.adultLayerFields()).toBeNull();
  });

  it("derives the adult layers' render-vertex fields once the pack has loaded", () => {
    const update = adultModel.adultLayerFields();
    expect(update).not.toBeNull();
    const { layers, layerFields } = update as NonNullable<typeof update>;
    expect(layers).toEqual(ADULT_SKIN_LAYERS.map((l) => l.id));
    const vc = adultModel.topology().body.vertexCount;
    expect(layerFields.length).toBe(layers.length * vc * 2);
    const b = blocks({ layers, layerFields }, vc);
    // The mound is on the rendered skin.
    expect(b["mound-skin"]?.some((x) => x > 0.5)).toBe(true);
    expect(inUnit(layerFields)).toBe(true);
  });

  it("documents that the CC0 penis and testes targets reach no rendered skin yet", () => {
    // They deform the helper-genital group, which the render surface (the body
    // group) leaves out; the sculpt phase puts adult geometry on the surface
    // (docs/research/ADULT-SCULPT-PLAN.md). When that lands this test is the
    // one to change, together with the docs that say so.
    const update = adultModel.adultLayerFields();
    const vc = adultModel.topology().body.vertexCount;
    const b = blocks(update as NonNullable<typeof update>, vc);
    expect(b["penis-skin"]?.every((x) => x === 0)).toBe(true);
    expect(b["testes-skin"]?.every((x) => x === 0)).toBe(true);
  });

  it("paints an adult layer only for an adult who applies its anatomy, end to end", () => {
    const tone = { melanin: 0.6, haemoglobin: 0.5, undertone: 0, override: null };
    const base = { tone, flush: 0.4, lips: 0.5, areola: 0.5, signals: {} };
    const row = (table: Float32Array, id: string) =>
      table[SKIN_LAYERS.findIndex((l) => l.id === id) * STOP_TABLE_WIDTH * 4] as number;
    const rest = paintStopTable(SKIN_LAYERS, base);
    const minor = paintStopTable(SKIN_LAYERS, { ...base, adult: false, anatomy: { mound: 1 } });
    const none = paintStopTable(SKIN_LAYERS, { ...base, adult: true, anatomy: {} });
    const shaped = paintStopTable(SKIN_LAYERS, { ...base, adult: true, anatomy: { mound: 1 } });
    expect(row(rest, "mound-skin")).toBe(0);
    expect(row(minor, "mound-skin")).toBe(0);
    expect(row(none, "mound-skin")).toBe(0);
    expect(row(shaped, "mound-skin")).toBeGreaterThan(0);
    // Applying one feature paints no other.
    expect(row(shaped, "penis-skin")).toBe(0);
    expect(row(shaped, "testes-skin")).toBe(0);
  });
});
