"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Constellation, type ConstellationHandle } from "@/components/constellation";
import { FileInspector } from "@/components/file-inspector";
import { FileSearch } from "@/components/file-search";
import { buildGraphIndex, describeFile, neighborhood, selectionFor } from "@/lib/visualization/inspection";
import type { RenderGraph } from "@/lib/visualization/types";

type GraphWorkspaceProps = {
  graph: RenderGraph;
  label: string;
};

export function GraphWorkspace({ graph, label }: GraphWorkspaceProps) {
  const index = useMemo(() => buildGraphIndex(graph), [graph]);
  // The selection remembers the graph it was made in, so a new analysis starts
  // without one even if a file with the same path exists.
  const [selection, setSelection] = useState<{ graph: RenderGraph; id: string } | null>(null);
  const selected = selection?.graph === graph ? selectionFor(index, selection.id) : null;
  const focus = useMemo(() => neighborhood(index, selected), [index, selected]);
  const details = useMemo(() => describeFile(index, selected), [index, selected]);

  const constellationRef = useRef<ConstellationHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingRef = useRef(false);

  const select = useCallback(
    (id: string | null) => setSelection(id === null ? null : { graph, id }),
    [graph],
  );

  function jumpTo(id: string, fromInspector = false) {
    select(id);
    constellationRef.current?.focus(id);
    focusHeadingRef.current = fromInspector;
  }

  function resetView() {
    select(null);
    constellationRef.current?.resetView();
  }

  // Choosing a related file replaces the list the focused button was in, so
  // keyboard focus moves to the new file's name instead of being dropped.
  useEffect(() => {
    if (details === null || !focusHeadingRef.current) return;
    focusHeadingRef.current = false;
    headingRef.current?.focus();
  }, [details]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      select(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [select]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-md border border-line px-4 py-10 text-center text-sm text-muted">
        No supported source files were found.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <FileSearch index={index} onPick={(id) => jumpTo(id)} onEscape={() => select(null)} />
        <button
          type="button"
          onClick={resetView}
          className="ml-auto h-9 shrink-0 rounded-md px-3 text-sm text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
        >
          Reset view
        </button>
      </div>
      <div className="flex flex-col overflow-hidden rounded-md border border-line bg-surface lg:h-[min(72svh,880px)] lg:flex-row">
        <div className="relative h-[min(64svh,640px)] min-h-72 lg:h-auto lg:min-h-0 lg:flex-1">
          <Constellation
            ref={constellationRef}
            graph={graph}
            label={label}
            neighborhood={focus}
            onSelect={select}
          />
        </div>
        {details !== null && (
          <FileInspector
            details={details}
            headingRef={headingRef}
            onSelect={(id) => jumpTo(id, true)}
            onClose={() => select(null)}
          />
        )}
      </div>
    </div>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
