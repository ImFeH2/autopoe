import { useEffect, useState } from "react";

import { send, subscribe } from "@/lib/agent";
import { type AppInfo, appInfoRequest, readAppInfoReply } from "@/lib/app-info";

type AppState =
  | { status: "connecting" }
  | { status: "ready"; info: AppInfo }
  | { status: "error" };

let nextRequestId = 1;

export function AppStatus({ state }: { state: AppState }) {
  const text =
    state.status === "ready"
      ? `${state.info.name} v${state.info.version}`
      : state.status === "connecting"
        ? "Connecting"
        : "Unavailable";

  return (
    <h1 className="app__title" aria-live="polite">
      {text}
    </h1>
  );
}

function App() {
  const [state, setState] = useState<AppState>({ status: "connecting" });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const requestId = `app-info-${nextRequestId++}`;

    const connect = async () => {
      const stop = await subscribe((message) => {
        if (!active) {
          return;
        }
        const reply = readAppInfoReply(message, requestId);
        if (reply) {
          setState(reply);
        }
      });
      if (!active) {
        stop();
        return;
      }
      unsubscribe = stop;
      await send(appInfoRequest(requestId));
    };

    connect().catch(() => {
      if (active) {
        setState({ status: "error" });
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <main className="app">
      <AppStatus state={state} />
    </main>
  );
}

export default App;
