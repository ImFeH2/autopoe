import type { ApiWritablePath } from "@/features/permissions/api/permission-api-types";
import { writablePathFromApi } from "@/features/permissions/api/permission-mappers";

export const removeWritablePathRequest = async (path: string) => {
  const response = await fetch("/api/permissions/writable-paths", {
    body: JSON.stringify({ path }),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  });

  if (!response.ok) {
    return null;
  }
  const result = (await response.json()) as {
    writable_paths?: ApiWritablePath[];
  };
  return (result.writable_paths ?? []).map(writablePathFromApi);
};

export const addWritablePathRequest = async (path: string) => {
  const response = await fetch("/api/permissions/writable-paths", {
    body: JSON.stringify({ path }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Directory could not be added.");
  }

  return writablePathFromApi((await response.json()) as ApiWritablePath);
};
