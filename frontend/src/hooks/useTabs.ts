import { useCallback, useEffect, useState } from "react";
import { fetchTabs } from "@/lib/api";
import {
  createTaskTabFromEvent,
  getTabEventId,
  mergeTaskTabUpdate,
} from "@/lib/tabEvents";
import type { AgentEvent, TaskTab } from "@/types";

export function useTabs() {
  const [tabs, setTabs] = useState<Map<string, TaskTab>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchTabs()
      .then((items) => {
        const next = new Map<string, TaskTab>();
        for (const tab of items) {
          next.set(tab.id, tab);
        }
        setTabs(next);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleUpdateEvent = useCallback((event: AgentEvent) => {
    if (event.type === "tab_created") {
      const tab = createTaskTabFromEvent(event.data);
      if (!tab) {
        return;
      }
      setTabs((prev) => {
        const next = new Map(prev);
        next.set(tab.id, tab);
        return next;
      });
      return;
    }

    if (event.type === "tab_updated") {
      const id = getTabEventId(event.data);
      if (id === null) {
        return;
      }
      setTabs((prev) => {
        const nextTab = mergeTaskTabUpdate(prev.get(id), event.data);
        if (!nextTab) {
          return prev;
        }
        const next = new Map(prev);
        next.set(nextTab.id, nextTab);
        return next;
      });
      return;
    }

    if (event.type !== "tab_deleted") {
      return;
    }

    const id = getTabEventId(event.data);
    if (id === null) {
      return;
    }
    setTabs((prev) => {
      if (!prev.has(id)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { tabs, loaded, handleUpdateEvent };
}
