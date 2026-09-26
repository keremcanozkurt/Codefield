"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { languageName } from "@/lib/languages/registry";
import type { GraphIndex } from "@/lib/visualization/inspection";
import { fileName, languageColors } from "@/lib/visualization/mapping";
import { childSteps, trail, type LanguageShare, type StructureStep, type StructureTree } from "@/lib/visualization/structure";

type StructureViewProps = {
  tree: StructureTree;
  index: GraphIndex;
  repositoryName: string;
  // The directory in focus, already canonical (see canonicalFocus).
  focus: string;
  selected: string | null;
  // Files passing the active filters, and their counts per directory; both
  // null when no filter is active.
  visible: Set<string> | null;
  visibleCounts: Map<string, number> | null;
  // Asks for a file to be scrolled into view; seq changes with every request.
  reveal: { id: string; seq: number } | null;
  immersive: boolean;
  onNavigate(path: string): void;
  onSelect(id: string): void;
  onToggleImmersive(): void;
};

// Up to this many subdirectories are laid out around the focus with
// connecting lines; more are shown as an even grid, which stays readable at
// any count.
const FAN_LIMIT = 16;
// Grids longer than this only render the rows in view.
const WINDOW_THRESHOLD = 200;
const SIBLINGS_PER_SIDE = 2;
const MOTION = { duration: 360, easing: "cubic-bezier(0.2, 0, 0, 1)" };

