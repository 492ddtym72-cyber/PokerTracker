import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./profile.css";

async function reloadWhenNewBuildIsAvailable() {
  if (document.visibilityState !== "visible") return;

  try {
    const response = await fetch(`/?update-check=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) return;

    const html = await response.text();
    const freshDocument = new DOMParser().parseFromString(html, "text/html");
    const freshScript = freshDocument.querySelector<HTMLScriptElement>(
      'script[type="module"][src]',
    );
    const currentScript = document.querySelector<HTMLScriptElement>(
      'script[type="module"][src]',
    );

    if (!freshScript?.src || !currentScript?.src) return;

    const freshPath = new URL(freshScript.src, window.location.origin).pathname;
    const currentPath = new URL(currentScript.src, window.location.origin).pathname;

    if (freshPath !== currentPath) {
      window.location.reload();
    }
  } catch {
    // Staying on the current build is preferable to interrupting the app
    // when the update check cannot reach the network.
  }
}

document.addEventListener("visibilitychange", reloadWhenNewBuildIsAvailable);
window.addEventListener("pageshow", reloadWhenNewBuildIsAvailable);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
