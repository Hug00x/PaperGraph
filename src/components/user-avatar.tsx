"use client";

import Image from "next/image";
import { useState } from "react";
import { getDisplayInitials } from "@/lib/workspace-presentation";

export function UserAvatar({ name, url, className = "h-11 w-11" }: {
  name: string | null | undefined;
  url?: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden rounded-full border border-[rgba(142,231,255,0.28)] bg-[rgba(142,231,255,0.12)] text-sm font-semibold text-[var(--accent)] ${className}`}>
      {url && url !== failedUrl ? (
        <Image src={url} alt="" width={256} height={256} unoptimized
          className="h-full w-full object-cover" onError={() => setFailedUrl(url)} />
      ) : getDisplayInitials(name)}
    </div>
  );
}
