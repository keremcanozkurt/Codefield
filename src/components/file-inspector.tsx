import { useEffect, useState, type Ref } from "react";

import type { ReferenceKind } from "@/lib/analysis/kinds";
import type { ImpactDetails } from "@/lib/visualization/impact";
import type { PathDetails } from "@/lib/visualization/path";
import { kindName, type FileDetails, type RelatedFile } from "@/lib/visualization/inspection";

type FileInspectorProps = {
  details: FileDetails;
  // Set while impact mode is on for this file.
  impact: ImpactDetails | null;
  // Path Finder: waiting for a destination, or showing a result.
  path: PathDetails | "choosing" | null;
  // Files that pass the active graph filters, or null when none are active.
  // Related files outside this set are still listed, since they are factual
  // relationships, but are marked rather than shown as if visible.
  visible: Set<string> | null;
  headingRef: Ref<HTMLHeadingElement>;
  // Shows the file in the other view: Graph from Structure, and the reverse.
  crossView: { label: string; onClick(): void };
  // Set in Structure, where Impact Mode and Path Finder switch to the graph.
  modesOpenGraph: boolean;
  onSelect(id: string): void;
  onClose(): void;
  onTraceImpact(): void;
  onExitImpact(): void;
  onFindPath(): void;
  onExitPath(): void;
  onReversePath(): void;
};

const actionClass =
  "h-7 rounded-md border border-line px-2.5 text-xs text-muted transition-colors duration-150 hover:border-line-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40 aria-pressed:border-line-strong aria-pressed:text-foreground";

