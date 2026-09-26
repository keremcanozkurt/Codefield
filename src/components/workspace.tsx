"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Constellation, type ConstellationHandle } from "@/components/constellation";
import { FileInspector } from "@/components/file-inspector";
import { FileSearch } from "@/components/file-search";
import { GraphFilters } from "@/components/graph-filters";
import { HelpLinks } from "@/components/help-links";
import { ProductMark } from "@/components/product-mark";
import { RepositoryOverview } from "@/components/repository-overview";
import { StructureView } from "@/components/structure-view";
import { ViewSwitch } from "@/components/view-switch";
import { deriveRepositoryInsights } from "@/lib/graph/insights";
import {
  DEFAULT_FILTERS,
  directoryOptions,
  filterCounts,
  languageOptions,
  resolveSelection,
  visibleNodeIds,
  type FilterState,
} from "@/lib/visualization/filters";
import { describeImpact, traceImpact } from "@/lib/visualization/impact";
import { buildGraphIndex, describeFile, neighborhood, selectionFor } from "@/lib/visualization/inspection";
import { describePath, findPath, pathView } from "@/lib/visualization/path";
import {
  carrySelection,
  escapeSelection,
  exitPathFinding,
  reversePath,
  selectFile,
  setImpactMode,
  startPathFinding,
  type Selection,
} from "@/lib/visualization/selection";
import { buildStructureTree, survivingFocus, trail, visibleFileCounts } from "@/lib/visualization/structure";
import type { RenderGraph } from "@/lib/visualization/types";
import { escapeTarget, structureFocusFor, type WorkspaceView } from "@/lib/visualization/workspace";

type WorkspaceProps = {
  graph: RenderGraph;
  label: string;
  repositoryName: string;
};

// Idle also covers a just-finished export: the button reverts once its
// "Exporting…" state clears, rather than staying in a separate "done" state.
type ExportState = "idle" | "pending" | "error";

type SelectionUpdate = (current: Selection<RenderGraph> | null) => Selection<RenderGraph> | null;

