import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import {
  CALLUS_LAYER,
  callusAmount,
  footFrame,
  RIDGE_LAYER,
  RIDGE_SPACING,
  TOE_CREASE_LAYER,
  TOE_WRINKLE_LAYER,
  TOENAIL_GLOSS_LAYER,
  TOENAIL_LAYER,
  toeFrame,
} from "../src/surface/regions/feet.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { ridgeOrientation } from "../src/surface/ridges.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();

/**
 * The 3D tangent direction a vertex's stored ridge orientation stands for: the
 * UV angle (from the two coordinates) carried back to the surface through the
 * inverse of the UV Jacobian of the faces round the vertex, averaged. Null for
 * a vertex no face of the body reaches.
 */
function waveDirection3D(
  a: typeof assets,
  vertex: number,
  coordinate: number,
): [number, number, number] | null {
  const theta = ridgeOrientation(coordinate);
  const duv = [Math.cos(theta), Math.sin(theta)] as const;
  const P = a.positions;
  const acc = [0, 0, 0];
  let count = 0;
  for (const f of groupFaces(a, "body")) {
    const q = [0, 1, 2, 3].map((k) => a.faceVerts[f * 4 + k] as number);
    if (!q.includes(vertex)) continue;
    const uv = [0, 1, 2, 3].map((k) => [
      a.uvs[(a.faceUvs[f * 4 + k] as number) * 2] as number,
      a.uvs[(a.faceUvs[f * 4 + k] as number) * 2 + 1] as number,
    ]);
    const at = (v: number) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]] as [number, number, number];
    const p0 = at(q[0] as number);
    const e1 = at(q[1] as number).map((x, i) => x - (p0[i] as number)) as [number, number, number];
    const e2 = at(q[3] as number).map((x, i) => x - (p0[i] as number)) as [number, number, number];
    const [u0, u1, , u3] = uv as [number[], number[], number[], number[]];
    const b1 = [(u1[0] as number) - (u0[0] as number), (u1[1] as number) - (u0[1] as number)];
    const b2 = [(u3[0] as number) - (u0[0] as number), (u3[1] as number) - (u0[1] as number)];
    // Solve duv = alpha b1 + beta b2, then the 3D direction is alpha e1 + beta e2.
    const det = (b1[0] as number) * (b2[1] as number) - (b1[1] as number) * (b2[0] as number);
    if (Math.abs(det) < 1e-12) continue;
    const alpha = (duv[0] * (b2[1] as number) - duv[1] * (b2[0] as number)) / det;
    const beta = (-duv[0] * (b1[1] as number) + duv[1] * (b1[0] as number)) / det;
    const d = [0, 1, 2].map((i) => alpha * (e1[i] as number) + beta * (e2[i] as number));
    const len = Math.hypot(...(d as [number, number, number])) || 1;
    // Direction modulo a half turn: orient all the faces' contributions the same way before averaging.
    const sign =
      count > 0 &&
      (d[0] as number) * (acc[0] as number) +
        (d[1] as number) * (acc[1] as number) +
        (d[2] as number) * (acc[2] as number) <
        0
        ? -1
        : 1;
    for (let i = 0; i < 3; i++) acc[i] = (acc[i] as number) + (sign * (d[i] as number)) / len;
    count++;
  }
  if (count === 0) return null;
  const l = Math.hypot(...(acc as [number, number, number])) || 1;
  return acc.map((x) => x / l) as [number, number, number];
}
const P = assets.positions;
const n = assets.manifest.vertexCount;

