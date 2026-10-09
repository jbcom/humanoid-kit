/**
 * Drawing the body into its own UV space, shared by the textures baked there:
 * the skin layers' field atlas (`layerAtlas.ts`) and a figure's body art
 * (`bodyArtTexture.ts`). The body is drawn with its UVs as positions; a cover
 * pass marks the texels its UV islands cover, and a gutter pass fills the
 * texels round each island from the nearest covered one, so bilinear filtering
 * at an island's edge never blends in empty texels and draws a seam.
 */

/** Texels of gutter filled around each UV island. */
export const GUTTER = 4;

/** Draws a mesh at its UVs (the `uv` attribute), passing `fields` (four per vertex) through. */
export const UV_RASTER_VERTEX = /* glsl */ `
in vec2 uv;
in vec4 fields;
out vec4 vFields;
void main() {
  vFields = fields;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Marks every texel an island covers. */
export const COVER_FRAGMENT = /* glsl */ `
precision highp float;
out vec4 color;
void main() { color = vec4(1.0); }`;

/** A full-target quad, for passes that read one target and write another. */
export const QUAD_VERTEX = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * GLSL: `src` at `uv` where the cover marks it, else at the nearest covered
 * texel within `GUTTER` (zero beyond).
 */
export const NEAREST_COVERED = /* glsl */ `
vec4 hkNearestCovered(sampler2D src, sampler2D cover, vec2 uv, float texel) {
  if (texture(cover, uv).r > 0.5) return texture(src, uv);
  float best = 1e9;
  vec4 found = vec4(0.0);
  for (int y = -${GUTTER}; y <= ${GUTTER}; y++)
    for (int x = -${GUTTER}; x <= ${GUTTER}; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 p = uv + o * texel;
      float d = dot(o, o);
      if (d < best && texture(cover, p).r > 0.5) { best = d; found = texture(src, p); }
    }
  return found;
}`;
