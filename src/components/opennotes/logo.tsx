"use client";

import { COVER_COLORS } from "@/lib/opennotes/types";

/** OpenNotes wordmark — a leather notebook with an ink swoosh. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="4" width="52" height="56" rx="10" fill="#8a5a32" />
      <rect x="6" y="4" width="52" height="56" rx="10" fill="url(#onGrad)" />
      <rect x="14" y="4" width="4" height="56" fill="rgba(0,0,0,0.18)" />
      <rect x="20" y="12" width="30" height="40" rx="4" fill="#fdfbf5" />
      <path
        d="M25 38c4-8 8-12 10-10s-2 8 2 8 6-6 10-6"
        stroke="#d6453d"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="27" cy="22" r="1.4" fill="#c9bda9" />
      <circle cx="33" cy="22" r="1.4" fill="#c9bda9" />
      <circle cx="39" cy="22" r="1.4" fill="#c9bda9" />
      <defs>
        <linearGradient id="onGrad" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a06a3c" />
          <stop offset="1" stopColor="#7c4e28" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** GoodNotes-style notebook cover used in the library grid. */
export function NotebookCover({
  colorIndex,
  title,
  pageCount,
}: {
  colorIndex: number;
  title: string;
  pageCount: number;
}) {
  const c = COVER_COLORS[colorIndex % COVER_COLORS.length];
  return (
    <div
      className="relative w-full aspect-[3/4] rounded-xl shadow-md overflow-hidden select-none"
      style={{
        background: `linear-gradient(145deg, ${c.light} 0%, ${c.base} 45%, ${c.dark} 100%)`,
      }}
      aria-label={`${title}, ${pageCount} page${pageCount === 1 ? "" : "s"}`}
    >
      {/* leather stitching */}
      <div
        className="absolute inset-2 rounded-lg border border-dashed border-white/25"
        aria-hidden="true"
      />
      {/* spine */}
      <div className="absolute inset-y-0 left-0 w-[9%] bg-black/20" aria-hidden="true" />
      <div className="absolute inset-y-0 left-[9%] w-px bg-black/25" aria-hidden="true" />
      {/* elastic band */}
      <div
        className="absolute inset-y-0 right-[22%] w-[7px] bg-black/25 rounded-full"
        aria-hidden="true"
      />
      {/* label */}
      <div className="absolute left-[16%] right-[16%] top-[16%] bottom-[26%] rounded-md bg-[#fdfbf5] shadow-inner flex flex-col overflow-hidden">
        <div className="flex-1 p-2 overflow-hidden">
          <p className="text-[11px] leading-snug font-medium text-[#5b4a35] line-clamp-4 break-words">
            {title}
          </p>
        </div>
        <svg className="w-full h-1/2" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
          <path
            d="M4 38 C 22 18, 34 44, 50 28 S 82 16, 96 30"
            stroke="#d6453d"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
