import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHumanoidAssetsStaged } from "../src/format/assetFormat.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { createWorkerHandler } from "../src/worker/handler.ts";
import type { WorkerResponse } from "../src/worker/protocol.ts";
import { stubFetch } from "./fetchStub.ts";
import { hairManifest } from "./hairFixtures.ts";

const LOAD = { body: "http://packs/body", hair: "http://packs/hair" };

function start() {
  const replies = new Map<number, WorkerResponse>();
  const handle = createWorkerHandler((msg) => {
    replies.set(msg.id, msg);
  });
  return { handle, replies };
}

describe("loading the hair pack", { timeout: 60_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches only the manifest up front, and a style's files only when it is first worn", async () => {
    const requested = stubFetch();
    const { assets, complete } = await loadHumanoidAssetsStaged(LOAD);
    await complete;
    const hairRequests = () => requested.filter((u) => u.startsWith("http://packs/hair/"));
    expect(hairRequests()).toEqual(["http://packs/hair/manifest.json"]);
    expect(assets.hair?.styles.size).toBe(hairManifest.styles.length);
    expect(assets.hair?.bound.size).toBe(0);

    const a = assets.hair?.load("short02");
    const b = assets.hair?.load("short02");
    const style = await a;
    expect(await b).toBe(style);
    expect(assets.hair?.bound.get("short02")).toBe(style);
    // Two concurrent wearers fetched it once; a later one fetches nothing.
    await assets.hair?.load("short02");
    expect(hairRequests().filter((u) => u.endsWith("short02.bin.gz"))).toHaveLength(1);
    expect(hairRequests()).not.toContain("http://packs/hair/bob02.bin.gz");
  });

  it("gives the strand map's URL to the topology, without fetching it (the renderer does)", async () => {
    stubFetch();
    const { assets } = await loadHumanoidAssetsStaged(LOAD);
    expect(assets.fileUrls.get("short02.webp")).toBe("http://packs/hair/short02.webp");
  });

  it("forgets a failed fetch, so the next wearer tries again, and rejects an unknown style", async () => {
    stubFetch({ missing: "bob01.bin.gz" });
    const { assets } = await loadHumanoidAssetsStaged(LOAD);
    await expect(assets.hair?.load("bob01")).rejects.toThrow(/404|not found/i);
    await expect(assets.hair?.load("bob01")).rejects.toThrow(/404|not found/i);
    await expect(assets.hair?.load("not-a-style")).rejects.toThrow(/no hair style not-a-style/);
    expect(assets.hair?.bound.size).toBe(0);
  });

  it("refuses a hair pack built for another body pack", async () => {
    stubFetch();
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string) => {
      const res = await real(input);
      if (!input.endsWith("hair/manifest.json")) return res;
      const m = (await res.json()) as { bodySha256: string };
      return new Response(JSON.stringify({ ...m, bodySha256: "0".repeat(64) }));
    });
    await expect(loadHumanoidAssetsStaged(LOAD)).rejects.toThrow(/different body pack/);
  });
});

describe("the worker with hair", { timeout: 60_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers the styles in ready, and sends a style's topology with its first evaluation only", async () => {
    stubFetch();
    const { handle, replies } = start();
    await handle({ type: "init", id: 1, load: LOAD, model: { subdivision: 0 } });
    const ready = replies.get(1);
    expect(ready?.type).toBe("ready");
    if (ready?.type !== "ready") return;
    expect(ready.hair?.styles.map((s) => s.id)).toContain("short02");
    expect(ready.hair?.styles[0]).toEqual({
      id: "short02",
      label: expect.any(String),
      tags: expect.any(Array),
      kind: "scalp",
    });

    const recipe = createRecipe({ hair: { style: "short02" } });
    await handle({ type: "evaluate", id: 2, recipe });
    const first = replies.get(2);
    expect(first?.type).toBe("evaluated");
    if (first?.type !== "evaluated") return;
    expect(first.evaluation.hair?.id).toBe("short02");
    expect(first.hairTopology?.id).toBe("short02");
    expect(first.hairTopology?.vertexCount).toBe(
      (first.evaluation.hair?.positions.length ?? 0) / 3,
    );

    await handle({ type: "evaluate", id: 3, recipe });
    const second = replies.get(3);
    expect(second?.type === "evaluated" && second.hairTopology).toBeFalsy();
    expect(second?.type === "evaluated" && second.evaluation.hair?.id).toBe("short02");

    // A different style sends its own topology; no hair sends none.
    await handle({
      type: "evaluate",
      id: 4,
      recipe: createRecipe({ hair: { style: "bob02" } }),
    });
    const other = replies.get(4);
    expect(other?.type === "evaluated" && other.hairTopology?.id).toBe("bob02");
    await handle({ type: "evaluate", id: 5, recipe: createRecipe() });
    const bald = replies.get(5);
    expect(bald?.type === "evaluated" && bald.evaluation.hair).toBeNull();
    expect(bald?.type === "evaluated" && bald.hairTopology).toBeFalsy();
  });

  it("answers an unknown style with an error that names it, and keeps serving", async () => {
    stubFetch();
    const { handle, replies } = start();
    await handle({ type: "init", id: 1, load: LOAD, model: { subdivision: 0 } });
    await handle({
      type: "evaluate",
      id: 2,
      recipe: createRecipe({ hair: { style: "no-such-style" } }),
    });
    expect(replies.get(2)).toMatchObject({ type: "error", name: "RecipeError" });
    expect((replies.get(2) as { message: string }).message).toMatch(/no-such-style/);
    await handle({ type: "evaluate", id: 3, recipe: createRecipe() });
    expect(replies.get(3)?.type).toBe("evaluated");
  });

  it("answers a style whose files fail to load with the reason, and recovers when they can", async () => {
    stubFetch({ missing: "bob02.bin.gz" });
    const { handle, replies } = start();
    await handle({ type: "init", id: 1, load: LOAD, model: { subdivision: 0 } });
    await handle({
      type: "evaluate",
      id: 2,
      recipe: createRecipe({ hair: { style: "bob02" } }),
    });
    expect(replies.get(2)?.type).toBe("error");
    expect((replies.get(2) as { message: string }).message).toMatch(/bob02\.bin\.gz/);
    await handle({
      type: "evaluate",
      id: 3,
      recipe: createRecipe({ hair: { style: "short04" } }),
    });
    expect(replies.get(3)?.type).toBe("evaluated");
  });

  it("reports no styles when no hair pack was asked for, and rejects a recipe that wears one", async () => {
    stubFetch();
    const { handle, replies } = start();
    await handle({
      type: "init",
      id: 1,
      load: { body: "http://packs/body" },
      model: { subdivision: 0 },
    });
    expect(replies.get(1)).toMatchObject({ type: "ready", hair: null });
    await handle({
      type: "evaluate",
      id: 2,
      recipe: createRecipe({ hair: { style: "short02" } }),
    });
    expect((replies.get(2) as { message: string }).message).toMatch(/no hair pack is loaded/);
  });
});
