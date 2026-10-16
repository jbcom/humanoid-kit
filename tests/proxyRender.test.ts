import { describe, expect, it } from "vitest";
import {
  type BoundProxy,
  type HumanoidAssets,
  SKIN_INFLUENCES,
} from "../src/format/assetFormat.ts";
import * as proxyApi from "../src/model/proxy.ts";

/** Only the proxy boundary's inputs; no model, pack loading, or renderer. */
function seamFixture(): { assets: HumanoidAssets; proxy: BoundProxy; positions: Float32Array } {
  const proxy = {
    entry: { id: "seam", vertexCount: 5, faceCount: 3, scale: null },
    refVerts: Uint32Array.from([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]),
    weights: Float32Array.from([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
    offsets: new Float32Array(15),
    faceVerts: Uint32Array.from([0, 1, 2, 3, 0, 2, 4, 4, 0, 1, 4, 0]),
    faceUvs: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 6, 7, 1, 6, 7]),
    // Entry 7 equals entry 0 by value but is a distinct authored UV identity.
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0, 0.5, 1, 1, 0.5, 0, 0]),
    deleteVerts: new Uint32Array(),
  } as BoundProxy;
  const skinIndex = Uint8Array.from({ length: 5 * SKIN_INFLUENCES }, (_, i) => i);
  const skinWeight = Float32Array.from(
    { length: skinIndex.length },
    (_, i) => (SKIN_INFLUENCES - (i % SKIN_INFLUENCES)) / 36,
  );
  const assets = { proxies: new Map([["seam", proxy]]), skinIndex, skinWeight } as HumanoidAssets;
  // Source vertices 3 and 4 coincide but must remain separate.
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0]);
  return { assets, proxy, positions };
}

// Namespace lookup gives a meaningful missing-contract assertion before implementation.
it("exposes source-preserving proxy render operations", () => {
  expect(proxyApi).toHaveProperty("proxyRenderTopology", expect.any(Function));
  expect(proxyApi).toHaveProperty("expandProxyPositions", expect.any(Function));
  expect(proxyApi).toHaveProperty("proxyRenderIndex", expect.any(Function));
});