export function StructureView({
  tree,
  index,
  repositoryName,
  focus,
  selected,
  visible,
  visibleCounts,
  reveal,
  immersive,
  onNavigate,
  onSelect,
  onToggleImmersive,
}: StructureViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Positions of everything on screen just before a navigation, keyed by
  // what each element stands for, so the same directory can glide from where
  // it was to where it now is.
  const pendingRef = useRef<{ rects: Map<string, DOMRect>; focusHeading: boolean } | null>(null);
  const previousFocusRef = useRef(focus);

  const directory = tree.directories.get(focus)!;
  const steps = useMemo(() => trail(tree, focus), [tree, focus]);
  const current = steps[steps.length - 1];
  const parent = steps.length > 1 ? steps[steps.length - 2] : null;
  const children = useMemo(() => childSteps(tree, focus), [tree, focus]);
  const siblings = useMemo(() => (parent === null ? [] : childSteps(tree, parent.path)), [tree, parent]);
  const files = useMemo(
    () => (visible === null ? directory.files : directory.files.filter((id) => visible.has(id))),
    [directory, visible],
  );
  const hiddenFiles = directory.files.length - files.length;

  function navigate(path: string, { focusHeading = true } = {}) {
    if (path === focus) return;
    const rects = new Map<string, DOMRect>();
    stageRef.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) rects.set(element.dataset.flip!, rect);
    });
    pendingRef.current = { rects, focusHeading };
    onNavigate(path);
  }

  useLayoutEffect(() => {
    if (previousFocusRef.current === focus) return;
    previousFocusRef.current = focus;
    const pending = pendingRef.current;
    pendingRef.current = null;
    const stage = stageRef.current;
    if (stage === null) return;
    stage.scrollTop = 0;
    if (pending?.focusHeading) headingRef.current?.focus({ preventScroll: true });
    if (prefersReducedMotion()) return;
    if (pending === null) {
      contentRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
      return;
    }
    animateLayout(stage, pending.rects);
  }, [focus]);

  const counts = directoryCounts(tree, focus, visibleCounts);
  const label = focus === "" ? repositoryName : current.label;

  return (
    <div className="@container absolute inset-0 flex flex-col bg-surface">
      <div className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2">
        <Breadcrumbs steps={steps} repositoryName={repositoryName} onNavigate={(path) => navigate(path)} />
        <button
          type="button"
          onClick={onToggleImmersive}
          aria-pressed={immersive}
          aria-label={immersive ? "Exit full screen" : "Full screen"}
          title={immersive ? "Exit full screen (Esc)" : "Full screen"}
          className="ml-auto grid size-8 shrink-0 place-items-center rounded-md text-subtle transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
        >
          <FullScreenIcon exit={immersive} />
        </button>
      </div>

      <div
        ref={stageRef}
        data-structure-stage=""
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onKeyDown={(event) => moveBetweenItems(event, stageRef)}
      >
        <div ref={contentRef} data-structure-content="" className="relative mx-auto w-full max-w-5xl px-6 pt-10 pb-20 @3xl:px-10 @3xl:pt-14">
          <section aria-labelledby="structure-focus" className="relative">
            {parent !== null && (
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  data-flip={parent.path}
                  onClick={() => navigate(parent.path)}
                  title="Up one level (Backspace)"
                  className="max-w-full truncate rounded px-2 py-0.5 text-sm text-subtle transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
                >
                  <span className="sr-only">Up to </span>
                  {parent.path === "" ? repositoryName : lastSegment(parent.label)}
                </button>
                <span aria-hidden="true" className="h-5 w-px bg-line-strong" />
              </div>
            )}

            <div className="flex items-start justify-center gap-6">
              <Siblings steps={siblingsAround(siblings, focus, "before")} onNavigate={navigate} align="end" />
              <div className="min-w-0 max-w-full text-center">
                <h2
                  id="structure-focus"
                  ref={headingRef}
                  tabIndex={-1}
                  data-flip={focus}
                  className="inline-block max-w-full break-words text-[2rem] leading-tight font-semibold tracking-tight text-foreground focus:outline-none @3xl:text-[2.75rem]"
                >
                  <ChainLabel label={label} prefixClass="block text-base font-normal tracking-normal text-subtle" />
                </h2>
                <p className="mt-2 text-sm text-muted tabular-nums">{describeCounts(counts)}</p>
                <LanguageBar shares={directory.languages} className="mx-auto mt-3.5 w-28" />
              </div>
              <Siblings steps={siblingsAround(siblings, focus, "after")} onNavigate={navigate} align="start" />
            </div>
          </section>

          {children.length > 0 && (
            <Directories
              steps={children}
              tree={tree}
              visibleCounts={visibleCounts}
              focus={focus}
              onNavigate={navigate}
            />
          )}

          {directory.files.length > 0 && (
            <section aria-labelledby="structure-files" className={children.length > 0 ? "mt-16" : "mt-12"}>
              <div className="flex items-baseline gap-3 border-b border-line pb-2">
                <h3 id="structure-files" className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">
                  Files
                </h3>
                <span className="text-xs text-subtle tabular-nums">
                  {files.length.toLocaleString("en-US")}
                  {hiddenFiles > 0 && ` · ${hiddenFiles.toLocaleString("en-US")} hidden by filters`}
                </span>
              </div>
              {files.length === 0 ? (
                <p className="mt-4 text-sm text-subtle">The active filters hide every file in this directory.</p>
              ) : (
                <WindowedGrid
                  items={files}
                  getKey={(id) => id}
                  itemHeight={36}
                  rowGap={2}
                  minItemWidth={208}
                  reveal={reveal !== null && files.includes(reveal.id) ? { index: files.indexOf(reveal.id), seq: reveal.seq } : null}
                  className="mt-3"
                  renderItem={(id) => (
                    <FileItem id={id} index={index} selected={id === selected} onSelect={onSelect} />
                  )}
                />
              )}
            </section>
          )}
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {`${label}: ${describeCounts(counts)}`}
      </p>
    </div>
  );
}

type Counts = { directories: number; files: number; visibleFiles: number | null; edges: number };

function directoryCounts(tree: StructureTree, path: string, visibleCounts: Map<string, number> | null): Counts {
  const directory = tree.directories.get(path)!;
  return {
    directories: directory.directories.length,
    files: directory.fileCount,
    visibleFiles: visibleCounts?.get(path) ?? null,
    edges: directory.internalEdges,
  };
}

