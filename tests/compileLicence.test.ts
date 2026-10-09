import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileAsset, proveCc0 } from "../scripts/lib/compileAsset.ts";

const CC0 =
  "# This asset was explicitly released as CC0 in september 2020. The license\n# text for CC0 can be found in the root of this repository.\n";
const LICENSE_LINE = "# license CC0\n";
const AGPL =
  "# license AGPL3 (see also http://www.makehuman.org/doc/node/external_tools_license.html)\n";

describe("the asset licence gate", () => {
  it("accepts the header MakeHuman's CC0 release wrote into every asset", () => {
    expect(proveCc0("a.mhclo", `${CC0}name x\n`)).toMatch(/explicitly released as CC0/);
  });

  it("refuses a file whose only statement is a licence line, even one that says CC0", () => {
    expect(() => proveCc0("a.mhclo", `${LICENSE_LINE}name x\n`)).toThrow(/does not prove CC0/);
    expect(() => proveCc0("a.mhclo", "# license: CC0\nname x\n")).toThrow(/does not prove CC0/);
  });

  it("refuses a file that names another licence and says nothing else", () => {
    expect(() => proveCc0("a.obj", `${AGPL}v 0 0 0\n`)).toThrow(/does not prove CC0/);
    expect(() => proveCc0("a.mhclo", "# license CC-BY\nname x\n")).toThrow(/does not prove CC0/);
    expect(() => proveCc0("a.mhclo", "name x\n")).toThrow(/does not prove CC0/);
  });

  it("looks only at the head of a file, where the header is", () => {
    expect(() => proveCc0("a.mhclo", `${"#\n".repeat(2000)}${CC0}`)).toThrow(/does not prove CC0/);
  });
});

describe("compileAsset", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-licence-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A one-quad asset bound to four base vertices, each file's header as given. */
  const write = (headers: { mhclo?: string; obj?: string; mhmat?: string }) => {
    const h = { mhclo: CC0, obj: CC0, mhmat: CC0, ...headers };
    fs.writeFileSync(
      path.join(dir, "t.mhclo"),
      `${h.mhclo}name t\nobj_file t.obj\nmaterial t.mhmat\nz_depth 50\nverts 0\n1\n2\n3\n4\n`,
    );
    fs.writeFileSync(
      path.join(dir, "t.obj"),
      `${h.obj}v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n`,
    );
    fs.writeFileSync(path.join(dir, "t.mhmat"), `${h.mhmat}name t\ndiffuseColor 1 1 1\n`);
    return path.join(dir, "t.mhclo");
  };

  it("compiles an asset whose three files each carry the header", () => {
    const c = compileAsset(write({}), "hair/t", "hair");
    expect(c.vertexCount).toBe(4);
    expect(Object.values(c.evidence).every((e) => /released as CC0/.test(e))).toBe(true);
  });

  it("refuses an asset when any one of its files cannot prove CC0", () => {
    expect(() => compileAsset(write({ mhclo: LICENSE_LINE }), "hair/t", "hair")).toThrow(
      /t\.mhclo does not prove CC0/,
    );
    expect(() => compileAsset(write({ obj: AGPL }), "hair/t", "hair")).toThrow(
      /t\.obj does not prove CC0/,
    );
    expect(() => compileAsset(write({ mhmat: "" }), "hair/t", "hair")).toThrow(
      /t\.mhmat does not prove CC0/,
    );
  });
});
