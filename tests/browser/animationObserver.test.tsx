/**
 * The observer is deliberately driven through R3F's public manual clock. In
 * `frameloop="never"`, `advance` takes the clock's seconds, not DOM
 * `performance.now()` milliseconds. A plain frame/draw witness is kept beside
 * the animation witness so a stopped Canvas cannot look like a swallowed
 * consumer exception.
 */
import { Canvas, type RootState, useFrame, useThree } from "@react-three/fiber";
import { animationsPack } from "humanoid-kit-animations";
import { useEffect } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { type AnimationLibrary, loadAnimationLibrary } from "../../src/animation/library.ts";
import { createPresenceRegistry } from "../../src/presence/presence.ts";
import {
  Humanoid,
  type HumanoidAnimationFrame,
  HumanoidProvider,
  PresenceProvider,
} from "../../src/react/index.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

const LOAD = { timeout: 120_000 };
const STEP = 1 / 60;
const client = inlineWorkerClient();
let library: AnimationLibrary;
beforeAll(async () => {
  await client.ready;
  library = await loadAnimationLibrary(animationsPack);
}, LOAD.timeout);
afterAll(() => client.dispose());

interface Harness {
  get: (() => RootState) | null;
  advance: RootState["advance"] | null;
  frames: number;
  draws: number;
  store: RootState | null;
  delta: number;
  subscribers: number;
  active: boolean;
  size: [number, number];
}

function Probe({ state }: { state: Harness }) {
  const get = useThree((root) => root.get);
  const advance = useThree((root) => root.advance);
  useEffect(() => {
    state.get = get;
    state.advance = advance;
  }, [advance, get, state]);
  useFrame((root, delta) => {
    state.frames++;
    state.store = root;
    state.delta = delta;
    state.subscribers = (root.internal as unknown as { subscribers: unknown[] }).subscribers.length;
    state.active = root.internal.active;
    state.size = [root.size.width, root.size.height];
  });
  return null;
}

function emptyHarness(): Harness {
  return {
    get: null,
    advance: null,
    frames: 0,
    draws: 0,
    store: null,
    delta: Number.NaN,
    subscribers: 0,
    active: false,
    size: [0, 0],
  };
}

/** A monotonic R3F-clock driver: `advance` timestamps are seconds. */
function clockDriver(state: Harness): () => void {
  if (!state.get || !state.advance) throw new Error("animation observer has no Canvas store");
  let time = state.get().clock.elapsedTime;
  return () => {
    time += STEP;
    state.advance?.(time);
  };
}

