"use client";

import Image from "next/image";
import paperGraphLogoText from "@/imagens/PapergraghTexto.png";
import type { AppLanguage } from "@/lib/portuguese-labels";
import { HelpButton } from "./help-button";

type Props = {
  language: AppLanguage;
  workspaceName: string | null;
  onlinePresenceCount: number;
  onHelp: () => void;
  onWorkspaces: () => void;
};

export function WorkspaceHeader({ language, workspaceName, onlinePresenceCount, onHelp, onWorkspaces }: Props) {
  const isEnglish = language === "en";
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--border)] px-6 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
      <div className="relative h-[4.4rem] w-[17rem] overflow-hidden" aria-label="PaperGraph">
        <Image src={paperGraphLogoText} alt="PaperGraph" priority className="absolute left-[-5.95rem] top-[-6.28rem] h-auto w-[28rem] max-w-none" />
      </div>
      <div className="flex items-center gap-3">
        <HelpButton isEnglish={isEnglish} onClick={onHelp} />
        <button type="button" onClick={onWorkspaces} className="w-full rounded-[18px] border border-[var(--border)] bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10 sm:w-auto sm:min-w-[16rem]">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">{isEnglish ? "Active workspace" : "Workspace ativa"}</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{workspaceName ?? (isEnglish ? "Local workspace" : "Workspace local")}</p>
          {workspaceName !== null && (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {onlinePresenceCount <= 1
                ? isEnglish ? "Only you online" : "Só tu online"
                : isEnglish ? `${onlinePresenceCount} online now` : `${onlinePresenceCount} online agora`}
            </p>
          )}
        </button>
      </div>
    </header>
  );
}
