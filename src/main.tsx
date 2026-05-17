import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { initGlobalErrorLogging } from "./services/errorLogService";
import { ThemeProvider } from "./contexts/ThemeContext";

// Defer non-critical error-capture wiring off the critical path.
// (Errors thrown before this runs are still surfaced by the browser.)
const deferIdle =
  (typeof window !== "undefined" && (window as any).requestIdleCallback) ||
  ((cb: () => void) => setTimeout(cb, 1));
deferIdle(() => {
  try {
    initGlobalErrorLogging();
  } catch (e) {
    console.warn("error logging init failed", e);
  }
});

// Recover from stale code-split chunks after a redeploy. Vite emits
// 'vite:preloadError' when a hashed chunk no longer exists.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", () => {
    if (sessionStorage.getItem("__vite_preload_reloaded") === "1") return;
    sessionStorage.setItem("__vite_preload_reloaded", "1");
    window.location.reload();
  });
}

// NOTE: React.StrictMode intentionally NOT used.
// react-helmet-async crashes under StrictMode's double-invocation
// ("Cannot read properties of undefined (reading 'add')" in HelmetDispatcher.init)
// and StrictMode also doubles effect work in dev. Re-enable only after
// migrating off react-helmet-async.
createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </HelmetProvider>
);
