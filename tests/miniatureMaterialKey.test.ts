/**
 * The key `<Miniatures>` rebuilds its crowd on (docs/MINIATURES.md): material
 * parameters by value, three.js objects by identity, and never through an
 * object's `toJSON` (which for a texture serialises its image).
 */
import { Color, DataTexture } from "three";
import { describe, expect, it } from "vitest";
import { miniatureMaterialKey } from "../src/render/miniature.ts";

describe("miniatureMaterialKey", () => {
  it("is equal for equal parameters in any order", () => {
    expect(miniatureMaterialKey({ roughness: 0.8, metalness: 0 })).toBe(
      miniatureMaterialKey({ metalness: 0, roughness: 0.8 }),
    );
    expect(miniatureMaterialKey({ roughness: 0.8 })).not.toBe(
      miniatureMaterialKey({ roughness: 0.7 }),
    );
  });

  it("keys a colour by its hex, so a fresh equal colour is the same key", () => {
    expect(miniatureMaterialKey({ color: new Color(1, 0, 0) })).toBe(
      miniatureMaterialKey({ color: new Color(1, 0, 0) }),
    );
    expect(miniatureMaterialKey({ color: new Color(1, 0, 0) })).not.toBe(
      miniatureMaterialKey({ color: new Color(0, 1, 0) }),
    );
  });

  it("keys a texture by identity without serialising it", () => {
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    map.toJSON = () => {
      throw new Error("a texture must not be serialised for a key");
    };
    const key = miniatureMaterialKey({ map });
    expect(key).toBe(miniatureMaterialKey({ map }));
    expect(key).not.toBe(miniatureMaterialKey({ map: new DataTexture(new Uint8Array(4), 1, 1) }));
  });
});
