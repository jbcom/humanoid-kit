import { describe, expect, it } from "vitest";
import { createRecipe } from "../src/recipe/recipe.ts";
import { HumanoidWorkerClient, HumanoidWorkerError } from "../src/worker/client.ts";
import type { WorkerRequest, WorkerResponse } from "../src/worker/protocol.ts";
import { EMPTY_RIG } from "./emptyRig.ts";

/**
 * A stand-in for the evaluation worker. As the real one does, it answers an
 * evaluation once the target files its recipe needs have loaded: here, a
 * figure aged 50 or over waits for `later` (the rest of the load).
 */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  evaluated: number[] = [];
  pickMaps = 0;
  posedOcclusions = 0;
  adultLayerRequests = 0;
  adultSurfaceRequests = 0;
  terminated = false;
  private readonly failInit: boolean;
  private readonly later: Promise<void>;
  constructor(failInit = false, later: Promise<void> = Promise.resolve()) {
    this.failInit = failInit;
    this.later = later;
  }
  postMessage(msg: WorkerRequest) {
    const reply = (data: WorkerResponse) => {
      if (!this.terminated) this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
    };
    const fail = (e: Error) =>
      reply({ type: "error", id: msg.id, message: e.message, name: e.name });
    if (msg.type === "complete") {
      this.later.then(() => reply({ type: "completed", id: msg.id }), fail);
      return;
    }
    if (msg.type === "pickMap") {
      this.pickMaps++;
      this.later.then(
        () =>
          reply({
            type: "pickMap",
            id: msg.id,
            features: [{ task: "Face", group: "nose features", label: "Nose features" }],
            render: { body: Uint8Array.of(0, 255), attachments: [] },
          }),
        fail,
      );
      return;
    }
    if (msg.type === "posedOcclusion") {
      this.posedOcclusions++;
      setTimeout(
        () => reply({ type: "posedOcclusion", id: msg.id, attachments: [Float32Array.of(0.5)] }),
        1,
      );
      return;
    }
    if (msg.type === "adultLayers") {
      this.adultLayerRequests++;
      this.later.then(
        () =>
          reply({
            type: "adultLayers",
            id: msg.id,
            update: { layers: ["penis-skin"], layerFields: Float32Array.of(0.25, 0.5) },
          }),
        fail,
      );
      return;
    }
    if (msg.type === "adultSurface") {
      this.adultSurfaceRequests++;
      setTimeout(
        () =>
          reply({
            type: "adultSurface",
            id: msg.id,
            topology: {
              index: Uint32Array.of(0, 1, 1),
              uvs: Float32Array.of(0, 0, 1, 1),
              skinIndex: new Uint16Array(8),
              skinWeight: new Float32Array(8),
              vertexCount: 2,
              uvScale: Float32Array.of(1, 2),
              occlusion: new Uint8Array(16).fill(255),
            },
          }),
        1,
      );
      return;
    }
    if (msg.type === "init") {
      setTimeout(() => {
        if (this.failInit)
          reply({ type: "error", id: msg.id, message: "no packs", name: "AssetFormatError" });
        else
          reply({
            type: "ready",
            id: msg.id,
            topology: { body: {} as never, attachments: [] },
            modifiers: [],
            sliders: [],
            rig: EMPTY_RIG,
            presenceJoints: {} as never,
            adultAnatomyLoaded: false,
          });
      }, 1);
      return;
    }
    const age = msg.recipe.macros.age;
    const needs = age >= 50 ? this.later : Promise.resolve();
    needs.then(() => {
      setTimeout(() => {
        this.evaluated.push(age);
        reply({ type: "evaluated", id: msg.id, ms: 0, evaluation: { age } as never });
      }, 1);
    }, fail);
  }
  terminate() {
    this.terminated = true;
  }
}

const make = (failInit = false, later?: Promise<void>) => {
  const worker = new FakeWorker(failInit, later);
  return {
    worker,
    client: new HumanoidWorkerClient({ body: "x" }, {}, worker as unknown as Worker),
  };
};
const recipe = (age: number) => createRecipe({ macros: { age } });
const gate = () => {
  let release = () => {};
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};

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

  it("never holds one figure up behind another that waits for its targets", async () => {
    const later = gate();
    const { client, worker } = make(false, later.promise);
    const old = client.evaluate(recipe(70), "a");
    const young = client.evaluate(recipe(30), "b");
    await expect(young).resolves.toMatchObject({ age: 30 });
    // The same key waits behind its own evaluation, keeping only the newest.
    const a2 = client.evaluate(recipe(71), "a");
    const a3 = client.evaluate(recipe(72), "a");
    await expect(a2).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.evaluated).toEqual([30]);
    later.release();
    await expect(old).resolves.toMatchObject({ age: 70 });
    await expect(a3).resolves.toMatchObject({ age: 72 });
    await client.complete;
    expect(worker.evaluated).toEqual([30, 70, 72]);
  });

  it("reports a failed load on what needs it, and on complete", async () => {
    const failure = Object.assign(new Error("targets-old.bin.gz failed: 404"), {
      name: "AssetFormatError",
    });
    const failed = Promise.reject(failure);
    // Observed here; the stand-in only subscribes once the client asks.
    failed.catch(() => {});
    const { client } = make(false, failed);
    await expect(client.complete).rejects.toMatchObject({ name: "AssetFormatError" });
    await expect(client.evaluate(recipe(70))).rejects.toMatchObject({ name: "AssetFormatError" });
    await expect(client.evaluate(recipe(30))).resolves.toMatchObject({ age: 30 });
  });

  it("asks the worker for the pick map once, after everything has loaded", async () => {
    const later = gate();
    const { client, worker } = make(false, later.promise);
    const first = client.pickMap();
    expect(client.pickMap()).toBe(first);
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await client.ready;
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    later.release();
    const map = await first;
    expect(map.features[0]?.group).toBe("nose features");
    expect([...map.render.body]).toEqual([0, 255]);
    expect(worker.pickMaps).toBe(1);
  });

  it("asks the worker for the posed occlusion once", async () => {
    const { client, worker } = make(false);
    const first = client.posedOcclusion();
    expect(client.posedOcclusion()).toBe(first);
    expect([...((await first)?.[0] ?? [])]).toEqual([0.5]);
    expect(worker.posedOcclusions).toBe(1);
  });

  it("asks the worker for the adult layer fields once, and shares the answer", async () => {
    const later = gate();
    const { client, worker } = make(false, later.promise);
    const first = client.adultLayers();
    expect(client.adultLayers()).toBe(first);
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await client.ready;
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    later.release();
    const update = await first;
    expect(update?.layers).toEqual(["penis-skin"]);
    expect([...(update?.layerFields ?? [])]).toEqual([0.25, 0.5]);
    expect(worker.adultLayerRequests).toBe(1);
  });

  it("asks the worker for the adult surface once, and shares the answer", async () => {
    const { client, worker } = make(false);
    const first = client.adultSurface();
    expect(client.adultSurface()).toBe(first);
    const topology = await first;
    expect(topology?.vertexCount).toBe(2);
    expect([...(topology?.uvScale ?? [])]).toEqual([1, 2]);
    expect(worker.adultSurfaceRequests).toBe(1);
  });

  it("fails queued evaluations when the worker cannot initialise", async () => {
    const { client } = make(true);
    await expect(client.evaluate(recipe(30))).rejects.toMatchObject({ message: "no packs" });
    await expect(client.ready).rejects.toMatchObject({ name: "AssetFormatError" });
    await expect(client.complete).rejects.toMatchObject({ name: "AssetFormatError" });
  });
});