describe("authored proxy UV seams", () => {
  it("splits by source vertex and UV entry while keeping ordered source triangles", () => {
    const { assets, proxy } = seamFixture();
    const before = structuredClone(proxy);
    const t = proxyApi.proxyRenderTopology(assets, "seam");
    expect(t.vertexCount).toBe(8);
    expect([...t.renderToProxy]).toEqual([0, 1, 2, 3, 0, 2, 4, 0]);
    expect([...t.renderToUv]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...t.index]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 1, 6]);
    expect([...t.triangleFace]).toEqual([0, 0, 1, 2]);
    expect([...t.sourceTriangle]).toEqual([0, 1, 2, 3]);
    expect(t.uvs).toEqual(proxy.uvs);
    expect(proxy).toEqual(before);
    expect(proxyApi.proxyRenderTopology(assets, "seam")).toBe(t);
    const other = seamFixture();
    expect(proxyApi.proxyRenderTopology(other.assets, "seam")).not.toBe(t);
    const source = proxyApi.proxyTopology(assets, "seam");
    for (let v = 0; v < t.vertexCount; v++) {
      const k = (t.renderToProxy[v] as number) * SKIN_INFLUENCES;
      expect(t.skinIndex.slice(v * SKIN_INFLUENCES, (v + 1) * SKIN_INFLUENCES)).toEqual(
        source.skinIndex.slice(k, k + SKIN_INFLUENCES),
      );
      expect(t.skinWeight.slice(v * SKIN_INFLUENCES, (v + 1) * SKIN_INFLUENCES)).toEqual(
        source.skinWeight.slice(k, k + SKIN_INFLUENCES),
      );
      expect(t.skinWeight[v * SKIN_INFLUENCES + 7]).toBeGreaterThan(0);
    }
  });

  it("expands fitted source positions without welding coincident source vertices", () => {
    const { assets, positions } = seamFixture();
    const fitted = proxyApi.fitProxy(assets, "seam", positions);
    expect(fitted).toEqual(positions);
    const expected = Float32Array.from([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0,
    ]);
    expect(proxyApi.expandProxyPositions(assets, "seam", fitted)).toEqual(expected);
    const out = new Float32Array(expected.length);
    expect(proxyApi.expandProxyPositions(assets, "seam", fitted, out)).toBe(out);
    expect(out).toEqual(expected);
    expect(fitted).toEqual(positions);
    const disjoint = new Float32Array(positions.length + out.length);
    disjoint.set(positions);
    expect(
      proxyApi.expandProxyPositions(
        assets,
        "seam",
        disjoint.subarray(0, 15),
        disjoint.subarray(15),
      ),
    ).toEqual(expected);
  });

  it("rejects wrong position lengths and overlapping views before writing", () => {
    const { assets, positions } = seamFixture();
    const out = new Float32Array(24).fill(73);
    for (const length of [14, 16]) {
      expect(() =>
        proxyApi.expandProxyPositions(assets, "seam", new Float32Array(length), out),
      ).toThrow(proxyApi.ProxyError);
      expect([...out]).toEqual(Array(24).fill(73));
    }
    for (const length of [23, 25])
      expect(() =>
        proxyApi.expandProxyPositions(assets, "seam", positions, new Float32Array(length)),
      ).toThrow(proxyApi.ProxyError);
    const buffer = new Float32Array(30).fill(37);
    const before = buffer.slice();
    expect(() =>
      proxyApi.expandProxyPositions(assets, "seam", buffer.subarray(0, 15), buffer.subarray(6)),
    ).toThrow(/overlap/);
    expect(buffer).toEqual(before);
  });

  it("uses source face visibility and keeps surviving original triangle order", () => {
    const { assets } = seamFixture();
    const t = proxyApi.proxyRenderTopology(assets, "seam");
    expect(proxyApi.proxyRenderIndex(assets, "seam", null)).toBe(t.index);
    expect([
      ...proxyApi.proxyRenderIndex(assets, "seam", Uint8Array.from([0, 0, 0, 1, 0])),
    ]).toEqual([0, 1, 2, 0, 2, 3]);
    expect([
      ...proxyApi.proxyRenderIndex(assets, "seam", Uint8Array.from([0, 0, 0, 0, 1])),
    ]).toEqual([4, 5, 6, 7, 1, 6]);
    expect(proxyApi.proxyRenderIndex(assets, "seam", new Uint8Array(5))).toHaveLength(0);
    expect([...proxyApi.proxyIndex(assets, "seam", Uint8Array.from([0, 0, 0, 0, 1]))]).toEqual([
      0, 2, 4, 0, 1, 4,
    ]);
  });

  it.each([
    [
      "face vertex shape",
      (p: BoundProxy) => {
        p.faceVerts = p.faceVerts.slice(1);
      },
    ],
    [
      "face UV shape",
      (p: BoundProxy) => {
        p.faceUvs = p.faceUvs.slice(1);
      },
    ],
    [
      "UV shape",
      (p: BoundProxy) => {
        p.uvs = p.uvs.slice(1);
      },
    ],
    [
      "vertex range",
      (p: BoundProxy) => {
        p.faceVerts[0] = 5;
      },
    ],
    [
      "UV range",
      (p: BoundProxy) => {
        p.faceUvs[0] = 8;
      },
    ],
    [
      "unused triangle corner UV range",
      (p: BoundProxy) => {
        p.faceUvs[7] = 8;
      },
    ],
    [
      "nonfinite UV",
      (p: BoundProxy) => {
        p.uvs[0] = Number.NaN;
      },
    ],
    [
      "reference range",
      (p: BoundProxy) => {
        p.refVerts[0] = 5;
      },
    ],
    [
      "binding shape",
      (p: BoundProxy) => {
        p.weights = p.weights.slice(1);
      },
    ],
  ] as const)("refuses malformed %s", (_, change) => {
    const { assets, proxy } = seamFixture();
    change(proxy);
    expect(() => proxyApi.proxyRenderTopology(assets, "seam")).toThrow(proxyApi.ProxyError);
  });

  it("refuses incomplete base skin rows", () => {
    const { assets } = seamFixture();
    assets.skinWeight = assets.skinWeight.slice(1);
    expect(() => proxyApi.proxyRenderTopology(assets, "seam")).toThrow(proxyApi.ProxyError);
  });
});

