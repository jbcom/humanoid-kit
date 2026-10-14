import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/react/Humanoid.tsx"),
  "utf8",
);

function component(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  const next = source.indexOf("\nfunction ", start + 1);
  if (start < 0 || next < 0) throw new Error(`could not find ${name}`);
  return source.slice(start, next);
}

describe("eight-influence attachment wiring", () => {
  it("hands the figure's dual-bone palette to every separately skinned attachment and hair mesh", () => {
    for (const name of ["AttachmentMesh", "HairMesh", "DecalMesh"]) {
      const body = component(name);
      expect(body, name).toContain("dual,");
      expect(body, name).toContain("dual={dual}");
    }
  });

  it("patches every visible attachment, hair, and decal material shader with the full dual palette", () => {
    const attachmentMaterial = component("useAttachmentMaterial");
    expect(attachmentMaterial).toContain("dual: DualBones | null");
    expect(attachmentMaterial).toContain("applyDualSkinning(material, dual)");

    for (const name of ["HairMesh", "DecalMesh"]) {
      const body = component(name);
      expect(body, name).toContain("if (dual) applyDualSkinning(made, dual)");
    }
  });
});
