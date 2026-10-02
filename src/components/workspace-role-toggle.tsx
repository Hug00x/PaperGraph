"use client";

import type { AppLanguage } from "@/lib/portuguese-labels";
import { editableWorkspaceMemberRoles, formatWorkspaceRole, type EditableWorkspaceMemberRole } from "@/lib/workspace-presentation";

export function WorkspaceRoleToggle({
  className = "",
  disabled = false,
  language,
  onChange,
  size = "md",
  value,
}: {
  className?: string;
  disabled?: boolean;
  language: AppLanguage;
  onChange: (role: EditableWorkspaceMemberRole) => void;
  size?: "sm" | "md";
  value: EditableWorkspaceMemberRole;
}) {
  const selectedIndex = editableWorkspaceMemberRoles.indexOf(value);
  const buttonClassName =
    size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-5 py-2.5 text-sm";

  return (
    <div
      className={`relative grid grid-cols-2 rounded-full border border-[var(--border)] bg-black/20 p-1 ${className}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-[var(--accent)] shadow-[0_10px_24px_rgba(142,231,255,0.18)] transition-transform duration-200 ease-out ${
          selectedIndex === 1 ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {editableWorkspaceMemberRoles.map((role) => {
        const isSelectedRole = value === role;

        return (
          <button
            key={role}
            type="button"
            aria-pressed={isSelectedRole}
            disabled={disabled}
            onClick={() => {
              if (!isSelectedRole) {
                onChange(role);
              }
            }}
            className={`relative z-10 rounded-full font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${buttonClassName} ${
              isSelectedRole ? "text-[#041016]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {formatWorkspaceRole(role, language)}
          </button>
        );
      })}
    </div>
  );
}
