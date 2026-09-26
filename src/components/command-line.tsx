"use client";

import { useEffect, useState } from "react";

export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="mt-2.5 flex items-center gap-3 rounded-md border border-line bg-surface py-1.5 pr-1.5 pl-3.5">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-foreground">
        <span aria-hidden="true" className="mr-2 text-subtle select-none">
          $
        </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="h-7 shrink-0 rounded px-2.5 text-xs text-muted transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
      >
        <span aria-live="polite">{copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}</span>
      </button>
    </div>
  );
}
