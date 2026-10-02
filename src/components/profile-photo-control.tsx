"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppLanguage } from "@/lib/portuguese-labels";
import { getProfileAvatarUrl, isProfileAvatarPath, prepareProfilePhoto, saveProfileAvatar } from "@/lib/profile-avatar";
import { UserAvatar } from "@/components/user-avatar";

export function ProfilePhotoControl({ supabase, userId, name, language, disabled, onChanged }: {
  supabase: SupabaseClient;
  userId: string;
  name: string | null;
  language: AppLanguage;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const isEnglish = language === "en";
  const [path, setPath] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
        if (error) throw error;
        const avatarPath = typeof data?.avatar_path === "string" && isProfileAvatarPath(data.avatar_path, userId)
          ? data.avatar_path : null;
        const avatarUrl = await getProfileAvatarUrl(supabase, avatarPath);
        if (!cancelled && !pending.current) { setPath(avatarPath); setUrl(avatarUrl); }
      } catch {
        if (!cancelled) setError(isEnglish ? "Could not load the profile photo. Try reopening Account." : "Não foi possível carregar a foto. Tenta abrir novamente a Conta.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => { if (!pending.current) void load(); }, 45 * 60 * 1000);
    return () => { cancelled = true; mounted.current = false; window.clearInterval(timer); };
  }, [supabase, userId, isEnglish]);

  async function change(file: File | null) {
    if (pending.current || disabled || loading) return;
    pending.current = true;
    setBusy(true); setError(null); setSaved(false);
    try {
      const photo = file ? await prepareProfilePhoto(file) : null;
      const nextPath = await saveProfileAvatar(supabase, userId, photo, path);
      const nextUrl = await getProfileAvatarUrl(supabase, nextPath);
      if (mounted.current) {
        setPath(nextPath); setUrl(nextUrl); setSaved(true);
        await onChanged();
      }
    } catch (failure) {
      if (mounted.current) {
        const code = failure instanceof Error ? failure.message : "";
        setError(code === "avatar-invalid-type" || code === "avatar-invalid-size"
          ? (isEnglish ? "Choose a JPG, PNG or WebP image up to 5 MB." : "Escolhe uma imagem JPG, PNG ou WebP até 5 MB.")
          : (isEnglish ? "Could not save the photo. Check your connection and try again." : "Não foi possível guardar a foto. Verifica a ligação e tenta novamente."));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const unavailable = disabled || loading || busy;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar name={name} url={url} className="h-20 w-20 text-xl" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold text-white">{isEnglish ? "Profile photo" : "Foto de perfil"}</p>
          <p className="text-xs text-[var(--muted)]">{isEnglish ? "Visible to workspace members. JPG, PNG or WebP, up to 5 MB." : "Visível para os membros das workspaces. JPG, PNG ou WebP, até 5 MB."}</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold text-white transition-colors focus-within:outline-2 focus-within:outline-[var(--accent)] ${unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/10"}`}>
              {busy ? (isEnglish ? "Saving..." : "A guardar...") : (isEnglish ? "Choose photo" : "Escolher foto")}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={unavailable} className="sr-only"
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void change(file); }} />
            </label>
            {path ? <button type="button" disabled={unavailable} onClick={() => void change(null)}
              className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50">
              {isEnglish ? "Remove photo" : "Remover foto"}
            </button> : null}
          </div>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-[var(--accent)]">{isEnglish ? "Profile photo updated." : "Foto de perfil atualizada."}</p> : null}
    </div>
  );
}
