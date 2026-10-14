/** Shared exact native-body shader readback for posed fluid proofs. */
import type { RootState } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  FloatType,
  GLSL3,
  type Material,
  type Object3D,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  type SkinnedMesh,
  WebGLRenderTarget,
} from "three";
import type { DualBones } from "../../src/react/index.ts";
import {
  applyDualSkinning,
  FOLD_SLOTS_ATTRIBUTE,
  SKIN_INDEX_ATTRIBUTE_1,
  SKIN_WEIGHT_ATTRIBUTE_1,
} from "../../src/render/dualSkinning.ts";
import { FOLD_JOINTS } from "../../src/rig/folds.ts";

export function gpuWorldVertices(
  state: RootState,
  mesh: SkinnedMesh,
  vertices: readonly number[],
): Float32Array {
  let parent: Object3D | null = mesh;
  let bones: DualBones | null = null;
  while (parent && !bones) {
    bones = (parent.userData as { dualBones?: DualBones }).dualBones ?? null;
    parent = parent.parent;
  }
  if (!bones) throw new Error("posed-fluid probe: body has no own live dual bones");
  state.scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  const source = mesh.geometry;
  const count = vertices.length;
  const pick = (name: string, size: number) => {
    const from = source.getAttribute(name);
    if (!from) throw new Error(`posed-fluid probe: body lacks ${name}`);
    const values = new Float32Array(count * size);
    vertices.forEach((vertex, at) => {
      for (let component = 0; component < size; component++)
        values[at * size + component] = from.getComponent(vertex, component);
    });
    return new BufferAttribute(values, size);
  };
  const points = new BufferGeometry();
  points.setAttribute("position", pick("position", 3));
  for (const name of ["skinIndex", "skinWeight", SKIN_INDEX_ATTRIBUTE_1, SKIN_WEIGHT_ATTRIBUTE_1])
    points.setAttribute(name, pick(name, 4));
  points.setAttribute(FOLD_SLOTS_ATTRIBUTE, pick(FOLD_SLOTS_ATTRIBUTE, FOLD_JOINTS.length));
  points.setAttribute(
    "aPixel",
    new BufferAttribute(
      Float32Array.from({ length: count }, (_, index) => index),
      1,
    ),
  );
  const material: Material = new ShaderMaterial({
    glslVersion: GLSL3,
    defines: { USE_SKINNING: "" },
    depthTest: false,
    depthWrite: false,
    uniforms: {
      bindMatrix: { value: mesh.bindMatrix },
      bindMatrixInverse: { value: mesh.bindMatrixInverse },
      boneTexture: { value: mesh.skeleton.boneTexture },
      uWorld: { value: mesh.matrixWorld },
      uCount: { value: count },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      in float aPixel;
      uniform mat4 uWorld;
      uniform float uCount;
      out vec3 vWorld;
      void main() {
        #include <begin_vertex>
        #include <skinbase_vertex>
        #include <skinning_vertex>
        vWorld = ( uWorld * vec4( transformed, 1.0 ) ).xyz;
        gl_PointSize = 1.0;
        gl_Position = vec4( ( aPixel + 0.5 ) / uCount * 2.0 - 1.0, 0.0, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      in vec3 vWorld;
      layout( location = 0 ) out highp vec4 outColor;
      void main() { outColor = vec4( vWorld, 1.0 ); }`,
  });
  applyDualSkinning(material, bones, true);
  const drawn = new Points(points, material);
  drawn.frustumCulled = false;
  const stage = new Scene();
  stage.add(drawn);
  const target = new WebGLRenderTarget(count, 1, { type: FloatType, depthBuffer: false });
  state.gl.setRenderTarget(target);
  state.gl.render(stage, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const pixels = new Float32Array(count * 4);
  state.gl.readRenderTargetPixels(target, 0, 0, count, 1, pixels);
  state.gl.setRenderTarget(null);
  target.dispose();
  material.dispose();
  points.dispose();
  const world = new Float32Array(count * 3);
  for (let index = 0; index < count; index++)
    world.set(pixels.subarray(index * 4, index * 4 + 3), index * 3);
  return world;
}
