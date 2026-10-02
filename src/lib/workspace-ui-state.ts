const activeWorkspaceStorageKey = "papergraph-active-workspace-id";

const emptyWorkspacesStorageKeyPrefix = "papergraph-empty-workspaces";

const localWorkspaceUiStorageId = "local";

const workspaceUiStorageKeyPrefix = "papergraph-workspace-ui";

export const tabs = ["drafts", "editor", "graph", "settings"] as const;

export type WorkspaceTab = (typeof tabs)[number];

type WorkspaceUiState = {
  activeTab?: WorkspaceTab;
  graphSelectedArticleId?: string | null;
  selectedArticleId?: string;
};

export function getStoredActiveWorkspaceId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(activeWorkspaceStorageKey);
}

export function rememberActiveWorkspaceId(workspaceId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (workspaceId) {
    window.localStorage.setItem(activeWorkspaceStorageKey, workspaceId);
    return;
  }

  window.localStorage.removeItem(activeWorkspaceStorageKey);
}

function getEmptyWorkspacesStorageKey(userId: string) {
  return `${emptyWorkspacesStorageKeyPrefix}:${userId}`;
}

export function shouldKeepWorkspacesEmpty(userId: string) {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(getEmptyWorkspacesStorageKey(userId)) === "true";
}

export function rememberShouldKeepWorkspacesEmpty(userId: string, shouldKeepEmpty: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (shouldKeepEmpty) {
    window.localStorage.setItem(getEmptyWorkspacesStorageKey(userId), "true");
    return;
  }

  window.localStorage.removeItem(getEmptyWorkspacesStorageKey(userId));
}

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return tabs.some((tab) => tab === value);
}

function getWorkspaceUiStorageKey(workspaceId: string | null) {
  return `${workspaceUiStorageKeyPrefix}:${workspaceId ?? localWorkspaceUiStorageId}`;
}

export function getStoredWorkspaceUiState(workspaceId: string | null): WorkspaceUiState {
  if (typeof window === "undefined") {
    return {};
  }

  const rawState = window.localStorage.getItem(getWorkspaceUiStorageKey(workspaceId));

  if (!rawState) {
    return {};
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<WorkspaceUiState>;

    return {
      activeTab: isWorkspaceTab(parsedState.activeTab ?? null) ? parsedState.activeTab : undefined,
      graphSelectedArticleId:
        typeof parsedState.graphSelectedArticleId === "string"
          ? parsedState.graphSelectedArticleId
          : parsedState.graphSelectedArticleId === null
            ? null
            : undefined,
      selectedArticleId:
        typeof parsedState.selectedArticleId === "string" && parsedState.selectedArticleId
          ? parsedState.selectedArticleId
          : undefined,
    };
  } catch {
    return {};
  }
}

export function rememberWorkspaceUiState(workspaceId: string | null, updates: WorkspaceUiState) {
  if (typeof window === "undefined") {
    return;
  }

  const currentState = getStoredWorkspaceUiState(workspaceId);
  const nextState = { ...currentState, ...updates };

  window.localStorage.setItem(getWorkspaceUiStorageKey(workspaceId), JSON.stringify(nextState));
}

export function forgetWorkspaceUiState(workspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getWorkspaceUiStorageKey(workspaceId));
}
