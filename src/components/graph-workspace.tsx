"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Constellation, type ConstellationHandle } from "@/components/constellation";
import { FileInspector } from "@/components/file-inspector";
import { FileSearch } from "@/components/file-search";
import { GraphFilters } from "@/components/graph-filters";
import { RepositoryOverview } from "@/components/repository-overview";
import { deriveRepositoryInsights } from "@/lib/graph/insights";
import {
  DEFAULT_FILTERS,
  directoryOptions,
  filterCounts,
  resolveSelection,
  visibleNodeIds,
  type FilterState,
} from "@/lib/visualization/filters";
import { describeImpact, traceImpact } from "@/lib/visualization/impact";
import { buildGraphIndex, describeFile, neighborhood, selectionFor } from "@/lib/visualization/inspection";
import { selectFile, setImpactMode, type Selection } from "@/lib/visualization/selection";
import type { RenderGraph } from "@/lib/visualization/types";

type GraphWorkspaceProps = {
  graph: RenderGraph;
  label: string;
  repositoryFullName: string;
};

// Idle also covers a just-finished export: the button reverts once its
// "Exporting…" state clears, rather than staying in a separate "done" state.
type ExportState = "idle" | "pending" | "error";

export function GraphWorkspace({ graph, label, repositoryFullName }: GraphWorkspaceProps) {
  const index = useMemo(() => buildGraphIndex(graph), [graph]);
  const [selection, setSelection] = useState<Selection<RenderGraph> | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [exportState, setExportState] = useState<ExportState>("idle");

  const rawSelected = selection?.graph === graph ? selectionFor(index, selection.id) : null;
  // Filters only affect what is shown: the graph, its metrics and the
  // repository overview are computed from the full, unfiltered data.
  const visibleIds = useMemo(() => visibleNodeIds(index, filters), [index, filters]);
  // A file a filter hides resolves to no selection: the inspector never stays
  // open for a node the graph is not currently showing.
  const selected = resolveSelection(rawSelected, visibleIds);
  const focus = useMemo(() => neighborhood(index, selected), [index, selected]);
  const details = useMemo(() => describeFile(index, selected), [index, selected]);
  const impactActive = selected !== null && selection?.impact === true;
  // Traced over the full graph: filters only decide which affected files show.
  const impact = useMemo(() => (impactActive ? traceImpact(index, selected) : null), [index, selected, impactActive]);
  const impactDetails = useMemo(
    () => (impact === null ? null : describeImpact(index, impact, visibleIds)),
    [index, impact, visibleIds],
  );
  const insights = useMemo(() => deriveRepositoryInsights(graph), [graph]);
  const directories = useMemo(() => directoryOptions(index), [index]);
  const counts = useMemo(() => filterCounts(index, visibleIds), [index, visibleIds]);

  const constellationRef = useRef<ConstellationHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
  // Where keyboard focus should go after the side panel changes, since the
  // button that caused the change is no longer rendered.
  const panelFocusRef = useRef<"inspector" | "overview" | null>(null);

  const select = useCallback(
    (id: string | null) => setSelection((current) => selectFile(current, graph, id)),
    [graph],
  );
  const setImpact = useCallback((on: boolean) => setSelection((current) => setImpactMode(current, on)), []);

  function jumpTo(id: string, fromPanel = false) {
    select(id);
    constellationRef.current?.focus(id);
    panelFocusRef.current = fromPanel ? "inspector" : null;
  }

  function closeInspector() {
    select(null);
    panelFocusRef.current = "overview";
  }

  function resetView() {
    select(null);
    constellationRef.current?.resetView();
  }

  async function exportPng() {
    if (exportState === "pending") return;
    setExportState("pending");
    const succeeded = (await constellationRef.current?.exportPng(repositoryFullName)) ?? false;
    setExportState(succeeded ? "idle" : "error");
  }

  useEffect(() => {
    const target = panelFocusRef.current;
    if (target === null || (target === "inspector") !== (details !== null)) return;
    panelFocusRef.current = null;
    (target === "inspector" ? headingRef : overviewHeadingRef).current?.focus();
  }, [details]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      // Leaves impact mode first, then the selection on a second press.
      if (impactActive) setImpact(false);
      else select(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [select, setImpact, impactActive]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-md border border-line px-4 py-10 text-center text-sm text-muted">
        No supported source files were found.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <FileSearch index={index} visible={visibleIds} onPick={(id) => jumpTo(id)} onEscape={() => select(null)} />
        <GraphFilters
          filters={filters}
          onChange={setFilters}
          directories={directories}
          visibleCount={counts.visible}
          totalCount={counts.total}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={exportPng}
            disabled={exportState === "pending"}
            aria-label={exportState === "error" ? "Export PNG failed, try again" : "Export PNG"}
            className="h-9 min-w-28 rounded-md px-3 text-sm text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportState === "pending" ? "Exporting…" : exportState === "error" ? "Export failed" : "Export PNG"}
          </button>
          <button
            type="button"
            onClick={resetView}
            className="h-9 rounded-md px-3 text-sm text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
          >
            Reset view
          </button>
        </div>
      </div>
      <div className="flex flex-col overflow-hidden rounded-md border border-line bg-surface lg:h-[min(72svh,880px)] lg:flex-row">
        <div className="relative h-[min(64svh,640px)] min-h-72 lg:h-auto lg:min-h-0 lg:flex-1">
          <Constellation
            ref={constellationRef}
            graph={graph}
            label={label}
            neighborhood={focus}
            impact={impact}
            visible={visibleIds}
            onSelect={select}
          />
        </div>
        {details !== null ? (
          <FileInspector
            details={details}
            impact={impactDetails}
            visible={visibleIds}
            headingRef={headingRef}
            onSelect={(id) => jumpTo(id, true)}
            onClose={closeInspector}
            onTraceImpact={() => setImpact(true)}
            onExitImpact={() => setImpact(false)}
          />
        ) : (
          <RepositoryOverview
            insights={insights}
            headingRef={overviewHeadingRef}
            onSelect={(id) => jumpTo(id, true)}
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
