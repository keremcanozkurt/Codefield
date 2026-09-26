import type { Ref } from "react";

import {
  directoryHighlights,
  fileHighlights,
  languageBreakdown,
  type DirectoryFactKind,
  type FileFactKind,
  type RepositoryInsights,
} from "@/lib/graph/insights";
import { languageName } from "@/lib/languages/registry";
import { formatBytes } from "@/lib/visualization/inspection";

type RepositoryOverviewProps = {
  insights: RepositoryInsights;
  headingRef: Ref<HTMLHeadingElement>;
  onSelect(id: string): void;
};

const FILE_FACT_LABELS: Record<FileFactKind, string> = {
  mostReferenced: "Most referenced",
  mostOutgoing: "Most outgoing",
  highestDegree: "Highest degree",
  largest: "Largest file",
};

const DIRECTORY_FACT_LABELS: Record<DirectoryFactKind, string> = {
  mostFiles: "Most files",
  mostIncoming: "Most incoming",
  mostOutgoing: "Most outgoing",
  highestDegree: "Highest degree",
};

export function RepositoryOverview({ insights, headingRef, onSelect }: RepositoryOverviewProps) {
  const { totals, isolated, directories } = insights;
  const highlights = fileHighlights(insights);
  const directoryLeaders = directoryHighlights(insights);

  return (
    <aside
      aria-label="Repository overview"
      className="border-t border-line text-sm lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l"
    >
      <div className="border-b border-line px-4 py-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm text-foreground focus:outline-none">
          Overview
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Total label="Files" value={count(totals.files)} />
          <Total label="Edges" value={count(totals.edges)} />
          <Total label="Relationships" value={count(totals.relationships)} />
          <Total label="Directories" value={count(totals.directories)} />
          <Total label="Source size" value={formatBytes(totals.totalBytes)} />
          <Total label="Isolated" value={count(totals.isolatedFiles)} />
        </dl>
        <p className="mt-2 text-xs text-muted">
          {languageBreakdown(totals.languages)
            .map(({ language, files }) => `${count(files)} ${languageName(language)}`)
            .join(" · ")}
        </p>
      </div>

      {highlights.length > 0 && (
        <section className="border-b border-line py-3">
          <h3 className="px-4 text-xs font-medium text-muted">Files</h3>
          <ul className="mt-1.5">
            {highlights.map(({ file, facts }) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onSelect(file.id)}
                  title={file.path}
                  className="block w-full px-4 py-2 text-left transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40"
                >
                  {facts.map((fact) => (
                    <Fact
                      key={fact.kind}
                      label={FILE_FACT_LABELS[fact.kind]}
                      value={fileValue(fact.kind, fact.value)}
                      tied={fact.ties > 0}
                    />
                  ))}
                  <span className="mt-1 block truncate font-mono text-[13px] text-foreground">{file.name}</span>
                  <span className="block truncate font-mono text-xs text-subtle">
                    {file.directory || "repository root"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {directories.length > 1 && (
        <section className="border-b border-line px-4 py-3">
          <h3 className="text-xs font-medium text-muted">Directories</h3>
          <p className="mt-0.5 text-xs text-subtle">Counting only files directly inside each directory.</p>
          <ul className="mt-2 space-y-2.5">
            {directoryLeaders.map(({ path, facts }) => (
              <li key={path}>
                {facts.map((fact) => (
                  <Fact
                    key={fact.kind}
                    label={DIRECTORY_FACT_LABELS[fact.kind]}
                    value={directoryValue(fact.kind, fact.value)}
                    tied={fact.ties > 0}
                  />
                ))}
                <span className="mt-0.5 block truncate font-mono text-xs text-foreground" title={path || "repository root"}>
                  {path || "repository root"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="py-3">
        <h3 className="px-4 text-xs font-medium text-muted">
          Isolated files <span className="font-normal text-foreground tabular-nums">{count(isolated.length)}</span>
        </h3>
        <p className="mt-0.5 px-4 text-xs text-subtle">
          No import, re-export or require to or from another analyzed file.
        </p>
        {isolated.length > 0 && (
          <details className="mt-1.5 group">
            <summary className="cursor-pointer px-4 py-1 text-xs text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40">
              {isolated.length === 1 ? "Show the file" : `Show ${count(isolated.length)} files`}
            </summary>
            <ul className="mt-1 max-h-56 overflow-y-auto">
              {isolated.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(file.id)}
                    title={file.path}
                    className="flex w-full min-w-0 items-baseline gap-2 px-4 py-1 text-left transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40"
                  >
                    <span className="shrink-0 font-mono text-[13px] text-foreground">{file.name}</span>
                    <span className="truncate font-mono text-xs text-subtle">{file.directory || "repository root"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </aside>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function Fact({ label, value, tied }: { label: string; value: string; tied: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-subtle">{label}</span>
      <span className="text-muted tabular-nums">
        {value}
        {tied && <span className="text-subtle"> · tied</span>}
      </span>
    </span>
  );
}

function fileValue(kind: FileFactKind, value: number): string {
  switch (kind) {
    case "mostReferenced":
      return `${count(value)} incoming`;
    case "mostOutgoing":
      return `${count(value)} outgoing`;
    case "highestDegree":
      return plural(value, "edge");
    case "largest":
      return formatBytes(value);
  }
}

function directoryValue(kind: DirectoryFactKind, value: number): string {
  switch (kind) {
    case "mostFiles":
      return plural(value, "file");
    case "mostIncoming":
      return `${count(value)} incoming`;
    case "mostOutgoing":
      return `${count(value)} outgoing`;
    case "highestDegree":
      return plural(value, "edge");
  }
}

function plural(value: number, unit: string): string {
  return `${count(value)} ${value === 1 ? unit : `${unit}s`}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}
