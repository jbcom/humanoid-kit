# Lighthouse full-page capture diagnostic

## Purpose

This one-shot isolated-branch workflow isolates the reproducible Ubuntu
Lighthouse 12.6.1 `Page.captureScreenshot` protocol timeout. It is not a
performance gate and it does not change the package's normal Lighthouse
configuration, budgets, or application source.

GitHub only enables `workflow_dispatch` after a workflow is present on the
default branch, and this diagnostic must not be merged there. It triggers only
on `chore/lighthouse-capture-diagnostic` when the pushed commit message contains
`[run-lighthouse-capture-diagnostic]`. That explicit marker is the one approved
dispatch; ordinary pushes, pull requests, `main`, and existing CI stay out of
scope.

The protocol probe builds the real production playground, generates the normal
Lighthouse configuration, and rejects the run if full-page screenshots are
disabled. It takes one capture in each fresh browser process:

1. the production creator route;
2. the production `view=front` shot route;
3. the production creator after only its canvas is hidden at runtime.

Each probe uses the generated Lighthouse Chrome flags and mirrors the
`Page.getLayoutMetrics` / resized-viewport / WebP quality-30 capture commands
used by Lighthouse 12.6.1. It deliberately takes the gatherer's five-second
post-resize branch instead of reproducing Lighthouse's trace and network-idle
driver, so it is a bounded CDP protocol probe, not an lhci replacement. It has
one 45-second watchdog and never retries a case.

## Evidence recorded

`capture-diagnostic.json` is overwritten incrementally before and after each
bounded browser operation. It records Chrome's executable and version, exact
generated flags, document/content/viewport metrics, canvas CSS and backing
dimensions, and context attributes only when the application itself created the
WebGL context. It does not call `canvas.getContext()` while sampling, because
that could create a different context first. It also records creator and figure
lifecycle attributes, cold-start samples at 0, 2, 10, and 27.7 seconds after
navigation, and each exact stage/error, including cleanup.

Every successful `Page.captureScreenshot` also writes a binary
`capture-<case>.webp` beside the JSON receipt. The workflow uploads those files
without printing their base64 payload, so visual review can inspect exactly what
the protocol returned before drawing conclusions from an apparent success.

Before Chrome starts, the diagnostic's Node static server fetches the production
entry page and the emitted JavaScript entry asset. Both must return HTTP 200
with the expected content type; `HK_CAPTURE_DIAGNOSTIC_PREFLIGHT_ONLY=1` runs
that deterministic build/server check without launching a browser.

## First dispatch result

Commit `7b5190c6043c2fe55e9a124e1ba8937c6c88bd5f` dispatched run
`38229927385` once. Its receipt recorded Chrome 154 and the generated flags,
but each case stopped during navigation with `ERR_HTTP_RESPONSE_CODE_FAILURE`.
The original probe served its requested base path from `.lighthouse/site`,
although the generated configuration placed the bundle below
`.lighthouse/site/humanoid-kit/playground`. It therefore returned 404 before
any page sample or CDP screenshot command. This is navigation-failure evidence
for the diagnostic server only, not Lighthouse screenshot or renderer evidence.

The `FullPageScreenshot` gatherer begins at 27.7 seconds because the reproduced
CI receipt navigated at 08:03:24.180 and began that gatherer at 08:03:51.911.
The probe samples there, then follows its five-second post-resize branch before
issuing `Page.captureScreenshot`. It does not wait for model settlement, so a
warm-after-settle result cannot hide the original failure.

## Interpretation

- A bounded content height with a creator-only timeout narrows the issue to the
  creator renderer or compositor path.
- A bounded content height with both visible WebGL routes timing out but the
  hidden-canvas route completing implicates the WebGL compositor/readback path.
- A very large content height implicates viewport expansion before capture.
- A timeout after hiding the canvas leaves the current evidence insufficient to
  attribute the failure to WebGL; inspect the recorded dimensions and CSS
  compositor work before proposing a change.

Do not respond by disabling the screenshot, extending a timeout, or changing
Lighthouse budgets. A production visual proof belongs in the normal visual QA
path, not in a fabricated diagnostic artifact.
