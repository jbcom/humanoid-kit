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
/** Whether a layer's fields are measured from targets (`AdultSkinLayerSpec.masks`), and so wait for them. */
const measured = (id: string) =>
  (adultManifest.anatomy?.skinLayers.find((l) => l.id === id)?.masks.length ?? 0) > 0;

describe("the adult anatomy spec in the pack's manifest", () => {
  it("is exactly what the packer writes", () => {
    // The core names no adult target or modifier, so the pack's manifest does;
    // the packer writes `adultAnatomySpec(base body)` into it, and this holds the two together.
    // Its detail (the generated targets' pin to the refinement) is checked against
    // the generator in moundPack.test.ts; the rest is the packer's spec for this body.
    const { detail: _detail, reservoirs: _reservoirs, ...rest } = spec ?? {};
    expect(rest).toEqual(adultAnatomySpec(core));
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
      // A layer measured from no target (the penis and testes: their skin is on islands) has
      // none to wait for.
      if (measured(l.id)) expect(l.available?.(pending), `${l.id} before its stage`).toBe(false);
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
      if (measured(l.id)) expect(() => l.fields(pending), l.id).toThrow(/not loaded/);
      expect(() => l.fields(core), l.id).toThrow(/has no skin layer/);
    }
  });

  it("measure nothing for the penis and testes on the base body: their skin is on the reservoirs' islands", () => {
    // The CC0 penis targets deform the helper-genital group, which the surface never
    // draws, so the layers are not measured from them (`AdultReservoirSpec.layer`).
    for (const id of ["penis-skin", "testes-skin"]) {
      const { mask, coord } = fieldsOf(id);
      expect(
        mask.every((x) => x === 0),
        id,
      ).toBe(true);
      expect(coord).toBeNull();
    }
    expect(genital.size).toBeGreaterThan(0);
  });

  it("find the mound on the body's own skin", () => {
    const mound = fieldsOf("mound-skin").mask;
    const hits = [...mound.keys()].filter((v) => (mound[v] as number) > 0.5);
    const body = new Set<number>();
    for (const f of groupFaces(withAdult, "body"))
      for (let k = 0; k < 4; k++) body.add(withAdult.faceVerts[f * 4 + k] as number);
    expect(hits.filter((v) => body.has(v)).length).toBeGreaterThan(10);
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

  it("leaves the penis and testes layers empty on the base body's vertices: they live on the islands", () => {
    const update = adultModel.adultLayerFields();
    const vc = adultModel.topology().body.vertexCount;
    const b = blocks(update as NonNullable<typeof update>, vc);
    expect(b["penis-skin"]?.every((x) => x === 0)).toBe(true);
    expect(b["testes-skin"]?.every((x) => x === 0)).toBe(true);
  });

  describe("on the reservoirs' islands", () => {
    const update = adultModel.adultLayerFields();
    const extra = update?.extra;
    const layers = update?.layers ?? [];
    const reservoirs = adultManifest.anatomy?.reservoirs ?? [];
    const count = (extra?.uvs.length ?? 0) / 2;
    const block = (id: string) => {
      const l = layers.indexOf(id);
      return (extra?.layerFields ?? new Float32Array(0)).subarray(
        l * count * 2,
        (l + 1) * count * 2,
      );
    };

    it("carries the triangles of every island, with fields for the layers they colour", () => {
      expect(extra).toBeDefined();
      expect(count).toBeGreaterThan(1000);
      expect(extra?.layerFields.length).toBe(layers.length * count * 2);
      expect(inUnit(extra?.layerFields as Float32Array)).toBe(true);
      expect(inUnit(extra?.uvs as Float32Array)).toBe(true);
      for (const v of extra?.index ?? []) expect(v).toBeLessThan(count);
      expect((extra?.index.length ?? 0) % 3).toBe(0);
    });

    it("has mask 1 on each island vertex of its reservoir's layer and none of any other", () => {
      const masks = new Map(layers.map((id) => [id, [] as number[]]));
      for (const id of layers) {
        const b = block(id);
        for (let v = 0; v < count; v++) (masks.get(id) as number[]).push(b[v * 2] as number);
      }
      for (let v = 0; v < count; v++) {
        const lit = layers.filter((id) => (masks.get(id) as number[])[v] === 1);
        expect(lit, `vertex ${v}`).toHaveLength(1);
        for (const id of layers)
          if (!lit.includes(id)) expect((masks.get(id) as number[])[v]).toBe(0);
      }
      const used = new Set(reservoirs.map((r) => r.layer));
      for (const id of used) expect(layers).toContain(id);
    });

    it("runs the penis layer's coordinate from the loop (0) to the tip (1)", () => {
      const b = block("penis-skin");
      const along: number[] = [];
      for (let v = 0; v < count; v++) if (b[v * 2] === 1) along.push(b[v * 2 + 1] as number);
      expect(Math.min(...along)).toBe(0);
      expect(Math.max(...along)).toBe(1);
      // The wall has a row of vertices for every ring.
      const rings = reservoirs.find((r) => r.id === "phallic")?.rings as number;
      expect(new Set(along.map((x) => Math.round(x * rings))).size).toBe(rings + 1);
    });

    it("keeps every island triangle inside its island and gives the wall real area in UV", () => {
      const uvs = extra?.uvs as Float32Array;
      const index = extra?.index as Uint32Array;
      const area = (a: number, b: number, c: number) =>
        Math.abs(
          ((uvs[b * 2] as number) - (uvs[a * 2] as number)) *
            ((uvs[c * 2 + 1] as number) - (uvs[a * 2 + 1] as number)) -
            ((uvs[c * 2] as number) - (uvs[a * 2] as number)) *
              ((uvs[b * 2 + 1] as number) - (uvs[a * 2 + 1] as number)),
        ) / 2;
      let total = 0;
      for (let t = 0; t < index.length; t += 3)
        total += area(index[t] as number, index[t + 1] as number, index[t + 2] as number);
      // The walls are rectangles and the caps discs of the sizes the spec gives.
      let expected = 0;
      for (const r of reservoirs) {
        const isle = r.island;
        if (!isle) continue;
        expected +=
          Math.abs(isle.along[0] * isle.across[1] - isle.along[1] * isle.across[0]) +
          Math.PI * isle.cap.radius ** 2;
      }
      expect(total).toBeGreaterThan(expected * 0.9);
      expect(total).toBeLessThan(expected * 1.1);
    });

    it("is none without an island: the core pack and a pack with no reservoir islands post no extra", () => {
      expect(coreModel.adultLayerFields()).toBeNull();
    });
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
