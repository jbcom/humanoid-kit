/**
 * A zip archive's entries, read from its central directory: enough for the
 * asset archives the packers take (stored or deflated entries, no encryption,
 * no zip64), without a system `unzip` (which reads `[` in a name as a pattern).
 */
import { inflateRawSync } from "node:zlib";

export interface ZipEntries {
  /** Every file's path in the archive (directories left out). */
  names: string[];
  /** A file's bytes, inflated. */
  read(name: string): Buffer;
}

export function readZip(file: Buffer): ZipEntries {
  // The end of central directory record is the last 22 bytes, or just before a comment.
  let eocd = -1;
  for (let i = file.length - 22; i >= Math.max(0, file.length - 22 - 65535); i--) {
    if (file.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end of central directory");
  const count = file.readUInt16LE(eocd + 10);
  let o = file.readUInt32LE(eocd + 16);
  const entries = new Map<string, { method: number; size: number; offset: number }>();
  for (let i = 0; i < count; i++) {
    if (file.readUInt32LE(o) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = file.readUInt16LE(o + 10);
    const size = file.readUInt32LE(o + 20);
    const nameLength = file.readUInt16LE(o + 28);
    const extraLength = file.readUInt16LE(o + 30);
    const commentLength = file.readUInt16LE(o + 32);
    const offset = file.readUInt32LE(o + 42);
    const name = file.toString("utf8", o + 46, o + 46 + nameLength);
    if (!name.endsWith("/")) entries.set(name, { method, size, offset });
    o += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`no ${name} in the archive`);
      if (file.readUInt32LE(e.offset) !== 0x04034b50)
        throw new Error(`bad local header for ${name}`);
      const start =
        e.offset + 30 + file.readUInt16LE(e.offset + 26) + file.readUInt16LE(e.offset + 28);
      const data = file.subarray(start, start + e.size);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
      throw new Error(`${name}: compression method ${e.method}`);
    },
  };
}
