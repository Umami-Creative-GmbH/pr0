import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { NativePresentation } from "./native-presentation";

import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing application root element");
}
createRoot(root).render(
  <StrictMode>
    <NativePresentation>
      <App />
    </NativePresentation>
  </StrictMode>
);
