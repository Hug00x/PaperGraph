import { createBrowserUuid } from "./browser-uuid.ts";
import type { AppLanguage } from "./portuguese-labels.ts";
import type { WorkspaceTab } from "./workspace-ui-state.ts";

export type WorkspacePresenceMode = "editing" | "viewing" | "browsing" | "settings";

export type WorkspacePresence = {
  articleId: string | null;
  articleTitle: string | null;
  clientId: string;
  enteredAt: string;
  email: string | null;
  mode: WorkspacePresenceMode;
  selectionEnd?: number | null;
  selectionStart?: number | null;
  tab: WorkspaceTab;
  updatedAt: string;
  userId: string;
  userName: string;
};

function isWorkspacePresence(value: unknown): value is WorkspacePresence {
  if (!value || typeof value !== "object") {
    return false;
  }

  const presence = value as Partial<WorkspacePresence>;

  return (
    typeof presence.clientId === "string" &&
    typeof presence.userId === "string" &&
    typeof presence.userName === "string" &&
    typeof presence.tab === "string" &&
    typeof presence.mode === "string"
  );
}

export function flattenPresenceState(presenceState: Record<string, unknown>, currentClientId: string) {
  const presenceByClientId = new Map<string, WorkspacePresence>();

  Object.values(presenceState).forEach((presenceItems) => {
    if (!Array.isArray(presenceItems)) {
      return;
    }

    presenceItems.forEach((presenceItem) => {
      if (!isWorkspacePresence(presenceItem) || presenceItem.clientId === currentClientId) {
        return;
      }

      presenceByClientId.set(presenceItem.clientId, presenceItem);
    });
  });

  return [...presenceByClientId.values()].sort((firstPresence, secondPresence) =>
    firstPresence.userName.localeCompare(secondPresence.userName),
  );
}

export function getPresenceModeLabel(mode: WorkspacePresenceMode, language: AppLanguage) {
  switch (mode) {
    case "editing":
      return language === "en" ? "Editing" : "A editar";
    case "viewing":
      return language === "en" ? "Viewing" : "A visualizar";
    case "settings":
      return language === "en" ? "Settings" : "Definições";
    case "browsing":
      return language === "en" ? "Browsing" : "A navegar";
  }
}

export function createPresenceClientId() {
  return createBrowserUuid();
}
