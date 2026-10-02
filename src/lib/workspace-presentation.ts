import type { User } from "@supabase/supabase-js";
import type { AppLanguage } from "./portuguese-labels.ts";
import type { WorkspaceInvite, WorkspaceMemberRole } from "./supabase-workspace.ts";

export const editableWorkspaceMemberRoles = ["editor", "viewer"] as const;

export type EditableWorkspaceMemberRole = (typeof editableWorkspaceMemberRoles)[number];

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function getAuthUserFallbackDisplayName(user: User | null) {
  if (!user) {
    return null;
  }

  const userMetadata = user.user_metadata as Record<string, unknown>;
  const metadataName =
    typeof userMetadata.display_name === "string"
      ? userMetadata.display_name
      : typeof userMetadata.full_name === "string"
        ? userMetadata.full_name
        : typeof userMetadata.name === "string"
          ? userMetadata.name
          : "";
  const normalizedMetadataName = normalizeDisplayName(metadataName);

  if (normalizedMetadataName) {
    return normalizedMetadataName;
  }

  return user.email?.split("@")[0] ?? null;
}

export function normalizeWorkspaceName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function getStoredNameFromWorkspaceAssetPath(storagePath: string) {
  return storagePath.split("/").filter(Boolean).at(-1) ?? storagePath;
}

export function formatWorkspaceDate(value: string | null, language: AppLanguage) {
  if (!value) {
    return language === "en" ? "No date yet" : "Sem data";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return language === "en" ? "No date yet" : "Sem data";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatWorkspaceRole(role: string, language: AppLanguage) {
  if (role === "owner") {
    return language === "en" ? "Owner" : "Dono";
  }

  if (role === "editor" || role === "member") {
    return language === "en" ? "Editor" : "Editor";
  }

  if (role === "viewer") {
    return language === "en" ? "Viewer" : "Visualizador";
  }

  return language === "en" ? "Member" : "Membro";
}

export function getEditableWorkspaceMemberRole(role: WorkspaceMemberRole): EditableWorkspaceMemberRole {
  return role === "viewer" ? "viewer" : "editor";
}

export function formatInviteStatus(status: WorkspaceInvite["status"], language: AppLanguage) {
  if (status === "accepted") {
    return language === "en" ? "Accepted" : "Aceite";
  }

  if (status === "revoked") {
    return language === "en" ? "Revoked" : "Revogado";
  }

  return language === "en" ? "Pending" : "Pendente";
}

export function getDisplayInitials(value: string | null | undefined) {
  const normalizedValue = normalizeDisplayName(value ?? "");

  if (!normalizedValue) {
    return "PG";
  }

  const initials = normalizedValue
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase();
}
