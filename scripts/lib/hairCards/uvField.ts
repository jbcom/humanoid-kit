/**
 * A value known on the cards' surface, spread over their texture: for each texel the cards cover,
 * the value of a function of where on the head that texel lies at rest. It lets an authored strand
 * map follow the head (a fade that is bare at the nape and full at the crown) though the atlas knows
 * nothing of the head, only of its own islands. A texel on no card is `NaN`.
 */
import { Vector3 } from "three";
import type { HeadFrame } from "./head.ts";

export interface CardGeometry {
  /** Rest positions of the cards' vertices, `x y z` each. */
  positions: Float32Array;
  /** Four vertex indices per quad. */
  faceVerts: Uint32Array;
  /** Four UV indices per quad, into `uvs`. */
  faceUvs: Uint32Array;
  /** `u v` per UV, V up (a texture's top row is V = 1). */
  uvs: Float32Array;
}

/** Where a point is on the head, as angles from the skull's centre: azimuth from the front, either side, and elevation. */
export function headAngles(head: HeadFrame, p: Vector3): { azimuth: number; elevation: number } {
  const d = new Vector3().subVectors(p, head.centre);
  return {
    azimuth: (Math.abs(Math.atan2(d.x, d.z)) * 180) / Math.PI,
    elevation: (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI,
  };
}

/** `value` of the head position of every texel the cards cover (NaN where none does), `width` by `height`, top row first. */
export function texelField(
  cards: CardGeometry,
  head: HeadFrame,
  width: number,
  height: number,
  value: (azimuth: number, elevation: number) => number,
): Float32Array {
  const field = new Float32Array(width * height).fill(Number.NaN);
  const at = (v: number) =>
    new Vector3(
      cards.positions[v * 3] as number,
      cards.positions[v * 3 + 1] as number,
      cards.positions[v * 3 + 2] as number,
    );
  const faces = cards.faceVerts.length / 4;
  const corner = new Vector3();
  const rasterise = (a: number, b: number, c: number, fa: number, fb: number, fc: number) => {
    // Triangle in texel space (x right, y down), the three vertices' positions to interpolate.
    const px = (f: number) => (cards.uvs[(cards.faceUvs[f] as number) * 2] as number) * width;
    const py = (f: number) =>
      (1 - (cards.uvs[(cards.faceUvs[f] as number) * 2 + 1] as number)) * height;
    const [x0, y0, x1, y1, x2, y2] = [px(fa), py(fa), px(fb), py(fb), px(fc), py(fc)] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-9) return;
    const p0 = at(a);
    const p1 = at(b);
    const p2 = at(c);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const sx = x + 0.5;
        const sy = y + 0.5;
        const w0 = ((y1 - y2) * (sx - x2) + (x2 - x1) * (sy - y2)) / denom;
        const w1 = ((y2 - y0) * (sx - x2) + (x0 - x2) * (sy - y2)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        corner.set(0, 0, 0).addScaledVector(p0, w0).addScaledVector(p1, w1).addScaledVector(p2, w2);
        const { azimuth, elevation } = headAngles(head, corner);
        field[y * width + x] = value(azimuth, elevation);
      }
  };
  for (let f = 0; f < faces; f++) {
    const v = (k: number) => cards.faceVerts[f * 4 + k] as number;
    rasterise(v(0), v(1), v(2), f * 4, f * 4 + 1, f * 4 + 2);
    rasterise(v(0), v(2), v(3), f * 4, f * 4 + 2, f * 4 + 3);
  }
  return field;
}