export function FileInspector({
  details,
  impact,
  path,
  visible,
  headingRef,
  crossView,
  modesOpenGraph,
  onSelect,
  onClose,
  onTraceImpact,
  onExitImpact,
  onFindPath,
  onExitPath,
  onReversePath,
}: FileInspectorProps) {
  return (
    <aside
      aria-label="Selected file"
      className="border-t border-line text-sm lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l"
    >
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="truncate font-mono text-sm text-foreground focus:outline-none"
          >
            {details.name}
          </h2>
          <p className="mt-1 font-mono text-xs leading-relaxed break-all text-muted">{details.path}</p>
          <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <div>
              <dt className="sr-only">Language</dt>
              <dd>{details.language}</dd>
            </div>
            <div>
              <dt className="sr-only">Size</dt>
              <dd>{details.size}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Degree</dt>
              <dd className="text-foreground tabular-nums">{details.degree.toLocaleString("en-US")}</dd>
            </div>
          </dl>
          {/* One button per mode for both of its states, so keyboard focus stays on it when it toggles. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={impact === null ? onTraceImpact : onExitImpact}
              aria-pressed={impact !== null}
              title={modesOpenGraph ? "Opens the graph" : undefined}
              className={actionClass}
            >
              {impact === null ? "Trace impact" : "Exit impact"}
            </button>
            <button
              type="button"
              onClick={path === null ? onFindPath : onExitPath}
              aria-pressed={path !== null}
              title={modesOpenGraph ? "Opens the graph" : undefined}
              className={actionClass}
            >
              {path === null ? "Find path" : path === "choosing" ? "Cancel path" : "Exit path"}
            </button>
            <CopyPathButton path={details.path} />
            <button type="button" onClick={crossView.onClick} className={actionClass}>
              {crossView.label}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close file details"
          className="-mt-0.5 -mr-1.5 grid size-7 shrink-0 place-items-center rounded text-subtle transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <p role="status" className="sr-only">
        {path === "choosing"
          ? `Finding a path from ${details.name}. Choose the destination file in the graph, in the lists below, or with search. Press Escape to cancel.`
          : path !== null
            ? pathAnnouncement(path)
            : impact === null
              ? ""
              : impactAnnouncement(details.name, impact)}
      </p>

      {path !== null && path !== "choosing" ? (
        <PathSection path={path} onSelect={onSelect} onReverse={onReversePath} />
      ) : impact !== null ? (
        <ImpactSection impact={impact} visible={visible} onSelect={onSelect} />
      ) : (
        <>
          {path === "choosing" && (
            <section className="border-b border-line px-4 py-3">
              <h3 className="text-xs font-medium text-muted">Find path</h3>
              <p className="mt-0.5 text-xs text-subtle">
                Choose the destination: click a file in the graph or below, or search for it. Codefield shows the
                shortest chain of dependencies from <span className="font-mono text-muted">{details.name}</span> to it.
              </p>
            </section>
          )}
          <Relations
            title="References"
            count={details.outgoing}
            description="Files this file imports, re-exports or requires."
            empty="No other analyzed file."
            files={details.references}
            visible={visible}
            onSelect={onSelect}
          />
          <Relations
            title="Referenced by"
            count={details.incoming}
            description="Files that import, re-export or require this file."
            empty="No analyzed file references it."
            files={details.referencedBy}
            visible={visible}
            onSelect={onSelect}
          />
        </>
      )}
    </aside>
  );
}

type ImpactSectionProps = {
  impact: ImpactDetails;
  visible: Set<string> | null;
  onSelect(id: string): void;
};

function ImpactSection({ impact, visible, onSelect }: ImpactSectionProps) {
  const hiddenByFilters = impact.visibleAffected !== null && impact.visibleAffected < impact.affected;
  return (
    <>
      <section className="border-b border-line px-4 py-3">
        <h3 className="text-xs font-medium text-muted">Impact</h3>
        <p className="mt-0.5 text-xs text-subtle">
          Files that depend on this file, directly or through other files, found by static analysis.
        </p>
        <dl className="mt-2 space-y-1 text-xs">
          <ImpactTotal label="Direct dependents" value={impact.direct} />
          <ImpactTotal label="Potentially affected" value={impact.affected} />
          <ImpactTotal label="Max dependency depth" value={impact.maxDepth} />
        </dl>
        {hiddenByFilters && (
          <p className="mt-2 text-xs text-subtle">
            <span className="text-muted tabular-nums">{count(impact.visibleAffected!)}</span> visible with current
            filters
          </p>
        )}
        {impact.affected === 0 && (
          <p className="mt-2 text-xs text-subtle">
            No dependents found in the analyzed graph. Relationships the analysis cannot see, such as imports built
            at runtime, are not included.
          </p>
        )}
      </section>

      {impact.levels.map(({ depth, files }) => (
        <section key={depth} className="border-b border-line py-3 last:border-b-0">
          <h3 className="px-4 text-xs font-medium text-muted">
            {depth === 1 ? "Direct dependents" : `Depth ${depth}`}{" "}
            <span className="font-normal text-foreground tabular-nums">{count(files.length)}</span>
          </h3>
          <FileList files={files} visible={visible} onSelect={onSelect} />
        </section>
      ))}
    </>
  );
}

function ImpactTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-foreground tabular-nums">{count(value)}</dd>
    </div>
  );
}

function PathSection({ path, onSelect, onReverse }: { path: PathDetails; onSelect(id: string): void; onReverse(): void }) {
  if (path.files === null) {
    return (
      <section className="border-b border-line px-4 py-3">
        <h3 className="text-xs font-medium text-muted">No directed dependency path found</h3>
        <p className="mt-0.5 text-xs text-subtle">
          No chain of imports in the static dependency graph leads from{" "}
          <span className="font-mono text-muted">{path.sourceName}</span> to{" "}
          <span className="font-mono text-muted">{path.targetName}</span>. The files may still interact at runtime.
        </p>
        <button type="button" onClick={onReverse} className={`${actionClass} mt-2`}>
          Try the reverse direction
        </button>
      </section>
    );
  }
  return (
    <section className="border-b border-line py-3">
      <div className="flex items-baseline justify-between gap-2 px-4">
        <h3 className="text-xs font-medium text-muted">
          Path found <span className="font-normal text-foreground tabular-nums">{plural(path.steps, "step")}</span>
        </h3>
        <button
          type="button"
          onClick={onReverse}
          className="rounded text-xs text-subtle transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
        >
          Reverse
        </button>
      </div>
      <p className="mt-0.5 px-4 text-xs text-subtle">Each file depends on the next.</p>
      {path.hidden > 0 && (
        <p className="mt-1 px-4 text-xs text-subtle">
          {plural(path.hidden, "file")} on this path {path.hidden === 1 ? "is" : "are"} hidden by the current filters.
        </p>
      )}
      <ol className="mt-1.5">
        {path.files.map((file, i) => (
          <li key={file.id} className="flex">
            <span aria-hidden="true" className="w-4 shrink-0 pt-1.5 pl-4 text-xs text-subtle">
              {i === 0 ? "" : "→"}
            </span>
            {file.hidden ? (
              // Selecting a file the filters hide would close the inspector.
              <div className="min-w-0 flex-1 px-4 py-1.5 opacity-60" title={file.id}>
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-mono text-[13px] text-muted">{file.name}</span>
                  <span className="shrink-0 text-xs text-subtle">hidden by filters</span>
                </span>
                <span className="block truncate font-mono text-xs text-subtle">{file.directory || "repository root"}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(file.id)}
                title={file.id}
                className="block min-w-0 flex-1 px-4 py-1.5 text-left transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40"
              >
                <span className="block truncate font-mono text-[13px] text-foreground">{file.name}</span>
                <span className="block truncate font-mono text-xs text-subtle">{file.directory || "repository root"}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function pathAnnouncement(path: PathDetails): string {
  if (path.files === null) return `No directed dependency path found from ${path.sourceName} to ${path.targetName}.`;
  return `Path found from ${path.sourceName} to ${path.targetName}, ${plural(path.steps, "step")}: ${path.files.map((f) => f.name).join(", then ")}.`;
}

function plural(value: number, unit: string): string {
  return `${count(value)} ${value === 1 ? unit : `${unit}s`}`;
}

function impactAnnouncement(name: string, impact: ImpactDetails): string {
  if (impact.affected === 0) return `Impact of ${name}: no dependents found in the analyzed graph.`;
  return (
    `Impact of ${name}: ${count(impact.direct)} direct ${impact.direct === 1 ? "dependent" : "dependents"}, ` +
    `${count(impact.affected)} potentially affected ${impact.affected === 1 ? "file" : "files"}, ` +
    `max dependency depth ${count(impact.maxDepth)}.`
  );
}

type RelationsProps = {
  title: string;
  count: number;
  description: string;
  empty: string;
  files: RelatedFile[];
  visible: Set<string> | null;
  onSelect(id: string): void;
};

function Relations({ title, count: total, description, empty, files, visible, onSelect }: RelationsProps) {
  return (
    <section className="border-b border-line py-3 last:border-b-0">
      <div className="px-4">
        <h3 className="text-xs font-medium text-muted">
          {title} <span className="font-normal text-foreground tabular-nums">{count(total)}</span>
        </h3>
        <p className="mt-0.5 text-xs text-subtle">{description}</p>
      </div>
      {files.length === 0 ? (
        <p className="mt-2 px-4 text-xs text-subtle">{empty}</p>
      ) : (
        <FileList files={files} visible={visible} onSelect={onSelect} />
      )}
    </section>
  );
}

type ListedFile = { id: string; name: string; directory: string; kinds?: ReferenceKind[] };

function FileList({
  files,
  visible,
  onSelect,
}: {
  files: ListedFile[];
  visible: Set<string> | null;
  onSelect(id: string): void;
}) {
  return (
    <ul className="mt-1.5">
      {files.map((file) => {
        const hiddenByFilters = visible !== null && !visible.has(file.id);
        const kinds = file.kinds;
        return (
          <li key={file.id}>
            {hiddenByFilters ? (
              <div className="px-4 py-1.5 opacity-60" title={file.id}>
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-mono text-[13px] text-muted">{file.name}</span>
                  <span className="shrink-0 text-xs text-subtle">hidden by filters</span>
                </span>
                <span className="block truncate font-mono text-xs text-subtle">
                  {file.directory || "repository root"}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(file.id)}
                title={file.id}
                className="block w-full px-4 py-1.5 text-left transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40"
              >
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-mono text-[13px] text-foreground">{file.name}</span>
                  {kinds !== undefined && !(kinds.length === 1 && kinds[0] === "import") && (
                    <span className="shrink-0 text-xs text-subtle">{kinds.map(kindName).join(", ")}</span>
                  )}
                </span>
                <span className="block truncate font-mono text-xs text-subtle">
                  {file.directory || "repository root"}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

// The result belongs to one path, so selecting another file resets it.
function CopyPathButton({ path }: { path: string }) {
  const [state, setState] = useState<{ path: string; result: "copied" | "failed" } | null>(null);
  const result = state?.path === path ? state.result : null;

  useEffect(() => {
    if (result === null) return;
    const timer = setTimeout(() => setState(null), 1500);
    return () => clearTimeout(timer);
  }, [result]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setState({ path, result: "copied" });
    } catch {
      setState({ path, result: "failed" });
    }
  }

  return (
    <button type="button" onClick={copy} className={actionClass}>
      <span aria-live="polite">{result === "copied" ? "Copied" : result === "failed" ? "Copy failed" : "Copy path"}</span>
    </button>
  );
}
