import { useEffect, useState } from "react";

import { type AppInfo, getAppInfo } from "@/lib/app-info";

type AppState =
  | { status: "loading" }
  | { status: "ready"; info: AppInfo }
  | { status: "error" };

export function Identity({ info }: { info: AppInfo }) {
  return (
    <section className="identity" aria-label={`${info.name} ${info.version}`}>
      <div className="identity__halo" />
      <div className="identity__content">
        <h1>{info.name}</h1>
        <span className="identity__version">v{info.version}</span>
      </div>
    </section>
  );
}

function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    getAppInfo().then(
      (info) => {
        if (active) {
          setState({ status: "ready", info });
        }
      },
      () => {
        if (active) {
          setState({ status: "error" });
        }
      },
    );

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app">
      {state.status === "ready" ? (
        <Identity info={state.info} />
      ) : (
        <p
          className={`app__status app__status--${state.status}`}
          aria-live="polite"
        >
          {state.status === "loading" ? "Connecting" : "Unavailable"}
        </p>
      )}
    </main>
  );
}

export default App;
