import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./profile.css";

// Vite hashes JavaScript and stylesheet assets independently. Compare both:
// a CSS-only deployment may keep the exact same JavaScript filename.
function buildAssetPaths(page: Document): string[] | null {
  const entryScript = page.querySelector<HTMLScriptElement>(
    'script[type="module"][src]',
  );
  if (!entryScript?.src) return null;

  const scriptPath = new URL(entryScript.src, window.location.origin).pathname;
  const stylesheets = Array.from(
    page.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
    (link) => new URL(link.href, window.location.origin).pathname,
  ).filter((path) => path.startsWith("/assets/"));

  return [scriptPath, ...stylesheets.sort()];
}

let updateCheckInFlight = false;

async function reloadWhenNewBuildIsAvailable() {
  if (document.visibilityState !== "visible" || updateCheckInFlight) return;
  updateCheckInFlight = true;

  try {
    const response = await fetch(`/?update-check=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) return;

    const html = await response.text();
    const freshDocument = new DOMParser().parseFromString(html, "text/html");
    const freshAssets = buildAssetPaths(freshDocument);
    const currentAssets = buildAssetPaths(document);

    // The login page or an incomplete response is not an application update.
    if (!freshAssets || !currentAssets) return;

    if (JSON.stringify(freshAssets) !== JSON.stringify(currentAssets)) {
      window.location.reload();
    }
  } catch {
    // Keep the current app running if an update check fails.
  } finally {
    updateCheckInFlight = false;
  }
}

// iOS home-screen web apps can remain open for long periods without a pageshow
// event. Check on resume, focus, connectivity restoration, and while in use.
document.addEventListener("visibilitychange", reloadWhenNewBuildIsAvailable);
window.addEventListener("pageshow", reloadWhenNewBuildIsAvailable);
window.addEventListener("focus", reloadWhenNewBuildIsAvailable);
window.addEventListener("online", reloadWhenNewBuildIsAvailable);
window.setInterval(reloadWhenNewBuildIsAvailable, 60_000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
