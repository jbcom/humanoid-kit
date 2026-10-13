/**
 * A small CPU rasteriser for sculpt iteration: smooth-shaded, zebra (isophote) and
 * wire/normal-colour views of a triangle mesh, written as PNG. It exists so a chest
 * study can be looked at in seconds; the lab's final captures use the real renderer.
 */
import fs from "node:fs";
import zlib from "node:zlib";

export type Vec3 = readonly [number, number, number];
export type Mode = "lit" | "zebra" | "normal" | "wire";

export interface Camera {
  eye: Vec3;
  target: Vec3;
  up?: Vec3;
  /** Vertical field of view, degrees (ignored when `ortho` is set). */
  fov?: number;
  /** Orthographic half-height in metres. */
  ortho?: number;
}

export interface Scene {
  positions: Float32Array;
  normals: Float32Array;
  index: ArrayLike<number>;
  /** Optional per-vertex rgb in 0..1 (lit mode multiplies the skin colour). */
  colours?: Float32Array;
  /** How much of a shaded pixel's colour is `colours` rather than the study's skin (default 0.65). */
  colourWeight?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function render(
  scene: Scene,
  camera: Camera,
  mode: Mode,
  width: number,
  height: number,
  ss = 2,
): Uint8Array {
  const colourWeight = scene.colourWeight ?? 0.65;
  const W = width * ss;
  const H = height * ss;
  const up = camera.up ?? [0, 1, 0];
  const f = norm(sub(camera.target, camera.eye));
  const r = norm(cross(f, up));
  const u = cross(r, f);
  const aspect = width / height;
  const n = scene.positions.length / 3;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const viewN = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [
      scene.positions[i * 3] as number,
      scene.positions[i * 3 + 1] as number,
      scene.positions[i * 3 + 2] as number,
    ];
    const d = sub(p, camera.eye);
    const x = dot(d, r);
    const y = dot(d, u);
    const z = dot(d, f);
    if (camera.ortho) {
      sx[i] = ((x / (camera.ortho * aspect)) * 0.5 + 0.5) * W;
      sy[i] = (0.5 - (y / camera.ortho) * 0.5) * H;
    } else {
      const t = Math.tan(((camera.fov ?? 30) * Math.PI) / 360);
      sx[i] = ((x / (z * t * aspect)) * 0.5 + 0.5) * W;
      sy[i] = (0.5 - (y / (z * t)) * 0.5) * H;
    }
    sz[i] = z;
    const nv: Vec3 = [
      scene.normals[i * 3] as number,
      scene.normals[i * 3 + 1] as number,
      scene.normals[i * 3 + 2] as number,
    ];
    viewN[i * 3] = dot(nv, r);
    viewN[i * 3 + 1] = dot(nv, u);
    viewN[i * 3 + 2] = -dot(nv, f);
  }
  const depth = new Float32Array(W * H).fill(Number.POSITIVE_INFINITY);
  const img = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    img[p * 3] = 0.075;
    img[p * 3 + 1] = 0.078;
    img[p * 3 + 2] = 0.085;
  }
  const key = norm([-0.4, 0.55, 0.75]);
  const fill = norm([0.7, 0.1, 0.5]);
  const skin: Vec3 = [0.86, 0.66, 0.55];
  const shade = (nx: number, ny: number, nz: number, c: Vec3): Vec3 => {
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (mode === "normal") return [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5];
    if (mode === "zebra") {
      // Isophote stripes from the reflection's elevation: seams and creases show as kinks.
      const rz = 2 * nz * nz - 1;
      const ry = 2 * nz * ny;
      const s = Math.sin(
        (Math.atan2(ry, rz) + Math.PI) * 14 + Math.asin(Math.max(-1, Math.min(1, 2 * nz * nx))) * 0,
      );
      const v = s > 0 ? 0.92 : 0.08;
      return [v, v, v];
    }
    const kd = Math.max(0, nx * key[0] + ny * key[1] + nz * key[2]);
    const fd = Math.max(0, nx * fill[0] + ny * fill[1] + nz * fill[2]);
    const hemi = 0.5 + 0.5 * ny;
    const k = 0.18 * hemi + 0.8 * kd + 0.22 * fd;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  const tri = (a: number, b: number, c: number) => {
    const x0 = sx[a] as number,
      y0 = sy[a] as number,
      x1 = sx[b] as number,
      y1 = sy[b] as number,
      x2 = sx[c] as number,
      y2 = sy[c] as number;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * (sz[a] as number) + w1 * (sz[b] as number) + w2 * (sz[c] as number);
        const o = y * W + x;
        if (z >= (depth[o] as number)) continue;
        depth[o] = z;
        const nx =
          w0 * (viewN[a * 3] as number) +
          w1 * (viewN[b * 3] as number) +
          w2 * (viewN[c * 3] as number);
        const ny =
          w0 * (viewN[a * 3 + 1] as number) +
          w1 * (viewN[b * 3 + 1] as number) +
          w2 * (viewN[c * 3 + 1] as number);
        const nz =
          w0 * (viewN[a * 3 + 2] as number) +
          w1 * (viewN[b * 3 + 2] as number) +
          w2 * (viewN[c * 3 + 2] as number);
        let col = skin;
        if (scene.colours)
          col = [
            skin[0] * (1 - colourWeight) +
              colourWeight *
                (w0 * (scene.colours[a * 3] as number) +
                  w1 * (scene.colours[b * 3] as number) +
                  w2 * (scene.colours[c * 3] as number)),
            skin[1] * (1 - colourWeight) +
              colourWeight *
                (w0 * (scene.colours[a * 3 + 1] as number) +
                  w1 * (scene.colours[b * 3 + 1] as number) +
                  w2 * (scene.colours[c * 3 + 1] as number)),
            skin[2] * (1 - colourWeight) +
              colourWeight *
                (w0 * (scene.colours[a * 3 + 2] as number) +
                  w1 * (scene.colours[b * 3 + 2] as number) +
                  w2 * (scene.colours[c * 3 + 2] as number)),
          ];
        const s = shade(nx, ny, nz, col);
        img[o * 3] = s[0];
        img[o * 3 + 1] = s[1];
        img[o * 3 + 2] = s[2];
      }
  };
  for (let i = 0; i + 2 < scene.index.length; i += 3)
    tri(scene.index[i] as number, scene.index[i + 1] as number, scene.index[i + 2] as number);
  if (mode === "wire") {
    const line = (a: number, b: number) => {
      let x0 = sx[a] as number,
        y0 = sy[a] as number;
      const x1 = sx[b] as number,
        y1 = sy[b] as number;
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
      const za = sz[a] as number,
        zb = sz[b] as number;
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        const x = Math.round(x0 + (x1 - x0) * t),
          y = Math.round(y0 + (y1 - y0) * t);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = y * W + x;
        if (za + (zb - za) * t > (depth[o] as number) + 0.004) continue;
        img[o * 3] = 0.1;
        img[o * 3 + 1] = 0.95;
        img[o * 3 + 2] = 0.8;
      }
      x0 = x1;
    };
    for (let i = 0; i + 2 < scene.index.length; i += 3) {
      const a = scene.index[i] as number,
        b = scene.index[i + 1] as number,
        c = scene.index[i + 2] as number;
      line(a, b);
      line(b, c);
      line(c, a);
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let dy = 0; dy < ss; dy++)
          for (let dx = 0; dx < ss; dx++)
            s += img[((y * ss + dy) * W + x * ss + dx) * 3 + ch] as number;
        const v = s / (ss * ss);
        out[(y * width + x) * 4 + ch] = Math.round(Math.max(0, Math.min(1, v ** (1 / 2.2))) * 255);
      }
      out[(y * width + x) * 4 + 3] = 255;
    }
  return out;
}

/** Tiles equal-sized RGBA images in a row-major grid with a 4 px gutter. */
export function montage(
  tiles: Uint8Array[],
  w: number,
  h: number,
  cols: number,
): { data: Uint8Array; width: number; height: number } {
  const rows = Math.ceil(tiles.length / cols);
  const gut = 4;
  const width = cols * w + (cols + 1) * gut;
  const height = rows * h + (rows + 1) * gut;
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = 30;
    data[p * 4 + 1] = 31;
    data[p * 4 + 2] = 34;
    data[p * 4 + 3] = 255;
  }
  tiles.forEach((t, i) => {
    const ox = gut + (i % cols) * (w + gut);
    const oy = gut + Math.floor(i / cols) * (h + gut);
    for (let y = 0; y < h; y++)
      data.set(t.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
  });
  return { data, width, height };
}

export function writePng(file: string, rgba: Uint8Array, width: number, height: number): void {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
