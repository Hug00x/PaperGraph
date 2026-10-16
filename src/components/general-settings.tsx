"use client";

import type { AppLanguage } from '@/lib/portuguese-labels';

export type AppTheme = 'dark' | 'light';

type Props = {
  appLanguage: AppLanguage;
  appTheme: AppTheme;
  onLanguageChange: (language: AppLanguage) => void;
  onThemeChange: (theme: AppTheme) => void;
};

export function GeneralSettings({ appLanguage, appTheme, onLanguageChange, onThemeChange }: Props) {
  const isEnglish = appLanguage === 'en';
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          {isEnglish ? "General" : "Geral"}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          {isEnglish ? "Interface language" : "Idioma da interface"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {isEnglish
            ? "The setting is saved in this browser and updates the workspace interface."
            : "A escolha fica guardada neste browser e atualiza a interface da workspace."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["pt", "en"] as const).map((language) => {
          const isActiveLanguage = appLanguage === language;

          return (
            <button
              key={language}
              type="button"
              onClick={() => onLanguageChange(language)}
              className={`rounded-[20px] border p-4 text-left transition-colors ${
                isActiveLanguage
                  ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                  : "border-[var(--border)] bg-black/15 hover:bg-white/8"
              }`}
            >
              <p className="text-sm font-semibold text-white">
                {language === "pt" ? "Português" : "English"}
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                {language === "pt"
                  ? "Interface principal em português."
                  : "Main interface in English."}
              </p>
            </button>
          );
        })}
      </div>

      <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
        <div>
          <h3 className="text-base font-semibold text-white">
            {isEnglish ? "Theme" : "Tema"}
          </h3>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["dark", "light"] as const).map((theme) => {
            const isActiveTheme = appTheme === theme;

            return (
              <button
                key={theme}
                type="button"
                onClick={() => onThemeChange(theme)}
                className={`rounded-[20px] border p-4 text-left transition-colors ${
                  isActiveTheme
                    ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                    : "border-[var(--border)] bg-white/5 hover:bg-white/8"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">
                    {theme === "dark"
                      ? isEnglish
                        ? "Dark"
                        : "Escuro"
                      : isEnglish
                        ? "Light"
                        : "Claro"}
                  </p>
                  <span
                    className={`h-4 w-4 rounded-full border ${
                      theme === "dark"
                        ? "border-slate-400 bg-[#0a0f14]"
                        : "border-sky-300 bg-[#edf5fb]"
                    }`}
                  />
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {theme === "dark"
                    ? isEnglish
                      ? "Current default theme for graph-heavy work."
                      : "Tema padrao atual para trabalho focado no mapa."
                    : isEnglish
                      ? "Brighter theme for reading and review."
                      : "Tema mais claro para leitura e revisao."}
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
