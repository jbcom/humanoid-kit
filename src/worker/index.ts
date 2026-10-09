/**
 * Worker entry: evaluates recipes off the main thread (`createWorkerHandler`).
 */
import { createWorkerHandler } from "./handler.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const handle = createWorkerHandler((msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer),
);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  void handle(e.data);
};
