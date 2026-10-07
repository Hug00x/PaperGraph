"use client";

import { useEffect, useRef, useState } from "react";

export type AnaraConnectionStatus = "disconnected" | "connecting" | "connected" | "expired" | "error";
type AnaraState = { status: AnaraConnectionStatus; error: string | null };
declare global {
  interface Window {
    papergraphAnara?: {
      getState(): Promise<AnaraState>;
      connect(): Promise<AnaraState>;
      disconnect(): Promise<AnaraState>;
      subscribe(callback: (state: AnaraState) => void): () => void;
    };
  }
}

export function AnaraSettings({ isEnglish }: { isEnglish: boolean }) {
  const [state, setState] = useState<AnaraState>({ status: "disconnected", error: null });
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    const bridge = window.papergraphAnara;
    if (!bridge) return;
    let active = true;
    let received = false;
    const unsubscribe = bridge.subscribe(value => { received = true; if (active) setState(value); });
    void bridge.getState().then(value => { if (active) { setAvailable(true); if (!received) setState(value); } }).catch(() => {
      if (active) { setAvailable(true); setState({ status: "error", error: "connection-failed" }); }
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  const act = async (disconnect: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const bridge = window.papergraphAnara;
      if (bridge) setState(await (disconnect ? bridge.disconnect() : bridge.connect()));
    } catch { setState({ status: "error", error: "connection-failed" }); }
    finally { pending.current = false; setBusy(false); }
  };
  const labels = isEnglish
    ? { disconnected: "Not connected", connecting: "Connecting to Anara…", connected: "Connected", expired: "Connection expired", error: "Could not connect" }
    : { disconnected: "Não ligado", connecting: "A ligar à Anara…", connected: "Ligado", expired: "Ligação expirada", error: "Não foi possível ligar" };
  const error = state.error === "storage-unavailable"
    ? (isEnglish ? "Secure credential storage is unavailable on this device." : "O armazenamento seguro de credenciais está indisponível neste dispositivo.")
    : state.error === "storage-removal-failed"
      ? (isEnglish ? "Could not remove saved credentials. Try disconnecting again." : "Não foi possível remover as credenciais. Tenta desligar novamente.")
      : state.error === "revocation-unconfirmed"
        ? (isEnglish ? "Disconnected on this device. Remote revocation could not be confirmed; remove PaperGraph’s access in Anara." : "Desligado neste dispositivo. Não foi possível confirmar a revogação remota; remove o acesso do PaperGraph na Anara.")
        : state.error ? (isEnglish ? "Check your connection and try again." : "Verifica a ligação e tenta novamente.") : null;
  return (
    <section className="rounded-[24px] border border-[var(--border)] bg-white/5 p-5">
      <h3 className="text-lg font-semibold text-white">Anara</h3>
      <p className="mt-2 text-sm text-[var(--muted)]">{isEnglish
        ? "Connect your Anara account to enable Anara-powered research features."
        : "Liga a tua conta Anara para permitir funcionalidades de investigação com a Anara."}</p>
      <p className="mt-4 text-sm" role="status" aria-live="polite">{labels[state.status]}</p>
      {!available ? <p className="mt-2 text-sm text-[var(--muted)]">{isEnglish ? "Available in the PaperGraph desktop app." : "Disponível na aplicação desktop PaperGraph."}</p> : null}
      {error ? <p className="mt-2 text-sm text-[var(--muted)]" role="alert">{error}</p> : null}
      <div className="mt-4 flex gap-3">
        {state.status !== "connected" ? <button type="button" disabled={!available || busy || state.status === "connecting"}
          onClick={() => void act(false)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50">
          {isEnglish ? "Connect Anara" : "Ligar Anara"}</button> : null}
        {available && state.status !== "disconnected" ? <button type="button" disabled={busy}
          onClick={() => void act(true)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50">
          {state.status === "connecting" ? (isEnglish ? "Cancel" : "Cancelar") : (isEnglish ? "Disconnect" : "Desligar")}</button> : null}
      </div>
    </section>
  );
}