describe("the foot frame", () => {
  const frame = footFrame(assets);
  const zones = skinZones(assets);

  it("runs from the heel (0) to the second toe's tip (1), the same on both feet", () => {
    for (const side of [0, 1] as const) {
      const f = frame.landmarks[side];
      // A foot is about a quarter of a metre long.
      expect(frame.length[side]).toBeGreaterThan(0.2);
      expect(frame.length[side]).toBeLessThan(0.32);
      // Heel pad near the back, ball two thirds of the way, the big toe's pad near the end.
      expect(f.heel.along).toBeGreaterThan(0.04);
      expect(f.heel.along).toBeLessThan(0.2);
      for (const mt of f.metatarsals) {
        expect(mt.along).toBeGreaterThan(0.55);
        expect(mt.along).toBeLessThan(0.8);
      }
      expect(f.hallux.along).toBeGreaterThan(0.85);
      expect(f.hallux.along).toBeLessThan(1.02);
    }
    // The feet mirror each other, and `across` is outward on both: the same number.
    expect(frame.landmarks[0].heel.along).toBeCloseTo(frame.landmarks[1].heel.along, 2);
    expect(frame.landmarks[0].hallux.across).toBeCloseTo(frame.landmarks[1].hallux.across, 2);
    expect(frame.landmarks[0].hallux.along).toBeCloseTo(frame.landmarks[1].hallux.along, 2);
  });

  it("puts the big toe on the inside and the little toe on the outside of each foot", () => {
    for (const side of [0, 1] as const) {
      const f = frame.landmarks[side];
      // Across is positive toward the outside of the foot.
      expect(f.metatarsals[0]?.across).toBeLessThan(f.metatarsals[4]?.across as number);
      expect(f.hallux.across).toBeLessThan(0);
    }
  });

  it("measures along and across for the foot's vertices, none elsewhere", () => {
    let feet = 0;
    for (let v = 0; v < n; v++) {
      if ((zones.zone("foot")[v] as number) < 0.5) {
        expect(frame.side[v], `vertex ${v} off the feet`).toBe(255);
        continue;
      }
      feet++;
      const side = (P[v * 3] as number) >= 0 ? 0 : 1;
      expect(frame.side[v]).toBe(side);
      expect(Number.isFinite(frame.along[v])).toBe(true);
      expect(Number.isFinite(frame.across[v])).toBe(true);
    }
    expect(feet).toBeGreaterThan(1000);
  });
});

describe("callus", () => {
  const fields = CALLUS_LAYER.fields(assets);
  const frame = footFrame(assets);

  /** Largest mask on a foot's sole within `r` metres (along the foot) and across of a landmark. */
  const peakNear = (side: 0 | 1, along: number, across: number, r: number) => {
    let best = 0;
    for (let v = 0; v < n; v++) {
      if (frame.side[v] !== side) continue;
      const da = ((frame.along[v] as number) - along) * (frame.length[side] as number);
      const dc = (frame.across[v] as number) - across;
      if (Math.hypot(da, dc) < r) best = Math.max(best, fields.mask[v] as number);
    }
    return best;
  };

  it("is on the sole at the heel, the ball and the big toe's pad, on both feet", () => {
    for (const side of [0, 1] as const) {
      const f = frame.landmarks[side];
      expect(peakNear(side, f.heel.along, f.heel.across, 0.012), "heel").toBeGreaterThan(0.8);
      expect(peakNear(side, f.hallux.along, f.hallux.across, 0.012), "hallux").toBeGreaterThan(0.6);
      const ball = f.metatarsals[0] as { along: number; across: number };
      expect(peakNear(side, ball.along, ball.across, 0.012), "ball").toBeGreaterThan(0.8);
    }
  });

  it("is absent from the top of the foot, the arch and everything but the feet", () => {
    const zones = skinZones(assets);
    const sole = zones.sole;
    let dorsal = 0;
    let off = 0;
    for (let v = 0; v < n; v++) {
      const m = fields.mask[v] as number;
      if (frame.side[v] === 255 && m > 0) off++;
      if ((zones.zone("foot")[v] as number) > 0.5 && (sole[v] as number) === 0 && m > 0.05)
        dorsal++;
    }
    expect(off).toBe(0);
    expect(dorsal).toBe(0);
  });

  it("is between 0 and 1 and the arch carries less than the heel", () => {
    expect(Math.max(...fields.mask)).toBeLessThanOrEqual(1);
    expect(Math.min(...fields.mask)).toBeGreaterThanOrEqual(0);
    const f = frame.landmarks[0];
    // Midway between heel and ball, on the foot's inner side: the arch.
    const arch = peakNear(
      0,
      (f.heel.along + (f.metatarsals[0] as { along: number }).along) / 2,
      -0.03,
      0.012,
    );
    expect(arch).toBeLessThan(0.35);
  });

  it("thickens with age: little in a small child, most in the old", () => {
    expect(callusAmount(1)).toBeLessThan(0.2);
    expect(callusAmount(10)).toBeLessThan(callusAmount(30));
    expect(callusAmount(30)).toBeLessThan(callusAmount(80));
    expect(callusAmount(80)).toBeLessThanOrEqual(1);
    expect(callusAmount(undefined)).toBe(callusAmount(30));
  });
});

