"use client";

import type { FormEventHandler } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AppLanguage } from '@/lib/portuguese-labels';
import { ProfilePhotoControl } from './profile-photo-control';

type Props = {
  appLanguage: AppLanguage;
  authUser: User;
  supabase: SupabaseClient | null;
  visibleAccountName: string | null;
  profileNameDraft: string;
  isAuthLoading: boolean;
  isAuthSubmitting: boolean;
  isAccountDeletionRunning: boolean;
  handleProfileNameSubmit: FormEventHandler<HTMLFormElement>;
  setProfileNameDraft: (name: string) => void;
  handleSignOut: () => Promise<void>;
  handleDeleteAccount: () => Promise<void>;
  onPhotoChanged: () => Promise<void>;
  authStatus: string | null;
  authError: string | null;
};

export function AccountSettings({ appLanguage, authUser, supabase, visibleAccountName, profileNameDraft, isAuthLoading, isAuthSubmitting, isAccountDeletionRunning, handleProfileNameSubmit, setProfileNameDraft, handleSignOut, handleDeleteAccount, authStatus, authError, onPhotoChanged }: Props) {
  const isEnglish = appLanguage === 'en';
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          {isEnglish ? "Profile and session" : "Perfil e sessão"}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">
          {isEnglish ? "Account" : "Conta"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {isEnglish
            ? "Manage your session and public display name."
            : "Gere a tua sessão e o nome visível do perfil."}
        </p>
      </div>

      {!supabase ? (
        <div className="rounded-[20px] border border-red-300/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
          {isEnglish
            ? "Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local."
            : "O Supabase não está configurado. Confirma NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no .env.local."}
        </div>
      ) : null}

      <div className="max-w-4xl">
        <section className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
            {isEnglish ? "Current session" : "Sessão atual"}
          </p>

          {isAuthLoading ? (
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {isEnglish ? "Checking session..." : "A confirmar sessão..."}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-base font-semibold text-white">
                  {visibleAccountName ?? (isEnglish ? "Connected account" : "Conta ligada")}
                </p>
                {authUser.email ? (
                  <p className="mt-1 truncate text-sm text-[var(--muted)]">{authUser.email}</p>
                ) : null}
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{authUser.id}</p>
              </div>

              {supabase ? (
                <ProfilePhotoControl key={authUser.id} supabase={supabase} userId={authUser.id}
                  name={visibleAccountName} language={appLanguage}
                  disabled={isAuthSubmitting || isAccountDeletionRunning}
                  onChanged={onPhotoChanged} />
              ) : null}

              <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleProfileNameSubmit}>
                <label className="min-w-0">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                    {isEnglish ? "Display name" : "Nome visível"}
                  </span>
                  <input
                    type="text"
                    value={profileNameDraft}
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                    minLength={2}
                    className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={isAuthSubmitting}
                  className="self-end rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isEnglish ? "Save name" : "Guardar nome"}
                </button>
              </form>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isAuthSubmitting || isAccountDeletionRunning}
                  onClick={() => {
                    void handleSignOut();
                  }}
                  className="rounded-full border border-red-300/30 bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAuthSubmitting
                    ? isEnglish
                      ? "Signing out..."
                      : "A sair..."
                    : isEnglish
                      ? "Sign out"
                      : "Terminar sessão"}
                </button>
                <button
                  type="button"
                  disabled={isAuthSubmitting || isAccountDeletionRunning}
                  onClick={() => {
                    void handleDeleteAccount();
                  }}
                  className="rounded-full border border-red-300/40 bg-red-600/20 px-4 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAccountDeletionRunning
                    ? isEnglish
                      ? "Deleting..."
                      : "A apagar..."
                    : isEnglish
                      ? "Delete account"
                      : "Eliminar conta"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {authStatus ? (
        <p className="rounded-[18px] border border-[rgba(142,231,255,0.25)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--accent)]">
          {authStatus}
        </p>
      ) : null}

      {authError ? (
        <p className="rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
          {authError}
        </p>
      ) : null}
    </div>
  );
}
