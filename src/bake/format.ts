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
import { assertFacialHairGreyMask } from "../surface/facialHairGrey.ts";
import type { MiniatureAlphaCard, MiniatureBake, MiniatureClip } from "./miniature.ts";

export class MiniatureFormatError extends Error {
  override name = "MiniatureFormatError";
}

const MAGIC = [0x48, 0x4b, 0x4d, 0x42]; // "HKMB"
export const MINIATURE_FORMAT_VERSION = 3;

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
  alphaCards?: HeaderAlphaCard[];
}

interface HeaderAlphaCard {
  id: string;
  vertexCount: number;
  index: "u16" | "u32";
  topology: Section;
  uvs: Section;
  positions: Section;
  normals: Section;
  texture: { width: number; height: number; rgba: Section };
  tint: [number, number, number];
  grey?: Omit<NonNullable<MiniatureAlphaCard["grey"]>, "data"> & { data: Section };
}

/** The mask is required appearance data; never encode an invalid or silently dropped field. */
function validateGrey(grey: NonNullable<MiniatureAlphaCard["grey"]>): void {
  try {
    assertFacialHairGreyMask(grey);
    if (
      !Number.isFinite(grey.amount) ||
      grey.amount < 0 ||
      grey.amount > 1 ||
      !Array.isArray(grey.tint) ||
      grey.tint.length !== 3 ||
      grey.tint.some((value) => !Number.isFinite(value) || value < 0)
    )
      throw new Error("grey amount/tint is invalid");
  } catch (error) {
    throw new MiniatureFormatError(`bad alpha-card grey mask: ${(error as Error).message}`);
  }
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
  const alphaCards = bake.alphaCards?.map((card): HeaderAlphaCard => {
    const wideCard = card.vertexCount > 0xffff;
    if (card.grey !== undefined) validateGrey(card.grey);
    const grey =
      card.grey && card.grey.amount > 0 && card.grey.data.some((value) => value !== 0)
        ? card.grey
        : undefined;
    return {
      id: card.id,
      vertexCount: card.vertexCount,
      index: wideCard ? "u32" : "u16",
      topology: add(view(wideCard ? Uint32Array.from(card.index) : Uint16Array.from(card.index))),
      uvs: add(view(card.uvs)),
      positions: add(view(card.positions)),
      normals: add(view(card.normals)),
      texture: {
        width: card.texture.width,
        height: card.texture.height,
        rgba: add(view(card.texture.rgba)),
      },
      tint: card.tint,
      ...(grey && { grey: { ...grey, data: add(view(grey.data)) } }),
    };
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
    ...(alphaCards?.length && { alphaCards }),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = Math.ceil((12 + json.byteLength) / 4) * 4;
  const out = new Uint8Array(start + size);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, alphaCards?.some((card) => card.grey) ? MINIATURE_FORMAT_VERSION : 2, true);
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
  if (version !== 1 && version !== 2 && version !== MINIATURE_FORMAT_VERSION)
    throw new MiniatureFormatError(
      `miniature format ${version}; this kit reads 1, 2 and ${MINIATURE_FORMAT_VERSION}`,
    );
  const jsonLength = dv.getUint32(8, true);
  if (12 + jsonLength > bytes.byteLength) throw new MiniatureFormatError("truncated header");
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(12, 12 + jsonLength)),
  ) as Header;
  if (version >= 2 && header.alphaCards !== undefined && !Array.isArray(header.alphaCards))
    throw new MiniatureFormatError("bad alpha-card header");
  if (
    version < 3 &&
    Array.isArray(header.alphaCards) &&
    header.alphaCards.some((card) => card?.grey !== undefined)
  )
    throw new MiniatureFormatError("alpha-card grey masks require miniature v3");
  const start = Math.ceil((12 + jsonLength) / 4) * 4;
  const N = header.vertexCount;
  const F = header.frameCount;
  const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!whole(N) || !whole(F) || F < 1) throw new MiniatureFormatError("bad vertex or frame count");
  for (const c of header.clips)
    if (!whole(c.start) || !whole(c.frames) || c.frames < 1 || c.start + c.frames > F)
      throw new MiniatureFormatError(`clip ${c.name} runs past the frames`);
  // Copied out, so the bake owns 4-aligned buffers it can transfer.
  const section = (s: Section, expect: number): Uint8Array => {
    if (
      !whole(s.offset) ||
      s.byteLength !== expect ||
      start + s.offset + s.byteLength > bytes.byteLength
    )
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
  const alphaCards =
    version === 1
      ? undefined
      : header.alphaCards?.map((card): MiniatureAlphaCard => {
          if (
            typeof card.id !== "string" ||
            !whole(card.vertexCount) ||
            card.vertexCount < 1 ||
            (card.index !== "u16" && card.index !== "u32") ||
            !Number.isInteger(card.texture?.width) ||
            !Number.isInteger(card.texture?.height) ||
            card.texture.width < 1 ||
            card.texture.height < 1 ||
            !Array.isArray(card.tint) ||
            card.tint.length !== 3 ||
            card.tint.some((value) => !Number.isFinite(value))
          )
            throw new MiniatureFormatError("bad alpha-card header");
          const cardWidth = card.index === "u32" ? 4 : 2;
          if (card.topology.byteLength % (cardWidth * 3) !== 0)
            throw new MiniatureFormatError("an alpha-card index is not whole triangles");
          const rawIndex = section(card.topology, card.topology.byteLength);
          const index = Uint32Array.from(
            cardWidth === 4 ? new Uint32Array(rawIndex.buffer) : new Uint16Array(rawIndex.buffer),
          );
          for (const vertex of index)
            if (vertex >= card.vertexCount)
              throw new MiniatureFormatError("an alpha-card index is out of range");
          let grey: MiniatureAlphaCard["grey"];
          if (card.grey !== undefined) {
            const field = card.grey;
            if (
              !field ||
              !Number.isSafeInteger(field.width) ||
              !Number.isSafeInteger(field.height) ||
              field.width < 1 ||
              field.height < 1 ||
              !Number.isSafeInteger(field.width * field.height)
            )
              throw new MiniatureFormatError("bad alpha-card grey mask dimensions");
            if (!field.data || typeof field.data !== "object")
              throw new MiniatureFormatError("bad alpha-card grey mask section");
            grey = { ...field, data: section(field.data, field.width * field.height) };
            validateGrey(grey);
          }
          return {
            id: card.id,
            vertexCount: card.vertexCount,
            index,
            uvs: new Float32Array(section(card.uvs, card.vertexCount * 2 * 4).buffer),
            positions: new Float32Array(
              section(card.positions, F * card.vertexCount * 3 * 4).buffer,
            ),
            normals: new Float32Array(section(card.normals, F * card.vertexCount * 3 * 4).buffer),
            texture: {
              width: card.texture.width,
              height: card.texture.height,
              rgba: section(card.texture.rgba, card.texture.width * card.texture.height * 4),
            },
            tint: [card.tint[0], card.tint[1], card.tint[2]],
            ...(grey && { grey }),
          };
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
    ...(alphaCards?.length && { alphaCards }),
  };
}

/** The bake's buffers, for `postMessage`'s transfer list. */
export function miniatureTransferables(bake: MiniatureBake): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [
    bake.colour,
    bake.channel,
    bake.positions,
    ...(bake.alphaCards?.flatMap((card) => [
      card.index,
      card.uvs,
      card.positions,
      card.normals,
      card.texture.rgba,
      ...(card.grey ? [card.grey.data] : []),
    ]) ?? []),
    ...bake.lods.flatMap((l) => [l.index, l.normals]),
  ])
    out.add(a.buffer as ArrayBuffer);
  return [...out];
}
