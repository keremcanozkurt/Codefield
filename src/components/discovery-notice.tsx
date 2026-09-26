type DiscoveryNoticeProps = {
  tone: "error" | "warning";
  title: string;
  message: string;
  detail?: string;
  retry?: { onClick(): void; disabled?: boolean };
};

export function DiscoveryNotice({ tone, title, message, detail, retry }: DiscoveryNoticeProps) {
  const toneClass = tone === "error" ? "border-danger/30 text-danger" : "border-warning/30 text-warning";

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`mt-4 flex items-start justify-between gap-3 rounded-md border ${toneClass} bg-surface px-3.5 py-3 text-sm`}
    >
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-muted">{message}</p>
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
