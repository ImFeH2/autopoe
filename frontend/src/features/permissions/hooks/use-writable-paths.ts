import { useCallback, useState } from "react";

import {
  addWritablePathRequest,
  removeWritablePathRequest,
} from "@/features/permissions/api/permission-requests";
import type { WritablePath } from "@/features/permissions/model/permission-types";

export const useWritablePaths = () => {
  const [writablePaths, setWritablePaths] = useState<WritablePath[]>([]);

  const replaceWritablePaths = useCallback(
    (nextWritablePaths: WritablePath[]) => {
      setWritablePaths(nextWritablePaths);
    },
    [],
  );

  const removeWritablePath = useCallback(async (path: string) => {
    const nextWritablePaths = await removeWritablePathRequest(path);

    if (nextWritablePaths) {
      setWritablePaths(nextWritablePaths);
    }
  }, []);

  const addWritablePath = useCallback(async (path: string) => {
    const savedWritablePath = await addWritablePathRequest(path);
    setWritablePaths((currentWritablePaths) => {
      if (
        currentWritablePaths.some(
          (writablePath) => writablePath.path === savedWritablePath.path,
        )
      ) {
        return currentWritablePaths;
      }
      return [...currentWritablePaths, savedWritablePath];
    });
  }, []);

  return {
    addWritablePath,
    removeWritablePath,
    replaceWritablePaths,
    writablePaths,
  };
};
