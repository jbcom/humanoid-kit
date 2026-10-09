import { activateSilentQa } from "game-harness/silent-qa";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Browser tests open the playground with ?muted and wait for the silent-QA
// marker before interacting. The playground makes no sound, so muting is a
// no-op; the marker still states that this session is a silent test run.
activateSilentQa(() => undefined);

const container = document.getElementById("root");
if (!container) {
  throw new Error("The playground shell is missing its #root element.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
