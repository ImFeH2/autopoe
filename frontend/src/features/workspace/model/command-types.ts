export type WorkspaceCommandId = "clear" | "compact";

export type WorkspaceCommand = {
  description: string;
  id: WorkspaceCommandId;
  label: string;
  name: string;
};
