import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { createAuthClient } from "./auth/auth-client.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import { loadDashboardConfig } from "./config.js";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#root");
if (!root) {
  throw new Error("Dashboard root element is missing");
}

const config = loadDashboardConfig();
const authClient = createAuthClient(config);

createRoot(root).render(
  <StrictMode>
    <AuthProvider client={authClient}>
      <App apiBaseUrl={config.apiBaseUrl} />
    </AuthProvider>
  </StrictMode>,
);
