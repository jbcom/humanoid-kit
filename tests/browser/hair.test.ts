/**
 * The hair material on the GPU (src/render/hairMaterial.ts), measured on
 * analytic geometry: a strand map multiplied by the recipe's colour renders as
 * that colour's albedo at every hair colour, cut-outs cut and their edges
 * smooth where the canvas is multisampled, baked occlusion scales the light,
 * and highlights stretch across the strands, not along them.
 *
 * Cards are drawn by an orthographic camera into a float render target (no
 * tone mapping), lit by one white directional light of intensity π from the
 * camera's side, so Lambert radiance of albedo A at normal incidence is A.
 */
import {
  DataTexture,
  DirectionalLight,
  FloatType,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  HAIR_ALPHA_CUTOFF,
  HAIR_OCCLUSION_FLOOR,
  HairMaterial,
  isMultisampled,
  setHairOcclusionAttribute,
} from "../../src/render/hairMaterial.ts";
import {
  HAIR_COLOURS,
  HAIR_STRAND_MEAN,
  type HairColour,
  hairAlbedo,
} from "../../src/surface/hairTone.ts";
import { linearToSrgb } from "../../src/surface/skinTone.ts";

const SIZE = 64;
const canvas = document.createElement("canvas");
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.toneMapping = NoToneMapping;
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 5);
const targets: WebGLRenderTarget[] = [];
afterAll(() => {
  for (const t of targets) t.dispose();
  renderer.dispose();
});

/** A strand map texel: grey at `linear` (sRGB-encoded as the packer does), with `alpha` 0..255. */
const texel = (linear: number, alpha: number): [number, number, number, number] => {
  const g = linearToSrgb(linear);
  return [g, g, g, alpha];
};

/** A texture from a per-pixel function, in the strand maps' encoding (8-bit sRGB grey and alpha). */
function strandMap(
  size: number,
  at: (x: number, y: number) => [number, number, number, number],
): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data.set(at(x, y), (y * size + x) * 4);
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const FLAT = strandMap(4, () => texel(HAIR_STRAND_MEAN, 255));

function render(
  mesh: Mesh,
  { samples = 0, light = [0, 0, 1] as [number, number, number] } = {},
): Float32Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType, samples });
  targets.push(target);
  const scene = new Scene();
  scene.add(mesh);
  const lamp = new DirectionalLight(0xffffff, Math.PI);
  lamp.position.set(...light);
  scene.add(lamp);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  const px = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, px);
  renderer.setRenderTarget(null);
  return px;
}

const at = (px: Float32Array, x: number, y: number, c = 0) =>
  px[((y * SIZE + x) * 4 + c) as number] as number;
/** Mean of channel `c` over the middle half of the image, away from the plane's edges. */
const centre = (px: Float32Array, c: number) => {
  let sum = 0;
  let n = 0;
  for (let y = SIZE / 4; y < (3 * SIZE) / 4; y++)
    for (let x = SIZE / 4; x < (3 * SIZE) / 4; x++) {
      sum += at(px, x, y, c);
      n++;
    }
  return sum / n;
};

function card(
  options: {
    map?: DataTexture;
    colour?: HairColour;
    occlusion?: number;
    strand?: { angle: number; coherence: number };
    multisampled?: boolean;
  } = {},
): { mesh: Mesh; material: HairMaterial } {
  const plane = new PlaneGeometry(2, 2);
  setHairOcclusionAttribute(
    plane,
    new Float32Array(plane.getAttribute("position").count).fill(options.occlusion ?? 1),
  );
  const material = new HairMaterial();
  material.map = options.map ?? FLAT;
  material.setColour(options.colour ?? (HAIR_COLOURS.brown as HairColour));
  material.setStrand(options.strand ?? { angle: 0, coherence: 0 });
  material.setMultisampled(options.multisampled ?? false);
  return { mesh: new Mesh(plane, material), material };
}

