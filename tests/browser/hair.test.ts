/**
 * The hair material on the GPU (src/render/hairMaterial.ts), measured on
 * analytic geometry: a strand map multiplied by the recipe's colour renders as
 * that colour's albedo at every hair colour, cut-outs cut and their edges
 * smooth where the canvas is multisampled, baked occlusion scales the light,
 * a hairline thins by its fade and an edge-on fin dissolves by its angle (cell by
 * cell of the card, never per screen pixel), a
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
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { afterAll, describe, expect, it } from "vitest";
import {
  HAIR_ALPHA_CUTOFF,
  HAIR_OCCLUSION_FLOOR,
  HairMaterial,
  HIGHLIGHT_OVER_DIFFUSE,
  isMultisampled,
  setHairOcclusionAttribute,
  setHairRankAttribute,
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
  // 20 texture units per metre: a 3 mm strand is 1/16 of the plane's UV range, four pixels.
  setHairStrandAttributes(
    g,
    fade,
    growth,
    new Float32Array(n).fill(o.fin ?? 0),
    new Float32Array(n).fill(20),
  );
}

const FLAT = strandMap(4, () => texel(HAIR_STRAND_MEAN, 255));

/** The studio's environment (`StudioStage`'s RoomEnvironment), prefiltered once on first use. */
let studioRoom: Texture | null = null;
function studioEnvironment(): Texture {
  if (!studioRoom) {
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    studioRoom = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
  }
  return studioRoom;
}

/**
 * `StudioStage`'s lights, seen from the camera on +z: the warm key high front-right, the
 * fill front-left, the rim behind, the hemisphere and the room environment.
 */
function addStudio(scene: Scene): void {
  scene.add(new HemisphereLight(0xeceeee, 0x3a342e, 0.22));
  const lights: [number, [number, number, number], number][] = [
    [0xfff6ef, [1.8, 3.2, 2.6], 2.4],
    [0xffffff, [-2.6, 1.6, 2.2], 0.7],
    [0xffffff, [-1.2, 2.4, -3], 1.6],
  ];
  for (const [colour, position, intensity] of lights) {
    const lamp = new DirectionalLight(colour, intensity);
    lamp.position.set(...position);
    scene.add(lamp);
  }
  scene.environment = studioEnvironment();
  scene.environmentIntensity = 0.22;
}

