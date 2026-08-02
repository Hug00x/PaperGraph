"use client";

import Image from "next/image";
import type { FormEventHandler } from "react";
import paperGraphLogoText from "@/imagens/PapergraghTexto.png";
import type { AppLanguage } from "@/lib/portuguese-labels";

type AuthMode = "sign-in" | "sign-up";

type AuthLandingProps = {
  authMode: AuthMode;
  email: string;
  name: string;
  password: string;
  error: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  language: AppLanguage;
  status: string | null;
  supabaseConfigured: boolean;
  onEmailChange: (value: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onModeChange: (mode: AuthMode) => void;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

const backgroundNodes = [
  { id: "pdf", label: "PDF", x: 10, y: 30 },
  { id: "wiki", label: "[[", x: 29, y: 43 },
  { id: "tex", label: "TEX", x: 15, y: 78 },
  { id: "nlp", label: "NLP", x: 46, y: 68 },
  { id: "ref", label: "REF", x: 72, y: 54 },
  { id: "doi", label: "DOI", x: 78, y: 22 },
  { id: "bib", label: "BIB", x: 87, y: 84 },
];

const backgroundNodeById = Object.fromEntries(backgroundNodes.map((node) => [node.id, node]));
const backgroundEdges = [
  ["pdf", "wiki"],
  ["pdf", "tex"],
  ["wiki", "ref"],
  ["wiki", "nlp"],
  ["tex", "nlp"],
  ["nlp", "ref"],
  ["ref", "doi"],
  ["ref", "bib"],
  ["nlp", "bib"],
];

export function AuthLanding({
  authMode,
  email,
  name,
  password,
  error,
  isLoading,
  isSubmitting,
  language,
  status,
  supabaseConfigured,
  onEmailChange,
  onLanguageChange,
  onModeChange,
  onNameChange,
  onPasswordChange,
  onSubmit,
}: AuthLandingProps) {
  const isEnglish = language === "en";
  const isDisabled = isSubmitting || !supabaseConfigured;

  return (
    <main className="papergraph-auth-background relative flex min-h-screen overflow-hidden text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <svg className="papergraph-auth-network" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="papergraph-auth-edge-gradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="rgba(142,231,255,0.1)" />
              <stop offset="48%" stopColor="rgba(142,231,255,0.55)" />
              <stop offset="100%" stopColor="rgba(74,222,128,0.28)" />
            </linearGradient>
          </defs>

          {backgroundEdges.map(([fromNodeId, toNodeId]) => {
            const fromNode = backgroundNodeById[fromNodeId];
            const toNode = backgroundNodeById[toNodeId];

            if (!fromNode || !toNode) {
              return null;
            }

            return (
              <line
                key={`${fromNodeId}-${toNodeId}`}
                className="papergraph-auth-edge"
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
              />
            );
          })}
        </svg>

        {backgroundNodes.map((node) => (
          <div
            key={node.id}
            className="papergraph-auth-node absolute"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            {node.label}
          </div>
        ))}

        <div className="papergraph-auth-stream left-[5%] top-[12%]">
          <span>G = (V,E)</span>
          <span>[[Wikilink]]</span>
          <span>citation graph</span>
        </div>
        <div className="papergraph-auth-stream right-[7%] top-[16%] text-right">
          <span>latex compile</span>
          <span>semantic links</span>
          <span>paper network</span>
        </div>
      </div>

      <section className="relative z-10 grid min-h-screen w-full items-center gap-10 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:px-12 xl:px-20">
        <div className="flex min-h-[22rem] flex-col justify-center">
          <div className="relative h-[5.8rem] w-[20rem] max-w-full overflow-hidden sm:h-[6.7rem] sm:w-[24rem]" aria-label="PaperGraph">
            <Image
              src={paperGraphLogoText}
              alt="PaperGraph"
              priority
              className="absolute left-[-6.95rem] top-[-7.55rem] h-auto w-[33rem] max-w-none sm:left-[-7.75rem] sm:top-[-8.4rem] sm:w-[37rem]"
            />
          </div>

          <h1 className="mt-7 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            {isEnglish ? "Your research workspace, connected." : "A tua workspace de investigação, ligada."}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
            {isEnglish
              ? "Sign in to continue to the article graph, LaTeX editor and synced library."
              : "Inicia sessão para continuar para o mapa de artigos, editor LaTeX e biblioteca sincronizada."}
          </p>
        </div>

        <aside className="rounded-[28px] border border-[rgba(145,166,189,0.24)] bg-[rgba(10,16,24,0.84)] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {isEnglish ? "Account" : "Conta"}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {authMode === "sign-in"
                  ? isEnglish
                    ? "Sign in"
                    : "Entrar"
                  : isEnglish
                    ? "Create account"
                    : "Criar conta"}
              </h2>
            </div>

            <div className="flex rounded-full border border-[var(--border)] bg-black/20 p-1">
              {(["pt", "en"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onLanguageChange(option)}
                  className={`h-8 rounded-full px-3 text-xs font-semibold transition-colors ${
                    language === option
                      ? "bg-[var(--accent)] text-[#041016]"
                      : "text-[var(--muted)] hover:text-white"
                  }`}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {(["sign-in", "sign-up"] as const).map((mode) => {
              const isActiveMode = authMode === mode;

              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onModeChange(mode);
                  }}
                  className={`rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${
                    isActiveMode
                      ? "border-[var(--accent)] bg-[rgba(142,231,255,0.16)] text-white"
                      : "border-[var(--border)] bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {mode === "sign-in"
                    ? isEnglish
                      ? "Sign in"
                      : "Entrar"
                    : isEnglish
                      ? "Sign up"
                      : "Registar"}
                </button>
              );
            })}
          </div>

          <form className="mt-5 space-y-4" onSubmit={onSubmit}>
            {authMode === "sign-up" ? (
              <label className="block">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  {isEnglish ? "Name" : "Nome"}
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  required
                  minLength={2}
                  autoComplete="name"
                  placeholder={isEnglish ? "Your name" : "O teu nome"}
                  className="mt-2 w-full rounded-[18px] border border-[var(--border)] bg-black/25 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                required
                autoComplete="email"
                placeholder={isEnglish ? "you@example.com" : "tu@example.com"}
                className="mt-2 w-full rounded-[18px] border border-[var(--border)] bg-black/25 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                {isEnglish ? "Password" : "Password"}
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                required
                minLength={6}
                autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                placeholder={isEnglish ? "At least 6 characters" : "Pelo menos 6 caracteres"}
                className="mt-2 w-full rounded-[18px] border border-[var(--border)] bg-black/25 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
              />
            </label>

            <button
              type="submit"
              disabled={isDisabled}
              className="w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isSubmitting
                ? isEnglish
                  ? "Working..."
                  : "A processar..."
                : authMode === "sign-in"
                  ? isEnglish
                    ? "Enter PaperGraph"
                    : "Entrar no PaperGraph"
                  : isEnglish
                    ? "Create account"
                    : "Criar conta"}
            </button>
          </form>

          {isLoading ? (
            <p className="mt-4 rounded-[18px] border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
              {isEnglish ? "Checking saved session..." : "A confirmar sessão guardada..."}
            </p>
          ) : null}

          {!supabaseConfigured ? (
            <p className="mt-4 rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
              {isEnglish
                ? "Supabase is not configured. Check the environment variables."
                : "O Supabase não está configurado. Confirma as variáveis de ambiente."}
            </p>
          ) : null}

          {status ? (
            <p className="mt-4 rounded-[18px] border border-[rgba(142,231,255,0.28)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--accent)]">
              {status}
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
              {error}
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
