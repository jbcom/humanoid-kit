/**
 * The coat on a whole figure (`<Humanoid>`, the worker's evaluation, the
 * figure's own skinning) sits on the skin it is painted on: every fragment the
 * coat draws at a full-body framing, unprojected from the depth buffer, lies
 * within its hair's length plus 2 mm of the skinned body triangles the coat
 * grows from. A coat skinned or placed apart from the body (a beard hanging
 * at the throat) fails it.
 */
import { Canvas, useThree } from "@react-three/fiber";
import {
  DepthTexture,
  FloatType,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Humanoid, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { CoatMaterial } from "../../src/render/coat.ts";
import { BEARD_LENGTHS } from "../../src/surface/regions/bodyHairCoat.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 120_000 };
const client = inlineWorkerClient({ subdivision: 1 });
beforeAll(async () => {
  await client.ready;
});
afterAll(() => client.dispose());

/** The read-back target's side, pixels: a full-body framing, the figure about 400 px tall. */
const SIZE = 512;
/** How far a fragment may stand off the skin beyond its hair's length, metres. */
const SLACK = 0.002;

let scene: Scene | null = null;
let gl: WebGLRenderer | null = null;
function Probe() {
  scene = useThree((s) => s.scene);
  gl = useThree((s) => s.gl);
  return null;
}

function Figure({ recipe }: { recipe: Recipe }) {
  return (
    <HumanoidProvider client={client}>
      <div style={{ width: 160, height: 160 }}>
        <Canvas>
          <Probe />
          <Humanoid recipe={recipe} />
        </Canvas>
      </div>
    </HumanoidProvider>
  );
}

function find<T extends Object3D>(test: (o: Object3D) => o is T): T | null {
  let out: T | null = null;
  scene?.traverse((o) => {
    if (!out && test(o)) out = o;
  });
  return out;
}
const coatMesh = () =>
  find((o): o is SkinnedMesh => o instanceof SkinnedMesh && o.material instanceof CoatMaterial);

/** Copies a depth texture into a float target's red channel, to be read back. */
const DEPTH: { value: DepthTexture | null } = { value: null };
const COPY = new ShaderMaterial({
  uniforms: { depth: DEPTH },
  vertexShader:
    "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
  fragmentShader:
    "uniform sampler2D depth; varying vec2 vUv; void main() { gl_FragColor = vec4( texture2D( depth, vUv ).x ); }",
});

/** The fragments `mesh` draws, world space, seen by `camera` with nothing else drawn. */
function fragmentsOf(mesh: SkinnedMesh, camera: PerspectiveCamera): Vector3[] {
  const renderer = gl as WebGLRenderer;
  const depth = new WebGLRenderTarget(SIZE, SIZE, { depthTexture: new DepthTexture(SIZE, SIZE) });
  const copy = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType });
  // Only the mesh: its own layer, and the camera sees only that.
  mesh.layers.set(5);
  camera.layers.set(5);
  renderer.setRenderTarget(depth);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene as Scene, camera);
  mesh.layers.set(0);
  DEPTH.value = depth.depthTexture;
  const quad = new Scene().add(new Mesh(new PlaneGeometry(2, 2), COPY));
  renderer.setRenderTarget(copy);
  renderer.render(quad, new OrthographicCamera());
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(copy, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  depth.dispose();
  copy.dispose();
  const out: Vector3[] = [];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const d = px[(y * SIZE + x) * 4] as number;
      if (d >= 1) continue;
      out.push(
        new Vector3(((x + 0.5) / SIZE) * 2 - 1, ((y + 0.5) / SIZE) * 2 - 1, d * 2 - 1).unproject(
          camera,
        ),
      );
    }
  return out;
}

