import { disconnectGitHub } from "@/app/actions";
import type { ConnectionStatus } from "@/lib/github/connection";

type GitHubConnectionProps = {
  status: ConnectionStatus;
  connectHref: string;
  manageHref: string;
  // The `github` parameter GitHub's redirects back to Codefield carry.
  notice: string | null;
};

const NOTICES: Record<string, string> = {
  installed: "Repository access updated on GitHub.",
  denied: "GitHub authorization was cancelled.",
  error: "GitHub could not be connected. Try again.",
};

const linkClass =
  "rounded text-muted underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40";

export function GitHubConnection({ status, connectHref, manageHref, notice }: GitHubConnectionProps) {
  const message = notice === null ? undefined : NOTICES[notice];

  return (
    <div className="mt-4 text-xs text-subtle">
      {status.connected ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            GitHub connected as <span className="font-mono text-muted">{status.login}</span>
          </span>
          <span aria-hidden="true">·</span>
          <a href={manageHref} className={linkClass}>
            Manage access
          </a>
          <span aria-hidden="true">·</span>
          <form action={disconnectGitHub} className="contents">
            <button type="submit" className={linkClass}>
              Disconnect
            </button>
          </form>
        </div>
      ) : (
        <p>
          Private repository?{" "}
          <a href={connectHref} className={linkClass}>
            Connect GitHub
          </a>
        </p>
      )}
      {message && (
        <p role="status" className="mt-1 text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
