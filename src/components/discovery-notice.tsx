type DiscoveryNoticeProps = {
  tone: "error" | "warning";
  title: string;
  message: string;
  detail?: string;
  // ISO timestamp for a rate limit's reset time. Replaces `message` with a
  // sentence naming the time, formatted in the viewer's own timezone.
  retryAt?: string;
  retry?: { onClick(): void; disabled?: boolean };
};

// This notice only ever mounts after a client-side analysis result arrives,
// never as part of the server-rendered page, so formatting retryAt in the
// viewer's local timezone during render cannot cause a hydration mismatch.
export function DiscoveryNotice({ tone, title, message, detail, retryAt, retry }: DiscoveryNoticeProps) {
  const localTime = retryAt ? formatLocalTime(retryAt) : null;
  const body = retryAt ? (localTime ? `You can try again after ${localTime}.` : "You can try again once the limit resets.") : message;
  const toneClass = tone === "error" ? "border-danger/30 text-danger" : "border-warning/30 text-warning";

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`mt-4 flex items-start justify-between gap-3 rounded-md border ${toneClass} bg-surface px-3.5 py-3 text-sm`}
    >
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-muted">{body}</p>
        {detail && <p className="mt-0.5 text-xs text-subtle">{detail}</p>}
      </div>
      {retry && (
        <button
          type="button"
          onClick={retry.onClick}
          disabled={retry.disabled}
          className="h-8 shrink-0 rounded-md border border-line px-3 text-xs font-medium text-foreground transition-colors duration-150 enabled:hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function formatLocalTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