function describeCounts({ directories, files, visibleFiles, edges }: Counts): string {
  const parts = [];
  if (directories > 0) parts.push(plural(directories, "folder"));
  parts.push(visibleFiles === null ? plural(files, "file") : `${visibleFiles.toLocaleString("en-US")} of ${plural(files, "file")}`);
  if (edges > 0) parts.push(`${plural(edges, "internal edge")}`);
  return parts.join(" · ");
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : `${word}s`}`;
}

function siblingsAround(siblings: StructureStep[], focus: string, side: "before" | "after"): StructureStep[] {
  const position = siblings.findIndex((step) => step.path === focus);
  if (position === -1) return [];
  return side === "before"
    ? siblings.slice(Math.max(0, position - SIBLINGS_PER_SIDE), position)
    : siblings.slice(position + 1, position + 1 + SIBLINGS_PER_SIDE);
}

// Neighbouring directories at the focus's own level, kept faint at its sides
// as context. They only appear where there is room.
function Siblings({
  steps,
  onNavigate,
  align,
}: {
  steps: StructureStep[];
  onNavigate(path: string): void;
  align: "start" | "end";
}) {
  return (
    <div
      className={`hidden w-0 flex-1 items-center gap-4 pt-3 @3xl:flex @3xl:pt-4 ${align === "end" ? "justify-end" : "justify-start"}`}
    >
      {steps.map((step) => (
        <button
          key={step.path}
          type="button"
          data-flip={step.path}
          data-structure-item=""
          onClick={() => onNavigate(step.path)}
          title={step.label}
          className="max-w-36 truncate rounded px-1.5 py-0.5 text-sm text-subtle/80 transition-colors duration-150 hover:text-muted focus-visible:outline-2 focus-visible:outline-foreground/40"
        >
          {lastSegment(step.label)}
        </button>
      ))}
    </div>
  );
}

function Directories({
  steps,
  tree,
  visibleCounts,
  focus,
  onNavigate,
}: {
  steps: StructureStep[];
  tree: StructureTree;
  visibleCounts: Map<string, number> | null;
  focus: string;
  onNavigate(path: string): void;
}) {
  // When some names carry passed-through directories above them, every tile
  // keeps that line, so the names stay on one line across the row.
  const reservePrefix = steps.some((step) => step.label.includes("/"));
  const tile = (step: StructureStep, dense: boolean) => (
    <DirectoryTile
      step={step}
      tree={tree}
      visibleCounts={visibleCounts}
      dense={dense}
      reservePrefix={reservePrefix && !dense}
      onNavigate={onNavigate}
    />
  );

  if (steps.length <= FAN_LIMIT) {
    return (
      <section aria-label="Folders" className="relative mt-4">
        <Connectors focus={focus} count={steps.length} />
        <ul className="relative flex flex-wrap justify-center gap-x-3 gap-y-5 pt-12">
          {steps.map((step) => (
            <li key={step.path} data-connector-target="">
              {tile(step, false)}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-labelledby="structure-folders" className="mt-14">
      <div className="flex items-baseline gap-3 border-b border-line pb-2">
        <h3 id="structure-folders" className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">
          Folders
        </h3>
        <span className="text-xs text-subtle tabular-nums">{steps.length.toLocaleString("en-US")}</span>
      </div>
      <WindowedGrid
        items={steps}
        getKey={(step) => step.path}
        itemHeight={64}
        rowGap={4}
        minItemWidth={200}
        reveal={null}
        className="mt-3"
        renderItem={(step) => tile(step, true)}
      />
    </section>
  );
}

function DirectoryTile({
  step,
  tree,
  visibleCounts,
  dense,
  reservePrefix,
  onNavigate,
}: {
  step: StructureStep;
  tree: StructureTree;
  visibleCounts: Map<string, number> | null;
  dense: boolean;
  reservePrefix: boolean;
  onNavigate(path: string): void;
}) {
  const directory = tree.directories.get(step.path)!;
  const visibleFiles = visibleCounts?.get(step.path) ?? null;
  const allHidden = visibleFiles === 0;
  const files =
    visibleFiles === null ? plural(directory.fileCount, "file") : `${visibleFiles.toLocaleString("en-US")} of ${directory.fileCount.toLocaleString("en-US")}`;
  const folders = directory.directories.length > 0 ? ` · ${plural(directory.directories.length, "folder")}` : "";

  return (
    <button
      type="button"
      data-structure-item=""
      onClick={() => onNavigate(step.path)}
      title={step.label}
      className={`group block rounded-lg transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-foreground/40 ${
        dense ? "h-16 w-full px-3 py-2.5 text-left" : "w-44 px-3 py-3 text-center"
      } ${allHidden ? "opacity-45" : ""}`}
    >
      <span className="sr-only">Folder </span>
      {reservePrefix && !step.label.includes("/") && (
        <span aria-hidden="true" className="block text-[11px]">
          &nbsp;
        </span>
      )}
      <span
        data-flip={step.path}
        className={`block truncate font-medium text-foreground ${dense ? "text-[15px]" : "text-lg tracking-tight"}`}
      >
        <ChainLabel
          label={step.label}
          prefixClass={dense ? "font-normal text-subtle" : "block truncate text-[11px] font-normal text-subtle"}
        />
        <span aria-hidden="true" className="text-subtle">/</span>
      </span>
      <span className="mt-1 block truncate text-xs text-subtle tabular-nums">
        {files}
        {folders}
      </span>
      {!dense && <LanguageBar shares={directory.languages} className="mx-auto mt-2.5 w-14" decorative />}
    </button>
  );
}

// "src/main/java/com/acme" shows the passed-through directories quietly
// above the directory the step lands on.
function ChainLabel({ label, prefixClass }: { label: string; prefixClass: string }) {
  const slash = label.lastIndexOf("/");
  if (slash === -1) return <>{label}</>;
  return (
    <>
      <span className={prefixClass}>{label.slice(0, slash + 1)}</span>
      {label.slice(slash + 1)}
    </>
  );
}

function FileItem({
  id,
  index,
  selected,
  onSelect,
}: {
  id: string;
  index: GraphIndex;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const node = index.nodeById.get(id)!;
  const [red, green, blue] = languageColors(node.language).bright;
  const name = fileName(node.path);
  const dot = name.lastIndexOf(".");
  const references = node.incoming;
  return (
    <button
      type="button"
      data-flip={`file:${id}`}
      data-file-id={id}
      data-structure-item=""
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      title={`${node.path}\n${languageName(node.language)} · referenced by ${plural(references, "file")}`}
      className="group flex h-full w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left font-mono text-[13px] text-muted transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40 aria-pressed:bg-foreground/[0.08] aria-pressed:text-foreground"
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full opacity-60 transition-opacity duration-150 group-hover:opacity-90 group-aria-pressed:opacity-100"
        style={{ backgroundColor: `rgb(${red} ${green} ${blue})` }}
      />
      <span className="min-w-0 flex-1 truncate">
        {dot > 0 ? name.slice(0, dot) : name}
        {dot > 0 && <span className="text-subtle group-aria-pressed:text-muted">{name.slice(dot)}</span>}
      </span>
      <span className="sr-only">
        , {languageName(node.language)}, referenced by {plural(references, "file")}
      </span>
    </button>
  );
}

function LanguageBar({
  shares,
  className,
  decorative = false,
}: {
  shares: LanguageShare[];
  className: string;
  decorative?: boolean;
}) {
  const total = shares.reduce((sum, share) => sum + share.files, 0);
  if (total === 0) return null;
  const label = shares.map((share) => `${share.files.toLocaleString("en-US")} ${languageName(share.language)}`).join(", ");
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      className={`flex h-0.5 overflow-hidden rounded-full ${className}`}
    >
      {shares.map((share) => {
        const [red, green, blue] = languageColors(share.language).bright;
        return (
          <span
            key={share.language}
            style={{ width: `${(share.files / total) * 100}%`, backgroundColor: `rgb(${red} ${green} ${blue} / 0.45)` }}
          />
        );
      })}
    </span>
  );
}

// Thin curves from the focused directory to each subdirectory, measured from
// the laid-out elements and drawn straight into the SVG. They fade in after a
// navigation's movement settles.
function Connectors({ focus, count }: { focus: string; count: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    // Looked up from the SVG: an ancestor's ref is not attached yet when a
    // child's layout effect first runs.
    const svg = svgRef.current;
    const content = svg?.closest<HTMLElement>("[data-structure-content]") ?? null;
    if (content === null || svg === null) return;

    const measure = () => {
      const heading = content.querySelector<HTMLElement>("#structure-focus");
      const section = svg.parentElement;
      if (heading === null || section === null) return;
      // Layout offsets rather than bounding boxes: a resize can land while the
      // elements are still moving, and boxes include that movement.
      const origin = offsetWithin(section, content);
      const anchor = offsetWithin(heading, content);
      const fx = anchor.x + heading.offsetWidth / 2 - origin.x;
      const targets = [...content.querySelectorAll<HTMLElement>("[data-connector-target]")].map((target) => {
        const offset = offsetWithin(target, content);
        return { x: offset.x + target.offsetWidth / 2 - origin.x, y: offset.y - origin.y };
      });
      const path = (d: string) => {
        const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
        element.setAttribute("d", d);
        return element;
      };
      // One curve per subdirectory while they fit on one row; once they wrap,
      // curves would cross the rows, so a single stem leads into the group.
      const rows = new Set(targets.map((target) => Math.round(target.y)));
      const paths =
        rows.size === 1
          ? targets.map(({ x, y }) => {
              const bend = y * 0.55;
              return path(`M ${fx} 0 C ${fx} ${bend}, ${x} ${y - bend}, ${x} ${y}`);
            })
          : [path(`M ${fx} 0 L ${fx} ${Math.max(0, (targets[0]?.y ?? 0) - 12)}`)];
      svg.replaceChildren(...paths);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [focus, count]);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    svgRef.current?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], {
      duration: 600,
      easing: "ease-out",
    });
  }, [focus]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      className="pointer-events-none absolute inset-x-0 top-0 h-full w-full overflow-visible text-line-strong"
    />
  );
}

// An element's layout position inside a positioned ancestor, ignoring any
// transform currently applied to it or its ancestors.
function offsetWithin(element: HTMLElement, container: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let current: HTMLElement | null = element; current !== null && current !== container; ) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function Breadcrumbs({
  steps,
  repositoryName,
  onNavigate,
}: {
  steps: StructureStep[];
  repositoryName: string;
  onNavigate(path: string): void;
}) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const last = steps[steps.length - 1].path;
  // Long trails keep the root and the last three steps; the button between
  // them shows the rest in place.
  const collapsed = steps.length > 5 && expandedFor !== last;
  const shown = collapsed ? [steps[0], null, ...steps.slice(-3)] : steps;

  return (
    <nav aria-label="Location in repository" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
        {shown.map((step, i) => (
          <li key={step?.path ?? "collapsed"} className="flex min-w-0 items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="text-line-strong">
                /
              </span>
            )}
            {step === null ? (
              <button
                type="button"
                onClick={() => setExpandedFor(last)}
                aria-label={`Show ${steps.length - 4} more folders`}
                className="rounded px-1.5 py-0.5 text-subtle transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
              >
                …
              </button>
            ) : step.path === last ? (
              <span aria-current="location" className="truncate px-1.5 py-0.5 font-medium text-foreground">
                {step.path === "" ? repositoryName : step.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(step.path)}
                className="truncate rounded px-1.5 py-0.5 text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
              >
                {step.path === "" ? repositoryName : step.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

type WindowedGridProps<T> = {
  items: T[];
  getKey(item: T): string;
  renderItem(item: T): ReactNode;
  itemHeight: number;
  rowGap: number;
  minItemWidth: number;
  reveal: { index: number; seq: number } | null;
  className: string;
};

const COLUMN_GAP = 12;
const OVERSCAN_ROWS = 6;

// A grid of fixed-height cells. Short grids render every cell; long ones only
// render the rows near the visible part of the stage, so a directory with
// thousands of files stays as light as one with twenty.
function WindowedGrid<T>({
  items,
  getKey,
  renderItem,
  itemHeight,
  rowGap,
  minItemWidth,
  reveal,
  className,
}: WindowedGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [range, setRange] = useState<[number, number]>([0, 30]);
  const windowed = items.length > WINDOW_THRESHOLD;
  const pitch = itemHeight + rowGap;
  const rows = Math.ceil(items.length / columns);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const stage = grid?.closest<HTMLElement>("[data-structure-stage]") ?? null;
    if (!windowed || grid === null || stage === null) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const nextColumns = columnCount(grid.clientWidth, minItemWidth);
      const top = stage.getBoundingClientRect().top - grid.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(top / pitch) - OVERSCAN_ROWS);
      const last = Math.ceil((top + stage.clientHeight) / pitch) + OVERSCAN_ROWS;
      setColumns(nextColumns);
      setRange((current) => (current[0] === first && current[1] === last ? current : [first, last]));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    observer.observe(stage);
    stage.addEventListener("scroll", schedule, { passive: true });
    return () => {
      observer.disconnect();
      stage.removeEventListener("scroll", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [windowed, pitch, minItemWidth]);

  useEffect(() => {
    if (reveal === null) return;
    const grid = gridRef.current;
    const stage = grid?.closest<HTMLElement>("[data-structure-stage]") ?? null;
    if (grid === null || stage === null) return;
    if (!windowed) {
      grid.querySelectorAll("li")[reveal.index]?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
      return;
    }
    const row = Math.floor(reveal.index / columnCount(grid.clientWidth, minItemWidth));
    const rowTop = grid.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop + row * pitch;
    if (rowTop < stage.scrollTop || rowTop + itemHeight > stage.scrollTop + stage.clientHeight) {
      stage.scrollTo({ top: rowTop - stage.clientHeight / 2 + itemHeight / 2, behavior: scrollBehavior() });
    }
    // Only a new request scrolls; layout changes on their own do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  if (!windowed) {
    return (
      <div ref={gridRef} className={className}>
        <ul
          className="grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`,
            gridAutoRows: itemHeight,
            rowGap,
            columnGap: COLUMN_GAP,
          }}
        >
          {items.map((item) => (
            <li key={getKey(item)} className="min-w-0">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const firstRow = Math.min(range[0], rows);
  const lastRow = Math.min(range[1], rows);
  return (
    <div
      ref={gridRef}
      className={className}
      style={{ height: rows * pitch, paddingTop: firstRow * pitch, boxSizing: "border-box" }}
    >
      <ul
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: itemHeight,
          rowGap,
          columnGap: COLUMN_GAP,
        }}
      >
        {items.slice(firstRow * columns, lastRow * columns).map((item) => (
          <li key={getKey(item)} className="min-w-0">
            {renderItem(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The number of columns CSS's auto-fill would make at this width.
function columnCount(width: number, minItemWidth: number): number {
  return Math.max(1, Math.floor((width + COLUMN_GAP) / (minItemWidth + COLUMN_GAP)));
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

// Arrow keys move between the items on the stage in reading order.
function moveBetweenItems(event: KeyboardEvent<HTMLDivElement>, stageRef: RefObject<HTMLDivElement | null>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined || event.altKey || event.metaKey || event.ctrlKey) return;
  const target = event.target as HTMLElement;
  if (!target.hasAttribute("data-structure-item")) return;
  // Items hidden for lack of room have no boxes and are skipped.
  const items = [...(stageRef.current?.querySelectorAll<HTMLElement>("[data-structure-item]") ?? [])].filter(
    (item) => item.getClientRects().length > 0,
  );
  const next = items[items.indexOf(target) + step];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
}

function lastSegment(label: string): string {
  return label.slice(label.lastIndexOf("/") + 1);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Moves each element that existed before the navigation from its old place
// and size to its new one; elements that are new fade in, the first few a
// little after each other.
function animateLayout(stage: HTMLElement, before: Map<string, DOMRect>) {
  const viewport = stage.getBoundingClientRect();
  let entering = 0;
  stage.querySelectorAll<HTMLElement>("[data-flip]").forEach((element) => {
    const after = element.getBoundingClientRect();
    if (after.width === 0 || after.bottom < viewport.top || after.top > viewport.bottom) return;
    const previous = before.get(element.dataset.flip!);
    if (previous === undefined) {
      element.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
        duration: 260,
        delay: 120 + Math.min(entering++, 12) * 18,
        easing: "ease-out",
        fill: "backwards",
      });
      return;
    }
    // Anchored at the top centre: labels are centred in some places and not
    // others, and their centres line up where their left edges do not.
    const dx = previous.left + previous.width / 2 - (after.left + after.width / 2);
    const dy = previous.top - after.top;
    const scale = previous.height / after.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) return;
    element.animate(
      [
        { transformOrigin: "50% 0", transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transformOrigin: "50% 0", transform: "none" },
      ],
      MOTION,
    );
  });
}

function FullScreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      {exit ? (
        <path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" />
      ) : (
        <path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" />
      )}
    </svg>
  );
}
