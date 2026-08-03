"use client";

import type { ReactNode } from "react";
import {
  getArticleStatusLabel,
  getArticleTagLabel,
  getRelativeTimeLabel,
  type AppLanguage,
} from "@/lib/portuguese-labels";
import type { Article } from "@/lib/workspace-data";

type ArticleLibraryProps = {
  articles: Article[];
  selectedArticleId: string;
  onSelectArticle: (articleId: string) => void;
  language: AppLanguage;
  renderArticleActions?: (article: Article) => ReactNode;
};

export function ArticleLibrary({
  articles,
  selectedArticleId,
  onSelectArticle,
  language,
  renderArticleActions,
}: ArticleLibraryProps) {
  const isEnglish = language === "en";

  return (
    <div className="space-y-3">
      {articles.map((article) => (
        <article
          key={article.id}
          className={`rounded-[24px] border p-4 transition-colors ${
            selectedArticleId === article.id
              ? "border-[var(--accent)] bg-[rgba(142,231,255,0.12)]"
              : "border-[var(--border)] bg-white/5 hover:bg-white/8"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelectArticle(article.id)}
            className="block w-full text-left"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{article.title}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                  {article.author}
                </p>
              </div>
              <span className="rounded-full border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[11px] text-[var(--muted)]">
                {getArticleStatusLabel(article.status, language)}
              </span>
            </div>

            {article.tags.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[11px] text-white"
                  >
                    {getArticleTagLabel(tag, language)}
                  </span>
                ))}
              </div>
            ) : null}

          </button>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Updated" : "Atualizado"} {getRelativeTimeLabel(article.updatedAt, language)}
            </p>
            {renderArticleActions ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {renderArticleActions(article)}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