describe("<Humanoid animation onFrame>", () => {
  it(
    "uses the Canvas clock, draws and exposes a consumer throw after root carry",
    async () => {
      const presence = createPresenceRegistry();
      const canvas = emptyHarness();
      const ref = { current: null as import("three").Group | null };
      const observed: { frame: HumanoidAnimationFrame; at: [number, number] }[] = [];
      const sentinel = new Error("observer sentinel");
      let throwNext = false;
      let started = false;
      let settled = false;
      await render(
        <HumanoidProvider client={client}>
          <div style={{ width: 160, height: 160 }}>
            <Canvas frameloop="never">
              <Probe state={canvas} />
              <PresenceProvider registry={presence}>
                <Humanoid
                  ref={ref}
                  recipe={createRecipe()}
                  presence={{ id: "walker" }}
                  onSettled={() => {
                    settled = true;
                  }}
                  animation={{
                    library,
                    clip: "walk_normal",
                    onStart: () => {
                      started = true;
                    },
                    onFrame: (frame) => {
                      observed.push({
                        frame,
                        at: [ref.current?.position.x ?? NaN, ref.current?.position.z ?? NaN],
                      });
                      if (throwNext) throw sentinel;
                    },
                  }}
                />
              </PresenceProvider>
              <mesh
                onAfterRender={() => {
                  canvas.draws++;
                }}
              >
                <boxGeometry />
                <meshBasicMaterial />
              </mesh>
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => canvas.get && canvas.advance, LOAD).toBeTruthy();
      await expect.poll(() => ref.current, LOAD).not.toBeNull();
      await expect.poll(() => settled && started, LOAD).toBe(true);
      const drive = clockDriver(canvas);
      drive();
      expect(canvas.frames, "manual advance reaches a same-store useFrame subscriber").toBe(1);
      expect(canvas.draws, "manual advance draws the Canvas").toBeGreaterThan(0);
      expect(canvas.store, "useFrame receives the Canvas store captured by Probe").toBe(
        canvas.get?.(),
      );
      expect(canvas.delta, "manual clock delta is in seconds").toBeCloseTo(STEP, 8);
      expect(canvas.subscribers).toBeGreaterThan(1);
      expect(canvas.active).toBe(true);
      expect(canvas.size).toEqual([160, 160]);
      expect(observed).toHaveLength(1);
      expect(presence.get("walker")).toBeDefined();
      const first = observed[0] as (typeof observed)[number];
      expect(first.at[0]).toBeCloseTo(first.frame.root[0], 6);
      expect(first.at[1]).toBeCloseTo(first.frame.root[1], 6);

      throwNext = true;
      expect(drive, "an observer exception is synchronous to the manual frame").toThrow(sentinel);
      const thrown = observed[1] as (typeof observed)[number];
      expect(thrown.at[0]).toBeCloseTo(thrown.frame.root[0], 6);
      expect(thrown.at[1]).toBeCloseTo(thrown.frame.root[1], 6);
    },
    LOAD.timeout,
  );

  it(
    "keeps the outer observer frame coherent when it reenters the public manual clock",
    async () => {
      const presence = createPresenceRegistry();
      const canvas = emptyHarness();
      const ref = { current: null as import("three").Group | null };
      const observed: HumanoidAnimationFrame[] = [];
      let drive: (() => void) | null = null;
      let started = false;
      let settled = false;
      await render(
        <HumanoidProvider client={client}>
          <div style={{ width: 160, height: 160 }}>
            <Canvas frameloop="never">
              <Probe state={canvas} />
              <PresenceProvider registry={presence}>
                <Humanoid
                  ref={ref}
                  recipe={createRecipe()}
                  presence={{ id: "walker" }}
                  onSettled={() => {
                    settled = true;
                  }}
                  animation={{
                    library,
                    clip: "walk_normal",
                    onStart: () => {
                      started = true;
                    },
                    onFrame: (frame) => {
                      observed.push(frame);
                      if (observed.length === 2) drive?.();
                    },
                  }}
                />
              </PresenceProvider>
              <mesh onAfterRender={() => canvas.draws++}>
                <boxGeometry />
                <meshBasicMaterial />
              </mesh>
            </Canvas>
          </div>
        </HumanoidProvider>,
      );
      await expect.poll(() => canvas.get && canvas.advance, LOAD).toBeTruthy();
      await expect.poll(() => ref.current, LOAD).not.toBeNull();
      await expect.poll(() => settled && started, LOAD).toBe(true);
      drive = clockDriver(canvas);
      drive();
      drive();
      expect(canvas.frames, "the Canvas frame witness ran for outer and nested advances").toBe(3);
      expect(canvas.draws).toBeGreaterThanOrEqual(3);
      expect(observed).toHaveLength(3);
      expect((observed[1] as HumanoidAnimationFrame).time).toBeLessThan(
        (observed[2] as HumanoidAnimationFrame).time,
      );
      expect(ref.current?.position.x).toBeCloseTo(
        (observed[2] as HumanoidAnimationFrame).root[0],
        6,
      );
      expect(ref.current?.position.z).toBeCloseTo(
        (observed[2] as HumanoidAnimationFrame).root[1],
        6,
      );
      expect(presence.get("walker")?.position[2]).toBeCloseTo(ref.current?.position.z ?? NaN, 6);
    },
    LOAD.timeout,
  );
});
