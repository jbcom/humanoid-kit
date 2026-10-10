/**
 * Edge bleeding for a straight-alpha RGBA texture: every texel whose colour
 * cannot be trusted (alpha below `TRUSTED`) takes the mean colour of its
 * trusted 3×3 neighbours, pass after pass outward from the opaque texels.
 *
 * A GPU filters a straight-alpha texture's colour and alpha separately, so at a
 * cut-out's edge, and in every mip level, a clear or faint texel's colour is
 * blended into the visible one beside it. An atlas's faint edge texels carry
 * its backdrop (usually black), and lossy encoding rewrites clear ones, so
 * without this a card's edge draws as a dark wire. Bled, the colour across the
 * edge is the opaque side's own, which is what premultiplied filtering would
 * give. The opaque texels are not touched, nor is any alpha.
 */

/** Alpha (of 255) from which a texel's colour is its own. */
export const TRUSTED = 250;
/** Passes outward: 16 texels covers the edge at every mip level a card uses. */
export const BLEED_PASSES = 16;

/** Bleeds `rgba` (width × height × 4, 8 bits, straight alpha) in place; returns it. */
export function bleedEdges(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height;
  const known = new Uint8Array(count);
  for (let i = 0; i < count; i++) known[i] = (rgba[i * 4 + 3] as number) >= TRUSTED ? 1 : 0;
  const next: number[] = [];
  for (let pass = 0; pass < BLEED_PASSES; pass++) {
    next.length = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const j = yy * width + xx;
            if (!known[j]) continue;
            r += rgba[j * 4] as number;
            g += rgba[j * 4 + 1] as number;
            b += rgba[j * 4 + 2] as number;
            n++;
          }
        if (!n) continue;
        rgba[i * 4] = Math.round(r / n);
        rgba[i * 4 + 1] = Math.round(g / n);
        rgba[i * 4 + 2] = Math.round(b / n);
        next.push(i);
      }
    if (!next.length) break;
    for (const i of next) known[i] = 1;
  }
  return rgba;
}
