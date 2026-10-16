"use client";

type Props = {
  isEnglish: boolean;
  onClick: () => void;
};

export function HelpButton({ isEnglish, onClick }: Props) {
  const label = isEnglish ? "Help" : "Ajuda";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-white/5 text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4" />
        <path d="M12 17h.01" />
      </svg>
    </button>
  );
}