describe("retained MakeHuman proxy render correspondence", () => {
  it("keeps every authored corner, triangle, skin row and visibility for all proxies", async () => {
    const { loadMiniatureAssets } = await import("./fixtures.ts");
    const assets = loadMiniatureAssets();
    for (const id of proxyApi.PROXY_IDS) {
      const p = proxyApi.boundProxy(assets, id);
      const original = structuredClone(p);
      const source = proxyApi.proxyTopology(assets, id);
      const t = proxyApi.proxyRenderTopology(assets, id);
      const fitted = proxyApi.fitProxy(assets, id, assets.positions);
      const expanded = proxyApi.expandProxyPositions(assets, id, fitted);
      const mapped = Uint32Array.from(t.index, (v) => t.renderToProxy[v] as number);
      expect(mapped).toEqual(source.index);
      expect(t.triangleFace).toEqual(source.triangleFace);
      expect([...t.sourceTriangle]).toEqual(
        Array.from({ length: source.index.length / 3 }, (_, i) => i),
      );
      let triangle = 0;
      for (let face = 0; face < p.entry.faceCount; face++) {
        const k = face * 4;
        const corners =
          p.faceVerts[k + 3] !== p.faceVerts[k + 2] && p.faceVerts[k + 3] !== p.faceVerts[k]
            ? [0, 1, 2, 0, 2, 3]
            : [0, 1, 2];
        for (let c = 0; c < corners.length; c++) {
          const render = t.index[triangle * 3 + c] as number;
          const uv = p.faceUvs[k + (corners[c] as number)] as number;
          expect(t.renderToUv[render]).toBe(uv);
          expect(t.uvs.slice(render * 2, render * 2 + 2)).toEqual(p.uvs.slice(uv * 2, uv * 2 + 2));
        }
        triangle += corners.length / 3;
      }
      const seamEntries = new Map<number, Set<number>>();
      for (let v = 0; v < t.vertexCount; v++) {
        const sourceVertex = t.renderToProxy[v] as number;
        const uvs = seamEntries.get(sourceVertex) ?? new Set<number>();
        uvs.add(t.renderToUv[v] as number);
        seamEntries.set(sourceVertex, uvs);
        expect(expanded.slice(v * 3, v * 3 + 3)).toEqual(
          fitted.slice(sourceVertex * 3, sourceVertex * 3 + 3),
        );
        const k = sourceVertex * SKIN_INFLUENCES;
        expect(t.skinIndex.slice(v * SKIN_INFLUENCES, (v + 1) * SKIN_INFLUENCES)).toEqual(
          source.skinIndex.slice(k, k + SKIN_INFLUENCES),
        );
        expect(t.skinWeight.slice(v * SKIN_INFLUENCES, (v + 1) * SKIN_INFLUENCES)).toEqual(
          source.skinWeight.slice(k, k + SKIN_INFLUENCES),
        );
      }
      expect([...seamEntries.values()].some((entries) => entries.size > 1)).toBe(true);
      const visibility = Uint8Array.from({ length: assets.positions.length / 3 }, (_, i) =>
        i % 3 === 0 ? 1 : 0,
      );
      const shown = proxyApi.proxyRenderIndex(assets, id, visibility);
      expect(Uint32Array.from(shown, (v) => t.renderToProxy[v] as number)).toEqual(
        proxyApi.proxyIndex(assets, id, visibility),
      );
      expect(proxyApi.fitProxy(assets, id, assets.positions)).toEqual(fitted);
      expect(p).toEqual(original);
    }
  });
});
