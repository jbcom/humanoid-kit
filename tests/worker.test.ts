import { afterEach, describe, expect, it, vi } from "vitest";
import { PHALLUS_SIZE } from "../scripts/lib/detail/phallus.ts";
import { TESTES_SIZE } from "../scripts/lib/detail/scrotum.ts";
import { shapeSignalNames } from "../src/model/detailFactors.ts";
import { presenceJoints } from "../src/presence/fromEvaluation.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { ADULT_SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { createWorkerHandler } from "../src/worker/handler.ts";
import type { WorkerResponse } from "../src/worker/protocol.ts";
import { stubFetch } from "./fetchStub.ts";
import { loadFixtureAssets } from "./fixtures.ts";

/** Drives the worker's handler directly, collecting its replies by request id. */
function start() {
  const replies = new Map<number, WorkerResponse>();
  const transfers = new Map<number, Transferable[]>();
  const handle = createWorkerHandler((msg, transfer) => {
    replies.set(msg.id, msg);
    transfers.set(msg.id, transfer ?? []);
  });
  return { handle, replies, transfers };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

// The adult cases also build the adult pack's layer fields or refined surface:
// 13–50 s alone on a loaded machine, more under coverage, as in
// tests/adultSurfaceModel.test.ts.
const ADULT_BUILD = { timeout: 300_000 };

// Init parses the whole first stage and builds the model (~1 s), so these get room.
describe("the evaluation worker", { timeout: 60_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("evaluates the first figure at once and makes an older one wait for its stage only", async () => {
    let release = () => {};
    const old = new Promise<void>((r) => {
      release = r;
    });
    stubFetch({ hold: { file: "targets-old.bin.gz", until: old } });
    const { handle, replies } = start();
    await handle({
      type: "init",
      id: 1,
      load: { body: "http://packs/body" },
      model: { subdivision: 0 },
    });
    expect(replies.get(1)?.type).toBe("ready");
    // Presence is derived on the main thread, which has no packs: the worker
    // reports the joints it reads, once, with the topology.
    expect(replies.get(1)).toMatchObject({ presenceJoints: presenceJoints(loadFixtureAssets()) });

    const older = handle({
      type: "evaluate",
      id: 2,
      recipe: createRecipe({ macros: { age: 70 } }),
    });
    const first = handle({ type: "evaluate", id: 3, recipe: createRecipe() });
    await first;
    // The default figure is evaluated while the 70-year-old waits for the old anchor.
    expect(replies.get(3)?.type).toBe("evaluated");
    await settle();
    expect(replies.has(2)).toBe(false);

    release();
    await older;
    expect(replies.get(2)?.type).toBe("evaluated");
  });

  it("solves a figure's hip fold between other requests, and lets a newer ask supersede an older", async () => {
    stubFetch();
    const { handle, replies, transfers } = start();
    await handle({
      type: "init",
      id: 1,
      load: { body: "http://packs/body" },
      model: { subdivision: 1 },
    });
    const first = handle({ type: "hipFold", id: 2, recipe: createRecipe({ macros: { age: 30 } }) });
    // A newer ask for a fold stops the older one at its next flexion.
    const second = handle({ type: "hipFold", id: 3, recipe: createRecipe() });
    // An evaluation is not held up behind either.
    const evaluated = handle({ type: "evaluate", id: 4, recipe: createRecipe() });
    await Promise.all([first, second, evaluated]);
    expect(replies.get(4)?.type).toBe("evaluated");
    expect(replies.get(2)).toMatchObject({ type: "error", name: "AbortError" });
    const fold = replies.get(3);
    expect(fold?.type).toBe("hipFold");
    if (fold?.type !== "hipFold") return;
    expect(fold.surface).toBe("base");
    expect(fold.fold.rows).toBeGreaterThan(50);
    expect(fold.fold.slot.length).toBe(
      (replies.get(1) as Extract<WorkerResponse, { type: "ready" }>).topology.body.vertexCount,
    );
    // The slots and the rows are transferred, not copied.
    expect(transfers.get(3)).toEqual([fold.fold.slot.buffer, fold.fold.data.buffer]);
  });

  it("bakes a partial attachment set against the default figure, whatever the first figure's age", async () => {
    // A child first figure loads the child anchors first; the bake needs the
    // default (adult) figure, so ready waits for its stage rather than failing.
    let release = () => {};
    const young = new Promise<void>((r) => {
      release = r;
    });
    stubFetch({ hold: { file: "targets-young.bin.gz", until: young } });
    const { handle, replies } = start();
    const init = handle({
      type: "init",
      id: 1,
      load: { body: "http://packs/body", firstFigureAge: 5 },
      model: { subdivision: 0, attachments: ["eyes/high-poly"] },
    });
    await settle();
    expect(replies.has(1)).toBe(false);
    release();
    await init;
    expect(replies.get(1)).toMatchObject({ type: "ready" });
  });

  describe("with the clothing pack", () => {
    const load = { body: "http://packs/body", clothing: "http://packs/clothing" };
    const outfit = ["suits/male_casualsuit01", "shoes/shoes01"];
    const evaluated = (replies: Map<number, WorkerResponse>, id: number) => {
      const r = replies.get(id);
      if (r?.type !== "evaluated") throw new Error(`request ${id}: ${JSON.stringify(r)}`);
      return r.evaluation;
    };

    it("answers an evaluation of an outfit with the garments and the masks to draw them", async () => {
      stubFetch();
      const { handle, replies, transfers } = start();
      await handle({ type: "init", id: 1, load, model: { subdivision: 0 } });
      await handle({ type: "evaluate", id: 2, recipe: createRecipe({ outfit }) });
      const ev = evaluated(replies, 2);
      // Innermost first: the shoes' own z_depth is below the suit's.
      expect(ev.outfit.order).toEqual(["shoes/shoes01", "suits/male_casualsuit01"]);
      expect(ev.garments).toHaveLength(2);
      expect(ev.outfit.masks?.bodyIndex.length).toBeGreaterThan(0);
      // Buffers are transferred, so what the model caches must not be among them.
      await handle({ type: "evaluate", id: 3, recipe: createRecipe({ outfit }) });
      const again = evaluated(replies, 3);
      expect(again.outfit.masks?.bodyIndex.length).toBe(ev.outfit.masks?.bodyIndex.length);
      expect(again.outfit.masks?.bodyIndex.buffer).not.toBe(ev.outfit.masks?.bodyIndex.buffer);
      expect(transfers.get(2)).toContain(ev.outfit.masks?.bodyIndex.buffer);
      expect(transfers.get(2)).toContain(ev.garments[0]?.positions.buffer);
    });

    it("leaves the masks out for a caller that holds them", async () => {
      stubFetch();
      const { handle, replies } = start();
      await handle({ type: "init", id: 1, load, model: { subdivision: 0 } });
      await handle({ type: "evaluate", id: 2, recipe: createRecipe({ outfit }) });
      const key = evaluated(replies, 2).outfit.key;
      await handle({ type: "evaluate", id: 3, recipe: createRecipe({ outfit }), haveOutfit: key });
      expect(evaluated(replies, 3).outfit).toMatchObject({ key, masks: null });
    });

    it("sends a garment's topology on request", async () => {
      stubFetch();
      const { handle, replies } = start();
      await handle({ type: "init", id: 1, load, model: { subdivision: 0 } });
      await handle({ type: "garment", id: 2, garment: "shoes/shoes01" });
      const r = replies.get(2);
      expect(r?.type).toBe("garment");
      if (r?.type === "garment") {
        expect(r.topology).toMatchObject({ id: "shoes/shoes01", kind: "shoes" });
        expect(r.topology.textureUrl).toBe(
          "http://packs/clothing/shoes_shoes01_shoes01_diffuse.webp",
        );
      }
    });

    it("makes an outfit wait for the garments' stage, and a figure that wears nothing not", async () => {
      let release = () => {};
      const garments = new Promise<void>((r) => {
        release = r;
      });
      stubFetch({ hold: { file: "garments.bin.gz", until: garments } });
      const { handle, replies } = start();
      await handle({ type: "init", id: 1, load, model: { subdivision: 0 } });
      const dressed = handle({ type: "evaluate", id: 2, recipe: createRecipe({ outfit }) });
      const garment = handle({ type: "garment", id: 3, garment: outfit[1] as string });
      await handle({ type: "evaluate", id: 4, recipe: createRecipe() });
      expect(replies.get(4)?.type).toBe("evaluated");
      await settle();
      expect(replies.has(2)).toBe(false);
      expect(replies.has(3)).toBe(false);
      release();
      await Promise.all([dressed, garment]);
      expect(replies.get(2)?.type).toBe("evaluated");
      expect(replies.get(3)?.type).toBe("garment");
    });

    it("rejects an outfit it cannot dress, by name, and keeps serving", async () => {
      stubFetch();
      const { handle, replies } = start();
      await handle({ type: "init", id: 1, load, model: { subdivision: 0 } });
      await handle({ type: "evaluate", id: 2, recipe: createRecipe({ outfit: ["suits/nope"] }) });
      expect(replies.get(2)).toMatchObject({ type: "error", name: "OutfitError" });
      await handle({ type: "garment", id: 3, garment: "suits/nope" });
      expect(replies.get(3)).toMatchObject({ type: "error", name: "OutfitError" });
      await handle({ type: "evaluate", id: 4, recipe: createRecipe() });
      expect(replies.get(4)?.type).toBe("evaluated");
    });

    it("rejects an outfit when the garments fail to load", async () => {
      stubFetch({ missing: "garments.bin.gz" });
      const { handle, replies } = start();
      await handle({ type: "init", id: 1, load, model: { subdivision: 0 } });
      await handle({ type: "evaluate", id: 2, recipe: createRecipe({ outfit }) });
      expect(replies.get(2)).toMatchObject({
        type: "error",
        message: expect.stringMatching(/garments\.bin\.gz failed/),
      });
    });

    it("rejects an outfit when no clothing pack was asked for", async () => {
      stubFetch();
      const { handle, replies } = start();
      await handle({ type: "init", id: 1, load: { body: "http://packs/body" }, model: {} });
      await handle({ type: "evaluate", id: 2, recipe: createRecipe({ outfit }) });
      expect(replies.get(2)).toMatchObject({
        type: "error",
        name: "OutfitError",
        message: expect.stringMatching(/no clothing pack/),
      });
    });
  });

  it("has no adult layer fields to post without an adult pack", ADULT_BUILD, async () => {
    stubFetch();
    const { handle, replies } = start();
    await handle({
      type: "init",
      id: 1,
      load: { body: "http://packs/body" },
      model: { subdivision: 0 },
    });
    await handle({ type: "adultLayers", id: 2 });
    expect(replies.get(2)).toEqual({ type: "adultLayers", id: 2, update: null });
    // No adult pack, so ready carries no anatomy: no features, no state morphs.
    expect(replies.get(1)).not.toHaveProperty("anatomy");
  });

  it(
    "posts the adult layer fields once the adult stage has loaded, without holding up evaluations",
    ADULT_BUILD,
    async () => {
      let release = () => {};
      const adult = new Promise<void>((r) => {
        release = r;
      });
      stubFetch({ hold: { file: "targets.bin.gz", until: adult } });
      const { handle, replies } = start();
      await handle({
        type: "init",
        id: 1,
        load: { body: "http://packs/body", adultAnatomy: "http://packs/adult" },
        model: { subdivision: 0 },
      });
      // The pack's manifest arrives with the first stage: ready already names its features.
      const ready = replies.get(1);
      if (ready?.type !== "ready") throw new Error("not ready");
      expect(ready.anatomy?.features.map((f) => f.id)).toEqual(["phallus", "scrotum", "mound"]);
      expect(shapeSignalNames([], ready.anatomy)).toEqual(["arousal"]);
      const layers = handle({ type: "adultLayers", id: 2 });
      // A figure that needs nothing of the adult stage: no organ and no testes. Left unset, an
      // adult with the pack takes its default anatomy (`AdultAnatomySpec.defaults`), which waits.
      await handle({
        type: "evaluate",
        id: 3,
        recipe: createRecipe({ modifiers: { [PHALLUS_SIZE]: 0, [TESTES_SIZE]: 0 } }),
      });
      expect(replies.get(3)?.type).toBe("evaluated");
      await settle();
      expect(replies.has(2)).toBe(false);

      release();
      await layers;
      const reply = replies.get(2);
      if (reply?.type !== "adultLayers" || !reply.update) throw new Error("no adult layer fields");
      expect(reply.update.layers).toEqual(ADULT_SKIN_LAYERS.map((l) => l.id));
      expect(reply.update.layerFields.length).toBeGreaterThan(0);
      expect(reply.update.layerFields.some((x) => x > 0)).toBe(true);
    },
  );

  it(
    "has no adult surface without an adult pack, and the base surface for every figure",
    ADULT_BUILD,
    async () => {
      stubFetch();
      const { handle, replies } = start();
      await handle({
        type: "init",
        id: 1,
        load: { body: "http://packs/body" },
        model: { subdivision: 0 },
      });
      await handle({ type: "adultSurface", id: 2 });
      expect(replies.get(2)).toEqual({ type: "adultSurface", id: 2, topology: null });
      await handle({ type: "evaluate", id: 3, recipe: createRecipe() });
      const ev = replies.get(3);
      if (ev?.type !== "evaluated") throw new Error("not evaluated");
      expect(ev.evaluation.surface).toBe("base");
    },
  );

  it(
    "serves the adult surface at once and evaluates an adult on it and a minor on the base",
    ADULT_BUILD,
    async () => {
      stubFetch();
      const { handle, replies } = start();
      await handle({
        type: "init",
        id: 1,
        load: { body: "http://packs/body", adultAnatomy: "http://packs/adult", firstFigureAge: 15 },
        model: { subdivision: 1 },
      });
      // The surface needs only the pack's manifest, not its targets: no waiting for the adult stage.
      await handle({ type: "adultSurface", id: 2 });
      const reply = replies.get(2);
      if (reply?.type !== "adultSurface" || !reply.topology) throw new Error("no adult surface");
      const { topology } = reply;
      await handle({ type: "evaluate", id: 3, recipe: createRecipe({ macros: { age: 30 } }) });
      await handle({ type: "evaluate", id: 4, recipe: createRecipe({ macros: { age: 15 } }) });
      const adult = replies.get(3);
      const minor = replies.get(4);
      if (adult?.type !== "evaluated" || minor?.type !== "evaluated")
        throw new Error("no evaluation");
      expect(adult.evaluation.surface).toBe("adult");
      expect(adult.evaluation.positions.length).toBe(topology.vertexCount * 3);
      expect(minor.evaluation.surface).toBe("base");
      const ready = replies.get(1);
      if (ready?.type !== "ready") throw new Error("not ready");
      expect(minor.evaluation.positions.length).toBe(ready.topology.body.vertexCount * 3);
      // The pick map covers the adult surface's vertices too.
      await handle({ type: "pickMap", id: 5 });
      const pick = replies.get(5);
      if (pick?.type !== "pickMap") throw new Error("no pick map");
      expect(pick.render.adultBody?.length).toBe(topology.vertexCount);
    },
  );

  it(
    "rejects the adult layer fields when the adult stage fails, and keeps serving others",
    ADULT_BUILD,
    async () => {
      stubFetch({ missing: "targets.bin.gz" });
      const { handle, replies } = start();
      await handle({
        type: "init",
        id: 1,
        load: { body: "http://packs/body", adultAnatomy: "http://packs/adult" },
        model: { subdivision: 0 },
      });
      await handle({ type: "adultLayers", id: 2 });
      expect(replies.get(2)).toMatchObject({
        type: "error",
        message: expect.stringMatching(/targets\.bin\.gz failed/),
      });
      // A figure that needs nothing of the failed stage: no organ and no testes.
      await handle({
        type: "evaluate",
        id: 3,
        recipe: createRecipe({ modifiers: { [PHALLUS_SIZE]: 0, [TESTES_SIZE]: 0 } }),
      });
      expect(replies.get(3)?.type).toBe("evaluated");
    },
  );

  it("rejects an evaluation whose stage fails, with the reason, and keeps serving others", async () => {
    stubFetch({ missing: "targets-modifiers.bin.gz" });
    const { handle, replies } = start();
    await handle({
      type: "init",
      id: 1,
      load: { body: "http://packs/body" },
      model: { subdivision: 0 },
    });
    await handle({
      type: "evaluate",
      id: 2,
      recipe: createRecipe({ modifiers: { "nose/nose-scale-horiz-decr|incr": 0.5 } }),
    });
    expect(replies.get(2)).toMatchObject({
      type: "error",
      message: expect.stringMatching(/targets-modifiers\.bin\.gz failed/),
    });
    await handle({ type: "complete", id: 3 });
    expect(replies.get(3)?.type).toBe("error");
    await handle({ type: "evaluate", id: 4, recipe: createRecipe() });
    expect(replies.get(4)?.type).toBe("evaluated");
  });
});
