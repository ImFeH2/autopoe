import React from "react";
import ReactDOM from "react-dom/client";
import "@radix-ui/themes/styles.css";
import App from "@/App";
import "@/styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
