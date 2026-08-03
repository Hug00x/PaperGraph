"use client";

import { useMemo, useState } from "react";
import { getArticleStatusLabel, type AppLanguage } from "@/lib/portuguese-labels";
import type { WorkspaceArticleVersion } from "@/lib/workspace-data";

type ArticleHistoryPanelProps = {
  articleTitle: string;
  canRestore?: boolean;
  language: AppLanguage;
  onRestoreVersion?: (versionId: string) => void | Promise<void>;
  versions: WorkspaceArticleVersion[];
};

type SourceDiffPart = {
  kind: "added" | "removed" | "same";
  value: string;
};

function formatVersionDate(value: string, language: AppLanguage) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return language === "en" ? "No date" : "Sem data";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function tokenizeSource(source: string) {
  return source.match(/\r\n|\n|\r|[^\S\r\n]+|[^\s]+/g) ?? [];
}

function splitSourceLines(source: string) {
  return source.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function appendDiffPart(parts: SourceDiffPart[], kind: SourceDiffPart["kind"], value: string) {
  if (!value) {
    return;
  }

  const previousPart = parts.at(-1);

  if (previousPart?.kind === kind) {
    previousPart.value += value;
    return;
  }

  parts.push({ kind, value });
}

function diffSequences(previousTokens: string[], nextTokens: string[], cellLimit = 420000) {
  const rows = previousTokens.length + 1;
  const columns = nextTokens.length + 1;

  if (rows * columns > cellLimit) {
    return null;
  }

  const table = new Uint32Array(rows * columns);

  for (let rowIndex = previousTokens.length - 1; rowIndex >= 0; rowIndex -= 1) {
    for (let columnIndex = nextTokens.length - 1; columnIndex >= 0; columnIndex -= 1) {
      const tableIndex = rowIndex * columns + columnIndex;

      if (previousTokens[rowIndex] === nextTokens[columnIndex]) {
        table[tableIndex] = table[(rowIndex + 1) * columns + columnIndex + 1] + 1;
      } else {
        table[tableIndex] = Math.max(
          table[(rowIndex + 1) * columns + columnIndex],
          table[rowIndex * columns + columnIndex + 1],
        );
      }
    }
  }

  const parts: SourceDiffPart[] = [];
  let previousIndex = 0;
  let nextIndex = 0;

  while (previousIndex < previousTokens.length && nextIndex < nextTokens.length) {
    if (previousTokens[previousIndex] === nextTokens[nextIndex]) {
      appendDiffPart(parts, "same", nextTokens[nextIndex]);
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (
      table[(previousIndex + 1) * columns + nextIndex] >=
      table[previousIndex * columns + nextIndex + 1]
    ) {
      appendDiffPart(parts, "removed", previousTokens[previousIndex]);
      previousIndex += 1;
    } else {
      appendDiffPart(parts, "added", nextTokens[nextIndex]);
      nextIndex += 1;
    }
  }

  while (previousIndex < previousTokens.length) {
    appendDiffPart(parts, "removed", previousTokens[previousIndex]);
    previousIndex += 1;
  }

  while (nextIndex < nextTokens.length) {
    appendDiffPart(parts, "added", nextTokens[nextIndex]);
    nextIndex += 1;
  }

  return parts;
}

function createSourceDiff(previousSource: string | null, nextSource: string) {
  if (!previousSource || previousSource === nextSource) {
    return [{ kind: "same", value: nextSource }] satisfies SourceDiffPart[];
  }

  return (
    diffSequences(tokenizeSource(previousSource), tokenizeSource(nextSource)) ??
    diffSequences(splitSourceLines(previousSource), splitSourceLines(nextSource), 900000) ??
    ([{ kind: "same", value: nextSource }] satisfies SourceDiffPart[])
  );
}

function SourceDiffView({ parts }: { parts: SourceDiffPart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <span
          key={`${part.kind}-${index}`}
          className={
            part.kind === "added"
              ? "papergraph-diff-added"
              : part.kind === "removed"
                ? "papergraph-diff-removed"
                : undefined
          }
        >
          {part.value}
        </span>
      ))}
    </>
  );
}