const closest = new Vector3();
const ab = new Vector3();
const ac = new Vector3();
const ap = new Vector3();
/** The distance from `p` to the triangle `a b c` (Ericson, Real-Time Collision Detection 5.1.5). */
function toTriangle(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  ab.subVectors(b, a);
  ac.subVectors(c, a);
  ap.subVectors(p, a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return p.distanceTo(a);
  const bp = new Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return p.distanceTo(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0)
    return p.distanceTo(closest.copy(a).addScaledVector(ab, d1 / (d1 - d3)));
  const cp = new Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return p.distanceTo(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0)
    return p.distanceTo(closest.copy(a).addScaledVector(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return p.distanceTo(
      closest
        .copy(b)
        .addScaledVector(new Vector3().subVectors(c, b), (d4 - d3) / (d4 - d3 + d5 - d6)),
    );
  const denom = 1 / (va + vb + vc);
  closest
    .copy(a)
    .addScaledVector(ab, vb * denom)
    .addScaledVector(ac, vc * denom);
  return p.distanceTo(closest);
}

/**
 * Each coat fragment's distance to the body's skinned triangles the coat grows
 * from (the coat's own index into the body's vertices), the worst first.
 */
function standOff(
  coat: SkinnedMesh,
  body: SkinnedMesh,
  fragments: Vector3[],
): { distance: number; at: Vector3 }[] {
  const index = coat.geometry.getIndex()?.array as ArrayLike<number>;
  const at = new Map<number, Vector3>();
  const vertex = (v: number) => {
    let p = at.get(v);
    if (!p) {
      p = body.getVertexPosition(v, new Vector3()).applyMatrix4(body.matrixWorld);
      at.set(v, p);
    }
    return p;
  };
  const triangles: [Vector3, Vector3, Vector3][] = [];
  for (let t = 0; t < index.length; t += 3)
    triangles.push([
      vertex(index[t] as number),
      vertex(index[t + 1] as number),
      vertex(index[t + 2] as number),
    ]);
  return fragments
    .map((p) => {
      let best = Number.POSITIVE_INFINITY;
      for (const [a, b, c] of triangles) best = Math.min(best, toTriangle(p, a, b, c));
      return { distance: best, at: p };
    })
    .sort((a, b) => b.distance - a.distance);
}

/** A camera framing the whole figure, from the front, as the sheets' full-body cells do. */
function fullBody(): PerspectiveCamera {
  const camera = new PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 0, 4.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

/** The body surface the coat shares its vertices with. */
const bodyUnder = (coat: SkinnedMesh) =>
  find(
    (o): o is SkinnedMesh =>
      o instanceof SkinnedMesh &&
      !(o.material instanceof CoatMaterial) &&
      o.geometry.getAttribute("position") === coat.geometry.getAttribute("position"),
  );

const bearded = (beard: "stubble" | "full") =>
  createRecipe({ macros: { gender: 1 }, bodyHair: { beard } });

describe("the coat on a figure", () => {
  for (const beard of ["stubble", "full"] as const) {
    it(
      `draws a ${beard} beard on the face it is painted on, at a full-body framing`,
      async () => {
        await render(<Figure recipe={bearded(beard)} />);
        // The coat shows once the figure is evaluated and its body drawn.
        await expect.poll(() => coatMesh()?.visible === true, LOAD).toBe(true);
        const coat = coatMesh() as SkinnedMesh;
        const body = bodyUnder(coat);
        expect(body).not.toBeNull();
        scene?.updateMatrixWorld(true);
        const fragments = fragmentsOf(coat, fullBody());
        expect(fragments.length).toBeGreaterThan(20);
        const reach = Math.max(...Object.values(BEARD_LENGTHS[beard])) + SLACK;
        const worst = standOff(coat, body as SkinnedMesh, fragments);
        const far = worst.filter((f) => f.distance >= reach);
        const where = far.slice(0, 3).map((f) => f.at.toArray().map((x) => x.toFixed(3)));
        expect(
          worst[0]?.distance,
          `${far.length} of ${fragments.length} fragments off the skin, the worst at ${JSON.stringify(where)}`,
        ).toBeLessThan(reach);
      },
      LOAD.timeout,
    );
  }

  // The coat's geometry shares the body's vertex buffers. Disposing it once
  // freed them under the body, which then drew the previous figure's shape
  // while its eyes and teeth moved on: a woman's eyes at a man's throat. Here
  // the renderer happens to rebind the body, so this is the whole figure's
  // check; tests/browser/coat.test.ts holds the buffers themselves.
  it(
    "leaves the body drawing its own shape when the coat goes",
    async () => {
      const screen = await render(<Figure recipe={bearded("full")} />);
      await expect.poll(() => coatMesh()?.visible === true, LOAD).toBe(true);
      const body = bodyUnder(coatMesh() as SkinnedMesh) as SkinnedMesh;
      const crown = () => {
        body.geometry.computeBoundingBox();
        return (body.geometry.boundingBox?.max.y ?? 0) + body.matrixWorld.elements[13];
      };
      const man = crown();
      await screen.rerender(<Figure recipe={createRecipe({ macros: { gender: 0 } })} />);
      // The coat is gone, and the woman (shorter) is evaluated into the body's buffers.
      await expect.poll(() => coatMesh() === null && crown() < man - 0.05, LOAD).toBe(true);
      // Give the coat's disposal a frame to run before the body is drawn.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      scene?.updateMatrixWorld(true);
      const drawn = Math.max(...fragmentsOf(body, fullBody()).map((p) => p.y));
      // The drawn crown is the woman's, to within a few pixels at this framing.
      expect(
        Math.abs(drawn - crown()),
        `drawn ${drawn}, evaluated ${crown()}, man ${man}`,
      ).toBeLessThan(0.015);
    },
    LOAD.timeout,
  );
});