describe("hair colour on the GPU", () => {
  it("renders every colour as its albedo, to within the small specular a rough fibre adds", () => {
    const colours: [string, HairColour][] = [
      ...Object.entries(HAIR_COLOURS).map(([n, c]) => [n, c] as [string, HairColour]),
      ["blue dye", { eumelanin: 0, pheomelanin: 0, grey: 0, override: [0.06, 0.11, 0.36] }],
      ["pink dye", { eumelanin: 0, pheomelanin: 0, grey: 0, override: [0.7, 0.2, 0.35] }],
    ];
    for (const [name, colour] of colours) {
      const { mesh, material } = card({ colour });
      const px = render(mesh);
      const want = hairAlbedo(colour);
      for (const c of [0, 1, 2]) {
        const got = centre(px, c);
        // Lambert at normal incidence is the albedo. The light is at the camera, the
        // peak of the fibre's specular lobe, which adds about 0.05 of white at every colour.
        expect(got, `${name} channel ${c}`).toBeGreaterThanOrEqual((want[c] as number) * 0.97);
        expect(got, `${name} channel ${c}`).toBeLessThan((want[c] as number) * 1.1 + 0.06);
      }
      material.dispose();
    }
  });

  it("keeps the strand map's structure: texels twice as bright render twice as bright", () => {
    const stripes = strandMap(8, (x) => texel(HAIR_STRAND_MEAN * (x % 2 === 0 ? 0.5 : 1.5), 255));
    const { mesh } = card({ map: stripes, colour: HAIR_COLOURS["light-blonde"] as HairColour });
    const px = render(mesh);
    const row = (SIZE * 3) / 8;
    let lo = 0;
    let hi = 0;
    // The plane spans the image, so texture column x covers pixels [x*8, x*8+8); sample column centres.
    for (let x = 0; x < 8; x++) {
      const v = at(px, x * 8 + 4, row);
      if (x % 2 === 0) lo += v / 4;
      else hi += v / 4;
    }
    // Three times as bright in the map; the specular's constant share narrows the ratio a little.
    expect(hi / lo).toBeGreaterThan(2.2);
    expect(hi / lo).toBeLessThan(3.2);
  });
});

describe("hair cut-outs", () => {
  /** Alpha rising left to right: clear at the left edge, opaque at the right. */
  const ramp = strandMap(64, (x) => texel(HAIR_STRAND_MEAN, Math.round((x / 63) * 255)));
  // Filtered, as the packed maps are: coverage needs alpha to change within a texel.
  ramp.magFilter = LinearFilter;
  ramp.minFilter = LinearFilter;

  it("cuts texels below the cutoff, with an alpha test where the target is not multisampled", () => {
    const { mesh, material } = card({ map: ramp, multisampled: false });
    const px = render(mesh);
    const row = SIZE / 2;
    // Left of the cutoff nothing is drawn; right of it the card is fully lit; no pixel is in between.
    const cut = Math.round(HAIR_ALPHA_CUTOFF * SIZE);
    expect(at(px, cut - 4, row)).toBe(0);
    expect(at(px, cut + 4, row)).toBeGreaterThan(0.03);
    const lit = at(px, SIZE - 4, row);
    for (let x = 0; x < SIZE; x++) {
      const v = at(px, x, row);
      expect(v === 0 || Math.abs(v - lit) < 0.01, `x=${x}: ${v}`).toBe(true);
    }
    material.dispose();
  });

  it("smooths the edge with alpha-to-coverage on a multisampled target", () => {
    /** Pixels along the cut that are neither empty nor fully lit, down every row. */
    const partialPixels = (multisampled: boolean, samples: number) => {
      const { mesh, material } = card({ map: ramp, multisampled });
      const px = render(mesh, { samples });
      const lit = at(px, SIZE - 4, SIZE / 2);
      let partial = 0;
      for (let y = 4; y < SIZE - 4; y++)
        for (let x = 0; x < SIZE; x++) {
          const v = at(px, x, y);
          if (v > 0.05 * lit && v < 0.95 * lit) partial++;
        }
      material.dispose();
      return partial;
    };
    // A plain alpha test leaves none; coverage leaves a pixel on most rows, where the alpha crosses the cutoff.
    expect(partialPixels(false, 4)).toBe(0);
    expect(partialPixels(true, 4)).toBeGreaterThan(10);
  });

  it("detects whether the framebuffer is multisampled", () => {
    // The canvas above asked for antialiasing; a canvas that does not has one sample.
    expect(isMultisampled(renderer.getContext())).toBe(true);
    const plain = new WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
    expect(isMultisampled(plain.getContext())).toBe(false);
    plain.dispose();
  });
});

