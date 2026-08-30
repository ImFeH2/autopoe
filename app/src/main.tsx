import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/styles/index.css";

function installDesktopInteractionGuards() {
  document.addEventListener("dragstart", (event) => event.preventDefault());
  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    const isEditable =
      target instanceof Element &&
      target.closest('input, textarea, [contenteditable="true"]') !== null;
    if (!isEditable) {
      event.preventDefault();
    }
  });
}

async function render() {
  if (import.meta.env.MODE === "debug") {
    await import("@wdio/tauri-plugin");
  }

  installDesktopInteractionGuards();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void render();
