import type { Ref } from "react";

import { kindName, type FileDetails, type RelatedFile } from "@/lib/visualization/inspection";

type FileInspectorProps = {
  details: FileDetails;
  // Files that pass the active graph filters, or null when none are active.
  // Related files outside this set are still listed, since they are factual
  // relationships, but are marked rather than shown as if visible.
  visible: Set<string> | null;
  headingRef: Ref<HTMLHeadingElement>;
  onSelect(id: string): void;
  onClose(): void;
};

export function FileInspector({ details, visible, headingRef, onSelect, onClose }: FileInspectorProps) {
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
    </aside>
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

function Relations({ title, count, description, empty, files, visible, onSelect }: RelationsProps) {
  return (
    <section className="border-b border-line py-3 last:border-b-0">
      <div className="px-4">
        <h3 className="text-xs font-medium text-muted">
          {title} <span className="font-normal text-foreground tabular-nums">{count.toLocaleString("en-US")}</span>
        </h3>
        <p className="mt-0.5 text-xs text-subtle">{description}</p>
      </div>
      {files.length === 0 ? (
        <p className="mt-2 px-4 text-xs text-subtle">{empty}</p>
      ) : (
        <ul className="mt-1.5">
          {files.map((file) => {
            const hiddenByFilters = visible !== null && !visible.has(file.id);
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
                      {!(file.kinds.length === 1 && file.kinds[0] === "import") && (
                        <span className="shrink-0 text-xs text-subtle">{file.kinds.map(kindName).join(", ")}</span>
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
      )}
    </section>
  );
}
