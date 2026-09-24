"use client";

import { useCallback, useRef, useState, useTransition, type FormEvent } from "react";

import { discoverRepository, type DiscoveryResult } from "@/app/actions";
import { DiscoveryNotice } from "@/components/discovery-notice";
import { GraphWorkspace } from "@/components/graph-workspace";
import { EMPTY_REPOSITORY, NO_SUPPORTED_SOURCE_FILES } from "@/lib/errors/presentation";
import { parseRepositoryUrl } from "@/lib/repository-url";
import { MAX_SOURCE_FILES } from "@/lib/source-files";

type Phase =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "done"; url: string; result: DiscoveryResult };

type Identity = { fullName: string; defaultBranch: string };

export function RepositoryForm() {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [, startTransition] = useTransition();
  // Guards against a second submission landing before the first one's loading
  // state has committed; state alone cannot make that promise.
  const loadingRef = useRef(false);

  const parsed = parseRepositoryUrl(value);
  const isEmpty = value.trim() === "";
  const validationError = touched && !isEmpty && !parsed.ok ? parsed.error : null;
  const isLoading = phase.status === "loading";
  // A result is only shown while it still describes what is in the box: an
  // edit to the URL retires the previous outcome immediately, the same as
  // starting a new analysis does.
  const result = phase.status === "done" && phase.url === value ? phase.result : null;
  const identity = identityOf(result);

  const submit = useCallback((url: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    // Cleared immediately rather than kept until the new result arrives, so
    // nothing on screen is ever a stale repository wearing the new URL.
    setPhase({ status: "loading", url });
    startTransition(async () => {
      const next = await discoverRepository(url);
      loadingRef.current = false;
      setPhase({ status: "done", url, result: next });
    });
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!parsed.ok) return;
    submit(value);
  }

  function retry() {
    if (phase.status === "idle") return;
    submit(phase.url);
  }

  return (
    <>
      <form
        noValidate
        onSubmit={handleSubmit}
        aria-busy={isLoading}
        className="mx-auto mt-10 w-full max-w-xl"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="repository-url" className="sr-only">
            GitHub repository URL
          </label>
          <input
            id="repository-url"
            name="repository"
            type="url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://github.com/owner/repository"
            autoComplete="off"
            spellCheck={false}
            disabled={isLoading}
            aria-invalid={validationError ? true : undefined}
            aria-describedby="repository-url-status"
            className="h-11 min-w-0 rounded-md border border-line bg-surface px-3.5 text-base sm:flex-1 sm:text-[15px] text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-2 focus:outline-foreground/40 aria-invalid:border-danger/60 aria-invalid:hover:border-danger/60 aria-invalid:focus:border-danger/60 disabled:cursor-not-allowed disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={!parsed.ok || isLoading}
            className="h-11 shrink-0 rounded-md bg-foreground px-4 text-base sm:text-[15px] font-medium text-background transition-colors duration-150 enabled:hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60 disabled:cursor-not-allowed disabled:bg-foreground/35 disabled:text-background/80"
          >
            {isLoading ? "Analyzing…" : "Generate constellation"}
          </button>
        </div>
        {/* Kept mounted with a reserved line so the live region announces changes and the layout does not shift. */}
        <p
          id="repository-url-status"
          aria-live="polite"
          className="mt-2 min-h-5 text-sm text-muted"
        >
          {validationError ? (
            <span className="text-danger">{validationError}</span>
          ) : isLoading ? (
            "Analyzing repository…"
          ) : identity ? (
            <>
              <span className="font-mono text-foreground">{identity.fullName}</span>
              {" on "}
              <span className="font-mono text-foreground">{identity.defaultBranch}</span>
              {result?.status === "success" &&
                ` · ${formatCount(result.repository.entryCount, "tree entry", "tree entries")}`}
            </>
          ) : null}
        </p>
        {/* Reserved even when idle, so entering the loading state never shifts what is below. */}
        <p className="min-h-4 text-xs text-subtle">
          {isLoading ? "Fetching files and mapping local dependencies." : ""}
        </p>
      </form>

      {result?.status === "success" && (
        <>
          {(result.limited || result.skippedCount > 0) && (
            <p className="mx-auto mt-2 w-full max-w-xl text-xs text-muted">
              {[
                result.skippedCount > 0 &&
                  `${result.skippedCount.toLocaleString("en-US")} file${result.skippedCount === 1 ? "" : "s"} skipped during analysis`,
                result.limited && `showing the first ${MAX_SOURCE_FILES.toLocaleString("en-US")} supported source files`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <section className="mx-auto mt-6 w-full max-w-7xl">
            <GraphWorkspace
              graph={result.graph}
              label={`Dependency graph of ${result.repository.fullName}: ${formatCount(result.graph.nodes.length, "file", "files")}, ${formatCount(result.graph.edges.length, "edge", "edges")}`}
              repositoryFullName={result.repository.fullName}
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
          <DiscoveryNotice
            tone="warning"
            title={NO_SUPPORTED_SOURCE_FILES.title}
            message={NO_SUPPORTED_SOURCE_FILES.message}
            detail={NO_SUPPORTED_SOURCE_FILES.detail}
          />
        </div>
      )}

      {result?.status === "error" && (
        <div className="mx-auto w-full max-w-xl">
          <DiscoveryNotice
            tone="error"
            title={result.error.title}
            message={result.error.message}
            retryAt={result.error.retryAt}
            retry={result.error.retryable ? { onClick: retry, disabled: isLoading } : undefined}
          />
        </div>
      )}
    </>
  );
}

function identityOf(result: DiscoveryResult | null): Identity | null {
  if (result === null) return null;
  if (result.status === "error") return result.repository ?? null;
  return result.repository;
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}
