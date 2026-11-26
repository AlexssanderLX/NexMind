import { Typography } from "@nous-research/ui/ui/components/typography/index";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export function SidebarFooter({ status }: SidebarFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2",
        "px-5 py-2.5",
        "border-t border-current/10",
      )}
    >
      <Typography
        className="font-mono-ui text-xs tabular-nums tracking-[0.08em] text-text-tertiary lowercase"
      >
        {status?.version != null ? `v${status.version}` : "—"}
      </Typography>

      <span
        className={cn(
          "font-mono font-bold text-xs tracking-[0.12em] text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]",
        )}
      >
        NEX V2
      </span>
    </div>
  );
}

interface SidebarFooterProps {
  status: StatusResponse | null;
}
