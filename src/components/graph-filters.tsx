"use client";

import { useId } from "react";

import {
  ALL_DIRECTORIES,
  activeFilterCount,
  DEFAULT_FILTERS,
  type ConnectivityFilter,
  type FilterState,
  type LanguageFilter,
} from "@/lib/visualization/filters";

type GraphFiltersProps = {
  filters: FilterState;
  onChange(filters: FilterState): void;
  // Directory paths present in the graph, sorted with the repository root
  // ("") first.
  directories: string[];
  visibleCount: number;
  totalCount: number;
};

const selectClass =
  "h-9 rounded-md border border-line bg-surface px-2 text-sm text-foreground transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-2 focus:outline-foreground/40";

export function GraphFilters({ filters, onChange, directories, visibleCount, totalCount }: GraphFiltersProps) {
  const languageId = useId();
  const directoryId = useId();
  const connectivityId = useId();
  const degreeId = useId();
  const active = activeFilterCount(filters);

  function update(partial: Partial<FilterState>) {
    onChange({ ...filters, ...partial });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div>
        <label htmlFor={languageId} className="sr-only">
          Language
        </label>
        <select
          id={languageId}
          value={filters.language}
          onChange={(event) => update({ language: event.target.value as LanguageFilter })}
          className={selectClass}
        >
          <option value="all">All languages</option>
          <option value="typescript">TypeScript</option>
          <option value="javascript">JavaScript</option>
        </select>
      </div>

      <div>
        <label htmlFor={directoryId} className="sr-only">
          Directory
        </label>
        <select
          id={directoryId}
          value={filters.directory}
          onChange={(event) => update({ directory: event.target.value })}
          className={`${selectClass} max-w-40`}
        >
          <option value={ALL_DIRECTORIES}>All directories</option>
          {directories.map((directory) => (
            <option key={directory === "" ? "\0root" : directory} value={directory}>
              {directory === "" ? "Repository root" : directory}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={connectivityId} className="sr-only">
          Connectivity
        </label>
        <select
          id={connectivityId}
          value={filters.connectivity}
          onChange={(event) => update({ connectivity: event.target.value as ConnectivityFilter })}
          className={selectClass}
        >
          <option value="all">All files</option>
          <option value="connected">Connected only</option>
          <option value="isolated">Isolated only</option>
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor={degreeId} className="text-xs text-subtle">
          Min degree
        </label>
        <input
          id={degreeId}
          type="number"
          min={0}
          inputMode="numeric"
          value={filters.minDegree}
          onChange={(event) => {
            const value = Number(event.target.value);
            update({ minDegree: Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0 });
          }}
          className={`${selectClass} w-16 px-2`}
        />
      </div>

      {active > 0 && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="h-9 shrink-0 rounded-md px-2 text-sm text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
        >
          Reset filters
        </button>
      )}

      <p aria-live="polite" className="text-xs text-subtle tabular-nums">
        {visibleCount.toLocaleString("en-US")} / {totalCount.toLocaleString("en-US")} files visible
      </p>
    </div>
  );
}
