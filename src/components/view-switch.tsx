"use client";

import { useRef, type KeyboardEvent } from "react";

import type { WorkspaceView } from "@/lib/visualization/workspace";

const VIEWS: { view: WorkspaceView; label: string; hint: string }[] = [
  { view: "graph", label: "Graph", hint: "How the files depend on each other" },
  { view: "structure", label: "Structure", hint: "Where the files and directories are" },
];

export function ViewSwitch({
  view,
  onChange,
  panelId,
}: {
  view: WorkspaceView;
  onChange(view: WorkspaceView): void;
  panelId(view: WorkspaceView): string;
}) {
  const refs = useRef<Partial<Record<WorkspaceView, HTMLButtonElement | null>>>({});

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const position = VIEWS.findIndex((entry) => entry.view === view);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? VIEWS.length - 1
          : (position + (event.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
    onChange(VIEWS[next].view);
    refs.current[VIEWS[next].view]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="View"
      onKeyDown={handleKeyDown}
      className="flex h-9 shrink-0 items-center rounded-md border border-line bg-surface p-0.5"
    >
      {VIEWS.map((entry) => {
        const selected = entry.view === view;
        return (
          <button
            key={entry.view}
            ref={(element) => {
              refs.current[entry.view] = element;
            }}
            type="button"
            role="tab"
            id={`${panelId(entry.view)}-tab`}
            aria-selected={selected}
            aria-controls={panelId(entry.view)}
            tabIndex={selected ? 0 : -1}
            title={entry.hint}
            onClick={() => onChange(entry.view)}
            className="h-full rounded-[5px] px-3 text-sm text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40 aria-selected:bg-foreground/[0.09] aria-selected:text-foreground"
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