function render(
  mesh: Mesh,
  {
    samples = 0,
    light = [0, 0, 1] as [number, number, number],
    studio = false,
  }: { samples?: number; light?: [number, number, number]; studio?: boolean } = {},
): Float32Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: FloatType, samples });
  targets.push(target);
  const scene = new Scene();
  scene.add(mesh);
  if (studio) addStudio(scene);
  else {
    const lamp = new DirectionalLight(0xffffff, Math.PI);
    lamp.position.set(...light);
    scene.add(lamp);
  }
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
        // peak of the fibre's specular lobe, which adds a little white at every colour (and takes
        // a little of the diffuse, as any specular layer does).
        expect(got, `${name} channel ${c}`).toBeGreaterThanOrEqual((want[c] as number) * 0.93);
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

  it("never outshines its diffuse: peak highlight stays under a set multiple, on every strand direction and light", () => {
    /** The render with the lobes on, divided by the same material's diffuse alone (lobes, sheen and base specular off). */
    const ratioPeak = (
      growth: ((x: number, y: number) => number) | undefined,
      light: [number, number, number],
      coherence: number,
    ) => {
      const sphere = new SphereGeometry(0.9, 64, 48);
      setHairOcclusionAttribute(
        sphere,
        new Float32Array(sphere.getAttribute("position").count).fill(1),
      );
      setStrandAttributesFrom(sphere, growth ? { growth } : {});
      const draw = (diffuseOnly: boolean) => {
        const material = new HairMaterial();
        material.setColour({ eumelanin: 0.5, pheomelanin: 0.1, grey: 0, override: null });
        material.setStrand({ angle: 0, coherence });
        material.map = FLAT;
        if (diffuseOnly) {
          material.hkUniforms.hkLobes.value.x = 0;
          material.sheen = 0;
          material.specularIntensity = 0;
        }
        const px = render(new Mesh(sphere, material), { light });
        material.dispose();
        return px;
      };
      const on = draw(false);
      const off = draw(true);
      let brightest = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) brightest = Math.max(brightest, at(off, x, y));
      let peak = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const d = at(off, x, y);
          // Only where the diffuse is at least half its brightest (not the limb, where sheen, a fibre's grazing fuzz, rightly outweighs it).
          if (d > 0.5 * brightest) peak = Math.max(peak, at(on, x, y) / d);
        }
      return peak;
    };
    const lights: [number, number, number][] = [
      [0, 0, 1],
      [0.8, 0.4, 0.6],
      [-0.6, 0.7, 0.4],
    ];
    const growths: ((x: number, y: number) => number)[] = [(_, y) => y, (x) => x, (x, y) => x + y];
    // The worst hair pixel at the key light, against its diffuse.
    for (const coherence of [0, 1])
      for (const growth of growths)
        for (const light of lights)
          expect(
            ratioPeak(growth, light, coherence),
            `coherence ${coherence}, light ${light}`,
          ).toBeLessThan(HIGHLIGHT_OVER_DIFFUSE);
  });

  it("never outshines its diffuse under the studio's lights and environment, at any colour or style's combing", () => {
    // The playground's stage adds a rim light and a room environment, whose reflection is what
    // makes black hair (a tiny diffuse) read as glossy plastic. Luminance, every pixel whose
    // diffuse is at least half its brightest, against the same material with the lobes, the
    // sheen and the base specular off.
    const luminance = (px: Float32Array, x: number, y: number) =>
      0.2126 * at(px, x, y, 0) + 0.7152 * at(px, x, y, 1) + 0.0722 * at(px, x, y, 2);
    const ratioPeak = (
      colour: HairColour,
      coherence: number,
      growth: (x: number, y: number) => number,
    ) => {
      const sphere = new SphereGeometry(0.9, 64, 48);
      setHairOcclusionAttribute(
        sphere,
        new Float32Array(sphere.getAttribute("position").count).fill(1),
      );
      setStrandAttributesFrom(sphere, { growth });
      const draw = (diffuseOnly: boolean) => {
        const material = new HairMaterial();
        material.setColour(colour);
        material.setStrand({ angle: 0, coherence });
        material.map = FLAT;
        if (diffuseOnly) {
          material.hkUniforms.hkLobes.value.x = 0;
          material.sheen = 0;
          material.specularIntensity = 0;
        }
        const px = render(new Mesh(sphere, material), { studio: true });
        material.dispose();
        return px;
      };
      const on = draw(false);
      const off = draw(true);
      let brightest = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) brightest = Math.max(brightest, luminance(off, x, y));
      let peak = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const d = luminance(off, x, y);
          if (d > 0.5 * brightest) peak = Math.max(peak, luminance(on, x, y) / d);
        }
      return peak;
    };
    const growths: ((x: number, y: number) => number)[] = [(_, y) => y, (x) => x, (x, y) => x + y];
    const worst: Record<string, number> = {};
    // short02's combing (side-swept), bob02's, long01's (long and straight), and perfectly combed.
    for (const name of ["black", "dark-brown", "brown", "light-blonde"])
      for (const coherence of [0.08, 0.64, 0.81, 1])
        for (const growth of growths) {
          const r = ratioPeak(HAIR_COLOURS[name] as HairColour, coherence, growth);
          worst[name] = Math.max(worst[name] ?? 0, r);
          expect(r, `${name}, coherence ${coherence}`).toBeLessThan(HIGHLIGHT_OVER_DIFFUSE);
        }
    console.log(`studio highlight over diffuse, worst per colour: ${JSON.stringify(worst)}`);
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

  /**
   * A 16x16 strand map with mipmaps, clear across its left five columns and opaque beyond: a
   * painted edge at 5/16 of the card, which the hairline thins toward.
   */
  const painted = () => {
    const map = strandMap(16, (x) => texel(HAIR_STRAND_MEAN, x < 5 ? 0 : 255));
    map.magFilter = NearestFilter;
    map.minFilter = LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  };
  const EDGE_PX = (5 / 16) * SIZE; // where the painted edge falls on screen

  it("thins a hairline strand by strand toward the painted edge: sparse at it, whole farther in, and whole strands, not dots", () => {
    // Strands run up the card (along V), so each strand is one column of pixels.
    const strand = { angle: Math.PI / 2, coherence: 0 };
    const { mesh, material } = card({ map: painted(), fade: () => 0, strand });
    const px = render(mesh);
    const share = (from: number, to: number) => drawn(px, from, to);
    // Nothing where the texture is clear; thinner at the edge than a way in; whole well in.
    expect(share(0, EDGE_PX - 2)).toBe(0);
    const bins = [0, 1, 2, 3].map((i) =>
      share(
        EDGE_PX + 2 + i * ((SIZE - EDGE_PX - 2) / 4),
        EDGE_PX + 2 + (i + 1) * ((SIZE - EDGE_PX - 2) / 4),
      ),
    );
    expect(bins[0] as number, `bins ${bins}`).toBeLessThan(0.7);
    expect(bins[3] as number, `bins ${bins}`).toBeGreaterThan(0.9);
    expect(bins[3] as number).toBeGreaterThan((bins[0] as number) + 0.25);
    // Whole strands: a column of pixels is drawn along its whole height or not at all
    // (a screen-door dither would leave most columns half drawn).
    let whole = 0;
    let partial = 0;
    for (let x = Math.ceil(EDGE_PX) + 2; x < SIZE; x++) {
      let n = 0;
      for (let y = 4; y < SIZE - 4; y++) if (at(px, x, y) > 0.005) n++;
      const f = n / (SIZE - 8);
      if (f < 0.05 || f > 0.95) whole++;
      else partial++;
    }
    // (A tip frays over a fifth of the ramp, cell by cell along the strand.)
    expect(whole, `columns whole ${whole}, partial ${partial}`).toBeGreaterThan(2 * partial);
    material.dispose();
    // A card that is no hairline (fade 1) is drawn whole to its painted edge.
    const whole1 = card({ map: painted(), fade: () => 1, strand });
    expect(drawn(render(whole1.mesh), Math.ceil(EDGE_PX) + 1)).toBeGreaterThan(0.99);
    whole1.material.dispose();
  });

  it("ramps a hairline's strand edges over more than a pixel under MSAA: no step from empty to whole between neighbours", (ctx) => {
    // Some software rasterisers (SwiftShader in CI) do not implement alpha-to-coverage; a stock
    // material on the same target shows whether this context can be asked.
    const stock = new MeshBasicMaterial({ map: FLAT, alphaToCoverage: true, alphaTest: 0.4 });
    stock.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        "#include <alphatest_fragment>",
        "diffuseColor.a = 0.5;\n#include <alphatest_fragment>",
      );
    };
    const half = render(new Mesh(new PlaneGeometry(2, 2), stock), { samples: 4 });
    stock.dispose();
    const v = at(half, SIZE / 2, SIZE / 2);
    if (!(v > 0.05 && v < 0.95)) ctx.skip("this GL context does not implement alpha-to-coverage");

    const strand = { angle: Math.PI / 2, coherence: 0 };
    /** Pixel pairs in the hairline that step straight from empty to whole, and those that cross the edge at all. */
    const steps = (multisampled: boolean) => {
      const { mesh, material } = card({ map: painted(), fade: () => 0, strand, multisampled });
      const px = render(mesh, { samples: 4 });
      material.dispose();
      let lit = 0;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) lit = Math.max(lit, at(px, x, y));
      const empty = (x: number, y: number) => at(px, x, y) < 0.02 * lit;
      const whole = (x: number, y: number) => at(px, x, y) > 0.98 * lit;
      let hard = 0;
      let crossings = 0;
      for (let y = 4; y < SIZE - 5; y++)
        for (let x = Math.ceil(EDGE_PX) + 2; x < SIZE - 5; x++)
          for (const [nx, ny] of [
            [x + 1, y],
            [x, y + 1],
          ] as const) {
            const a = at(px, x, y);
            const b = at(px, nx, ny);
            if (Math.abs(a - b) < 0.5 * lit) continue;
            crossings++;
            if ((empty(x, y) && whole(nx, ny)) || (whole(x, y) && empty(nx, ny))) hard++;
          }
      return { hard, crossings };
    };
    const cut = steps(false);
    const smooth = steps(true);
    // The plain cut steps at nearly every edge; the ramp leaves a part-covered pixel on each.
    expect(cut.hard, `cut ${JSON.stringify(cut)}`).toBeGreaterThan(0.8 * cut.crossings);
    expect(smooth.crossings, `smooth ${JSON.stringify(smooth)}`).toBeGreaterThan(20);
    expect(smooth.hard, `smooth ${JSON.stringify(smooth)}`).toBeLessThanOrEqual(
      0.02 * smooth.crossings,
    );
  });

  it("decides every strand cell on the card, never on the screen pixel: a card slid sideways draws the same image slid", () => {
    // A screen-space dither (a function of gl_FragCoord) would draw a different pattern once the
    // card moves; a hash of the card's own surface moves with it, so the dot-grid class of bug
    // (found on a hardware GPU, where software renders looked fine) cannot return.
    const strand = { angle: Math.PI / 2, coherence: 0 };
    const shift = 4; // pixels, an exact number of them
    // Both paths: the plain cut, and the smoothed edges under MSAA (alpha-to-coverage).
    for (const multisampled of [false, true])
      for (const fin of [0, 1]) {
        const fade = () => 0;
        const a = card({ map: painted(), fade, strand, fin, multisampled });
        const b = card({ map: painted(), fade, strand, fin, multisampled });
        // PlaneGeometry is 2 wide over SIZE pixels; a fin card is turned until it is half dissolved (|cos| 0.54).
        for (const m of [a.mesh, b.mesh]) m.rotation.y = fin ? 1 : 0;
        b.mesh.position.x = (shift * 2) / SIZE;
        const samples = multisampled ? 4 : 0;
        const pa = render(a.mesh, { samples });
        const pb = render(b.mesh, { samples });
        let lit = 0;
        for (let y = 0; y < SIZE; y++)
          for (let x = 0; x < SIZE; x++) lit = Math.max(lit, at(pa, x, y));
        let compared = 0;
        let differ = 0;
        for (let y = 4; y < SIZE - 4; y++)
          for (let x = 10; x < SIZE - shift - 10; x++) {
            compared++;
            const va = at(pa, x, y);
            const vb = at(pb, x + shift, y);
            // A cut pixel is drawn or not; a smoothed one may differ by a sample of its coverage.
            if (multisampled ? Math.abs(va - vb) > 0.3 * lit : va > 0.005 !== vb > 0.005) differ++;
          }
        a.material.dispose();
        b.material.dispose();
        // (The view direction drifts a little as the card slides, moving the odd cell over its threshold;
        // a dither of the screen pixel would differ in about half the pixels.)
        expect(
          differ / compared,
          `multisampled ${multisampled}, fin ${fin}: pixels that differ once the card is slid`,
        ).toBeLessThan(0.08);
      }
  });

  it("dissolves a fin card as it turns edge-on, and leaves a card lying along the scalp alone", () => {
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

describe("body hair cards' ranks", () => {
  const ranked = (rank: number | null, density?: number) => {
    const { mesh, material } = card();
    if (rank !== null)
      setHairRankAttribute(
        mesh.geometry,
        new Float32Array(mesh.geometry.getAttribute("position").count).fill(rank),
      );
    if (density !== undefined) material.setDensity(density);
    const px = render(mesh);
    material.dispose();
    return centre(px, 1);
  };

  it("draw a card while its rank is under the density, and none at or over it", () => {
    expect(ranked(0.3, 0.5)).toBeGreaterThan(0.01);
    expect(ranked(0.7, 0.5)).toBe(0);
    expect(ranked(0.5, 0.5)).toBe(0);
  });

  it("leave hair with no ranks (scalp hair) whole at the default density", () => {
    expect(ranked(null)).toBeGreaterThan(0.01);
    expect(ranked(null)).toBeCloseTo(ranked(0, 1), 5);
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
