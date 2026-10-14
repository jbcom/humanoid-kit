import { bodyPack } from "humanoid-kit-body";
import { hairPack } from "humanoid-kit-hair";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderTarget,
} from "three";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { bakeMiniature } from "../../src/bake/miniature.ts";
import { loadHumanoidAssets } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { HAIR_ALPHA_CUTOFF } from "../../src/render/hairMaterial.ts";
import { MiniatureCrowd, VAT_WIDTH } from "../../src/render/miniature.ts";
import { createTestRenderer } from "./gl.ts";

it("measures native beard and asymmetric texture upload parity", async () => {
  const renderer = createTestRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.toneMapping = NoToneMapping;
  renderer.setSize(300, 840);
  const assets = await loadHumanoidAssets({ body: bodyPack, hair: hairPack });
  if (!assets.hair) throw new Error("hair fixture missing");
  await assets.hair.load("beard-viking");
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const live = await new TextureLoader().loadAsync(hairPack.files["beard-viking.webp"]);
  live.colorSpace = SRGBColorSpace;
  const canvas = document.createElement("canvas");
  canvas.width = live.image.width;
  canvas.height = live.image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D decode unavailable");
  context.drawImage(live.image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bake = bakeMiniature(
    model,
    createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] }),
    {
      body: "surface",
      lods: [100],
      facialHair: "alpha-cards",
      texture: () => ({ width: canvas.width, height: canvas.height, data: rgba }),
    },
  );
  const crowd = new MiniatureCrowd([bake], { levelPixels: [0] });
  let near: DataTexture | undefined;
  crowd.object.traverse((o) => {
    if (
      o instanceof Mesh &&
      o.material instanceof MeshStandardMaterial &&
      o.material.map instanceof DataTexture
    )
      near = o.material.map;
  });
  if (!near) throw new Error("source miniature map missing");
  const read = (texture: Texture, width: number, height: number) => {
    const target = new WebGLRenderTarget(width, height);
    const mat = new RawShaderMaterial({
      uniforms: { map: { value: texture }, dimensions: { value: [width, height] } },
      vertexShader: "attribute vec3 position; void main(){gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader:
        "precision highp float; uniform sampler2D map; uniform vec2 dimensions; void main(){gl_FragColor=texture2D(map,gl_FragCoord.xy/dimensions);}",
    });
    const scene = new Scene();
    const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
    scene.add(mesh);
    renderer.setRenderTarget(target);
    renderer.render(scene, new OrthographicCamera());
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(null);
    target.dispose();
    mat.dispose();
    mesh.geometry.dispose();
    return pixels;
  };
  const diff = (a: Uint8Array, b: Uint8Array) => {
    let alpha = 0,
      opaque = 0,
      max = 0,
      visibleMax = 0,
      opaqueMax = 0;
    for (let i = 0; i < a.length; i += 4) {
      alpha += Math.abs((a[i + 3] as number) - (b[i + 3] as number));
      opaque += Number(
        (a[i + 3] as number) >= Math.ceil(HAIR_ALPHA_CUTOFF * 255) !==
          (b[i + 3] as number) >= Math.ceil(HAIR_ALPHA_CUTOFF * 255),
      );
      for (let c = 0; c < 4; c++) {
        const error = Math.abs((a[i + c] as number) - (b[i + c] as number));
        max = Math.max(max, error);
        if ((a[i + 3] as number) >= 102 && (b[i + 3] as number) >= 102 && c < 3)
          visibleMax = Math.max(visibleMax, error);
        if ((a[i + 3] as number) === 255 && (b[i + 3] as number) === 255 && c < 3)
          opaqueMax = Math.max(opaqueMax, error);
      }
    }
    return {
      alphaMAE: alpha / (a.length / 4),
      cutoffDisagreements: opaque,
      maxByteDifference: max,
      visibleMax,
      opaqueMax,
    };
  };
  const mirror = (a: Uint8Array, w: number, h: number) => {
    const out = new Uint8Array(a.length);
    for (let y = 0; y < h; y++)
      out.set(a.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    return out;
  };
  const nativeLive = read(live, canvas.width, canvas.height);
  const nativeNear = read(near, canvas.width, canvas.height);
  const config = (t: Texture) => ({
    flipY: t.flipY,
    minFilter: t.minFilter,
    magFilter: t.magFilter,
    generateMipmaps: t.generateMipmaps,
    colorSpace: t.colorSpace,
  });
  const corrected = near.clone();
  corrected.flipY = true;
  corrected.magFilter = LinearFilter;
  corrected.minFilter = LinearMipmapLinearFilter;
  corrected.generateMipmaps = true;
  corrected.needsUpdate = true;
  const nativeCorrected = read(corrected, canvas.width, canvas.height);
  const fixtureCanvas = document.createElement("canvas");
  fixtureCanvas.width = 2;
  fixtureCanvas.height = 2;
  const fixture = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 255, 255, 255,
  ]);
  const fixtureContext = fixtureCanvas.getContext("2d");
  if (!fixtureContext) throw new Error("fixture canvas missing");
  fixtureContext.putImageData(new ImageData(new Uint8ClampedArray(fixture), 2, 2), 0, 0);
  const fixtureLive = new Texture(fixtureCanvas);
  fixtureLive.needsUpdate = true;
  const fixtureNear = near.clone();
  fixtureNear.image = { data: fixture, width: 2, height: 2 };
  fixtureNear.colorSpace = fixtureLive.colorSpace;
  fixtureNear.needsUpdate = true;
  const receipt = {
    native: {
      width: canvas.width,
      height: canvas.height,
      live: config(live),
      near: config(near),
      direct: diff(nativeLive, nativeNear),
      mirrored: diff(nativeLive, mirror(nativeNear, canvas.width, canvas.height)),
      corrected: diff(nativeLive, nativeCorrected),
      minifiedCurrent: diff(read(live, 96, 96), read(near, 96, 96)),
      minifiedCorrected: diff(read(live, 96, 96), read(corrected, 96, 96)),
    },
    fixture: {
      live: Array.from(read(fixtureLive, 2, 2)),
      near: Array.from(read(fixtureNear, 2, 2)),
    },
  };
  console.log(`FACIAL_TEXTURE_PARITY_RECEIPT ${JSON.stringify(receipt)}`);
  const card = bake.alphaCards?.[0];
  if (!card) throw new Error("source card missing");
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(card.positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(card.uvs, 2));
  geometry.setIndex(new BufferAttribute(card.index, 1));
  const camera = new OrthographicCamera(-0.16, 0.16, 0.15, -0.15, 0.01, 10);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error("source geometry bounds missing");
  const cy = (box.min.y + box.max.y) / 2;
  const half =
    Math.max((box.max.y - box.min.y) / 2, (((box.max.x - box.min.x) / 2) * 420) / 300) * 1.1;
  camera.left = (-half * 300) / 420;
  camera.right = (half * 300) / 420;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
  camera.position.set(0, cy, 2);
  camera.lookAt(0, cy, 0);
  const panel = document.createElement("div");
  panel.style.cssText = "width:300px;background:#222;color:white";
  panel.innerHTML = "<p>Native Viking beard: live image above; miniature RGBA below</p>";
  panel.appendChild(renderer.domElement);
  document.body.appendChild(panel);
  renderer.setScissorTest(true);
  for (const [i, texture] of [live, near].entries()) {
    const scene = new Scene();
    scene.add(
      new Mesh(
        geometry,
        new MeshBasicMaterial({ map: texture, side: DoubleSide, alphaTest: HAIR_ALPHA_CUTOFF }),
      ),
    );
    renderer.setViewport(0, (1 - i) * 420, 300, 420);
    renderer.setScissor(0, (1 - i) * 420, 300, 420);
    renderer.setClearColor(0x333333);
    renderer.clear();
    renderer.render(scene, camera);
  }
  await page.screenshot({
    element: panel,
    path: "../../test-results/facial-texture-parity-3099e405.png",
  });
  expect(receipt.native.direct.cutoffDisagreements).toBe(0);
  expect(receipt.native.corrected.cutoffDisagreements).toBe(0);
  expect(receipt.native.direct.alphaMAE).toBe(0);
  expect(receipt.native.minifiedCurrent.alphaMAE).toBe(0);
  expect(diff(read(fixtureLive, 2, 2), read(fixtureNear, 2, 2)).alphaMAE).toBe(0);
  expect(config(near)).toEqual(config(live));
  const opaqueBake = { ...bake };
  delete opaqueBake.alphaCards;
  const opaqueCrowd = new MiniatureCrowd([opaqueBake]);
  let sourceBytes = 0;
  for (
    let w = card.texture.width, h = card.texture.height;
    ;
    w = Math.max(1, Math.floor(w / 2)), h = Math.max(1, Math.floor(h / 2))
  ) {
    sourceBytes += w * h * 4;
    if (w === 1 && h === 1) break;
  }
  const sourceVatBytes =
    2 *
    VAT_WIDTH *
    Math.ceil((card.vertexCount * bake.frameCount) / VAT_WIDTH) *
    4 *
    Float32Array.BYTES_PER_ELEMENT;
  expect(crowd.textureBytes - opaqueCrowd.textureBytes).toBe(sourceBytes + sourceVatBytes);
  opaqueCrowd.dispose();
  crowd.dispose();
  live.dispose();
  corrected.dispose();
  geometry.dispose();
  fixtureLive.dispose();
  fixtureNear.dispose();
  panel.remove();
}, 120_000);
