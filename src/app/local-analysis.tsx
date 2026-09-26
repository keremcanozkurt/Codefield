"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { requestAnalysis } from "@/app/analysis-stream";
import { DiscoveryNotice } from "@/components/discovery-notice";
import { Workspace } from "@/components/workspace";
import type { DiscoveryProgress, DiscoveryResult, RepositoryIdentity, SkipCounts, SuccessResult } from "@/lib/discovery";
import { EMPTY_REPOSITORY, NO_READABLE_SOURCE_FILES, NO_SUPPORTED_SOURCE_FILES } from "@/lib/errors/presentation";

// While a new analysis runs, the last successful one stays on screen, so the
// workspace keeps its view, selection and filters through Analyze again.
type Phase = { status: "loading"; previous: SuccessResult | null } | { status: "done"; result: DiscoveryResult };

export function LocalAnalysis({ repository }: { repository: RepositoryIdentity }) {
  const [phase, setPhase] = useState<Phase>({ status: "loading", previous: null });
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sets state only from the request's callbacks, so it can run from the mount effect.
  const run = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void requestAnalysis(setProgress, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPhase({ status: "done", result });
    });
  }, []);

  useEffect(() => {
    run();
    return () => abortRef.current?.abort();
  }, [run]);

  function analyze() {
    setPhase((current) => ({
      status: "loading",
      previous: current.status === "done" ? (current.result.status === "success" ? current.result : null) : current.previous,
    }));
    setProgress(null);
    run();
  }

  const isLoading = phase.status === "loading";
  const result = phase.status === "done" ? phase.result : null;
  const shown = result?.status === "success" ? result : phase.status === "loading" ? phase.previous : null;

  return (
    <>
      <div className="mx-auto mt-8 w-full max-w-xl" aria-busy={isLoading}>
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5">
          <p className="min-w-0 truncate text-sm text-muted">
            <span className="font-mono text-foreground">{repository.name}</span>
            {repository.branch !== null && (
              <>
                {" on "}
                <span className="font-mono text-foreground">{repository.branch}</span>
              </>
            )}
            {repository.remote !== null && <span className="text-subtle"> · {repository.remote}</span>}
          </p>
          <button
            type="button"
            onClick={analyze}
            disabled={isLoading}
            title="Read the files on disk again"
            className="h-8 shrink-0 rounded-md border border-line px-3 text-xs font-medium text-foreground transition-colors duration-150 enabled:hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Analyzing…" : "Analyze again"}
          </button>
        </div>
        {/* Kept mounted with reserved lines so the live region announces changes and the layout does not shift. */}
        <p aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">
          {isLoading
            ? progressLabel(progress)
            : result?.status === "success"
              ? `${formatCount(result.graph.nodes.length, "source file", "source files")} · ${formatCount(result.graph.edges.length, "edge", "edges")} · ${formatCount(result.repository.fileCount, "file", "files")} in the folder`
              : ""}
        </p>
        <p className="min-h-4 text-xs text-subtle tabular-nums">{isLoading ? progressDetail(progress) : ""}</p>
      </div>

      {shown !== null && (
        <>
          {shown.skippedCount > 0 && (
            <p className="mx-auto mt-2 w-full max-w-xl text-xs text-muted">{skipSummary(shown.skipped)}</p>
          )}
          <section className="mx-auto mt-6 w-full max-w-7xl">
            <Workspace
              graph={shown.graph}
              label={`Dependency graph of ${repository.name}: ${formatCount(shown.graph.nodes.length, "file", "files")}, ${formatCount(shown.graph.edges.length, "edge", "edges")}`}
              repositoryName={repository.name}
            />
          </section>
        </>
      )}

      {result?.status === "empty" && (
        <div className="mx-auto w-full max-w-xl">
          <DiscoveryNotice tone="warning" title={EMPTY_REPOSITORY.title} message={EMPTY_REPOSITORY.message} />
        </div>
      )}

      {result?.status === "unsupported" && (
        <div className="mx-auto w-full max-w-xl">
          {result.skippedCount > 0 ? (
            <DiscoveryNotice
              tone="warning"
              title={NO_READABLE_SOURCE_FILES.title}
              message={NO_READABLE_SOURCE_FILES.message}
              detail={skipSummary(result.skipped)}
            />
          ) : (
            <DiscoveryNotice
              tone="warning"
              title={NO_SUPPORTED_SOURCE_FILES.title}
              message={NO_SUPPORTED_SOURCE_FILES.message}
              detail={NO_SUPPORTED_SOURCE_FILES.detail}
            />
          )}
        </div>
      )}

      {result?.status === "error" && (
        <div className="mx-auto w-full max-w-xl">
          <DiscoveryNotice
            tone="error"
            title={result.error.title}
            message={result.error.message}
            retry={result.error.retryable ? { onClick: analyze, disabled: isLoading } : undefined}
          />
        </div>
      )}
    </>
  );
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function progressLabel(progress: DiscoveryProgress | null): string {
  switch (progress?.stage) {
    case undefined:
    case "discover":
      return "Reading repository…";
    case "read":
      return "Reading source files…";
    case "analysis":
      return "Analyzing dependencies…";
    case "graph":
      return "Building graph…";
  }
}

function progressDetail(progress: DiscoveryProgress | null): string {
  switch (progress?.stage) {
    case "discover":
      return progress.files > 0 ? `${formatCount(progress.files, "file", "files")} found` : "";
    case "read":
      return `${progress.filesRead.toLocaleString("en-US")} of ${formatCount(progress.files, "source file", "source files")} read`;
    case "analysis":
    case "graph":
      return formatCount(progress.files, "source file", "source files");
    default:
      return "";
  }
}

function skipSummary(skipped: SkipCounts): string {
  const parts = [
    skipped.tooLarge > 0 && `${formatCount(skipped.tooLarge, "file", "files")} too large to analyze safely`,
    skipped.symlinks > 0 && `${formatCount(skipped.symlinks, "symbolic link", "symbolic links")} not followed`,
    skipped.unreadable > 0 && `${formatCount(skipped.unreadable, "file", "files")} not readable as UTF-8 text`,
    skipped.parseFailed > 0 && `${formatCount(skipped.parseFailed, "file", "files")} shown without relationships, as they could not be parsed`,
    skipped.unreadableDirectories > 0 &&
      `${formatCount(skipped.unreadableDirectories, "directory", "directories")} could not be read`,
  ].filter(Boolean);
  return parts.join(" · ");
}
