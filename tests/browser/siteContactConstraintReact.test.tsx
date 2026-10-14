import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useSiteContactConstraint } from "../../src/react/index.ts";

describe("React site-contact constraint", () => {
  it("keeps one controller for a mount and disposes it on unmount", async () => {
    const observed: ReturnType<typeof useSiteContactConstraint>[] = [];
    function Probe() {
      const constraint = useSiteContactConstraint();
      if (observed.length === 0) observed.push(constraint);
      expect(constraint).toBe(observed[0]);
      return null;
    }
    const screen = await render(<Probe />);
    await screen.rerender(<Probe />);
    const constraint = observed[0];
    if (!constraint) throw new Error("site-contact hook did not create a controller");
    await screen.unmount();
    expect(() =>
      constraint.release(
        { generation: {}, rotations: new Float32Array([0, 0, 0, 1]) },
        new Float32Array(4),
      ),
    ).toThrow(/disposed/);
  });
});
