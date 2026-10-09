import { describe, expect, it } from "vitest";
import { createRecipe } from "../src/recipe/recipe.ts";
import { HumanoidWorkerClient, HumanoidWorkerError } from "../src/worker/client.ts";
import type { WorkerRequest, WorkerResponse } from "../src/worker/protocol.ts";

/** A stand-in for the evaluation worker: answers each request on a later tick. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  evaluated: number[] = [];
  terminated = false;
  private readonly failInit: boolean;
  constructor(failInit = false) {
    this.failInit = failInit;
  }
  postMessage(msg: WorkerRequest) {
    setTimeout(() => {
      if (this.terminated) return;
      const reply = (data: WorkerResponse) =>
        this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
      if (msg.type === "init") {
        if (this.failInit)
          reply({ type: "error", id: msg.id, message: "no packs", name: "AssetFormatError" });
        else
          reply({
            type: "ready",
            id: msg.id,
            topology: { body: {} as never, attachments: [] },
            modifiers: [],
            sliders: [],
            bones: [],
            adultAnatomyLoaded: false,
          });
        return;
      }
      this.evaluated.push(msg.recipe.macros.age);
      reply({
        type: "evaluated",
        id: msg.id,
        ms: 0,
        evaluation: { age: msg.recipe.macros.age } as never,
      });
    }, 1);
  }
  terminate() {
    this.terminated = true;
  }
}

const make = (failInit = false) => {
  const worker = new FakeWorker(failInit);
  return {
    worker,
    client: new HumanoidWorkerClient({ body: "x" }, {}, worker as unknown as Worker),
  };
};
const recipe = (age: number) => createRecipe({ macros: { age } });

describe("HumanoidWorkerClient", () => {
  it("serves two keys without either cancelling the other", async () => {
    const { client } = make();
    const [a, b] = await Promise.all([
      client.evaluate(recipe(30), "a"),
      client.evaluate(recipe(40), "b"),
    ]);
    expect((a as unknown as { age: number }).age).toBe(30);
    expect((b as unknown as { age: number }).age).toBe(40);
  });

  it("supersedes a waiting request for the same key and keeps only the latest", async () => {
    const { client, worker } = make();
    // All three are queued while the worker initialises, so the first two are superseded.
    const first = client.evaluate(recipe(20), "a");
    const second = client.evaluate(recipe(21), "a");
    const third = client.evaluate(recipe(22), "a");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    await expect(third).resolves.toMatchObject({ age: 22 });
    expect(worker.evaluated).toEqual([22]);
  });

  it("rejects waiting and later evaluations after dispose, and disposes twice safely", async () => {
    const { client } = make();
    const waiting = client.evaluate(recipe(30), "a");
    client.dispose();
    client.dispose();
    await expect(waiting).rejects.toBeInstanceOf(HumanoidWorkerError);
    await expect(client.evaluate(recipe(31), "a")).rejects.toBeInstanceOf(HumanoidWorkerError);
  });

  it("fails queued evaluations when the worker cannot initialise", async () => {
    const { client } = make(true);
    await expect(client.evaluate(recipe(30))).rejects.toMatchObject({ message: "no packs" });
    await expect(client.ready).rejects.toMatchObject({ name: "AssetFormatError" });
  });
});
