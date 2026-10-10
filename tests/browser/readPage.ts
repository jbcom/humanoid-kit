/**
 * Reads a page of an array texture back, texel for texel, through a float
 * target, for the browser tests of the textures baked in UV space (the field
 * atlas, a figure's body art).
 */
import {
  FloatType,
  GLSL3,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** Page `page` of `texture` (`size`² texels), RGBA per texel, row 0 at v = 0. */
export function readPage(
  renderer: WebGLRenderer,
  texture: Texture,
  page: number,
  size: number,
): Float32Array {
  const rt = new WebGLRenderTarget(size, size, { type: FloatType });
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: `in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; uniform highp sampler2DArray atlas; uniform int page;
      out vec4 color; void main() { color = texelFetch(atlas, ivec3(ivec2(gl_FragCoord.xy), page), 0); }`,
    uniforms: { atlas: { value: texture }, page: { value: page } },
    blending: NoBlending,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, new OrthographicCamera());
  const out = new Float32Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, out);
  renderer.setRenderTarget(previous);
  mesh.geometry.dispose();
  material.dispose();
  rt.dispose();
  return out;
}
