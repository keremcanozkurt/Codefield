import type { Ref } from "react";

import type { ReferenceKind } from "@/lib/analysis/imports";
import type { ImpactDetails } from "@/lib/visualization/impact";
import { kindName, type FileDetails, type RelatedFile } from "@/lib/visualization/inspection";

type FileInspectorProps = {
  details: FileDetails;
  // Set while impact mode is on for this file.
  impact: ImpactDetails | null;
  // Files that pass the active graph filters, or null when none are active.
  // Related files outside this set are still listed, since they are factual
  // relationships, but are marked rather than shown as if visible.
  visible: Set<string> | null;
  headingRef: Ref<HTMLHeadingElement>;
  onSelect(id: string): void;
  onClose(): void;
  onTraceImpact(): void;
  onExitImpact(): void;
};

export function FileInspector({
  details,
  impact,
  visible,
  headingRef,
  onSelect,
  onClose,
  onTraceImpact,
  onExitImpact,
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
          {/* One button for both states, so keyboard focus stays on it when it toggles. */}
          <button
            type="button"
            onClick={impact === null ? onTraceImpact : onExitImpact}
            className="mt-3 h-7 rounded-md border border-line px-2.5 text-xs text-muted transition-colors duration-150 hover:border-line-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40"
          >
            {impact === null ? "Trace impact" : "Exit impact"}
          </button>
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
        {impact === null ? "" : impactAnnouncement(details.name, impact)}
      </p>

      {impact !== null ? (
        <ImpactSection impact={impact} visible={visible} onSelect={onSelect} />
      ) : (
        <>
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
