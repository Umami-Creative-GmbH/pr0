import { ApiProvider } from "@pr0/api-client/provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing application root element");
}

createRoot(root).render(
  <StrictMode>
    <ApiProvider
      baseUrl={import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"}
    >
      <App />
    </ApiProvider>
  </StrictMode>
);
