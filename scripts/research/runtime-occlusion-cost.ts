/** Paired CPU cost/error observation for a real custom attachment set; no speed threshold. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { bodyPackData, loadFixtureAssets } from "../../tests/fixtures.ts";

const sourceHead = process.argv[2];
assert(sourceHead && /^[a-f0-9]{40}$/.test(sourceHead), "pass the exact40-character source commit");
const assets = loadFixtureAssets();
const pack = bodyPackData();
const sha = (bytes: ArrayBuffer | ArrayBufferView) => {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  return createHash("sha256").update(view).digest("hex");
};
const sourceHashes = () => ({
  manifest: createHash("sha256").update(JSON.stringify(pack.manifest)).digest("hex"),
  body: sha(pack.body),
  attachments: sha(pack.attachments),
  bodyOcclusion: pack.bodyOcclusion ? sha(pack.bodyOcclusion) : null,
  targets: Object.fromEntries(Object.entries(pack.targets).map(([id, bytes]) => [id, sha(bytes)])),
});
const sourceBefore = sourceHashes();
const id = "eyes/high-poly";
assert(assets.attachments.has(id), "source eyes must exist");
assert(assets.attachments.size > 1, "eyes alone must differ from the packed worn set");
const makeModel = (rays: number | undefined) =>
  new HumanoidModel(assets, {
    subdivision: 0,
    attachments: [id],
    ...(rays !== undefined && { runtimeOcclusionRays: rays }),
  });
interface Cost {
  wallMs: number;
  userMs: number;
  systemMs: number;
  cpuMs: number;
}
function timed<T>(fn: () => T): { value: T; cost: Cost } {
  const beforeCpu = process.cpuUsage();
  const beforeWall = performance.now();
  const value = fn();
  const wallMs = performance.now() - beforeWall;
  const cpu = process.cpuUsage(beforeCpu);
  return {
    value,
    cost: {
      wallMs,
      userMs: cpu.user / 1000,
      systemMs: cpu.system / 1000,
      cpuMs: (cpu.user + cpu.system) / 1000,
    },
  };
}
function drain(model: HumanoidModel): Float32Array[] {
  const steps = model.bakePosedOcclusion();
  for (;;) {
    const step = steps.next();
    if (step.done) {
      assert(step.value, "custom worn set must bake posed occlusion");
      return step.value;
    }
  }
}
function run(rays: number | undefined) {
  const construction = timed(() => makeModel(rays));
  const model = construction.value;
  assert(model.occlusionBakeRecipe(), "custom set must request a runtime bake");
  const coldRest = timed(() => model.topology());
  const cachedRest = timed(() => model.topology());
  const posed = timed(() => drain(model));
  const restField = coldRest.value.attachments[0]?.occlusion;
  assert(restField);
  assert.deepEqual(cachedRest.value.attachments[0]?.occlusion, restField);
  assert.equal(posed.value.length, 1);
  const posedField = posed.value[0];
  assert(posedField);
  return {
    costs: {
      constructor: construction.cost,
      coldRest: coldRest.cost,
      cachedRest: cachedRest.cost,
      posed: posed.cost,
    },
    restField,
    posedField,
  };
}
function difference(a: Float32Array, b: Float32Array) {
  assert.equal(a.length, b.length);
  let total = 0;
  let max = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] as number) - (b[i] as number));
    total += d;
    max = Math.max(max, d);
    changed += Number(d !== 0);
  }
  return { components: a.length, mae: total / a.length, max, changed };
}
const context = () => ({
  loadAverage: os.loadavg(),
  freeMemoryBytes: os.freemem(),
  totalMemoryBytes: os.totalmem(),
  cpuCount: os.cpus().length,
});
const started = new Date().toISOString();
const contextBefore = context();
// Full path warmups are discarded. Omitted/32 correctness checks stay outside measured samples.
const omitted = run(undefined);
const full = run(32);
const reduced = run(16);
assert.equal(
  sha(omitted.restField),
  sha(full.restField),
  "omitted rest must be byte-identical to32",
);
assert.equal(
  sha(omitted.posedField),
  sha(full.posedField),
  "omitted posed must be byte-identical to32",
);
const expected = {
  32: { rest: sha(full.restField), posed: sha(full.posedField) },
  16: { rest: sha(reduced.restField), posed: sha(reduced.posedField) },
};
const errors = {
  rest: difference(full.restField, reduced.restField),
  posed: difference(full.posedField, reduced.posedField),
};
assert(errors.rest.changed > 0, "16 must alter the actual rest bake");
assert(errors.posed.changed > 0, "16 must alter the actual posed bake");
const samples: { pair: number; rays: 16 | 32; costs: ReturnType<typeof run>["costs"] }[] = [];
const sampleStart = performance.now();
for (let pair = 0; pair < 9; pair++) {
  const order = pair % 2 === 0 ? ([32, 16] as const) : ([16, 32] as const);
  for (const rays of order) {
    const result = run(rays);
    // Hash/assert work is deliberately outside the timed model calls.
    assert.equal(sha(result.restField), expected[rays].rest);
    assert.equal(sha(result.posedField), expected[rays].posed);
    samples.push({ pair, rays, costs: result.costs });
    console.info(JSON.stringify({ pair, rays, costs: result.costs }));
  }
  if (performance.now() - sampleStart > 180_000) break;
}
assert.deepEqual(sourceHashes(), sourceBefore, "all loaded source pack buffers must be unchanged");
const stages = ["constructor", "coldRest", "cachedRest", "posed"] as const;
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
};
const summaries = [32, 16].map((rays) => {
  const selected = samples.filter((s) => s.rays === rays);
  return {
    rays,
    count: selected.length,
    stages: Object.fromEntries(
      stages.map((stage) => [
        stage,
        Object.fromEntries(
          (["wallMs", "cpuMs"] as const).map((metric) => {
            const values = selected.map((s) => s.costs[stage][metric]);
            return [metric, { p50: quantile(values, 0.5), p95: quantile(values, 0.95) }];
          }),
        ),
      ]),
    ),
  };
});
const receipt = {
  started,
  finished: new Date().toISOString(),
  sourceHead,
  scriptSha256: sha(fs.readFileSync(import.meta.filename)),
  host: {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    cpu: os.cpus()[0]?.model,
  },
  contextBefore,
  contextAfter: context(),
  uncontended: false,
  scope: {
    attachment: id,
    subdivision: 0,
    skinInfluences: 8,
    foldSolvePasses: 60,
    requestedPairs: 9,
    pairWallBudgetMs: 180_000,
    completedPairs: samples.length / 2,
    assetLoadingExcluded: true,
    sourceHashingExcluded: true,
    warmupsDiscarded: ["omitted", 32, 16],
    stages: {
      constructor: "fresh model construction",
      coldRest: "first topology; fresh model rest cache",
      cachedRest: "second topology; cached rest rays, field allocations remain",
      posed: "all seven non-rest corners recomputed with rest baseline; includes render projection",
    },
  },
  checks: {
    omittedEquals32RestBytes: true,
    omittedEquals32PosedBytes: true,
    sourceBuffersUnchanged: true,
    repeatedOutputBytesStable: true,
  },
  sourceBefore,
  outputHashes: expected,
  errors,
  summaries,
  samples,
  rendererEvidence: "runtime-occlusion-quality.md",
};
fs.mkdirSync("docs/evidence", { recursive: true });
fs.writeFileSync(
  "docs/evidence/runtime-occlusion-cost.receipt.json",
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.info("runtime-occlusion-cost-summary", JSON.stringify({ summaries, errors }));
