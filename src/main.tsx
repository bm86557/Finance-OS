import { createRoot } from "react-dom/client";
import App from "./app/App";
import { initDataStore } from "./services/dataStore";
import { isHttpBackendConfigured } from "./lib/apiClient";
import "./styles/index.css";

async function bootstrap() {
  if (!isHttpBackendConfigured()) {
    await initDataStore();
  }
  createRoot(document.getElementById("root")!).render(
    <App />
  );
}

void bootstrap();
  