/**
 * The authored hair styles (scripts/lib/hairCards): ropes placed from angles round the head, lying on
 * and hanging over the default figure's body, bound to its base mesh.
 */
import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { compileAuthored } from "../scripts/lib/hairCards/compile.ts";
import { BodySurface, HeadFrame } from "../scripts/lib/hairCards/head.ts";
import { AUTHORED_STYLES } from "../scripts/lib/hairCards/index.ts";
import { hairlineElevation } from "../scripts/lib/hairCards/styles.ts";
import { evaluateBinding } from "../src/mhclo/bound.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

let rest: ReturnType<HumanoidModel["restHead"]>;
let head: HeadFrame;
let body: BodySurface;
beforeAll(() => {
  rest = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 }).restHead();
  head = new HeadFrame(rest);
  body = new BodySurface(rest, head);
});

describe("the head frame", () => {
  it("finds the scalp from every direction over the cranium, with the normal pointing out", () => {
    for (let az = -180; az < 180; az += 20)
      for (let el = -10; el <= 90; el += 20) {
        const s = head.surface((az * Math.PI) / 180, (el * Math.PI) / 180);
        expect(s, `azimuth ${az}, elevation ${el}`).not.toBeNull();
        if (!s) continue;
        expect(s.normal.length()).toBeCloseTo(1, 5);
        expect(s.normal.dot(new Vector3().subVectors(s.point, head.centre))).toBeGreaterThan(0);
        // On the body, not near it.
        expect(Math.abs(body.probe(s.point).distance)).toBeLessThan(1e-4);
      }
  });

  it("reads a point as outside the body above the crown and inside it under the scalp", () => {
    const crown = head.surface(0, Math.PI / 2);
    if (!crown) throw new Error("no crown");
    expect(
      body.probe(crown.point.clone().addScaledVector(crown.normal, 0.01)).distance,
    ).toBeCloseTo(0.01, 3);
    expect(
      body.probe(crown.point.clone().addScaledVector(crown.normal, -0.02)).distance,
    ).toBeLessThan(-0.01);
  });

  it("puts the hairline lowest at the nape and the front's middle higher than the temples", () => {
    expect(hairlineElevation(180)).toBeLessThan(hairlineElevation(0));
    expect(hairlineElevation(40)).toBeLessThan(hairlineElevation(0));
    expect(hairlineElevation(-40)).toBe(hairlineElevation(40));
  });
});

describe.each(AUTHORED_STYLES.map((s) => [s.id, s] as const))(
  "the authored style %s",
  (_id, spec) => {
    let cards: ReturnType<typeof spec.build>;
    beforeAll(() => {
      cards = spec.build({ head, body });
    });

    it("is a whole mesh: finite positions, every face's corners and UVs in range", () => {
      const vertices = cards.positions.length / 3;
      const uvs = cards.uvs.length / 2;
      expect(vertices).toBeGreaterThan(500);
      expect(cards.positions.every(Number.isFinite)).toBe(true);
      expect(cards.faceVerts.length).toBe(cards.faceUvs.length);
      expect(cards.faceVerts.every((v) => v >= 0 && v < vertices)).toBe(true);
      expect(cards.faceUvs.every((v) => v >= 0 && v < uvs)).toBe(true);
      // The atlas is one image: a rope reads only inside it.
      for (let i = 0; i < uvs; i++) {
        expect(cards.uvs[i * 2] as number).toBeGreaterThanOrEqual(0);
        expect(cards.uvs[i * 2] as number).toBeLessThanOrEqual(1);
        expect(cards.uvs[i * 2 + 1] as number).toBeGreaterThanOrEqual(0);
        expect(cards.uvs[i * 2 + 1] as number).toBeLessThanOrEqual(1);
      }
    });

    it("lies over the body and not through it: all but the sunk roots are outside it", () => {
      let inside = 0;
      const p = new Vector3();
      const vertices = cards.positions.length / 3;
      for (let v = 0; v < vertices; v++) {
        p.set(
          cards.positions[v * 3] as number,
          cards.positions[v * 3 + 1] as number,
          cards.positions[v * 3 + 2] as number,
        );
        if (body.probe(p).distance < -0.0015) inside++;
      }
      // The first ring of every rope is sunk 2 mm under the scalp so it grows from it.
      expect(inside / vertices).toBeLessThan(0.08);
    });

    it("is made the same every time", () => {
      const again = spec.build({ head, body });
      expect(again.positions).toEqual(cards.positions);
      expect(again.uvs).toEqual(cards.uvs);
    });

    it("binds to the base mesh and comes back where it was, at rest", () => {
      const asset = compileAuthored(
        spec.id,
        spec.label,
        cards,
        rest,
        `${spec.id}.webp`,
        spec.provenance,
      );
      expect(asset.vertexCount).toBe(cards.positions.length / 3);
      expect(asset.faceCount).toBe(cards.faceVerts.length / 4);
      const out = evaluateBinding(
        { ...asset.arrays, entry: { scale: asset.scale, vertexCount: asset.vertexCount } },
        rest.positions,
        new Float32Array(asset.vertexCount * 3),
      );
      let worst = 0;
      out.forEach((value, i) => {
        worst = Math.max(worst, Math.abs(value - (cards.positions[i] as number)));
      });
      expect(worst).toBeLessThan(1e-5);
    });
  },
);
