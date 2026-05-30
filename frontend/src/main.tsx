import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import App from "@/App.tsx";
import { AgentationRoot } from "@/components/flowent/agentation-root";
import { ErudaRoot } from "@/components/flowent/eruda-root";
import { initializeViewportHeight } from "@/lib/viewport-height";

initializeViewportHeight();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AgentationRoot />
    <ErudaRoot />
  </StrictMode>,
);
