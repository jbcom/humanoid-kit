/**
 * Where palmar skin lies (docs/ARCHITECTURE.md, "Hands"): the palms and the
 * fingers' palmar sides, fading into the back of the hand along the lateral
 * borders and into the forearm at the wrist.
 *
 * The skin states' palm zone (`skinZones().palm`) is a ramp of the normal
 * against the palm's facing, which on a mesh 5 mm between vertices turns from
 * 1 to 0 within a face or two where the palm curves (the thenar and
 * hypothenar eminences), drawing the palm's colour as a polygon. Here the mask
 * is a function of distances instead, which interpolate smoothly across
 * coarse faces: the signed distance to the palmar-dorsal border (where the
 * skin turns square to the palm's facing), eased over `PALM_BORDER_BLEND`, and
 * the distance from the wrist along the hand, eased over `PALM_WRIST_BLEND`.
 */
import type { HumanoidAssets } from "../../../format/assetFormat.ts";
import { handFrame, smoothstep } from "./frame.ts";

/**
 * The transition across the palmar-dorsal border, metres from it: from fully
 * dorsal to fully palmar, 1.6 cm (CHOICE: the 1 to 2 cm over which the palm's
 * colour gives way to the back's along the hand's sides).
 */
export const PALM_BORDER_BLEND: [number, number] = [-0.006, 0.01];
/** The transition at the wrist, metres along the hand from the wrist joint (CHOICE: the distal wrist crease lies just past it). */
export const PALM_WRIST_BLEND: [number, number] = [-0.008, 0.012];

const maskCache = new WeakMap<HumanoidAssets, Float32Array>();

/** Palmar skin, 0 to 1, per base vertex. */
export function palmarMask(assets: HumanoidAssets): Float32Array {
  const known = maskCache.get(assets);
  if (known) return known;
  const frame = handFrame(assets);
  const border = palmarBorderDistance(assets);
  const out = new Float32Array(assets.manifest.vertexCount);
  for (let v = 0; v < out.length; v++) {
    if (!frame.digit[v]) continue;
    out[v] =
      smoothstep(PALM_BORDER_BLEND[0], PALM_BORDER_BLEND[1], border[v] as number) *
      palmarWrist(frame.palm[v * 2 + 1] as number);
  }
  maskCache.set(assets, out);
  return out;
}

/** How far past the wrist toward the fingers, eased (`PALM_WRIST_BLEND`), for a vertex `along` metres from it. */
export const palmarWrist = (along: number): number =>
  smoothstep(PALM_WRIST_BLEND[0], PALM_WRIST_BLEND[1], along);

const borderCache = new WeakMap<HumanoidAssets, Float32Array>();

/**
 * Each hand vertex's distance over the skin to the palmar-dorsal border,
 * metres: positive on the palmar side, negative on the dorsal; 0 off the hands.
 */
export function palmarBorderDistance(assets: HumanoidAssets): Float32Array {
  const known = borderCache.get(assets);
  if (known) return known;
  const frame = handFrame(assets);
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const onHand = (v: number) => frame.digit[v] !== 0;
  const volar = (v: number) => frame.volar[v] as number;
  const length = (a: number, b: number) =>
    Math.hypot(
      (P[a * 3] as number) - (P[b * 3] as number),
      (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
      (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
    );
  // The hands' edges, each once.
  const edges = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const list = edges.get(a);
    if (list) {
      if (!list.includes(b)) list.push(b);
    } else edges.set(a, [b]);
  };
  for (let f = 0; f < assets.faceVerts.length; f += 4)
    for (let k = 0; k < 4; k++) {
      const a = assets.faceVerts[f + k] as number;
      const b = assets.faceVerts[f + ((k + 1) % 4)] as number;
      if (onHand(a) && onHand(b) && frame.side[a] === frame.side[b]) {
        link(a, b);
        link(b, a);
      }
    }
  // Distance over the skin to the border, where the facing crosses 0 along an
  // edge (interpolated there), by Dijkstra from those crossings.
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  for (const [a, list] of edges)
    for (const b of list) {
      if (volar(a) >= 0 === volar(b) >= 0) continue;
      const t = volar(a) / (volar(a) - volar(b));
      dist[a] = Math.min(dist[a] as number, t * length(a, b));
    }
  const done = new Uint8Array(n);
  const queue = [...edges.keys()].filter((v) => Number.isFinite(dist[v] as number));
  while (queue.length) {
    let i = 0;
    for (let j = 1; j < queue.length; j++)
      if ((dist[queue[j] as number] as number) < (dist[queue[i] as number] as number)) i = j;
    const v = queue[i] as number;
    queue[i] = queue[queue.length - 1] as number;
    queue.pop();
    if (done[v]) continue;
    done[v] = 1;
    for (const w of edges.get(v) ?? []) {
      // Distance spreads within one side of the border only.
      if (done[w] || volar(w) >= 0 !== volar(v) >= 0) continue;
      const d = (dist[v] as number) + length(v, w);
      if (d < (dist[w] as number)) {
        dist[w] = d;
        queue.push(w);
      }
    }
  }
  const out = new Float32Array(n);
  for (const v of edges.keys()) {
    // A side with no border (none here) is as far from it as the hand is long.
    const reach = Number.isFinite(dist[v] as number) ? (dist[v] as number) : 1;
    out[v] = volar(v) >= 0 ? reach : -reach;
  }
  borderCache.set(assets, out);
  return out;
}
