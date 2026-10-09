import { cn } from "@/lib/utils";

/**
 * The SED AI mark: three chevrons converging on one point — many signals,
 * one answer. Drawn as a stroke icon so it sits with the app's other icons,
 * and it turns while the assistant is working.
 */
export function SedAiMark({ className, spinning }: { className?: string; spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", spinning && "sed-ai-spin", className)}
    >
      <path d="M3 7.4 8 12l-5 4.6M20.48 6.51 14 8.54l-1.48-6.63M12.52 22.09 14 15.46l6.48 2.03" />
    </svg>
  );
}

const SIZES = {
  xs: { disc: "h-6 w-6", mark: "h-3 w-3" },
  sm: { disc: "h-7 w-7", mark: "h-3.5 w-3.5" },
  md: { disc: "h-10 w-10", mark: "h-5 w-5" },
  lg: { disc: "h-14 w-14", mark: "h-7 w-7" },
} as const;

/** The assistant's avatar: the mark on the SED AI disc (black, gradient edge). */
export function SedAiAvatar({ size = "sm", spinning, className }: { size?: keyof typeof SIZES; spinning?: boolean; className?: string }) {
  const s = SIZES[size];
  return (
    <span className={cn("sed-ai-surface grid shrink-0 place-items-center rounded-full", s.disc, className)} aria-hidden>
      <SedAiMark className={s.mark} spinning={spinning} />
    </span>
  );
}
