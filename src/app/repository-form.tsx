"use client";

import { useState, useTransition, type FormEvent } from "react";

import { discoverRepository, type DiscoveryResult } from "@/app/actions";
import { GraphWorkspace } from "@/components/graph-workspace";
import { parseRepositoryUrl } from "@/lib/repository-url";
import { MAX_SOURCE_FILES } from "@/lib/source-files";

type Discovery = { input: string; result: DiscoveryResult };

export function RepositoryForm() {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = parseRepositoryUrl(value);
  const isEmpty = value.trim() === "";
  const validationError = touched && !isEmpty && !parsed.ok ? parsed.error : null;
  // A result only applies to the input it was requested for.
  const result = discovery?.input === value ? discovery.result : null;
  const error = validationError ?? (result && !result.ok ? result.message : null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!parsed.ok || isPending) return;

    const input = value;
    startTransition(async () => {
      const next = await discoverRepository(input);
      setDiscovery({ input, result: next });
    });
  }

  return (
    <>
      <form
        noValidate
        onSubmit={handleSubmit}
        aria-busy={isPending}
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
            aria-invalid={validationError ? true : undefined}
            aria-describedby="repository-url-status"
            className="h-11 min-w-0 rounded-md border border-line bg-surface px-3.5 text-base sm:flex-1 sm:text-[15px] text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-2 focus:outline-foreground/40 aria-invalid:border-danger/60 aria-invalid:hover:border-danger/60 aria-invalid:focus:border-danger/60"
          />
          <button
            type="submit"
            disabled={!parsed.ok || isPending}
            className="h-11 shrink-0 rounded-md bg-foreground px-4 text-base sm:text-[15px] font-medium text-background transition-colors duration-150 enabled:hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60 disabled:cursor-not-allowed disabled:bg-foreground/35 disabled:text-background/80"
          >
            Generate constellation
          </button>
        </div>
        {/* Kept mounted with a reserved line so the live region announces changes and the layout does not shift. */}
        <p
          id="repository-url-status"
          aria-live="polite"
          className="mt-2 min-h-5 text-sm text-muted"
        >
          {error ? (
            <span className="text-danger">{error}</span>
          ) : isPending ? (
            "Loading repository…"
          ) : result?.ok ? (
            <>
              <span className="font-mono text-foreground">{result.repository.fullName}</span>
              {" on "}
              <span className="font-mono text-foreground">{result.repository.defaultBranch}</span>
              {` · ${formatCount(result.repository.entryCount, "tree entry", "tree entries")}`}
              {` · ${formatCount(result.repository.sourceFileCount, "source file", "source files")}`}
              {` · ${formatCount(result.repository.relationshipCount, "internal relationship", "internal relationships")}`}
              {` · ${formatCount(result.repository.edgeCount, "graph edge", "graph edges")}`}
              {result.repository.skippedCount > 0 &&
                ` · ${result.repository.skippedCount.toLocaleString("en-US")} skipped`}
              {result.repository.limited &&
                ` · analysis limited to ${MAX_SOURCE_FILES.toLocaleString("en-US")} files`}
            </>
          ) : null}
        </p>
      </form>
      {result?.ok && (
        <section className="mx-auto mt-6 w-full max-w-7xl">
          <GraphWorkspace
            graph={result.graph}
            label={`Dependency graph of ${result.repository.fullName}: ${formatCount(result.graph.nodes.length, "file", "files")}, ${formatCount(result.graph.edges.length, "edge", "edges")}`}
          />
        </section>
      )}
    </>
  );
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}
