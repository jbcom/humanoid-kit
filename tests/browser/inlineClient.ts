/**
 * A `HumanoidWorkerClient` whose "worker" is the real worker handler running on
 * the page's own thread, so React tests exercise the whole evaluation path
 * (packs from the dev server, the model, the protocol) without a Worker.
 */
import { bodyPack } from "humanoid-kit-body";
import type { ModelOptions } from "../../src/model/humanoidModel.ts";
import { HumanoidWorkerClient } from "../../src/worker/client.ts";
import { createWorkerHandler } from "../../src/worker/handler.ts";
import type { WorkerRequest, WorkerResponse } from "../../src/worker/protocol.ts";

class InlineWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private readonly handle = createWorkerHandler((data) =>
    queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<WorkerResponse>)),
  );
  postMessage(request: WorkerRequest) {
    void this.handle(request);
  }
  terminate() {}
}

export function inlineWorkerClient(model: ModelOptions = { subdivision: 0 }) {
  return new HumanoidWorkerClient(
    { body: bodyPack },
    model,
    new InlineWorker() as unknown as Worker,
  );
}
