/**
 * The miniature binary (docs/MINIATURES.md): one archetype's bake in one
 * buffer a build step can commit and a page or worker can transfer.
 *
 *   "HKMB" | u32 version | u32 header bytes | header JSON (UTF-8) | padding to 4 | sections
 *
 * The header names every section's offset and length from the start of the
 * sections. Positions are half floats (about a millimetre at a figure's
 * height), normals are octahedral pairs of signed bytes (about a degree and a
 * half), colours sRGB bytes, and indices 16-bit when the vertex set allows.
 * Encoding is deterministic: the same bake gives the same bytes.
 */
import type { MiniatureBake, MiniatureClip } from "./miniature.ts";

export class MiniatureFormatError extends Error {
  override name = "MiniatureFormatError";
}

const MAGIC = [0x48, 0x4b, 0x4d, 0x42]; // "HKMB"
export const MINIATURE_FORMAT_VERSION = 1;

interface Section {
  offset: number;
  byteLength: number;
}

interface Header {
  body: string;
  vertexCount: number;
  frameCount: number;
  clips: MiniatureClip[];
  min: [number, number, number];
  max: [number, number, number];
  index: "u16" | "u32";
  lods: { target: number; index: Section; normals: Section }[];
  colour: Section;
  channel: Section;
  positions: Section;
}

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** IEEE 754 half precision of `value`, rounded to nearest even; overflow saturates to infinity. */
export function toHalf(value: number): number {
  F32[0] = value;
  const x = U32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rest = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rest > mid || (rest === mid && half & 1)) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && half & 1)) half++;
  e = half >>> 10;
  return sign | (e >= 0x1f ? 0x7c00 : half);
}

/** The number a half float's bits stand for. */
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

const snorm8 = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));

/** A unit normal as an octahedral pair of signed bytes. */
export function octEncode(x: number, y: number, z: number): [number, number] {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l1;
  let v = y / l1;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  return [snorm8(u), snorm8(v)];
}

/** The unit normal of an octahedral pair. */
export function octDecode(a: number, b: number): [number, number, number] {
  let x = a / 127;
  let y = b / 127;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** The bake as one deterministic buffer. */
export function encodeMiniature(bake: MiniatureBake): Uint8Array {
  const N = bake.vertexCount;
  const F = bake.frameCount;
  const wide = N > 0xffff;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const add = (bytes: Uint8Array): Section => {
    size = Math.ceil(size / 4) * 4;
    const s = { offset: size, byteLength: bytes.byteLength };
    chunks.push(bytes);
    size += bytes.byteLength;
    return s;
  };
  const view = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const colour = add(bake.colour);
  const channel = add(bake.channel);
  const halves = new Uint16Array(F * N * 3);
  for (let i = 0; i < halves.length; i++) halves[i] = toHalf(bake.positions[i] as number);
  const positions = add(view(halves));
  const lods = bake.lods.map((l) => {
    const index = add(view(wide ? Uint32Array.from(l.index) : Uint16Array.from(l.index)));
    const oct = new Int8Array(F * N * 2);
    for (let i = 0; i < F * N; i++) {
      const [a, b] = octEncode(
        l.normals[i * 3] as number,
        l.normals[i * 3 + 1] as number,
        l.normals[i * 3 + 2] as number,
      );
      oct[i * 2] = a;
      oct[i * 2 + 1] = b;
    }
    return { target: l.target, index, normals: add(view(oct)) };
  });
  const header: Header = {
    body: bake.body,
    vertexCount: N,
    frameCount: F,
    clips: bake.clips,
    min: bake.min,
    max: bake.max,
    index: wide ? "u32" : "u16",
    lods,
    colour,
    channel,
    positions,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = Math.ceil((12 + json.byteLength) / 4) * 4;
  const out = new Uint8Array(start + size);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, MINIATURE_FORMAT_VERSION, true);
  dv.setUint32(8, json.byteLength, true);
  out.set(json, 12);
  let o = 0;
  for (const c of chunks) {
    o = Math.ceil(o / 4) * 4;
    out.set(c, start + o);
    o += c.byteLength;
  }
  return out;
}

/** A bake from `encodeMiniature`'s bytes; positions and normals come back as their quantized values. */
export function decodeMiniature(data: ArrayBuffer | Uint8Array): MiniatureBake {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 12 || MAGIC.some((m, i) => bytes[i] !== m))
    throw new MiniatureFormatError("not a miniature bake");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== MINIATURE_FORMAT_VERSION)
    throw new MiniatureFormatError(
      `miniature format ${version}; this kit reads ${MINIATURE_FORMAT_VERSION}`,
    );
  const jsonLength = dv.getUint32(8, true);
  if (12 + jsonLength > bytes.byteLength) throw new MiniatureFormatError("truncated header");
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(12, 12 + jsonLength)),
  ) as Header;
  const start = Math.ceil((12 + jsonLength) / 4) * 4;
  const N = header.vertexCount;
  const F = header.frameCount;
  // Copied out, so the bake owns 4-aligned buffers it can transfer.
  const section = (s: Section, expect: number): Uint8Array => {
    if (s.byteLength !== expect || start + s.offset + s.byteLength > bytes.byteLength)
      throw new MiniatureFormatError("a section is out of bounds or the wrong size");
    return bytes.slice(start + s.offset, start + s.offset + s.byteLength);
  };
  const halves = new Uint16Array(section(header.positions, F * N * 6).buffer);
  const positions = new Float32Array(halves.length);
  for (let i = 0; i < halves.length; i++) positions[i] = fromHalf(halves[i] as number);
  const width = header.index === "u32" ? 4 : 2;
  const lods = header.lods.map((l) => {
    if (l.index.byteLength % (width * 3) !== 0)
      throw new MiniatureFormatError("an index section is not whole triangles");
    const raw = section(l.index, l.index.byteLength);
    const index = Uint32Array.from(
      width === 4 ? new Uint32Array(raw.buffer) : new Uint16Array(raw.buffer),
    );
    for (const v of index) if (v >= N) throw new MiniatureFormatError("an index is out of range");
    const oct = new Int8Array(section(l.normals, F * N * 2).buffer);
    const normals = new Float32Array(F * N * 3);
    for (let i = 0; i < F * N; i++)
      normals.set(octDecode(oct[i * 2] as number, oct[i * 2 + 1] as number), i * 3);
    return { target: l.target, index, normals };
  });
  return {
    body: header.body,
    vertexCount: N,
    lods,
    colour: section(header.colour, N * 3),
    channel: section(header.channel, N),
    frameCount: F,
    positions,
    clips: header.clips,
    min: header.min,
    max: header.max,
  };
}

/** The bake's buffers, for `postMessage`'s transfer list. */
export function miniatureTransferables(bake: MiniatureBake): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [
    bake.colour,
    bake.channel,
    bake.positions,
    ...bake.lods.flatMap((l) => [l.index, l.normals]),
  ])
    out.add(a.buffer as ArrayBuffer);
  return [...out];
}
