/**
 * The hair material on the GPU (src/render/hairMaterial.ts), measured on
 * analytic geometry: a strand map multiplied by the recipe's colour renders as
 * that colour's albedo at every hair colour, cut-outs cut and their edges
 * smooth where the canvas is multisampled, baked occlusion scales the light,
 * a hairline dithers away by its fade and an edge-on fin by its angle, a
 * Kajiya-Kay highlight runs across the strands (their direction read from the
 * growth gradient), and the skin under the hair takes the scalp tint.
 *
 * CI runs these on SwiftShader (`HK_GPU=software`), whose derivatives are taken
 * per 2x2 quad: tests that count pixels use margins wide enough for that.
 *
 * Cards are drawn by an orthographic camera into a float render target (no
 * tone mapping), lit by one white directional light of intensity π from the
 * camera's side, so Lambert radiance of albedo A at normal incidence is A.
 */
import {
  BufferAttribute,
  type BufferGeometry,
  DataTexture,
  DirectionalLight,
  FloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
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
  setHairStrandAttributes,
} from "../../src/render/hairMaterial.ts";
import { SCALP_ATTRIBUTE, SkinMaterial } from "../../src/render/skinMaterial.ts";
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

/** Sets a geometry's fade, fin and growth from functions of each vertex's x, y. */
function setStrandAttributesFrom(
  g: BufferGeometry,
  o: {
    fade?: (x: number, y: number) => number;
    fin?: number;
    growth?: (x: number, y: number) => number;
  },
): void {
  const p = g.getAttribute("position");
  const n = p.count;
  const fade = new Float32Array(n);
  const growth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fade[i] = o.fade ? o.fade(p.getX(i), p.getY(i)) : 1;
    growth[i] = o.growth ? o.growth(p.getX(i), p.getY(i)) : 0;
  }
  setHairStrandAttributes(g, fade, growth, new Float32Array(n).fill(o.fin ?? 0));
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
    /** Per vertex fade, fin and growth as functions of the vertex's position; default all there, no fin, no growth. */
    fade?: (x: number, y: number) => number;
    fin?: number;
    growth?: (x: number, y: number) => number;
  } = {},
): { mesh: Mesh; material: HairMaterial } {
  const plane = new PlaneGeometry(2, 2, 8, 8);
  setHairOcclusionAttribute(
    plane,
    new Float32Array(plane.getAttribute("position").count).fill(options.occlusion ?? 1),
  );
  setStrandAttributesFrom(plane, options);
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

  it("smooths the edge with alpha-to-coverage on a multisampled target", (ctx) => {
    /** Pixels along the cut that are neither empty nor fully lit, down every row. */
    const partialPixels = (mesh: Mesh, samples: number) => {
      const px = render(mesh, { samples });
      const lit = at(px, SIZE - 4, SIZE / 2);
      let partial = 0;
      for (let y = 4; y < SIZE - 4; y++)
        for (let x = 0; x < SIZE; x++) {
          const v = at(px, x, y);
          if (v > 0.05 * lit && v < 0.95 * lit) partial++;
        }
      return partial;
    };
    const hair = (multisampled: boolean) => {
      const { mesh, material } = card({ map: ramp, multisampled });
      return { mesh, material };
    };
    // Some software rasterisers (SwiftShader in CI) do not implement alpha-to-coverage
    // on multisampled targets at all. A stock material set up the same way shows it:
    // when even that leaves no partial pixel, the context cannot be asked.
    const stock = new MeshBasicMaterial({ map: ramp, alphaToCoverage: true, alphaTest: 0.4 });
    const stockPartial = partialPixels(new Mesh(new PlaneGeometry(2, 2), stock), 4);
    stock.dispose();
    if (stockPartial === 0) ctx.skip("this GL context does not implement alpha-to-coverage");
    const off = hair(false);
    const on = hair(true);
    // A plain alpha test leaves none; coverage leaves a pixel on most rows, where the alpha crosses the cutoff.
    expect(partialPixels(off.mesh, 4)).toBe(0);
    expect(partialPixels(on.mesh, 4)).toBeGreaterThan(10);
    off.material.dispose();
    on.material.dispose();
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

describe("hair highlights (Kajiya-Kay)", () => {
  /**
   * A sphere seen from the light's side, with growth set from the vertex position by
   * `growth`; the strand lobes' contribution alone (the render minus the same render
   * with the lobes switched off), and how wide it is along the horizontal and the
   * vertical through the centre.
   */
  function lobes(growth: ((x: number, y: number) => number) | undefined) {
    const sphere = new SphereGeometry(0.9, 64, 48);
    setHairOcclusionAttribute(
      sphere,
      new Float32Array(sphere.getAttribute("position").count).fill(1),
    );
    setStrandAttributesFrom(sphere, growth ? { growth } : {});
    const render1 = (strength: number) => {
      const material = new HairMaterial();
      material.setColour({ eumelanin: 0.5, pheomelanin: 0.1, grey: 0, override: null });
      material.setStrand({ angle: 0, coherence: 1 });
      material.hkUniforms.hkLobes.value.x = strength;
      material.sheen = 0;
      material.map = FLAT;
      const px = render(new Mesh(sphere, material));
      material.dispose();
      return px;
    };
    const on = render1(1);
    const off = render1(0);
    const c = SIZE / 2;
    const diff = (x: number, y: number) => Math.max(0, at(on, x, y, 0) - at(off, x, y, 0));
    // How many pixels along a line through the centre hold at least half the lobes' peak there.
    const width = (read: (i: number) => number) => {
      let peak = 0;
      for (let i = c - 20; i <= c + 20; i++) peak = Math.max(peak, read(i));
      let w = 0;
      for (let i = c - 20; i <= c + 20; i++) if (read(i) >= 0.5 * peak) w++;
      return { width: w, peak };
    };
    const horizontal = width((i) => diff(i, c));
    const vertical = width((i) => diff(c, i));
    return { horizontal, vertical };
  }

  it("spreads across strands that grow upward: the band is wider than it is tall", () => {
    const h = lobes((_, y) => y);
    expect(h.horizontal.peak).toBeGreaterThan(0.02);
    expect(h.horizontal.width).toBeGreaterThan(h.vertical.width * 1.5);
  });

  it("turns with the strands: growing along x, the band is taller than it is wide", () => {
    const h = lobes((x) => x);
    expect(h.vertical.peak).toBeGreaterThan(0.02);
    expect(h.vertical.width).toBeGreaterThan(h.horizontal.width * 1.5);
  });

  it("is absent where growth has no gradient: no direction, no strand highlight", () => {
    const h = lobes(undefined);
    expect(h.horizontal.peak).toBeLessThan(0.002);
    expect(h.vertical.peak).toBeLessThan(0.002);
  });
});

describe("hairlines and fins", () => {
  /** Share of the image's pixels the render draws (anything above black). */
  const drawn = (px: Float32Array, from = 0, to = SIZE) => {
    let n = 0;
    for (let y = 0; y < SIZE; y++) for (let x = from; x < to; x++) if (at(px, x, y) > 0.005) n++;
    return n / ((to - from) * SIZE);
  };

  it("dithers a card away by its fade: none at 0, all at 1, a share in between, on any GPU", () => {
    // Fade 0 on the left edge, 1 on the right, rising linearly across the card.
    const { mesh, material } = card({ fade: (x) => (x + 1) / 2 });
    const px = render(mesh);
    const q = SIZE / 4;
    // Fade is about 1/8, 3/8, 5/8, 7/8 at the centres of the four quarters.
    for (const [i, want] of [0.125, 0.375, 0.625, 0.875].entries())
      expect(drawn(px, i * q, (i + 1) * q), `quarter ${i}`).toBeCloseTo(want, 1);
    // A flat fade of 0 draws nothing; one of 1 draws the whole card.
    expect(drawn(render(card({ fade: () => 0 }).mesh))).toBe(0);
    expect(drawn(render(card({ fade: () => 1 }).mesh))).toBeGreaterThan(0.99);
    material.dispose();
  });

  it("dithers a fin card away as it turns edge-on, and leaves a card lying along the scalp alone", () => {
    /** Pixels a card turned `turn` radians about the vertical axis draws, relative to the same card face-on. */
    const coverage = (fin: number, turn: number) => {
      const { mesh, material } = card({ fin });
      mesh.rotation.y = turn;
      const full = drawn(render(card({ fin }).mesh));
      const got = drawn(render(mesh));
      material.dispose();
      // A card turned by `turn` projects to cos(turn) of its width.
      return got / (full * Math.cos(turn));
    };
    const turn = (80 * Math.PI) / 180; // |cos| of the angle to the eye is 0.17
    expect(coverage(0, turn)).toBeGreaterThan(0.9);
    expect(coverage(1, turn)).toBeLessThan(0.5);
    // Face-on, fin or not, the whole card is there.
    expect(coverage(1, 0)).toBeGreaterThan(0.95);
  });
});

describe("the scalp under the hair", () => {
  /** A plane with the scalp attribute 0 on the left and 1 on the right, rendered; the red channel's left and right. */
  function sides(tint: [number, number, number] | null) {
    const plane = new PlaneGeometry(2, 2, 2, 1);
    const p = plane.getAttribute("position");
    plane.setAttribute(
      SCALP_ATTRIBUTE,
      new BufferAttribute(
        Float32Array.from({ length: p.count }, (_, i) => (p.getX(i) > 0.5 ? 1 : 0)),
        1,
      ),
    );
    const material = new SkinMaterial();
    material.normalMap = null;
    material.setScalp(tint);
    const px = render(new Mesh(plane, material));
    material.dispose();
    return { left: at(px, SIZE / 8, SIZE / 2), right: at(px, (7 * SIZE) / 8, SIZE / 2) };
  }

  it("tints the skin toward the hair's colour where the style grows, and nowhere else", () => {
    const none = sides(null);
    expect(none.right).toBeCloseTo(none.left, 2);
    const dark = sides([0.02, 0.012, 0.008]);
    // The left (no scalp) is untouched; the right is much darker.
    expect(dark.left).toBeCloseTo(none.left, 2);
    // (Specular and sheen are not tinted, so the drop is less than the diffuse's.)
    expect(dark.right).toBeLessThan(dark.left * 0.85);
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