export function ArticleHistoryPanel({
  articleTitle,
  canRestore = false,
  language,
  onRestoreVersion,
  versions,
}: ArticleHistoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const isEnglish = language === "en";
  const sortedVersions = useMemo(
    () =>
      [...versions].sort(
        (firstVersion, secondVersion) =>
          new Date(secondVersion.createdAt).getTime() - new Date(firstVersion.createdAt).getTime(),
      ),
    [versions],
  );
  const versionEntries = useMemo(
    () =>
      sortedVersions.map((version, index) => {
        const previousVersion = sortedVersions[index + 1] ?? null;
        const versionNumber = sortedVersions.length - index;
        const sourceDiffParts = createSourceDiff(previousVersion?.source ?? null, version.source);

        return {
          sourceDiffParts,
          version,
          versionNumber,
        };
      }),
    [sortedVersions],
  );

  async function restoreVersion(versionId: string) {
    if (!canRestore || !onRestoreVersion) {
      return;
    }

    setRestoringVersionId(versionId);

    try {
      await onRestoreVersion(versionId);
      setIsOpen(false);
    } finally {
      setRestoringVersionId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--foreground)] transition-transform hover:-translate-y-0.5 hover:bg-white/10"
      >
        {isEnglish ? "History" : "Histórico"}
        <span className="ml-2 rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {versions.length}
        </span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[120] flex justify-end bg-black/45 backdrop-blur-sm">
          <button
            type="button"
            aria-label={isEnglish ? "Close history" : "Fechar histórico"}
            className="absolute inset-0 cursor-default"
            onClick={() => setIsOpen(false)}
          />

          <aside className="relative z-10 flex h-full w-full max-w-[34rem] flex-col border-l border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                  {isEnglish ? "Article history" : "Histórico do artigo"}
                </p>
                <h2 className="mt-2 truncate text-xl font-semibold text-[var(--foreground)]">{articleTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {isEnglish
                    ? "Versions are created when the article is submitted or resubmitted."
                    : "As versões são criadas quando o artigo é submetido ou resubmetido."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1">
                    <span className="papergraph-diff-dot papergraph-diff-dot-added" />
                    {isEnglish ? "Added" : "Adicionado"}
                  </span>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1">
                    <span className="papergraph-diff-dot papergraph-diff-dot-removed" />
                    {isEnglish ? "Removed" : "Removido"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-white/10"
              >
                {isEnglish ? "Close" : "Fechar"}
              </button>
            </div>

            <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto py-4">
              {versionEntries.length === 0 ? (
                <div className="rounded-[20px] border border-[var(--border)] bg-white/5 p-4 text-sm leading-6 text-[var(--muted)]">
                  {isEnglish
                    ? "This article does not have saved versions yet."
                    : "Este artigo ainda não tem versões guardadas."}
                </div>
              ) : null}

              <div className="space-y-3">
                {versionEntries.map((entry, index) => {
                  const { sourceDiffParts, version, versionNumber } = entry;
                  const isRestoring = restoringVersionId === version.id;

                  return (
                    <article
                      key={version.id}
                      className="rounded-[20px] border border-[var(--border)] bg-white/5 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                            {isEnglish ? `Version ${versionNumber}` : `Versão ${versionNumber}`}
                          </p>
                          <h3 className="mt-1 truncate text-base font-semibold text-[var(--foreground)]">{version.title}</h3>
                        </div>

                        <span className="shrink-0 rounded-full border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                          {index === 0
                            ? isEnglish
                              ? "Latest"
                              : "Mais recente"
                            : getArticleStatusLabel(version.status, language)}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--muted)]">
                        <p>
                          {formatVersionDate(version.createdAt, language)}
                          {version.submittedByName ? ` · ${version.submittedByName}` : ""}
                        </p>
                        {version.tags.length > 0 ? <p>{version.tags.join(" · ")}</p> : null}
                      </div>

                      <details className="mt-3 rounded-[16px] border border-[var(--border)] bg-black/15">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--foreground)]">
                          {isEnglish ? "View source" : "Ver código"}
                        </summary>
                        <pre className="scrollbar-hidden max-h-52 overflow-auto border-t border-[var(--border)] px-3 py-3 text-xs leading-5 text-[var(--muted)]">
                          <SourceDiffView parts={sourceDiffParts} />
                        </pre>
                      </details>

                      {canRestore && onRestoreVersion ? (
                        <button
                          type="button"
                          disabled={isRestoring}
                          onClick={() => {
                            void restoreVersion(version.id);
                          }}
                          className="mt-3 w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRestoring
                            ? isEnglish
                              ? "Restoring..."
                              : "A restaurar..."
                            : isEnglish
                              ? "Restore into editor"
                              : "Restaurar no editor"}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