describe("hair occlusion on the GPU", () => {
  it("scales the light by the floor-mixed bake, and a card with none baked is fully lit", () => {
    const open = centre(render(card({ occlusion: 1 }).mesh), 0);
    for (const occ of [0, 0.25, 0.6]) {
      const got = centre(render(card({ occlusion: occ }).mesh), 0) / open;
      expect(got, `occlusion ${occ}`).toBeCloseTo(
        HAIR_OCCLUSION_FLOOR + (1 - HAIR_OCCLUSION_FLOOR) * occ,
        1,
      );
    }
  });
});

describe("hair highlights", () => {
  /**
   * A sphere seen from the light's side, its highlight at the centre; how wide
   * the highlight is along the horizontal and the vertical through the centre.
   * On a UV sphere, U runs round (horizontal at the centre) and V up
   * (vertical).
   */
  function highlight(strand: { angle: number; coherence: number }) {
    const material = new HairMaterial();
    material.setColour({ eumelanin: 0.5, pheomelanin: 0.1, grey: 0, override: null });
    material.setStrand(strand);
    // A glossy, rough-free fibre makes the highlight's shape the measurement.
    material.roughness = 0.3;
    material.sheen = 0;
    material.map = FLAT;
    const sphere = new SphereGeometry(0.9, 64, 48);
    setHairOcclusionAttribute(
      sphere,
      new Float32Array(sphere.getAttribute("position").count).fill(1),
    );
    const px = render(new Mesh(sphere, material));
    const c = SIZE / 2;
    // The width along a line, over the middle of the disc (the rim, where a grazing
    // highlight is brightest, is left out): how many pixels stay within 20 % of the peak.
    const width = (read: (i: number) => number) => {
      let peak = 0;
      for (let i = c - 20; i <= c + 20; i++) peak = Math.max(peak, read(i));
      let w = 0;
      for (let i = c - 20; i <= c + 20; i++) if (read(i) >= 0.8 * peak) w++;
      return w;
    };
    const horizontal = width((i) => at(px, i, c));
    const vertical = width((i) => at(px, c, i));
    material.dispose();
    return { horizontal, vertical };
  }

  it("spreads across strands that run along V, so the band is wider than it is tall", () => {
    const h = highlight({ angle: Math.PI / 2, coherence: 1 });
    expect(h.horizontal).toBeGreaterThan(h.vertical * 1.3);
  });

  it("turns with the strands: along U, the band is taller than it is wide", () => {
    const h = highlight({ angle: 0, coherence: 1 });
    expect(h.vertical).toBeGreaterThan(h.horizontal * 1.3);
  });

  it("stays round for hair with no strand direction", () => {
    const h = highlight({ angle: Math.PI / 2, coherence: 0 });
    expect(Math.abs(h.horizontal - h.vertical)).toBeLessThanOrEqual(2);
  });
});

describe("the material's own shader", () => {
  it("compiles beside a stock material in one scene, without clashing", () => {
    const { mesh, material } = card();
    const stock = new Mesh(new PlaneGeometry(0.2, 0.2), new MeshStandardMaterial());
    const scene = new Scene();
    scene.add(mesh, stock);
    expect(() => renderer.compile(scene, camera)).not.toThrow();
    material.dispose();
  });
});
