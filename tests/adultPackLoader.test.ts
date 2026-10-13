/**
 * Every path the adult pack's content can reach a figure by is gated at load:
 * the loader does not trust a pack's own flags (docs/AGE-POLICY.md, "The adult
 * pack refuses any figure under 18"). Each test names the route it closes, and
 * the shipped pack passes them all.
 */
import { describe, expect, it } from "vitest";
import { AssetFormatError, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import {
  addCustomTargets,
  CustomTargetError,
  customTargetId,
  customTargetOf,
} from "../src/makehuman/customTargets.ts";
import { ADULT_ONLY_MODIFIER, ADULT_ONLY_SIGNALS } from "../src/recipe/agePolicy.ts";
import { adultManifest, adultPackData, bodyManifest, bodyPackData } from "./fixtures.ts";

const parse = (adult = adultManifest, body = bodyManifest) =>
  parseHumanoidAssets(
    { ...bodyPackData(), manifest: body },
    { ...adultPackData(), manifest: adult },
  );

/** The adult manifest with its anatomy defaults dropped, so only the check under test can fire. */
const without = (): typeof adultManifest => {
  const m = structuredClone(adultManifest);
  if (m.anatomy) delete m.anatomy.defaults;
  return m;
};

describe("the shipped adult pack", () => {
  it("passes every load check, and every one of its modifiers is adult-only by flag and by id", () => {
    expect(() => parse()).not.toThrow();
    for (const m of adultManifest.modifiers) {
      expect(m.adultOnly).toBe(true);
      expect(ADULT_ONLY_MODIFIER(m.id)).toBe(true);
    }
  });
});

describe("an adult pack modifier", () => {
  it("is refused when it does not say it is adult-only", () => {
    const m = without();
    (m.modifiers[0] as { adultOnly: boolean }).adultOnly = false;
    expect(() => parse(m)).toThrow(AssetFormatError);
    expect(() => parse(m)).toThrow(/adult-only/);
  });

  it("is refused when the core's id rule would not gate it, so withAge could not strip it", () => {
    const m = without();
    const first = m.modifiers[0] as { id: string };
    const id = first.id;
    first.id = `face/${id.split("/").slice(1).join("/")}`;
    for (const t of m.sliders)
      for (const g of t.groups) for (const s of g.sliders) if (s.id === id) s.id = first.id;
    expect(() => parse(m)).toThrow(/adult-only/);
  });

  it("is refused when it takes the id of a body modifier", () => {
    const m = without();
    const body = bodyManifest.modifiers[0] as { id: string };
    (m.modifiers[0] as { id: string }).id = body.id;
    expect(() => parse(m)).toThrow(/body pack/);
  });

  it("is refused in the custom group, whose modifiers a custom target replaces", () => {
    const m = without();
    const first = m.modifiers[0] as { id: string; group: string };
    first.group = "custom";
    expect(() => parse(m)).toThrow(/custom/);
  });
});

describe("a body pack modifier", () => {
  it("is refused when it drives a target of the adult pack's file", () => {
    const adultTarget = adultManifest.targets.entries[0]?.name as string;
    const body = structuredClone(bodyManifest);
    const m = body.modifiers.find((x) => !x.adultOnly && x.hi !== "") as { hi: string };
    m.hi = adultTarget;
    expect(() => parse(adultManifest, body)).toThrow(/adult pack/);
  });
});

describe("an adult pack state morph", () => {
  const withMorph = (signal: string) => {
    const m = without();
    const target = adultManifest.targets.entries[0]?.name as string;
    if (m.anatomy) m.anatomy.stateMorphs = [{ signal, targets: [{ name: target, weight: 0.5 }] }];
    return m;
  };

  it("is refused on a signal a figure under 18 may have", () => {
    for (const signal of ["cold", "heat", "blush", "exertion", "fear"])
      expect(() => parse(withMorph(signal))).toThrow(/adult-only signal/);
  });

  it("is accepted on an adult-only signal", () => {
    for (const signal of ADULT_ONLY_SIGNALS) expect(() => parse(withMorph(signal))).not.toThrow();
  });
});

describe("custom targets", () => {
  const assets = parse();
  const offsets = new Float32Array(assets.manifest.vertexCount * 3);
  offsets[2] = 0.001;

  it("cannot take the id of an adult pack modifier, whatever its group", () => {
    const id = customTargetId("planted");
    // A modifier that reached the table despite the loader's checks (a host's own mutation).
    assets.modifiers.set(id, { id, group: "custom", lo: null, hi: id, adultOnly: true });
    expect(() => addCustomTargets(assets, [customTargetOf("planted", offsets)])).toThrow(
      CustomTargetError,
    );
    expect(assets.modifiers.get(id)?.adultOnly).toBe(true);
    assets.modifiers.delete(id);
  });

  it("cannot take the name of an adult pack modifier or target", () => {
    for (const name of [adultManifest.modifiers[0]?.id, adultManifest.targets.entries[0]?.name])
      expect(() => addCustomTargets(assets, [customTargetOf(name as string, offsets)])).toThrow(
        CustomTargetError,
      );
    expect(adultManifest.modifiers.every((m) => assets.modifiers.get(m.id)?.adultOnly)).toBe(true);
  });

  it("never flags a custom modifier adult-only or changes what an adult modifier is", () => {
    const before = adultManifest.modifiers.map((m) => assets.modifiers.get(m.id));
    addCustomTargets(assets, [customTargetOf("harmless", offsets)]);
    expect(assets.modifiers.get(customTargetId("harmless"))?.adultOnly).toBe(false);
    expect(adultManifest.modifiers.map((m) => assets.modifiers.get(m.id))).toEqual(before);
  });
});