describe("the toes' frame", () => {
  const frame = toeFrame(assets);
  const zones = skinZones(assets);

  it("lays the digits big toe first from the inside out, on both feet", () => {
    for (const sign of [1, -1]) {
      const sum = [0, 0, 0, 0, 0, 0];
      const count = [0, 0, 0, 0, 0, 0];
      for (let v = 0; v < n; v++) {
        const d = frame.digit[v] as number;
        if (d === 0 || Math.sign(P[v * 3] as number) !== sign) continue;
        // Out on the toes proper, not the instep.
        if ((frame.along[v] as number) < 0.01) continue;
        sum[d] = (sum[d] as number) + Math.abs(P[v * 3] as number);
        count[d] = (count[d] as number) + 1;
      }
      const mean = [1, 2, 3, 4, 5].map((d) => (sum[d] as number) / (count[d] as number));
      // |x| grows from the big toe (inside) to the little toe (outside).
      for (let d = 1; d < 5; d++)
        expect(mean[d] as number, `digit ${d + 1}`).toBeGreaterThan(mean[d - 1] as number);
    }
  });

  it("measures `along` from each toe's base joint to its tip, in metres", () => {
    for (let d = 0; d < 5; d++) {
      // The big toe has two bones, the others three: the last joint is the tip.
      const joints = frame.joints[0]?.[d] as readonly number[];
      expect(joints.length).toBe(d === 0 ? 3 : 4);
      expect(joints[0]).toBeCloseTo(0, 6);
      expect(joints[1]).toBeGreaterThan(0.01);
      expect(joints[joints.length - 1]).toBeLessThan(0.07);
    }
    // The toes' flesh reaches the tip of the last bone and, with the pad, up to two centimetres past it.
    for (let d = 1; d <= 5; d++) {
      let top = Number.NEGATIVE_INFINITY;
      for (let v = 0; v < n; v++)
        if (frame.digit[v] === d && Math.sign(P[v * 3] as number) === 1)
          top = Math.max(top, frame.along[v] as number);
      const joints = frame.joints[0]?.[d - 1] as readonly number[];
      const tip = joints[joints.length - 1] as number;
      expect(top, `toe ${d}`).toBeGreaterThan(tip - 0.004);
      expect(top, `toe ${d}`).toBeLessThan(tip + 0.02);
    }
  });

  it("tells the sole from the top of the toe", () => {
    // `under` is positive on the sole's side: the pads of the toes have it, the nails' side not.
    let pads = 0;
    let nails = 0;
    for (let v = 0; v < n; v++) {
      if ((frame.digit[v] as number) === 0 || (zones.zone("foot")[v] as number) < 0.5) continue;
      if ((frame.under[v] as number) > 0.006) pads++;
      if ((frame.under[v] as number) < -0.006) nails++;
    }
    expect(pads).toBeGreaterThan(50);
    expect(nails).toBeGreaterThan(50);
  });
});

