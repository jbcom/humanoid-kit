import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecipe } from "../src/recipe/recipe.ts";
import { createWorkerHandler } from "../src/worker/handler.ts";
import type { WorkerResponse } from "../src/worker/protocol.ts";
import { stubFetch } from "./fetchStub.ts";

/** Drives the worker's handler directly, collecting its replies by request id. */
function start() {
  const replies = new Map<number, WorkerResponse>();
  const handle = createWorkerHandler((msg) => {
    replies.set(msg.id, msg);
  });
  return { handle, replies };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

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
