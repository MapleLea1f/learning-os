export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  local_path: string | null;
  status: "active" | "archived";
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceTaskPriority = "high" | "medium" | "low";
export type WorkspaceTaskStatus = "todo" | "in_progress" | "completed" | "blocked";

export type WorkspaceTask = {
  id: string;
  workspace_id: string;
  user_id: string;
  parent_task_id: string | null;
  title: string;
  priority: WorkspaceTaskPriority;
  status: WorkspaceTaskStatus;
  due_date: string | null;
  notes: string;
  source: "manual" | "skill";
  created_at: string;
  updated_at: string;
};

export type WorkspaceResourceType = "link" | "chatgpt" | "deepseek" | "local_path" | "file_output";

export type WorkspaceExecutionStatus = "in_progress" | "completed" | "blocked" | "cancelled";

export type WorkspaceExecution = {
  id: string;
  workspace_id: string;
  user_id: string;
  task_id: string | null;
  title: string;
  status: WorkspaceExecutionStatus;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};
export type WorkspaceExecutionStepStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";

export type WorkspaceExecutionStep = {
  id: string;
  execution_id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  status: WorkspaceExecutionStepStatus;
  position: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceResource = {
  id: string;
  workspace_id: string;
  user_id: string;
  resource_type: WorkspaceResourceType;
  title: string;
  url: string | null;
  path: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};
