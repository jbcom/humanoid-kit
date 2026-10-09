import { describe, expect, it } from "vitest";
import { groupFaces, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { buildFeatureMap, NO_FEATURE } from "../src/makehuman/features.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const map = buildFeatureMap(assets);
const { positions } = assets;
const p = (v: number, k: number) => positions[v * 3 + k] as number;

/** Base vertices of the visible body (no helper geometry). */
const bodyVertices = (() => {
  const set = new Set<number>();
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) set.add(assets.faceVerts[f * 4 + k] as number);
  return [...set];
})();
const extreme = (score: (v: number) => number, among = bodyVertices) =>
  among.reduce((best, v) => (score(v) > score(best) ? v : best));
const featureOf = (v: number) => {
  const i = map.vertexFeature[v] as number;
  return i === NO_FEATURE ? null : map.features[i];
};
const centroidY = (joint: string) => {
  const verts = assets.manifest.skeleton.joints[joint] ?? [];
  return verts.reduce((s, v) => s + p(v, 1), 0) / verts.length;
};

describe("the feature map", () => {
  it("maps the tip of the nose to the nose controls", () => {
    // The most forward body vertex near the midline, between eye and jaw height.
    const eyeY = centroidY("eye.L____head");
    const jawY = centroidY("jaw____tail");
    const tip = extreme(
      (v) => p(v, 2),
      bodyVertices.filter((v) => Math.abs(p(v, 0)) < 0.01 && p(v, 1) < eyeY && p(v, 1) > jawY),
    );
    expect(featureOf(tip)).toMatchObject({ task: "Face", group: expect.stringMatching(/^nose/) });
  });

  it("maps the eyes' own geometry to each eye's controls", () => {
    for (const [joint, group] of [
      ["eye.L____head", "left eye"],
      ["eye.R____head", "right eye"],
    ] as const) {
      const verts = assets.manifest.skeleton.joints[joint] ?? [];
      expect(verts.length).toBeGreaterThan(0);
      const groups = verts.map((v) => featureOf(v)?.group);
      expect(groups.filter((g) => g === group).length / verts.length, joint).toBeGreaterThan(0.8);
    }
  });

  it("maps fingertips and toes to the hand and foot on their own side", () => {
    // The figure faces +z with its left side at +x; the arms hang beside it.
    expect(featureOf(extreme((v) => p(v, 0)))).toMatchObject({ group: "left hand" });
    expect(featureOf(extreme((v) => -p(v, 0)))).toMatchObject({ group: "right hand" });
    const toe = (side: 1 | -1) =>
      extreme(
        (v) => p(v, 2) - 10 * p(v, 1),
        bodyVertices.filter((v) => side * p(v, 0) > 0.03),
      );
    expect(featureOf(toe(1))).toMatchObject({ group: "left foot" });
    expect(featureOf(toe(-1))).toMatchObject({ group: "right foot" });
  });

  it("covers almost all of the body, and never with adult-only controls", () => {
    const covered = bodyVertices.filter((v) => featureOf(v) !== null).length;
    expect(covered / bodyVertices.length).toBeGreaterThan(0.9);
    // Adult sliders merge into body groups by id; a group whose modifiers are all
    // adult-only must not be offered, and adult targets never place a feature.
    const modifiersOf = (g: { sliders: { kind: string; id: string }[] }) =>
      g.sliders.filter((s) => s.kind === "modifier").map((s) => assets.modifiers.get(s.id));
    const adultOnlyGroups = new Set(
      assets.sliders.flatMap((t) =>
        t.groups
          .filter((g) => {
            const mods = modifiersOf(g);
            return mods.length > 0 && mods.every((m) => m?.adultOnly);
          })
          .map((g) => `${t.id}/${g.id}`),
      ),
    );
    expect(assets.adultAnatomyLoaded).toBe(true);
    for (const f of map.features) expect(adultOnlyGroups.has(`${f.task}/${f.group}`)).toBe(false);
    const adultTargets = new Set(assets.adultAnatomyManifest?.targets.entries.map((e) => e.name));
    expect(adultTargets.size).toBeGreaterThan(0);
    const withoutAdult = buildFeatureMap(loadFixtureAssets(false));
    expect([...withoutAdult.vertexFeature]).toEqual([...map.vertexFeature]);
  });

  it("follows the figure onto its render surface and its attachments", () => {
    const model = new HumanoidModel(assets, { subdivision: 1 });
    const topology = model.topology();
    const picked = model.renderFeatures(map.vertexFeature);
    expect(picked.body).toHaveLength(topology.body.vertexCount);
    expect(picked.attachments).toHaveLength(topology.attachments.length);
    const share = (features: Uint8Array, pred: (f: (typeof map.features)[number]) => boolean) =>
      [...features].filter((i) => i !== NO_FEATURE && pred(map.features[i] as never)).length /
      features.length;
    // Subdivision keeps the body's features: nearly every render vertex has one.
    expect(share(picked.body, () => true)).toBeGreaterThan(0.9);
    // An eyeball tap opens an eye's controls, through the base vertices it is bound to.
    const eyes = topology.attachments.findIndex((a) => a.kind === "eyes");
    expect(
      share(picked.attachments[eyes] as Uint8Array, (f) => / eye$/.test(f.group)),
    ).toBeGreaterThan(0.9);
  });

  it("needs the modifier targets", () => {
    const early = parseHumanoidAssets(bodyPackData(["core", "young"]));
    expect(() => buildFeatureMap(early)).toThrow(/modifier targets/);
  });
});
