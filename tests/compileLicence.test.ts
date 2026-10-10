import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileAsset } from "../scripts/lib/compileAsset.ts";
import type { BodyMesh } from "../scripts/lib/hairCards/bind.ts";

const CC0 =
  "# This asset was explicitly released as CC0 in september 2020. The license\n# text for CC0 can be found in the root of this repository.\n";
const LICENSE_LINE = "# license CC0\n";
const AGPL =
  "# license AGPL3 (see also http://www.makehuman.org/doc/node/external_tools_license.html)\n";

/** A flat 2 m square at z = 0, two triangles: enough body for a small asset to bind to. */
const BODY: BodyMesh = {
  positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
  triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]),
};

describe("compileAsset", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-licence-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const BINDING = "name t\nobj_file t.obj\nmaterial t.mhmat\nz_depth 50\nverts 0\n1\n2\n3\n4\n";
  /** A one-quad asset bound to four base vertices, each file's header as given. */
  const write = (headers: { mhclo?: string; obj?: string; mhmat?: string }, binding = BINDING) => {
    const h = { mhclo: CC0, obj: CC0, mhmat: CC0, ...headers };
    fs.writeFileSync(path.join(dir, "t.mhclo"), `${h.mhclo}${binding}`);
    fs.writeFileSync(
      path.join(dir, "t.obj"),
      `${h.obj}v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n`,
    );
    fs.writeFileSync(path.join(dir, "t.mhmat"), `${h.mhmat}name t\ndiffuseColor 0.5 0.4 0.3\n`);
    return path.join(dir, "t.mhclo");
  };

  it("compiles a team asset whose files each carry MakeHuman's CC0 header", () => {
    const c = compileAsset(write({}), "hair/t", "hair");
    expect(c.vertexCount).toBe(4);
    expect(Object.values(c.evidence).every((e) => /released as CC0/.test(e))).toBe(true);
  });

  it("reads only the head of a file for its licence", () => {
    expect(() =>
      compileAsset(write({ obj: `${"#\n".repeat(2000)}${CC0}` }), "hair/t", "hair"),
    ).toThrow(/t\.obj does not prove CC0/);
  });

  const page = {
    url: "http://www.makehumancommunity.org/node/1769",
    submitter: "WDG",
    submitted: "2019-02-03",
    licence: "CC0 - Creative Commons Zero",
    retrieved: "2026-10-09",
  };

  it("compiles a community asset whose page says CC0, whatever its files say", () => {
    const c = compileAsset(write({ mhclo: AGPL, obj: AGPL, mhmat: "" }), "beard/t", "beard", {
      page,
    });
    for (const f of ["t.mhclo", "t.obj", "t.mhmat"])
      expect(c.evidence[path.join(dir, f)]).toBe(
        'B: page licence "CC0 - Creative Commons Zero" (<http://www.makehumancommunity.org/node/1769>, submitted 2019-02-03)',
      );
  });

  it("refuses an asset whose page is not CC0 and whose mesh is not CC0", () => {
    expect(() =>
      compileAsset(write({ mhclo: LICENSE_LINE, obj: AGPL }), "x/t", "x", {
        page: { ...page, licence: "CC-BY - Creative Commons Attribution" },
      }),
    ).toThrow(/licence gate: .*t\.mhclo: t\.obj does not prove CC0 \(page licence is "CC-BY/);
    expect(() => compileAsset(write({ obj: AGPL }), "hair/t", "hair")).toThrow(
      /t\.obj does not prove CC0/,
    );
  });

  it("packs a CC0 mesh without its material when only the material is not CC0", () => {
    const c = compileAsset(write({ mhmat: "" }), "hair/t", "hair");
    expect(c.material.color).toEqual([1, 1, 1]);
    expect(c.evidence[path.join(dir, "t.mhmat")]).toMatch(/not CC0; not shipped/);
  });

  describe("a CC0 mesh whose binding says AGPL", () => {
    // Distinctive values in the AGPL binding, so any of them reaching the output is visible.
    const AGPL_BINDING =
      "name AgplBindingName\nobj_file t.obj\nmaterial t.mhmat\nz_depth 37\nx_scale 11 12 3.14159\ny_scale 13 14 2.71828\nz_scale 15 16 1.61803\n" +
      "verts 0\n0 1 2 0.111111 0.222222 0.666667 0.314159 0.271828 0.161803\n" +
      "1 2 3 0.123457 0.234568 0.641975 0.414214 0.732051 0.236068\n" +
      "2 3 0 0.135791 0.246802 0.617407 0.577216 0.693147 0.301030\n" +
      "3 0 1 0.147025 0.258036 0.594939 0.618034 0.367879 0.434294\n" +
      "delete_verts\n7 8 9\n";
    const compileIt = (options = {}) =>
      compileAsset(
        write({ mhclo: AGPL, obj: LICENSE_LINE }, AGPL_BINDING),
        "horns/t",
        "horns",
        options,
      );

    it("passes, with the binding rebuilt against our base", () => {
      const c = compileIt({ body: BODY });
      expect(c.evidence[path.join(dir, "t.obj")]).toBe('M: file states "CC0"');
      expect(c.evidence[path.join(dir, "t.mhclo")]).toMatch(
        /not shipped, rebuilt from the CC0 mesh/,
      );
      // Bound to the square's triangles, the mesh comes back where the OBJ put it (metres).
      expect(c.arrays.refVerts.every((v) => v < 4)).toBe(true);
      expect(Array.from(c.arrays.offsets).every((o) => Math.abs(o) < 1e-6)).toBe(true);
    });

    it("ships no byte of the AGPL binding", () => {
      const c = compileIt({ body: BODY });
      expect(c.name).toBe("t");
      expect(c.zDepth).toBe(50);
      expect(c.scale).toBeNull();
      expect(c.arrays.deleteVerts.length).toBe(0);
      const packed = Buffer.concat(
        Object.values(c.arrays).map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)),
      );
      // Every value the AGPL binding holds, in the encodings the pack writes them in.
      const agplValues = AGPL_BINDING.split(/\s+/).filter((w) => /^\d+\.\d+$/.test(w));
      for (const value of agplValues)
        for (const v of [Number(value), Number(value) * 0.1]) {
          const bytes = Buffer.from(Float32Array.of(v).buffer);
          expect(packed.includes(bytes), `${value} reached the pack`).toBe(false);
        }
      expect(JSON.stringify({ ...c, arrays: null, textures: [...c.textures] })).not.toMatch(
        /AgplBindingName|3\.14159|2\.71828|1\.61803/,
      );
    });

    it("is refused without the base body to rebuild the binding against", () => {
      expect(() => compileIt()).toThrow(/binding is not CC0; pass the base body/);
    });
  });
});
