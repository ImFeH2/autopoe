import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/styles/index.css";

async function render() {
  if (import.meta.env.MODE === "e2e") {
    await import("@wdio/tauri-plugin");
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void render();