// A new analysis replaces `graph`; the selection, the Structure location and
// the filters carry over where the files still exist.
export function Workspace({ graph, label, repositoryName }: WorkspaceProps) {
  const index = useMemo(() => buildGraphIndex(graph), [graph]);
  const tree = useMemo(() => buildStructureTree(graph), [graph]);
  const [storedSelection, setSelection] = useState<Selection<RenderGraph> | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [view, setView] = useState<WorkspaceView>("graph");
  const [storedFocus, setStoredFocus] = useState("");
  const [immersive, setImmersive] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; seq: number } | null>(null);
  const idPrefix = useId();
  const panelId = (which: WorkspaceView) => `${idPrefix}-${which}`;

  const exists = useCallback((id: string) => index.nodeById.has(id), [index]);
  const selection = carrySelection(storedSelection, graph, exists);
  const update = useCallback(
    (change: SelectionUpdate) => setSelection((current) => change(carrySelection(current, graph, exists))),
    [graph, exists],
  );

  const rawSelected = selection === null ? null : selectionFor(index, selection.id);
  // Filters only affect what is shown: the graph, its metrics and the
  // repository overview are computed from the full, unfiltered data.
  const visibleIds = useMemo(() => visibleNodeIds(index, filters), [index, filters]);
  // A file a filter hides resolves to no selection: the inspector never stays
  // open for a node the graph is not currently showing.
  const selected = resolveSelection(rawSelected, visibleIds);
  const focus = useMemo(() => neighborhood(index, selected), [index, selected]);
  const details = useMemo(() => describeFile(index, selected), [index, selected]);
  const mode = selected !== null && selection !== null ? selection.mode : ({ type: "none" } as const);
  const impactActive = mode.type === "impact";
  // Traced over the full graph: filters only decide which affected files show.
  const impact = useMemo(() => (impactActive ? traceImpact(index, selected) : null), [index, selected, impactActive]);
  const impactDetails = useMemo(
    () => (impact === null ? null : describeImpact(index, impact, visibleIds)),
    [index, impact, visibleIds],
  );
  // Also traced over the full graph, so a path through hidden files is still
  // found; the inspector says how many of its files are hidden.
  const pathTarget = mode.type === "path" ? mode.target : null;
  const pathResult = useMemo(() => findPath(index, selected, pathTarget), [index, selected, pathTarget]);
  const pathDisplay = useMemo(() => (pathResult === null ? null : pathView(pathResult)), [pathResult]);
  const pathDetails = useMemo(
    () => (pathResult === null ? null : describePath(index, pathResult, visibleIds)),
    [index, pathResult, visibleIds],
  );
  const insights = useMemo(() => deriveRepositoryInsights(graph), [graph]);
  const directories = useMemo(() => directoryOptions(index), [index]);
  const languages = useMemo(() => languageOptions(index), [index]);
  const counts = useMemo(() => filterCounts(index, visibleIds), [index, visibleIds]);
  const visibleCounts = useMemo(() => visibleFileCounts(tree, visibleIds), [tree, visibleIds]);
  const structureFocus = survivingFocus(tree, storedFocus);

  const constellationRef = useRef<ConstellationHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
  // Where keyboard focus should go after the side panel changes, since the
  // button that caused the change is no longer rendered.
  const panelFocusRef = useRef<"inspector" | "overview" | null>(null);

  const select = useCallback((id: string | null) => update((current) => selectFile(current, graph, id)), [update, graph]);

  function revealInStructure(id: string) {
    const directory = tree.fileDirectory.get(id);
    if (directory !== undefined) setStoredFocus(directory);
    setReveal((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
  }

  function jumpTo(id: string, fromPanel = false) {
    select(id);
    if (view === "graph") constellationRef.current?.focus(id);
    else revealInStructure(id);
    panelFocusRef.current = fromPanel ? "inspector" : null;
  }

  function switchView(next: WorkspaceView) {
    if (next === view) return;
    if (next === "structure") {
      setStoredFocus(structureFocusFor(tree, selected, storedFocus));
      if (selected !== null) setReveal((current) => ({ id: selected, seq: (current?.seq ?? 0) + 1 }));
    }
    setView(next);
  }

  function showInGraph(id: string) {
    setView("graph");
    constellationRef.current?.focus(id);
  }

  function showInStructure(id: string) {
    revealInStructure(id);
    setView("structure");
  }

  // Impact Mode and Path Finder draw on the graph; started from Structure,
  // they switch to it instead of being drawn a second way.
  function startMode(change: SelectionUpdate) {
    update(change);
    if (view === "structure" && selected !== null) showInGraph(selected);
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
    const succeeded = (await constellationRef.current?.exportPng(repositoryName)) ?? false;
    setExportState(succeeded ? "idle" : "error");
  }

  // Full screen covers the page with the workspace, and also asks the browser
  // for real full screen where it allows it. Without the Fullscreen API, or if
  // the request is refused, the in-page layout alone is used.
  const setFullScreen = useCallback((on: boolean) => {
    setImmersive(on);
    const element = workspaceRef.current;
    if (on && element?.requestFullscreen !== undefined && document.fullscreenElement === null) {
      element.requestFullscreen().catch(() => {});
    } else if (!on && document.fullscreenElement !== null) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleEscape = useCallback(() => {
    const target = escapeTarget({ immersive, mode: mode.type, hasSelection: selected !== null });
    if (target === "immersive") setFullScreen(false);
    else if (target !== null) update((current) => escapeSelection(current));
  }, [immersive, mode.type, selected, update, setFullScreen]);

  const goUp = useCallback(() => {
    const steps = trail(tree, structureFocus);
    if (steps.length > 1) setStoredFocus(steps[steps.length - 2].path);
  }, [tree, structureFocus]);

  useEffect(() => {
    const target = panelFocusRef.current;
    if (target === null || (target === "inspector") !== (details !== null)) return;
    panelFocusRef.current = null;
    (target === "inspector" ? headingRef : overviewHeadingRef).current?.focus();
  }, [details]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditable(event.target)) return;
      if (event.key === "Escape") {
        handleEscape();
      } else if (view === "structure" && (event.key === "Backspace" || (event.altKey && event.key === "ArrowLeft"))) {
        event.preventDefault();
        goUp();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleEscape, goUp, view]);

  // The browser leaves real full screen on its own (Escape, F11); the page
  // follows it out.
  useEffect(() => {
    function handleChange() {
      if (document.fullscreenElement === null) setImmersive(false);
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [immersive]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-md border border-line px-4 py-10 text-center text-sm text-muted">
        No supported source files were found.
      </p>
    );
  }

  const inStructure = view === "structure";

  return (
    <div
      ref={workspaceRef}
      className={immersive ? "fixed inset-0 z-50 flex flex-col bg-background px-5 pt-3 pb-5" : undefined}
    >
      {immersive && (
        <div className="mb-3 flex items-center gap-3">
          <ProductMark />
          <span className="truncate font-mono text-sm text-muted">{repositoryName}</span>
          <div className="ml-auto">
            <HelpLinks />
          </div>
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ViewSwitch view={view} onChange={switchView} panelId={panelId} />
        <FileSearch index={index} visible={visibleIds} onPick={(id) => jumpTo(id)} onEscape={handleEscape} />
        <GraphFilters
          filters={filters}
          onChange={setFilters}
          directories={directories}
          languages={languages}
          visibleCount={counts.visible}
          totalCount={counts.total}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!inStructure && (
            <>
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
            </>
          )}
          {(immersive || !inStructure) && (
            <button
              type="button"
              onClick={() => setFullScreen(!immersive)}
              aria-pressed={immersive}
              className="h-9 rounded-md px-3 text-sm text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
            >
              {immersive ? "Exit full screen" : "Full screen"}
            </button>
          )}
        </div>
      </div>
      <div
        className={`flex flex-col overflow-hidden rounded-md border border-line bg-surface lg:flex-row ${
          immersive ? "min-h-0 flex-1" : "lg:h-[min(72svh,880px)]"
        }`}
      >
        <div
          className={`relative min-h-72 lg:min-h-0 lg:flex-1 ${immersive ? "min-h-0 flex-1" : "h-[min(64svh,640px)] lg:h-auto"}`}
        >
          {/* The graph stays mounted in Structure, hidden but laid out, so switching back is instant and keeps the camera. */}
          <div
            id={panelId("graph")}
            role="tabpanel"
            aria-labelledby={`${panelId("graph")}-tab`}
            inert={inStructure}
            className={inStructure ? "invisible absolute inset-0" : "absolute inset-0"}
          >
            <Constellation
              ref={constellationRef}
              graph={graph}
              label={label}
              neighborhood={focus}
              impact={impact}
              path={pathDisplay}
              visible={visibleIds}
              onSelect={select}
            />
          </div>
          <div
            id={panelId("structure")}
            role="tabpanel"
            aria-labelledby={`${panelId("structure")}-tab`}
            hidden={!inStructure}
          >
            {inStructure && (
              <StructureView
                tree={tree}
                index={index}
                repositoryName={repositoryName}
                focus={structureFocus}
                selected={selected}
                visible={visibleIds}
                visibleCounts={visibleCounts}
                reveal={reveal}
                immersive={immersive}
                onNavigate={setStoredFocus}
                onSelect={select}
                onToggleImmersive={() => setFullScreen(!immersive)}
              />
            )}
          </div>
        </div>
        {details !== null ? (
          <FileInspector
            details={details}
            impact={impactDetails}
            path={mode.type === "choosingPath" ? "choosing" : pathDetails}
            visible={visibleIds}
            headingRef={headingRef}
            modesOpenGraph={inStructure}
            crossView={
              inStructure
                ? { label: "Show in graph", onClick: () => showInGraph(details.id) }
                : { label: "Show in structure", onClick: () => showInStructure(details.id) }
            }
            onSelect={(id) => jumpTo(id, true)}
            onClose={closeInspector}
            onTraceImpact={() => startMode((current) => setImpactMode(current, true))}
            onExitImpact={() => update((current) => setImpactMode(current, false))}
            onFindPath={() => startMode((current) => startPathFinding(current))}
            onExitPath={() => update((current) => exitPathFinding(current))}
            onReversePath={() => update((current) => reversePath(current))}
          />
        ) : (
          <RepositoryOverview
            insights={insights}
            headingRef={overviewHeadingRef}
            onSelect={(id) => jumpTo(id, true)}
          />
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {immersive ? "Full screen" : ""}
      </p>
    </div>
  );
}

// Keys typed into a field, or inside a dialog such as the FAQ, are not
// workspace shortcuts.
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("dialog") !== null
  );
}
