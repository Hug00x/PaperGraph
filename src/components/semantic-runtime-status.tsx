"use client";

import { useEffect, useState } from "react";

type RuntimeState = {
  phase: "idle" | "starting-runtime" | "checking-model" | "downloading-model" | "ready" | "offline" | "error";
  completed: number;
  total: number;
  percentage: number | null;
  error: string | null;
};
declare global {
  interface Window {
    papergraphRuntime?: {
      getState(): Promise<RuntimeState>;
      retry(): Promise<RuntimeState>;
      subscribe(callback: (state: RuntimeState) => void): () => void;
    };
  }
}
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

export function SemanticRuntimeStatus() {
  const [state, setState] = useState<RuntimeState | null>(null);
  const [english, setEnglish] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const bridge = window.papergraphRuntime;
    if (!bridge) return;
    let active = true;
    const syncLanguage = () => setEnglish(window.localStorage.getItem("papergraph-language") === "en");
    const receive = (value: RuntimeState) => {
      if (active) {
        syncLanguage();
        setState(value); setDismissed(false);
      }
    };
    const unsubscribe = bridge.subscribe(receive);
    window.addEventListener("papergraph-language-changed", syncLanguage);
    void bridge.getState().then(receive).catch(() => {});
    return () => { active = false; unsubscribe(); window.removeEventListener("papergraph-language-changed", syncLanguage); };
  }, []);
  if (!state || dismissed) return null;
  const failure = state.phase === "error" || state.phase === "offline";
  const ready = state.phase === "ready";
  const downloading = state.phase === "downloading-model";
  const title = ready ? (english ? "Semantic search ready" : "Pesquisa semântica pronta")
    : failure ? (english ? "Semantic search unavailable" : "Pesquisa semântica indisponível")
    : (english ? "Preparing semantic search" : "A preparar a pesquisa semântica");
  const errorText = state.error === "download-failed"
    ? (english ? "Could not download the search model. Check your Internet connection and try again."
      : "Não foi possível descarregar o modelo de pesquisa. Verifica a ligação à Internet e tenta novamente.")
    : state.error === "runtime-missing"
      ? (english ? "The search engine is missing from this installation. Reinstall PaperGraph."
        : "O motor de pesquisa está em falta nesta instalação. Reinstala o PaperGraph.")
      : state.error === "model-invalid"
        ? (english ? "The search model could not be validated. Try again or restart PaperGraph."
          : "Não foi possível validar o modelo de pesquisa. Tenta novamente ou reinicia o PaperGraph.")
        : (english ? "Could not start the local search engine. Try again."
          : "Não foi possível iniciar o motor de pesquisa local. Tenta novamente.");
  return (
    <aside className="semantic-runtime-status" aria-label={title}>
      <div className="semantic-runtime-heading">
        <strong role="status" aria-live="polite">{title}</strong>
        {ready && <button aria-label={english ? "Dismiss" : "Fechar"} onClick={() => setDismissed(true)}>×</button>}
      </div>
      {!ready && <p>{failure ? errorText : downloading
        ? (english ? "Downloading the search model. This is only needed on first use."
          : "A descarregar o modelo de pesquisa. Isto só é necessário na primeira utilização.")
        : (english ? "Preparing local processing. You can continue using PaperGraph."
          : "A preparar o processamento local. Podes continuar a usar o PaperGraph.")}</p>}
      {downloading && state.total > 0 && <>
        <progress aria-label={english ? "Model download" : "Download do modelo"} value={state.completed} max={state.total} />
        <small>{state.percentage}% · {bytes(state.completed)} / {bytes(state.total)}</small>
      </>}
      {failure && <button className="semantic-runtime-retry" onClick={() => {
        void window.papergraphRuntime?.retry().then(setState).catch(() => {});
      }}>{english ? "Try again" : "Tentar novamente"}</button>}
    </aside>
  );
}
