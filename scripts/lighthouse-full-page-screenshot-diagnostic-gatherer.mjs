/**
 * Times the installed Lighthouse FullPageScreenshot artifact without changing
 * its resize or concurrent capture/node-resolution behavior.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const lhciRequire = createRequire(require.resolve("@lhci/cli/package.json"));
const lighthouseEntry = lhciRequire.resolve("lighthouse");
const lighthouseCore = path.dirname(lighthouseEntry);
const gathererUrl = pathToFileURL(
  path.join(lighthouseCore, "gather", "gatherers", "full-page-screenshot.js"),
).href;
const pageFunctionsUrl = pathToFileURL(path.join(lighthouseCore, "lib", "page-functions.js")).href;
const [{ default: FullPageScreenshot }, { pageFunctions }] = await Promise.all([
  import(gathererUrl),
  import(pageFunctionsUrl),
]);

const format = process.env.LH_FPS_TEST ? "png" : "webp";
const quality = process.env.LH_FPS_TEST ? 100 : 30;
let receiptSink = () => {};

/**
 * @param {(stage: { name: string; startedAt: string; elapsedMs: number; outcome: "ok" | "error"; error?: string }) => void} sink
 */
export function setFullPageScreenshotDiagnosticSink(sink) {
  receiptSink = sink;
}

/** Records precisely which installed methods remain unmodified by this probe. */
export function fullPageScreenshotPrototypeReceipt() {
  const methodNames = (prototype) =>
    Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== "constructor")
      .sort();
  const installed = methodNames(FullPageScreenshot.prototype);
  const diagnostic = methodNames(DiagnosticFullPageScreenshot.prototype);
  const inherited = installed.filter(
    (name) => DiagnosticFullPageScreenshot.prototype[name] === FullPageScreenshot.prototype[name],
  );
  return {
    diagnostic,
    inherited,
    installed,
    overrides: installed.filter((name) => !inherited.includes(name)),
  };
}

/**
 * @param {unknown} error
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

class DiagnosticFullPageScreenshot extends FullPageScreenshot {
  /**
   * `finally` makes every command's timing durable even when the parallel
   * counterpart rejects and Lighthouse aborts this artifact.
   * @template T
   * @param {string} name
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  async _measure(name, operation) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let outcome = "ok";
    let error;
    try {
      return await operation();
    } catch (caught) {
      outcome = "error";
      error = errorMessage(caught);
      throw caught;
    } finally {
      receiptSink({
        elapsedMs: performance.now() - started,
        error,
        name,
        outcome,
        startedAt,
      });
    }
  }

  /**
   * This is the installed 12.6.1 method with only per-command timing wrappers.
   * The same two protocol commands still begin in one Promise.all call.
   * @param {LH.Gatherer.Context} context
   */
  async _takeScreenshot(context) {
    const [metrics, result] = await Promise.all([
      this._measure("capture-layout-metrics", () =>
        context.driver.defaultSession.sendCommand("Page.getLayoutMetrics"),
      ),
      this._measure("capture-webp", () =>
        context.driver.defaultSession.sendCommand("Page.captureScreenshot", { format, quality }),
      ),
    ]);
    const data = `data:image/${format};base64,${result.data}`;

    return {
      data,
      height: metrics.cssVisualViewport.clientHeight,
      width: metrics.cssVisualViewport.clientWidth,
    };
  }

  /**
   * This is the installed 12.6.1 method with only timing wrappers around the
   * page and isolated execution-context node reads.
   * @param {LH.Gatherer.Context} context
   */
  async _resolveNodes(context) {
    function resolveNodes() {
      const nodes = {};
      if (!window.__lighthouseNodesDontTouchOrAllVarianceGoesAway) return nodes;

      const lhIdToElements = window.__lighthouseNodesDontTouchOrAllVarianceGoesAway;
      for (const [node, id] of lhIdToElements.entries()) {
        const rect = getBoundingClientRect(node);
        nodes[id] = { id: node.id, ...rect };
      }

      return nodes;
    }

    /** @param {{ useIsolation: boolean }} options */
    function resolveNodesInPage({ useIsolation }) {
      return context.driver.executionContext.evaluate(resolveNodes, {
        args: [],
        deps: [pageFunctions.getBoundingClientRect],
        useIsolation,
      });
    }

    const pageContextResult = await this._measure("nodes-page-context", () =>
      resolveNodesInPage({ useIsolation: false }),
    );
    const isolatedContextResult = await this._measure("nodes-isolated-context", () =>
      resolveNodesInPage({ useIsolation: true }),
    );
    return { ...pageContextResult, ...isolatedContextResult };
  }
}

export default DiagnosticFullPageScreenshot;
