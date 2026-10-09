import { describe, expect, it } from "vitest";
import { parseMhclo } from "../src/mhclo/parse.ts";

const HEADER =
  "# author Jane Doe\n# license CC0\nname Knitted Sweater - Sleeveless\nobj_file sweater.obj\nz_depth 60\n";

describe("parseMhclo", () => {
  it("reads exact and weighted vertex lines and keeps multi-word metadata whole", () => {
    const b = parseMhclo(`${HEADER}verts 0\n7\n1 2 3 0.5 0.25 0.25 0.1 0.2 0.3\n\n`);
    expect(b.name).toBe("Knitted Sweater - Sleeveless");
    expect(b.author).toBe("Jane Doe");
    expect(b.licenseLine).toBe("# license CC0");
    expect(b.zDepth).toBe(60);
    expect([...b.refVerts]).toEqual([7, 7, 7, 1, 2, 3]);
    expect([...b.weights]).toEqual([1, 0, 0, 0.5, 0.25, 0.25]);
    expect([...b.offsets].map((x) => Math.round(x * 10) / 10)).toEqual([0, 0, 0, 0.1, 0.2, 0.3]);
  });

  it("reads delete_verts ranges and singles", () => {
    const b = parseMhclo(`${HEADER}verts 0\n1\n\ndelete_verts\n10 - 12 20\n`);
    expect([...b.deleteVerts]).toEqual([10, 11, 12, 20]);
  });

  it("does not lose a delete_verts section written straight after the vertex block", () => {
    const b = parseMhclo(`${HEADER}verts 0\n1\n2\ndelete_verts\n0 - 5\n`);
    expect([...b.refVerts]).toEqual([1, 1, 1, 2, 2, 2]);
    expect([...b.deleteVerts]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("accepts material lines and comments inside the vertex block", () => {
    const b = parseMhclo(`${HEADER}verts 0\nmaterial wool.mhmat\n# note\n4\n\n`);
    expect(b.material).toBe("wool.mhmat");
    expect([...b.refVerts]).toEqual([4, 4, 4]);
  });

  it("rejects malformed vertex lines and a missing obj_file", () => {
    expect(() => parseMhclo(`${HEADER}verts 0\n1 2\n`)).toThrow(/1 or 9 fields/);
    expect(() => parseMhclo("name x\n")).toThrow(/obj_file/);
  });
});
