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

/**
 * WebGL renderer strings whose frame times do not measure a display's GPU: software
 * rasterisers (they measure the CPU) and the virtual GPU of a hosted macOS runner (an
 * "Apple Paravirtual device", which draws one figure in 75 to 100 ms where an M1 Pro
 * holds 60 Hz with 500).
 */
const UNPACED_RENDERER = /swiftshader|llvmpipe|softpipe|basic render driver|paravirtual/i;

/** Whether frame times on this WebGL renderer can be judged against a display's rate. */
export const judgesFramePacing = (renderer: string): boolean => !UNPACED_RENDERER.test(renderer);

/**
 * The description of a frame-pacing skip, counted by scripts/ci/skipLedger.ts on either
 * lane: the draw budgets still run there, only the frame time goes unjudged.
 */
export const FRAME_PACING_SKIP =
  "frame-pacing-unjudged: a software or virtual GPU does not hold a display's rate";
