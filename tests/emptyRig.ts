import type { ReadyInfo } from "../src/worker/protocol.ts";

/** A rig with no bones, for test doubles of the worker's ready reply. */
export const EMPTY_RIG: ReadyInfo["rig"] = {
  bones: [],
  parents: new Int16Array(0),
  faceUnits: { names: [], joints: [], frames: [] },
  poses: [],
  skin: {
    skinIndex: new Uint8Array(0),
    skinWeight: new Float32Array(0),
    bodyVertices: new Uint32Array(0),
  },
};
