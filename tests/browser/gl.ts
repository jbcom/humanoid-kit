/**
 * The browser suite's one way to get a `WebGLRenderer`.
 *
 * A renderer that is only `dispose()`d keeps its WebGL context until the page is
 * collected, and Chrome keeps about sixteen live ones: in a whole-suite run the
 * later files' contexts were lost (`THREE.WebGLRenderer: Context Lost.`), and what
 * they then read back was NaN, which a comparison such as `x > limit` passes. So a
 * renderer from here is torn down at the end of its file with `dispose()` and then
 * `forceContextLoss()`, and a context that is lost while a test runs fails that
 * test, saying so: the next draw or read throws, and the test is failed afterwards
 * whatever it did with the result. A file keeps no renderer of its own.
 */
import { WebGLRenderer, type WebGLRendererParameters } from "three";
import { afterAll, afterEach, expect } from "vitest";

interface Tracked {
  /** The listener on the canvas, removed when the renderer is released. */
  onLost: () => void;
  /** The tests during which the context was lost (by their names). */
  lostDuring: string[];
  released: boolean;
}

const tracked = new Map<WebGLRenderer, Tracked>();

function assertUsable(renderer: WebGLRenderer, what: string): void {
  const state = tracked.get(renderer);
  if (state?.released)
    throw new Error(`${what}: the renderer was released (its context is lost on purpose)`);
  if (renderer.getContext().isContextLost())
    throw new Error(`${what}: the WebGL context is lost, so what it reads is not a measurement`);
}

/**
 * A renderer whose context is lost and disposed when its file ends, and which fails
 * the running test if the context is lost under it. `options.canvas` defaults to a
 * new canvas.
 */
export function createTestRenderer(options: WebGLRendererParameters = {}): WebGLRenderer {
  const canvas = options.canvas ?? document.createElement("canvas");
  const renderer = new WebGLRenderer({ ...options, canvas });
  const state: Tracked = {
    lostDuring: [],
    released: false,
    onLost: () => {
      state.lostDuring.push(expect.getState().currentTestName ?? "(outside a test)");
    },
  };
  (canvas as HTMLCanvasElement).addEventListener("webglcontextlost", state.onLost);
  tracked.set(renderer, state);
  // The two calls a test reads a measurement through.
  const render = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    assertUsable(renderer, "render");
    render(...args);
  };
  const read = renderer.readRenderTargetPixels.bind(renderer);
  renderer.readRenderTargetPixels = (...args) => {
    assertUsable(renderer, "readRenderTargetPixels");
    read(...args);
  };
  return renderer;
}

/**
 * Frees a renderer's context now rather than at the end of the file: for one made inside
 * a test, or when a file has more than it needs live at once. Safe to call twice.
 */
export function releaseTestRenderer(renderer: WebGLRenderer): void {
  const state = tracked.get(renderer);
  if (!state || state.released) return;
  state.released = true;
  (renderer.domElement as HTMLCanvasElement).removeEventListener("webglcontextlost", state.onLost);
  renderer.dispose();
  renderer.forceContextLoss();
}

// A loss in one test is reported against it, not against whichever test reads next.
afterEach(() => {
  const lost: string[] = [];
  for (const state of tracked.values()) {
    lost.push(...state.lostDuring);
    state.lostDuring.length = 0;
  }
  if (lost.length > 0)
    throw new Error(`the WebGL context was lost during this test (${lost.join("; ")})`);
});

// Registered when a file imports this module, before the file's own hooks, so it runs
// after them (hooks run last-in-first-out): the file frees its materials and targets
// first, then the contexts go.
afterAll(() => {
  for (const renderer of [...tracked.keys()]) releaseTestRenderer(renderer);
  tracked.clear();
});
