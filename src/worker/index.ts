/**
 * Worker entry: owns one `HumanoidModel` and evaluates recipes off the main
 * thread. Results are transferred, not copied.
 */
import { loadHumanoidAssets } from "../format/assetFormat.ts";
import { HumanoidModel } from "../model/humanoidModel.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let model: HumanoidModel | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === "init") {
      const assets = await loadHumanoidAssets(req.load);
      model = new HumanoidModel(assets, req.model);
      const topology = model.topology();
      post({
        type: "ready",
        id: req.id,
        topology,
        modifiers: [...assets.modifiers.values()],
        sliders: assets.sliders,
        bones: assets.manifest.skeleton.bones.map((b) => b.name),
        adultAnatomyLoaded: assets.adultAnatomyLoaded,
      });
      return;
    }
    if (!model) throw new Error("worker received evaluate before init");
    const t0 = performance.now();
    const evaluation = model.evaluate(req.recipe);
    const transfer: Transferable[] = [
      evaluation.positions.buffer,
      evaluation.normals.buffer,
      evaluation.control.buffer,
      evaluation.curvature.buffer,
    ];
    for (const a of evaluation.attachments) transfer.push(a.positions.buffer, a.normals.buffer);
    post({ type: "evaluated", id: req.id, evaluation, ms: performance.now() - t0 }, transfer);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    post({ type: "error", id: req.id, message: error.message, name: error.name });
  }
};
