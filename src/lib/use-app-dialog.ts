"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AppDialogTone = "default" | "danger" | "warning";
export type AppDialogState = {
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmationValue?: string;
  eyebrow?: string;
  inputDefaultValue?: string;
  inputLabel?: string;
  kind: "alert" | "confirm" | "prompt";
  title: string;
  tone?: AppDialogTone;
};
export type AppDialogResult = {
  confirmed: boolean;
  value?: string;
};
export function useAppDialog() {
  const [appDialog, setAppDialog] = useState<AppDialogState | null>(null);
  const [appDialogValue, setAppDialogValue] = useState("");
  const appDialogResolverRef = useRef<((result: AppDialogResult) => void) | null>(null);

  const openAppDialog = useCallback((dialog: AppDialogState) => {
    appDialogResolverRef.current?.({ confirmed: false });
    setAppDialog(dialog);
    setAppDialogValue(dialog.inputDefaultValue ?? "");

    return new Promise<AppDialogResult>((resolve) => {
      appDialogResolverRef.current = resolve;
    });
  }, []);

  const closeAppDialog = useCallback((result: AppDialogResult) => {
    appDialogResolverRef.current?.(result);
    appDialogResolverRef.current = null;
    setAppDialog(null);
    setAppDialogValue("");
  }, []);

  const requestAppConfirm = useCallback(
    async (dialog: Omit<AppDialogState, "kind">) => {
      const result = await openAppDialog({ ...dialog, kind: "confirm" });
      return result.confirmed;
    },
    [openAppDialog],
  );

  const requestAppPrompt = useCallback(
    async (dialog: Omit<AppDialogState, "kind">) => {
      const result = await openAppDialog({ ...dialog, kind: "prompt" });
      return result.confirmed ? result.value ?? "" : null;
    },
    [openAppDialog],
  );

  const requestAppAlert = useCallback(
    async (dialog: Omit<AppDialogState, "kind">) => {
      await openAppDialog({ ...dialog, kind: "alert" });
    },
    [openAppDialog],
  );

  useEffect(() => {
    return () => {
      appDialogResolverRef.current?.({ confirmed: false });
      appDialogResolverRef.current = null;
    };
  }, []);

  return {
    appDialog,
    appDialogValue,
    setAppDialogValue,
    closeAppDialog,
    requestAppConfirm,
    requestAppPrompt,
    requestAppAlert,
  };
}
