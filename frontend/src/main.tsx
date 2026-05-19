import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import App from "@/App.tsx";
import { AgentationRoot } from "@/components/flowent/agentation-root";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AgentationRoot />
  </StrictMode>,
);
