import { useEffect } from "react";

export function ErudaRoot() {
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    let isMounted = true;

    void import("eruda").then(({ default: eruda }) => {
      if (!isMounted) {
        return;
      }

      eruda.init();
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return null;
}
