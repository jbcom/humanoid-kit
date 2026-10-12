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

The current probe builds the real production playground, generates the normal
Lighthouse configuration, and rejects the run if full-page screenshots are
disabled. It launches the same headless Chrome flags that LHCI passes to the
installed Lighthouse CLI and runs one navigation at the generated production
URL. It does not retry.

The diagnostic copies Lighthouse 12.6.1's installed desktop default config,
replaces only the `FullPageScreenshot` artifact implementation, and retains
the artifact ID. Its subclass inherits `getArtifact` and `_resizeViewport`, so
the installed resize, network-idle, double-rAF, default protocol timeout and
parallel `Promise.all([_takeScreenshot(), _resolveNodes()])` lifecycle remain
unchanged. It adds `finally` timing receipts only around the two capture
protocol commands and the page/isolated-context node reads.

## Evidence recorded

`capture-diagnostic.json` is overwritten after every timed stage settles,
including if its concurrent counterpart rejects. It records generated Chrome
flags and settings, the actual artifact ID, static-server preflight and the
timings/outcomes for `Page.getLayoutMetrics`, `Page.captureScreenshot`, page
context node resolution and isolated-context node resolution. A successful
Lighthouse run also writes its real `capture-full-page.webp` from the returned
artifact and records decoded byte size; base64 is never printed.

The receipt records its diagnostic source commit and the failed product head
`c57d29cbbf89160e627d258bf93af1a6904252f0`; the script refuses to run unless
that product commit is in its ancestry. It also records the installed and
diagnostic gatherer prototype method lists and which methods are inherited.
`LH_FPS_TEST` is rejected so this run must retain production WebP quality 30.

Before Chrome starts, the diagnostic uses LHCI's own fallback static server to
fetch the production entry page and emitted JavaScript asset. Both must return
HTTP 200 with the expected content type. This preflight prevents a server-path
failure from being misreported as capture evidence.

## First dispatch result

Commit `7b5190c6043c2fe55e9a124e1ba8937c6c88bd5f` dispatched run
`38229927385` once. Its receipt recorded Chrome 154 and the generated flags,
but each case stopped during navigation with `ERR_HTTP_RESPONSE_CODE_FAILURE`.
The original probe served its requested base path from `.lighthouse/site`,
although the generated configuration placed the bundle below
`.lighthouse/site/humanoid-kit/playground`. It therefore returned 404 before
any page sample or CDP screenshot command. This is navigation-failure evidence
for the diagnostic server only, not Lighthouse screenshot or renderer evidence.

## Second dispatch authorization

The root review accepted the forward static-root fix in
`6e067418395dcae7722147a7da217459d1df948e` and the local production HTTP
preflight that proved the entry page and emitted script return 200 with their
expected content types. The separate forward change
`244993d45ea04ad298b65b333fe587af5ca1b09d` stops an individual case after a
failed sampled operation, after its receipt has been persisted and before the
next 45-second sample wait; bounded cleanup still runs. This commit authorizes
one changed-code diagnostic push. It is not a rerun of the navigation-failure
revision and it does not change product source, Lighthouse budgets, or screenshot
requirements.

## Installed-gatherer dispatch authorization

The bounded installed-gatherer diagnostic is based on product head
`c57d29cbbf89160e627d258bf93af1a6904252f0`, brought into this isolated branch
through merge commit `602daa12a82050441b3138b2fc753fa192d4e0d8`. The next
explicit marker commit authorizes exactly one run of this changed diagnostic.
It is neither a retry of a previous result nor a change to normal Lighthouse
CI, screenshot requirements, budgets or application behavior.

## Setup-failure correction authorization

Run `38238222246` at `ea3f3f8` failed before the production build, Chrome or
Lighthouse began: checkout's default depth of one omitted `c57d29c`, so the
provenance guard correctly rejected its unavailable commit. It produced no
capture attempt or evidence. Commit `70da58e` sets the diagnostic checkout to
the documented `fetch-depth: 0`; its local depth-one simulation reproduced the
missing-object rejection, while full history passes the same guard. The next
explicit marker commit authorizes exactly one changed-setup diagnostic run.

The direct CDP probe was useful renderer evidence but cannot distinguish a
capture command that blocks from Lighthouse's concurrent node-resolution work.
The installed-gatherer diagnostic is the bounded next step: its receipt makes
that distinction without disabling screenshots, extending a timeout, changing
budgets or fabricating a substitute image.

## Interpretation

- A failing `capture-webp` with timely node reads attributes the observed timeout
  to the capture/compositor path under the unchanged Lighthouse lifecycle.
- A failing page or isolated node stage with a successful capture attributes the
  failure to execution-context work, not screenshot generation.
- Timely stages in a completed run provide a real artifact for visual review,
  but do not by themselves accept anatomy or rendering quality.

Do not respond by disabling the screenshot, extending a timeout, or changing
Lighthouse budgets. A production visual proof belongs in the normal visual QA
path, not in a fabricated diagnostic artifact.
