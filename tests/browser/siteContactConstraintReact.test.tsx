import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useSiteContactConstraint } from "../../src/react/index.ts";

describe("React site-contact constraint", () => {
  it("survives StrictMode's effect replay and disposes after a real unmount", async () => {
    const observed: ReturnType<typeof useSiteContactConstraint>[] = [];
    function Probe() {
      const constraint = useSiteContactConstraint();
      if (observed.length === 0) observed.push(constraint);
      expect(constraint).toBe(observed[0]);
      return null;
    }
    const screen = await render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await screen.rerender(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const constraint = observed[0];
    if (!constraint) throw new Error("site-contact hook did not create a controller");
    // React development StrictMode runs effect cleanup and setup once while still mounted.
    expect(() => constraint.invalidate()).not.toThrow();
    await screen.unmount();
    await Promise.resolve();
    expect(() =>
      constraint.release(
        { generation: {}, rotations: new Float32Array([0, 0, 0, 1]) },
        new Float32Array(4),
      ),
    ).toThrow(/disposed/);
  });
});
