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
  BufferAttribute,
  BufferGeometry,
  DepthTexture,
  FloatType,
  GLSL3,
  type Material,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Humanoid, type HumanoidPose, HumanoidProvider } from "../../src/react/index.ts";
import { createRecipe, type Recipe } from "../../src/recipe/recipe.ts";
import { CoatMaterial } from "../../src/render/coat.ts";
import {
  applyDualSkinning,
  type DualBones,
  FOLD_SLOTS_ATTRIBUTE,
  SKIN_INDEX_ATTRIBUTE_1,
  SKIN_WEIGHT_ATTRIBUTE_1,
} from "../../src/render/dualSkinning.ts";
import { HairMaterial } from "../../src/render/hairMaterial.ts";
import { hairTint } from "../../src/surface/hairTone.ts";
import { BEARD_LENGTHS } from "../../src/surface/regions/bodyHairCoat.ts";
import { expectSameArray } from "./arrays.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 120_000 };
// With the hair pack, for a grown beard's cards.
const client = inlineWorkerClient({ subdivision: 1 }, { hair: true });
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

function Figure({
  recipe,
  pose,
  onSettled,
}: {
  recipe: Recipe;
  pose?: HumanoidPose;
  onSettled?: () => void;
}) {
  return (
    <HumanoidProvider client={client}>
      <div style={{ width: 160, height: 160 }}>
        <Canvas>
          <Probe />
          <Humanoid recipe={recipe} {...(pose && { pose })} {...(onSettled && { onSettled })} />
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
  // Only the mesh: its own layer, and the camera sees only that. The coat
  // blends without writing depth; for this read it writes it, which changes
  // no fragment it draws.
  const material = mesh.material as Material;
  const writes = material.depthWrite;
  material.depthWrite = true;
  mesh.layers.set(5);
  camera.layers.set(5);
  renderer.setRenderTarget(depth);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene as Scene, camera);
  mesh.layers.set(0);
  material.depthWrite = writes;
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
 * Each fragment's distance to the body's skinned triangles the coat grows from
 * (the coat's own index into the body's vertices), or those of them `keep`
 * keeps (given a triangle's three vertices), the worst first.
 */
function standOff(
  coat: SkinnedMesh,
  body: SkinnedMesh,
  fragments: Vector3[],
  keep: (a: number, b: number, c: number) => boolean = () => true,
): { distance: number; at: Vector3 }[] {
  const all = coat.geometry.getIndex()?.array as ArrayLike<number>;
  const index: number[] = [];
  for (let t = 0; t < all.length; t += 3) {
    const [a, b, c] = [all[t] as number, all[t + 1] as number, all[t + 2] as number];
    if (keep(a, b, c)) index.push(a, b, c);
  }
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

/** Every authored facial asset has a distinct vertex count in the pinned CC0 pack. */
const FACIAL_VERTICES = {
  "beard-faun": 5218,
  "beard-sigmund": 503,
  "beard-viking": 6557,
  "moustache-viking": 1598,
  "beard-scruffy": 2300,
} as const;
type FacialId = keyof typeof FACIAL_VERTICES;
const FACIAL_IDS = Object.keys(FACIAL_VERTICES) as FacialId[];

/** An authored facial-hair mesh is rendered with the same material as scalp hair. */
const facialMesh = (id: FacialId = "beard-viking") => {
  // The worker expands authored source vertices into the bound card topology. Its
  // supplied topology is therefore the identity the renderer actually receives.
  const vertices = client.hairTopology(id)?.vertexCount;
  return find(
    (o): o is SkinnedMesh =>
      vertices !== undefined &&
      o instanceof SkinnedMesh &&
      o.material instanceof HairMaterial &&
      o.geometry.getAttribute("position")?.count === vertices,
  );
};

const facialState = (id: FacialId) => {
  const meshes: string[] = [];
  scene?.traverse((o) => {
    if (o instanceof SkinnedMesh && o.material instanceof HairMaterial)
      meshes.push(`${o.geometry.getAttribute("position")?.count}:${o.visible}`);
  });
  return facialMesh(id)?.visible === true
    ? "visible"
    : `expected=${client.hairTopology(id)?.vertexCount ?? "unloaded"}; actual=${meshes.join(",") || "absent"}`;
};

const bodyMesh = () =>
  find(
    (o): o is SkinnedMesh =>
      o instanceof SkinnedMesh &&
      (o.userData.hkPart === "body" || o.userData.hkPart === "adultBody"),
  );

function dualBones(): DualBones {
  let found: DualBones | null = null;
  scene?.traverse((o) => {
    const dual = (o.userData as { dualBones?: DualBones | null }).dualBones;
    if (dual) found = dual;
  });
  if (!found) throw new Error("facial hair: no figure dual-bone palette");
  return found;
}

/** Propagates a written local pose before flattening its linear skin matrices. */
function updateSkinningMatrices(mesh: SkinnedMesh): void {
  const root = mesh.skeleton.bones.find(
    (bone) => !(bone.parent as { isBone?: boolean } | null)?.isBone,
  );
  if (!root) throw new Error("facial hair: no skeleton root");
  root.updateWorldMatrix(true, true);
  mesh.updateWorldMatrix(true, false);
  mesh.skeleton.update();
}

/** Reads one facial vertex exactly as its HairMaterial shader draws it, in world space. */
function gpuFacialVertex(mesh: SkinnedMesh, vertex: number): Vector3 {
  const fold = mesh.userData.hkPart === "body" || mesh.userData.hkPart === "adultBody";
  const renderer = gl as WebGLRenderer;
  updateSkinningMatrices(mesh);
  const source = mesh.geometry;
  const pick = (name: string, size: number) => {
    const attr = source.getAttribute(name);
    if (!attr) throw new Error(`facial hair: missing ${name}`);
    const values = new Float32Array(size);
    for (let k = 0; k < size; k++) values[k] = attr.getComponent(vertex, k);
    return new BufferAttribute(values, size);
  };
  const points = new BufferGeometry();
  points.setAttribute("position", pick("position", 3));
  for (const name of ["skinIndex", "skinWeight", SKIN_INDEX_ATTRIBUTE_1, SKIN_WEIGHT_ATTRIBUTE_1])
    points.setAttribute(name, pick(name, 4));
  if (fold) {
    const slots = source.getAttribute(FOLD_SLOTS_ATTRIBUTE);
    if (!slots) throw new Error("body: missing fold slots");
    points.setAttribute(FOLD_SLOTS_ATTRIBUTE, pick(FOLD_SLOTS_ATTRIBUTE, slots.itemSize));
  }
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    defines: { USE_SKINNING: "" },
    depthTest: false,
    depthWrite: false,
    uniforms: {
      bindMatrix: { value: mesh.bindMatrix },
      bindMatrixInverse: { value: mesh.bindMatrixInverse },
      boneTexture: { value: mesh.skeleton.boneTexture },
      uWorld: { value: mesh.matrixWorld },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      uniform mat4 uWorld;
      out vec3 vWorld;
      void main() {
        #include <begin_vertex>
        #include <skinbase_vertex>
        #include <skinning_vertex>
        vWorld = ( uWorld * vec4( transformed, 1.0 ) ).xyz;
        gl_PointSize = 1.0;
        gl_Position = vec4( 0.0, 0.0, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      in vec3 vWorld;
      layout( location = 0 ) out highp vec4 outColor;
      void main() { outColor = vec4( vWorld, 1.0 ); }`,
  });
  applyDualSkinning(material, dualBones(), fold);
  const point = new Points(points, material);
  point.frustumCulled = false;
  const stage = new Scene().add(point);
  const target = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false });
  renderer.setRenderTarget(target);
  renderer.render(stage, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const pixel = new Float32Array(4);
  renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
  renderer.setRenderTarget(null);
  target.dispose();
  material.dispose();
  points.dispose();
  return new Vector3(pixel[0], pixel[1], pixel[2]);
}

/** The joint-only body skin transform is an independent jaw-motion reference. */
function jawReference(mesh: SkinnedMesh, vertex: number, jaw: number): Vector3 {
  const point = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex);
  return point
    .applyMatrix4(mesh.bindMatrix)
    .applyMatrix4(mesh.skeleton.boneInverses[jaw] as import("three").Matrix4)
    .applyMatrix4(mesh.skeleton.bones[jaw]?.matrixWorld as import("three").Matrix4)
    .applyMatrix4(mesh.bindMatrixInverse)
    .applyMatrix4(mesh.matrixWorld);
}

interface JawReceipt {
  id: string;
  vertex: number;
  jaw: number;
  weights: { index: number[]; weight: number[] };
  quaternion: number[];
  boneMatrix: number[];
  dual: number[];
  cpu: number[];
  reference: number[];
  gpu: number[];
}

/** A direct record of every skinning boundary for one jaw-bound render vertex. */
function jawReceipt(mesh: SkinnedMesh, id: string, vertex: number, jaw: number): JawReceipt {
  updateSkinningMatrices(mesh);
  const indices = ["skinIndex", SKIN_INDEX_ATTRIBUTE_1].flatMap((name) =>
    Array.from({ length: 4 }, (_, place) =>
      mesh.geometry.getAttribute(name).getComponent(vertex, place),
    ),
  );
  const weights = ["skinWeight", SKIN_WEIGHT_ATTRIBUTE_1].flatMap((name) =>
    Array.from({ length: 4 }, (_, place) =>
      mesh.geometry.getAttribute(name).getComponent(vertex, place),
    ),
  );
  const bone = mesh.skeleton.bones[jaw];
  const matrices = mesh.skeleton.boneMatrices;
  if (!bone || !matrices) throw new Error(`jaw ${jaw}: no bone matrix`);
  return {
    id,
    vertex,
    jaw,
    weights: { index: indices, weight: weights },
    quaternion: bone.quaternion.toArray(),
    boneMatrix: Array.from(matrices.slice(jaw * 16, jaw * 16 + 16)),
    dual: Array.from(dualBones().data.slice(jaw * 12, jaw * 12 + 12)),
    cpu: mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld).toArray(),
    reference: jawReference(mesh, vertex, jaw).toArray(),
    gpu: gpuFacialVertex(mesh, vertex).toArray(),
  };
}

const receiptDistance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));

function jawWeightedVertex(mesh: SkinnedMesh): { vertex: number; jaw: number; weight: number } {
  const jaw = mesh.skeleton.bones.findIndex((bone) => bone.name === "jaw");
  if (jaw < 0) throw new Error("facial hair: no jaw bone");
  const index = mesh.geometry.getAttribute("skinIndex");
  const weight = mesh.geometry.getAttribute("skinWeight");
  const index1 = mesh.geometry.getAttribute(SKIN_INDEX_ATTRIBUTE_1);
  const weight1 = mesh.geometry.getAttribute(SKIN_WEIGHT_ATTRIBUTE_1);
  let vertex = -1;
  let share = -1;
  for (let v = 0; v < weight.count; v++)
    for (const [indices, weights] of [
      [index, weight],
      [index1, weight1],
    ] as const)
      for (let place = 0; place < 4; place++)
        if (indices.getComponent(v, place) === jaw && weights.getComponent(v, place) > share) {
          vertex = v;
          share = weights.getComponent(v, place);
        }
  if (vertex < 0) throw new Error("facial hair: no jaw-weighted vertex");
  return { vertex, jaw, weight: share };
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

  it(
    "draws an authored beard through HairMaterial and removes it when the selected asset is removed",
    async () => {
      const bearded = createRecipe({
        hair: { style: null },
        facialHair: ["beard-viking"],
      });
      const screen = await render(<Figure recipe={bearded} />);
      await expect.poll(() => facialMesh()?.visible === true, LOAD).toBe(true);
      const beard = facialMesh() as SkinnedMesh;
      // The renderer draws the worker's render topology of the style (its 6557
      // source vertices expanded into bound cards, tests/beardAssets.test.ts), whole.
      const topology = client.hairTopology("beard-viking");
      expect(beard.geometry.getAttribute("position").count).toBe(topology?.vertexCount);
      expect(beard.geometry.index?.count).toBe(topology?.index.length);
      await screen.rerender(<Figure recipe={createRecipe({ hair: { style: null } })} />);
      await expect.poll(() => facialMesh(), LOAD).toBeNull();
    },
    LOAD.timeout,
  );

  // The coat's geometry shares the body's vertex buffers. Disposing it once
  // freed them under the body, which then drew the previous figure's shape
  // while its eyes and teeth moved on: a woman's eyes at a man's throat. Here
  // the renderer happens to rebind the body, so this is the whole figure's
  // check; tests/browser/coat.test.ts holds the buffers themselves.
  it(
    "records the CPU and GPU jaw boundary for an authored beard and the body",
    async () => {
      let settled = false;
      const recipe = createRecipe({ facialHair: ["beard-viking"] });
      const screen = await render(<Figure recipe={recipe} onSettled={() => (settled = true)} />);
      await expect.poll(() => settled, LOAD).toBe(true);
      await expect.poll(() => facialState("beard-viking"), LOAD).toBe("visible");
      const beard = facialMesh("beard-viking") as SkinnedMesh;
      const body = bodyMesh() as SkinnedMesh;
      const beardJaw = jawWeightedVertex(beard);
      const bodyJaw = jawWeightedVertex(body);
      expect(beardJaw.weight, "Viking beard's selected jaw weight").toBeGreaterThan(0.9);
      const rest = {
        beard: jawReceipt(beard, "beard-viking", beardJaw.vertex, beardJaw.jaw),
        body: jawReceipt(body, "body", bodyJaw.vertex, bodyJaw.jaw),
      };

      await screen.rerender(<Figure recipe={recipe} pose={{ faceUnits: { JawDrop: 1 } }} />);
      let posed = {
        beard: jawReceipt(beard, "beard-viking", beardJaw.vertex, beardJaw.jaw),
        body: jawReceipt(body, "body", bodyJaw.vertex, bodyJaw.jaw),
      };
      // Let React's passive pose effect run once if rerender returned before it; this
      // is a single semantic yield, never a frame-count settlement condition.
      if (receiptDistance(rest.beard.quaternion, posed.beard.quaternion) === 0) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        posed = {
          beard: jawReceipt(beard, "beard-viking", beardJaw.vertex, beardJaw.jaw),
          body: jawReceipt(body, "body", bodyJaw.vertex, bodyJaw.jaw),
        };
      }
      const delta = (part: JawReceipt, atRest: JawReceipt) => ({
        quaternion: receiptDistance(part.quaternion, atRest.quaternion),
        boneMatrix: receiptDistance(part.boneMatrix, atRest.boneMatrix),
        dual: receiptDistance(part.dual, atRest.dual),
        cpu: receiptDistance(part.cpu, atRest.cpu),
        reference: receiptDistance(part.reference, atRest.reference),
        gpu: receiptDistance(part.gpu, atRest.gpu),
      });
      console.info(
        `HK_FACIAL_JAW_BOUNDARY ${JSON.stringify({
          rest,
          posed,
          delta: {
            beard: delta(posed.beard, rest.beard),
            body: delta(posed.body, rest.body),
          },
        })}`,
      );
      expect(
        receiptDistance(posed.beard.quaternion, rest.beard.quaternion),
        "JawDrop writes jaw rotation",
      ).toBeGreaterThan(0.0005);
      expect(
        receiptDistance(posed.beard.boneMatrix, rest.beard.boneMatrix),
        "JawDrop updates linear bone texture",
      ).toBeGreaterThan(0.0005);
      expect(
        receiptDistance(posed.beard.reference, rest.beard.reference),
        "jaw reference moves",
      ).toBeGreaterThan(0.0005);
      expect(
        receiptDistance(posed.beard.cpu, rest.beard.cpu),
        "beard CPU mirror follows jaw",
      ).toBeGreaterThan(0.0005);
      expect(
        receiptDistance(posed.beard.gpu, rest.beard.gpu),
        "beard GPU follows jaw",
      ).toBeGreaterThan(0.0005);
      expect(
        receiptDistance(posed.body.gpu, rest.body.gpu),
        "body GPU control follows jaw",
      ).toBeGreaterThan(0.0005);
    },
    LOAD.timeout,
  );
  it("keeps all authored facial assets on their jaw motion, pigment, and legacy body boundary", async () => {
    const colour = {
      eumelanin: 0.15,
      pheomelanin: 0.35,
      grey: 0,
      override: [0.08, 0.31, 0.67] as [number, number, number],
    };
    const variants = [
      { age: 18, gender: 0, height: 0.15 },
      { age: 45, gender: 1, height: -0.2 },
      { age: 90, gender: 0.35, height: 0.05 },
    ];
    const recipeFor = (macros: (typeof variants)[number], id?: FacialId) =>
      createRecipe({
        hair: { style: null, colour },
        ...(id && { facialHair: [id] }),
        macros,
      });
    let settles = 0;
    const onSettled = () => {
      settles++;
    };
    const screen = await render(<Figure recipe={createRecipe()} onSettled={onSettled} />);
    await expect.poll(() => settles, LOAD).toBeGreaterThan(0);
    const rerenderAndSettle = async (recipe: Recipe, pose?: HumanoidPose) => {
      const before = settles;
      await screen.rerender(
        <Figure recipe={recipe} {...(pose && { pose })} onSettled={onSettled} />,
      );
      await expect.poll(() => settles > before, LOAD).toBe(true);
    };
    const [red, green, blue] = hairTint(colour);

    for (const macros of variants)
      for (const id of FACIAL_IDS) {
        const recipe = recipeFor(macros, id);
        await rerenderAndSettle(recipe);
        await expect.poll(() => facialState(id), LOAD).toBe("visible");
        const body = bodyMesh() as SkinnedMesh;
        const before = Array.from(body.geometry.getAttribute("position").array);
        const mesh = facialMesh(id) as SkinnedMesh;
        await expect
          .poll(() => {
            const material = facialMesh(id)?.material as HairMaterial | undefined;
            return Math.max(
              Math.abs((material?.color.r ?? 0) - (red as number)),
              Math.abs((material?.color.g ?? 0) - (green as number)),
              Math.abs((material?.color.b ?? 0) - (blue as number)),
            );
          }, LOAD)
          .toBeLessThan(0.000001);
        const selected = jawWeightedVertex(mesh);
        expect(selected.weight, `${id} has material jaw binding`).toBeGreaterThan(0.01);
        const rest = gpuFacialVertex(mesh, selected.vertex);
        const reference = jawReference(mesh, selected.vertex, selected.jaw);

        await screen.rerender(
          <Figure recipe={recipe} pose={{ faceUnits: { JawDrop: 1 } }} onSettled={onSettled} />,
        );
        await expect
          .poll(() => gpuFacialVertex(mesh, selected.vertex).distanceTo(rest), LOAD)
          .toBeGreaterThan(0.0005);
        const moved = gpuFacialVertex(mesh, selected.vertex).sub(rest);
        const joint = jawReference(mesh, selected.vertex, selected.jaw).sub(reference);
        expect(
          moved.dot(joint),
          `${id} follows its independently sampled jaw joint`,
        ).toBeGreaterThan(0);
        console.info(
          `HK_FACIAL_JAW age=${macros.age} gender=${macros.gender} height=${macros.height} id=${id} jawWeight=${selected.weight.toFixed(6)} gpuMetres=${moved.length().toFixed(6)} jointMetres=${joint.length().toFixed(6)} dot=${moved.dot(joint).toExponential(6)} tint=${red?.toFixed(6)},${green?.toFixed(6)},${blue?.toFixed(6)}`,
        );

        await rerenderAndSettle(recipeFor(macros));
        await expect.poll(() => facialMesh(id) === null, LOAD).toBe(true);
        const after = Array.from(
          (bodyMesh() as SkinnedMesh).geometry.getAttribute("position").array,
        );
        expectSameArray(after, before, { what: `${id} body positions after removal` });
        console.info(
          `HK_FACIAL_LEGACY age=${macros.age} id=${id} bodyBytes=${before.length * 4} unchanged=true removed=true`,
        );
      }
  }, 900_000);

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
