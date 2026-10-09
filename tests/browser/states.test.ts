/**
 * The skin-state layers (src/surface/regions/states.ts) through the real skin
 * shader: relief at the measured size, and colour and sheen at the strengths
 * their paint asks for.
 */
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_SKIN_APPEARANCE } from "../../src/render/skinMaterial.ts";
import { GOOSEBUMP_DENSITY_PER_CM2, GOOSEBUMP_LAYER } from "../../src/surface/regions/states.ts";
import { disposeLayerRender, renderLayers, variance } from "./layerRender.ts";

afterAll(disposeLayerRender);

/** A 4 cm square of skin at 0.16 mm per pixel, lit along x. */
const PATCH = 0.04;
const PIXELS = 256;

/**
 * The patch of a figure-sized plane (1.7 m per UV unit) whose middle is `at`
 * metres from the plane's own: near its origin, or at the far end of the UV
 * layout where most of a figure's skin is.
 */
const patch = (signals: Record<string, number>, at: [number, number] = [0, 0]) =>
  renderLayers([GOOSEBUMP_LAYER], {
    plane: 1.7,
    size: PIXELS,
    view: { span: PATCH, centre: at },
    appearance: { ...DEFAULT_SKIN_APPEARANCE, flush: 0, signals },
  });

/** Local maxima of the shading: one bright flank per bump under a grazing light. */
function brightFlanks(px: Float32Array): number {
  const sd = Math.sqrt(variance(px));
  const m = px.reduce((s, x) => s + x, 0) / px.length;
  const R = 4;
  let count = 0;
  for (let y = R; y < PIXELS - R; y++)
    for (let x = R; x < PIXELS - R; x++) {
      const c = px[y * PIXELS + x] as number;
      if (c < m + 0.5 * sd) continue;
      let peak = true;
      for (let dy = -R; dy <= R && peak; dy++)
        for (let dx = -R; dx <= R; dx++)
          if ((dx || dy) && (px[(y + dy) * PIXELS + x + dx] as number) > c) {
            peak = false;
            break;
          }
      if (peak) count++;
    }
  return count;
}

describe("goosebumps through the skin shader", () => {
  // 4 cm × 4 cm at the measured density, less the bumps cut by the patch's edge.
  const expected = PATCH * PATCH * 1e4 * GOOSEBUMP_DENSITY_PER_CM2;

  it("raise one papule per follicle at the measured density", () => {
    expect(variance(patch({}))).toBeLessThan(1e-9);
    const papules = brightFlanks(patch({ cold: 1 }));
    expect(papules).toBeGreaterThan(0.6 * expected);
    expect(papules).toBeLessThan(1.4 * expected);
  });

  it("do the same at the far end of the UV layout, where the cell index is large", () => {
    // A hash that loses precision for large cell indices bunches the bumps into
    // lines and leaves gaps, so the count and its spread across the patch fail.
    const far = patch({ cold: 1 }, [0.8, 0.8]);
    const papules = brightFlanks(far);
    expect(papules).toBeGreaterThan(0.6 * expected);
    expect(papules).toBeLessThan(1.4 * expected);
    // Every quarter of the patch holds a fair share of them.
    const quarter = (qx: number, qy: number) => {
      const h = PIXELS / 2;
      const part = new Float32Array(h * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < h; x++)
          part[y * h + x] = far[(qy * h + y) * PIXELS + qx * h + x] as number;
      return variance(part);
    };
    const spread = [quarter(0, 0), quarter(1, 0), quarter(0, 1), quarter(1, 1)];
    expect(Math.min(...spread)).toBeGreaterThan(0.5 * Math.max(...spread));
  });

  it("scale the relief with the signal: half the signal is half the height", () => {
    // Shading contrast is proportional to the slope, so its variance to height squared.
    const full = variance(patch({ cold: 1 }));
    const half = variance(patch({ cold: 0.5 }));
    expect(full / half).toBeGreaterThan(3);
    expect(full / half).toBeLessThan(5);
    expect(variance(patch({ fear: 1 }))).toBeCloseTo(full, 6);
  });
});
