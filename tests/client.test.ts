import { describe, expect, it } from "vitest";
import { createRecipe } from "../src/recipe/recipe.ts";
import { HumanoidWorkerClient, HumanoidWorkerError } from "../src/worker/client.ts";
import type { WorkerRequest, WorkerResponse } from "../src/worker/protocol.ts";

/** A stand-in for the evaluation worker: answers each request on a later tick. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  evaluated: number[] = [];
  pickMaps = 0;
  terminated = false;
  private readonly failInit: boolean;
  /** Settles when the stand-in's modifier targets "arrive"; rejects to fail them. */
  private readonly modifierTargets: Promise<void>;
  constructor(failInit = false, modifierTargets: Promise<void> = Promise.resolve()) {
    this.failInit = failInit;
    this.modifierTargets = modifierTargets;
  }
  postMessage(msg: WorkerRequest) {
    const reply = (data: WorkerResponse) => {
      if (!this.terminated) this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
    };
    if (msg.type === "modifierTargets") {
      this.modifierTargets.then(
        () => reply({ type: "modifierTargetsLoaded", id: msg.id }),
        (e: Error) => reply({ type: "error", id: msg.id, message: e.message, name: e.name }),
      );
      return;
    }
    if (msg.type === "pickMap") {
      this.pickMaps++;
      this.modifierTargets.then(() =>
        reply({
          type: "pickMap",
          id: msg.id,
          features: [{ task: "Face", group: "nose features", label: "Nose features" }],
          render: { body: Uint8Array.of(0, 255), attachments: [] },
        }),
      );
      return;
    }
    setTimeout(() => {
      if (this.terminated) return;
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

const make = (failInit = false, modifierTargets?: Promise<void>) => {
  const worker = new FakeWorker(failInit, modifierTargets);
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

  it("serves macro-only figures while the modifier targets are still arriving", async () => {
    let release = () => {};
    const { client, worker } = make(
      false,
      new Promise<void>((r) => {
        release = r;
      }),
    );
    const shaped = createRecipe({ macros: { age: 50 }, modifiers: { "nose/a|b": 0.5 } });
    const a = client.evaluate(shaped, "a");
    const b = client.evaluate(recipe(30), "b");
    // "a" was queued first, but waiting on the targets must not hold up "b".
    await expect(b).resolves.toMatchObject({ age: 30 });
    expect(worker.evaluated).toEqual([30]);
    // A newer macro-only request for "a" replaces the held one and goes at once.
    const a2 = client.evaluate(recipe(51), "a");
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    await expect(a2).resolves.toMatchObject({ age: 51 });
    const a3 = client.evaluate(shaped, "a");
    release();
    await client.modifierTargets;
    await expect(a3).resolves.toMatchObject({ age: 50 });
    expect(worker.evaluated).toEqual([30, 51, 50]);
  });

  it("still sends modifier evaluations when the targets fail, so the worker reports why", async () => {
    const failure = Object.assign(new Error("modifier-targets.bin.gz failed: 404"), {
      name: "AssetFormatError",
    });
    const failed = Promise.reject(failure);
    // Observed here; the stand-in only subscribes once the client asks.
    failed.catch(() => {});
    const { client, worker } = make(false, failed);
    const shaped = createRecipe({ modifiers: { "nose/a|b": 0.5 } });
    await expect(client.modifierTargets).rejects.toMatchObject({ name: "AssetFormatError" });
    await client.evaluate(shaped);
    expect(worker.evaluated).toHaveLength(1);
  });

  it("asks the worker for the pick map once, after the modifier targets", async () => {
    let release = () => {};
    const { client, worker } = make(
      false,
      new Promise<void>((r) => {
        release = r;
      }),
    );
    const first = client.pickMap();
    expect(client.pickMap()).toBe(first);
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await client.ready;
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    release();
    const map = await first;
    expect(map.features[0]?.group).toBe("nose features");
    expect([...map.render.body]).toEqual([0, 255]);
    expect(worker.pickMaps).toBe(1);
  });

  it("fails queued evaluations when the worker cannot initialise", async () => {
    const { client } = make(true);
    await expect(client.evaluate(recipe(30))).rejects.toMatchObject({ message: "no packs" });
    await expect(client.ready).rejects.toMatchObject({ name: "AssetFormatError" });
    await expect(client.modifierTargets).rejects.toMatchObject({ name: "AssetFormatError" });
  });
});
