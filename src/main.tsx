import { createRoot } from "react-dom/client";
import App from "./app/App";
import { initDataStore } from "./services/dataStore";
import { isHttpBackendConfigured } from "./lib/apiClient";
import "./styles/index.css";

// Automatically recover once if a stale browser tab tries to load an old hashed JS chunk after a Vercel redeploy
const CHUNK_RELOAD_KEY = "finance_os_chunk_reload_at";
function recoverFromStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
    if (Date.now() - last > 15_000) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }
  } catch {
    window.location.reload();
  }
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  recoverFromStaleChunk();
});

window.addEventListener("unhandledrejection", (event) => {
  const msg = String(event.reason?.message || event.reason || "");
  if (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Loading chunk")
  ) {
    event.preventDefault();
    recoverFromStaleChunk();
  }
});

async function bootstrap() {
  if (!isHttpBackendConfigured()) {
    await initDataStore();
  }
  createRoot(document.getElementById("root")!).render(
    <App />
  );
}

void bootstrap();
