import "@fontsource-variable/inter/wght.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { ComponentLab } from "@/component-lab/component-lab";
import "@/styles/index.css";
import "@/component-lab/component-lab.css";
import { TooltipProvider } from "@/components/ui";

ReactDOM.createRoot(
  document.getElementById("component-lab-root") as HTMLElement,
).render(
  <React.StrictMode>
    <TooltipProvider>
      <ComponentLab />
    </TooltipProvider>
  </React.StrictMode>,
);
