/**
 * What a skeletal animation needs from a glTF binary (.glb): the skin's joints
 * (their parents and rest transforms) and each animation's rotation tracks. No
 * meshes, no materials, no extensions: the Quaternius libraries are plain
 * Blender exports.
 */
export interface GlbJoint {
  name: string;
  /** Index into `joints`, or -1 for the root. */
  parent: number;
  /** Rest local rotation (x, y, z, w) and translation. */
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

export interface GlbTrack {
  /** Joint index. */
  joint: number;
  times: Float32Array;
  /** `times.length` quaternions (x, y, z, w). */
  rotations: Float32Array;
}

export interface GlbAnimation {
  name: string;
  duration: number;
  /** Rotation tracks by joint; a joint with none keeps its rest rotation. */
  tracks: GlbTrack[];
}

export interface GlbRig {
  joints: GlbJoint[];
  animations: GlbAnimation[];
}

interface Json {
  nodes: {
    name?: string;
    children?: number[];
    rotation?: number[];
    translation?: number[];
  }[];
  skins: { joints: number[] }[];
  accessors: { bufferView: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  animations?: {
    name?: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
}

const FLOAT = 5126;

/** Splits a .glb into its JSON and binary chunks. */
export function parseGlb(file: Uint8Array): { json: Json; bin: Uint8Array } {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const length = view.getUint32(8, true);
  let o = 12;
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  while (o < length) {
    const size = view.getUint32(o, true);
    const type = view.getUint32(o + 4, true);
    const chunk = file.subarray(o + 8, o + 8 + size);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Json;
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + size;
  }
  if (!json || !bin) throw new Error("the glb has no JSON or no binary chunk");
  return { json, bin };
}

/** An accessor's floats (the animation inputs and outputs are float32), as a copy. */
function floats(json: Json, bin: Uint8Array, accessor: number): Float32Array {
  const a = json.accessors[accessor];
  if (!a || a.componentType !== FLOAT) throw new Error(`accessor ${accessor} is not float32`);
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  if (width === undefined) throw new Error(`accessor ${accessor}: ${a.type}`);
  const view = json.bufferViews[a.bufferView];
  if (!view) throw new Error(`accessor ${accessor} has no buffer view`);
  const stride = view.byteStride ?? width * 4;
  const out = new Float32Array(a.count * width);
  const dv = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0), view.byteLength);
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < width; c++) out[i * width + c] = dv.getFloat32(i * stride + c * 4, true);
  return out;
}

/** The first skin's joints and the animations' rotation tracks. */
export function readRig(file: Uint8Array): GlbRig {
  const { json, bin } = parseGlb(file);
  const skin = json.skins[0];
  if (!skin) throw new Error("the glb has no skin");
  const index = new Map(skin.joints.map((node, j) => [node, j]));
  const parent = new Array<number>(skin.joints.length).fill(-1);
  json.nodes.forEach((n, node) => {
    const p = index.get(node);
    if (p === undefined) return;
    for (const c of n.children ?? []) {
      const j = index.get(c);
      if (j !== undefined) parent[j] = p;
    }
  });
  const joints: GlbJoint[] = skin.joints.map((node, j) => {
    const n = json.nodes[node];
    if (!n) throw new Error(`no node ${node}`);
    return {
      name: n.name ?? `joint${j}`,
      parent: parent[j] as number,
      rotation: (n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number],
      translation: (n.translation ?? [0, 0, 0]) as [number, number, number],
    };
  });
  const animations: GlbAnimation[] = (json.animations ?? []).map((a) => {
    const tracks: GlbTrack[] = [];
    let duration = 0;
    for (const c of a.channels) {
      if (c.target.path !== "rotation") continue;
      const joint = index.get(c.target.node);
      const sampler = a.samplers[c.sampler];
      if (joint === undefined || !sampler) continue;
      if (sampler.interpolation && sampler.interpolation !== "LINEAR")
        throw new Error(`${a.name}: ${sampler.interpolation} rotation interpolation`);
      const times = floats(json, bin, sampler.input);
      tracks.push({ joint, times, rotations: floats(json, bin, sampler.output) });
      duration = Math.max(duration, times[times.length - 1] as number);
    }
    return { name: a.name ?? "animation", duration, tracks };
  });
  return { joints, animations };
}
