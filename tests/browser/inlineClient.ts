/**
 * A `HumanoidWorkerClient` whose "worker" is the real worker handler running on
 * the page's own thread, so React tests exercise the whole evaluation path
 * (packs from the dev server, the model, the protocol) without a Worker.
 */
import { adultAnatomyPack } from "humanoid-kit-adult-anatomy";
import { bodyPack } from "humanoid-kit-body";
import { clothingPack } from "humanoid-kit-clothing";
import { hairPack } from "humanoid-kit-hair";
import type { ModelOptions } from "../../src/model/humanoidModel.ts";
import { HumanoidWorkerClient } from "../../src/worker/client.ts";
import { createWorkerHandler } from "../../src/worker/handler.ts";
import type { WorkerRequest, WorkerResponse } from "../../src/worker/protocol.ts";

class InlineWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private readonly handle: ReturnType<typeof createWorkerHandler>;
  private readonly tap: ((request: WorkerRequest) => void) | undefined;
  /**
   * `withoutPresenceJoints` reports the body pack as lacking the joints presence reads;
   * `tap` sees every request that reaches the worker.
   */
  constructor(withoutPresenceJoints: boolean, tap?: (request: WorkerRequest) => void) {
    this.tap = tap;
    this.handle = createWorkerHandler((reply) => {
      const data =
        withoutPresenceJoints && reply.type === "ready"
          ? { ...reply, presenceJoints: null }
          : reply;
      queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<WorkerResponse>));
    });
  }
  postMessage(request: WorkerRequest) {
    this.tap?.(request);
    void this.handle(request);
  }
  terminate() {}
}

export function inlineWorkerClient(
  model: ModelOptions = { subdivision: 0 },
  options: {
    withoutPresenceJoints?: boolean;
    hair?: boolean;
    adultAnatomy?: boolean;
    clothing?: boolean;
    /** Sees every request the worker receives, recipes included. */
    onRequest?: (request: WorkerRequest) => void;
  } = {},
) {
  return new HumanoidWorkerClient(
    {
      body: bodyPack,
      ...(options.hair && { hair: hairPack }),
      ...(options.adultAnatomy && { adultAnatomy: adultAnatomyPack }),
      ...(options.clothing && { clothing: clothingPack }),
    },
    model,
    new InlineWorker(
      options.withoutPresenceJoints ?? false,
      options.onRequest,
    ) as unknown as Worker,
  );
}