describe("toe joint creases", () => {
  const frame = toeFrame(assets);
  const dorsal = TOE_WRINKLE_LAYER.fields(assets);
  const plantar = TOE_CREASE_LAYER.fields(assets);

  const bands = (side: 0 | 1, toe: number) => {
    const j = frame.joints[side][toe - 1] as readonly number[];
    // Base joint (0) and the joints between the bones: the tip is not a joint.
    return j.slice(0, -1);
  };

  it("lies in a band across each toe at each of its joints, on its side of the toe only", () => {
    for (let v = 0; v < n; v++) {
      const d = frame.digit[v] as number;
      const under = frame.under[v] as number;
      const md = dorsal.mask[v] as number;
      const mp = plantar.mask[v] as number;
      if (d === 0) {
        expect(md).toBe(0);
        expect(mp).toBe(0);
        continue;
      }
      // Never on the sole's side of the dorsal wrinkles, nor the top's of the plantar creases.
      if (under > 0.002) expect(md, `vertex ${v}`).toBe(0);
      if (under < -0.002) expect(mp, `vertex ${v}`).toBe(0);
    }
  });

  it("is centred on a joint and runs 0 to 1 across the band, the way the toe runs", () => {
    for (const side of [0, 1] as const) {
      for (let toe = 1; toe <= 5; toe++) {
        for (const j of bands(side, toe)) {
          const xs: number[] = [];
          const ys: number[] = [];
          for (let v = 0; v < n; v++) {
            if (frame.digit[v] !== toe || Math.sign(P[v * 3] as number) !== (side === 0 ? 1 : -1))
              continue;
            const m = dorsal.mask[v] as number;
            // This joint's band: the nearest joint is this one (a band is at most 7 mm either side).
            const a = frame.along[v] as number;
            const closer = bands(side, toe).some((o) => Math.abs(a - o) < Math.abs(a - j));
            if (m <= 0 || closer || Math.abs(a - j) > 0.0075) continue;
            xs.push((frame.along[v] as number) - j);
            ys.push(dorsal.coord?.[v] as number);
          }
          if (xs.length < 6) continue;
          // Within 1.5 mm of the joint the coordinate is within a quarter of 0.5 (a band is at least 6 mm wide).
          xs.forEach((x, i) => {
            if (Math.abs(x) < 0.0015)
              expect(
                Math.abs((ys[i] as number) - 0.5),
                `toe ${toe} at ${j.toFixed(3)}`,
              ).toBeLessThan(0.26);
          });
          // And it grows along the toe: the correlation with `along` is strong.
          const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
          const my = ys.reduce((a, b) => a + b, 0) / ys.length;
          let sxy = 0;
          let sxx = 0;
          let syy = 0;
          xs.forEach((x, i) => {
            sxy += (x - mx) * ((ys[i] as number) - my);
            sxx += (x - mx) ** 2;
            syy += ((ys[i] as number) - my) ** 2;
          });
          expect(sxy / Math.sqrt(sxx * syy), `toe ${toe} at ${j.toFixed(3)}`).toBeGreaterThan(0.95);
        }
      }
    }
  });

  it("has a coordinate that stays inside 0..1 and a mask that fades out at the band's ends", () => {
    for (const f of [dorsal, plantar]) {
      expect(Math.min(...(f.coord as Float32Array))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...(f.coord as Float32Array))).toBeLessThanOrEqual(1);
    }
    // A mask is only above zero where the coordinate says the vertex is within its band.
    let wrong = 0;
    for (let v = 0; v < n; v++) {
      if ((dorsal.mask[v] as number) > 0 && ((dorsal.coord as Float32Array)[v] as number) <= 0)
        wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("is deeper on the sole than on the top, and the top's deepen with age", () => {
    const input = (age: number) => ({
      tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
      flush: 0.4,
      lips: 0.5,
      areola: 0.5,
      signals: {},
      age,
    });
    const top = (age: number) =>
      TOE_WRINKLE_LAYER.paint(input(age)) as { height: number; strength: number };
    const sole = TOE_CREASE_LAYER.paint(input(30)) as { height: number };
    expect(sole.height).toBeGreaterThan(top(30).height);
    expect(top(80).strength).toBeGreaterThan(top(30).strength);
    expect(top(5).strength).toBeLessThan(top(30).strength);
  });
});

describe("friction ridges on the sole", () => {
  const ridge = RIDGE_LAYER.fields(assets);
  const foot = footFrame(assets);
  const sole = skinZones(assets).sole;

  it("covers the sole and nothing else", () => {
    for (let v = 0; v < n; v++) {
      // Ignoring the faint tails of the sole's weight a vertex off the sole's faces may carry.
      if ((sole[v] as number) > 0.01)
        expect(ridge.mask[v], `vertex ${v}`).toBeCloseTo(sole[v] as number, 6);
      expect(ridge.mask[v]).toBeLessThanOrEqual(sole[v] as number);
    }
  });

  it("stores the orientation as a coordinate in 0..1 where there are ridges", () => {
    for (let v = 0; v < n; v++) {
      if ((ridge.mask[v] as number) <= 0.5) continue;
      const c = (ridge.coord as Float32Array)[v] as number;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(1);
    }
  });

  it("keeps neighbouring vertices of the sole from straddling the orientation's seam", () => {
    // Bilinear filtering between 0.02 and 0.98 passes through every orientation: a pair that wraps draws wrong ridges between.
    const coord = ridge.coord as Float32Array;
    let pairs = 0;
    let wraps = 0;
    for (const f of groupFaces(assets, "body"))
      for (let k = 0; k < 4; k++) {
        const a = assets.faceVerts[f * 4 + k] as number;
        const b = assets.faceVerts[f * 4 + ((k + 1) % 4)] as number;
        if ((ridge.mask[a] as number) < 0.5 || (ridge.mask[b] as number) < 0.5) continue;
        pairs++;
        if (Math.abs((coord[a] as number) - (coord[b] as number)) > 0.5) wraps++;
      }
    expect(pairs).toBeGreaterThan(300);
    expect(wraps / pairs).toBeLessThan(0.03);
  });

  it("runs the ridges across the foot at the heel, as a stripe across the sole's length", () => {
    // Where UV space is conformal enough, the stored UV angle maps back to the wave direction in 3D;
    // the ridges' waves run along the foot at the heel and arch, so the ridges cross it.
    const heel = foot.landmarks[0].heel;
    let checked = 0;
    for (let v = 0; v < n; v++) {
      if (foot.side[v] !== 0 || (ridge.mask[v] as number) < 0.5) continue;
      // The flat of the sole, where the face's plane holds the foot's axis (the heel's back curves up).
      if ((skinZones(assets).normals[v * 3 + 1] as number) > -0.85) continue;
      if (Math.abs((foot.along[v] as number) - heel.along) > 0.35) continue;
      const wave = waveDirection3D(assets, v, (ridge.coord as Float32Array)[v] as number);
      if (!wave) continue;
      // Along the foot's axis (z at rest), within 35 degrees either way (the ridges bow with the offset from the axis).
      expect(Math.abs(wave[2]), `vertex ${v}`).toBeGreaterThan(Math.cos((35 * Math.PI) / 180));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("is finer and shallower on a child than the ridges of a grown foot, and flattens with age", () => {
    const input = (age: number) => ({
      tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
      flush: 0.4,
      lips: 0.5,
      areola: 0.5,
      signals: {},
      age,
    });
    const paint = (age: number) =>
      RIDGE_LAYER.paint(input(age)) as { height: number; size: number };
    expect(paint(3).size).toBeLessThan(paint(30).size);
    expect(paint(30).size).toBeCloseTo(RIDGE_SPACING, 6);
    expect(paint(80).height).toBeLessThan(paint(30).height);
    expect(paint(30).height).toBeLessThanOrEqual(paint(3).height * 1.01 + 1e-9);
  });
});

describe("toenails", () => {
  const frame = toeFrame(assets);
  const colour = TOENAIL_LAYER.fields(assets);
  const gloss = TOENAIL_GLOSS_LAYER.fields(assets);

  /** The toe's vertices carrying nail (mask above a fifth: a lesser toe has a handful of vertices to the nail), by digit and side. */
  const nailVertices = (side: 0 | 1, toe: number) => {
    const out: number[] = [];
    for (let v = 0; v < n; v++)
      if (
        frame.digit[v] === toe &&
        Math.sign(P[v * 3] as number) === (side === 0 ? 1 : -1) &&
        (colour.mask[v] as number) > 0.2
      )
        out.push(v);
    return out;
  };

  it("lies on the top of each toe's end, on both feet, and on no other skin", () => {
    for (let v = 0; v < n; v++) {
      if ((colour.mask[v] as number) <= 0) continue;
      expect(frame.digit[v], `vertex ${v} is on a toe`).toBeGreaterThan(0);
      // The sole's side of a toe carries none.
      expect(frame.under[v] as number, `vertex ${v}`).toBeLessThan(0.004);
    }
    for (const side of [0, 1] as const)
      for (let toe = 1; toe <= 5; toe++)
        expect(nailVertices(side, toe).length, `toe ${toe}, side ${side}`).toBeGreaterThanOrEqual(
          1,
        );
  });

  it("is bigger on the big toe than the little toe, in length and in the skin it covers", () => {
    const span = (toe: number) => {
      const along = nailVertices(0, toe).map((v) => frame.along[v] as number);
      return Math.max(...along) - Math.min(...along);
    };
    expect(span(1)).toBeGreaterThan(span(5) * 1.5);
    for (let toe = 2; toe <= 5; toe++) expect(span(1), `toe ${toe}`).toBeGreaterThan(span(toe));
    expect(nailVertices(0, 1).length).toBeGreaterThan(nailVertices(0, 5).length);
  });

  it("runs from the proximal fold to the free edge: the coordinate grows toward each toe's tip", () => {
    for (const side of [0, 1] as const)
      for (let toe = 1; toe <= 5; toe++) {
        const vs = nailVertices(side, toe);
        // A lesser toe's nail has only a few vertices, along a single line of them: the correlation is of what there is.
        if (vs.length < 4) continue;
        const xs = vs.map((v) => frame.along[v] as number);
        const ys = vs.map((v) => (colour.coord as Float32Array)[v] as number);
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const my = ys.reduce((a, b) => a + b, 0) / ys.length;
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        xs.forEach((x, i) => {
          sxy += (x - mx) * ((ys[i] as number) - my);
          sxx += (x - mx) ** 2;
          syy += ((ys[i] as number) - my) ** 2;
        });
        expect(sxy / Math.sqrt(sxx * syy), `toe ${toe}, side ${side}`).toBeGreaterThan(0.8);
      }
  });

  it("is centred on the toe and not wider than it: the nail's edge lies short of the toe's sides", () => {
    for (let toe = 1; toe <= 5; toe++) {
      const across = nailVertices(0, toe).map((v) => Math.abs(frame.across[v] as number));
      // Within the toe's own radius (a centimetre or two): the plate is narrower than the digit.
      expect(Math.max(...across), `toe ${toe}`).toBeLessThan(toe === 1 ? 0.012 : 0.008);
    }
  });

  it("glosses where the nail is, and the nail grows yellower and thicker with age", () => {
    for (let v = 0; v < n; v++)
      expect(gloss.mask[v] as number).toBeLessThanOrEqual((colour.mask[v] as number) + 1e-6);
    const input = (age: number) => ({
      tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
      flush: 0.4,
      lips: 0.5,
      areola: 0.5,
      signals: {},
      age,
    });
    const stops = (age: number) => TOENAIL_LAYER.paint(input(age)).stops;
    // The bed (index 4): the old one is yellower (less blue against red) than the young.
    const young = stops(25)[4] as [number, number, number];
    const old = stops(85)[4] as [number, number, number];
    expect(old[2] / old[0]).toBeLessThan(young[2] / young[0]);
    // Fold and free edge ends keep their identity: eight stops either way.
    expect(stops(25)).toHaveLength(8);
    expect(stops(85)).toHaveLength(8);
  });
});
