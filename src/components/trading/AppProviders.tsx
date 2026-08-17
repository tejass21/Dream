import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { MarketProvider } from "@/lib/market/MarketProvider";
import { PaperProvider } from "@/lib/paper/PaperProvider";
import { TopNav } from "./TopNav";

export function TerminalShell({ children }: { children: ReactNode }) {
  return (
    <PaperProvider>
      <MarketProvider>
        <div className="min-h-screen bg-background">
          <TopNav />
          <main className="px-3 py-3 lg:px-4">{children}</main>
        </div>
        <Toaster position="bottom-right" />
      </MarketProvider>
    </PaperProvider>
  );
}
