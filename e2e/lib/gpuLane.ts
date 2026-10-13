import { browserRun } from "../../scripts/lib/browserRun.ts";

/**
 * Whether this run has a GPU render lane: the render Macs' ANGLE Metal, the native GPU of
 * a local run, or a Vulkan runner named by `HK_GPU`. Only software rendering (hosted CI's
 * SwiftShader) lacks one. The decision is `browserRun`'s, so the specs and the browser
 * config can never disagree about it.
 */
export const gpuLane = browserRun(process.env, process.platform).gpuMode !== "software";

/**
 * The description every GPU-lane skip carries. scripts/ci/skipLedger.ts counts skips by
 * this exact text, so a skip with any other reason is reported as unaccounted for.
 */
export const GPU_LANE_SKIP = "gpu-lane-required: needs a GPU render lane, not software rendering";
