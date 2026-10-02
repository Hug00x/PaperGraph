"use client";

function formatNotificationCount(count: number) {
  return count > 999 ? "999+" : String(count);
}

export function NotificationBadge({ className = "", count }: { className?: string; count: number }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className={`pointer-events-none inline-flex min-w-7 items-center justify-center rounded-full border border-white/25 bg-[#ff6b38] px-2 py-1 text-xs font-black leading-none text-white shadow-[0_10px_28px_rgba(255,107,56,0.38)] ${className}`}
    >
      {formatNotificationCount(count)}
    </span>
  );
}
