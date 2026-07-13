import type { ApiWritablePath } from "@/features/permissions/api/permission-api-types";
import type { WritablePath } from "@/features/permissions/model/permission-types";

export const writablePathFromApi = (
  writablePath: ApiWritablePath,
): WritablePath => ({
  createdAt: writablePath.created_at,
  path: writablePath.path,
});
