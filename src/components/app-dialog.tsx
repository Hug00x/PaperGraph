"use client";

import type { AppDialogResult, AppDialogState } from "@/lib/use-app-dialog";

type AppDialogProps = {
  appDialog: AppDialogState;
  appDialogValue: string;
  isEnglish: boolean;
  setAppDialogValue: (value: string) => void;
  closeAppDialog: (result: AppDialogResult) => void;
};

export function AppDialog({ appDialog, appDialogValue, isEnglish, setAppDialogValue, closeAppDialog }: AppDialogProps) {
  const isPrompt = appDialog.kind === "prompt";
  const isAlert = appDialog.kind === "alert";
  const isConfirmDisabled =
    isPrompt && appDialog.confirmationValue
      ? appDialogValue.trim() !== appDialog.confirmationValue
      : false;
  const confirmButtonClassName =
    appDialog.tone === "danger"
      ? "border-red-300/30 bg-red-500/18 text-red-50 hover:bg-red-500/26"
      : appDialog.tone === "warning"
        ? "border-amber-200/30 bg-amber-300/18 text-amber-50 hover:bg-amber-300/26"
        : "border-[var(--accent)] bg-[var(--accent)] text-[#041016] hover:-translate-y-0.5";

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className="w-full max-w-md rounded-[24px] border border-[var(--border)] bg-[var(--surface-strong)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
        onSubmit={(event) => {
          event.preventDefault();

          if (isConfirmDisabled) {
            return;
          }

          closeAppDialog({ confirmed: true, value: isPrompt ? appDialogValue : undefined });
        }}
      >
        {appDialog.eyebrow ? (
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">{appDialog.eyebrow}</p>
        ) : null}
        <h2 id="app-dialog-title" className="mt-2 text-xl font-semibold text-white">
          {appDialog.title}
        </h2>
        {appDialog.body ? (
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{appDialog.body}</p>
        ) : null}

        {isPrompt ? (
          <label className="mt-5 block">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
              {appDialog.inputLabel ?? (isEnglish ? "Confirmation" : "Confirmação")}
            </span>
            <input
              autoFocus
              type="text"
              value={appDialogValue}
              onChange={(event) => setAppDialogValue(event.target.value)}
              placeholder={appDialog.confirmationValue ?? appDialog.inputDefaultValue}
              className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
            />
            {appDialog.confirmationValue ? (
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                {isEnglish ? "Type exactly" : "Escreve exatamente"}{" "}
                <span className="font-semibold text-white">&quot;{appDialog.confirmationValue}&quot;</span>.
              </p>
            ) : null}
          </label>
        ) : null}

        <div className={`mt-5 grid gap-3 ${isAlert ? "" : "sm:grid-cols-2"}`}>
          {!isAlert ? (
            <button
              type="button"
              onClick={() => closeAppDialog({ confirmed: false })}
              className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {appDialog.cancelLabel ?? (isEnglish ? "Cancel" : "Cancelar")}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isConfirmDisabled}
            className={`rounded-full border px-4 py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${confirmButtonClassName}`}
          >
            {appDialog.confirmLabel ?? (isAlert ? "OK" : isEnglish ? "Confirm" : "Confirmar")}
          </button>
        </div>
      </form>
    </div>
  );
}
