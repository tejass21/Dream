import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PanelProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, action, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      {(title || action) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-panel-border px-3">
          {title && <h2 className="label-xs font-semibold text-foreground/80">{title}</h2>}
          {action}
        </header>
      )}
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}
