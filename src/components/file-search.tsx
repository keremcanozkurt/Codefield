"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { searchFiles, type GraphIndex } from "@/lib/visualization/inspection";

type FileSearchProps = {
  index: GraphIndex;
  onPick(id: string): void;
  // Escape with nothing left to close or clear.
  onEscape(): void;
};

export function FileSearch({ index, onPick, onEscape }: FileSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputId = useId();
  const resultsId = useId();

  const results = useMemo(() => searchFiles(index, query), [index, query]);
  const showResults = open && query.trim() !== "";

  function pick(id: string) {
    onPick(id);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActive((current) => (current + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      const result = showResults ? results[active] : undefined;
      if (result === undefined) return;
      event.preventDefault();
      pick(result.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (showResults) setOpen(false);
      else if (query !== "") setQuery("");
      else onEscape();
    }
  }

  return (
    <div className="relative w-full sm:max-w-sm">
      <label htmlFor={inputId} className="sr-only">
        Find a file
      </label>
      <input
        id={inputId}
        type="text"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Find a file"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={resultsId}
        aria-expanded={showResults}
        className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-2 focus:outline-foreground/40"
      />
      <div
        id={resultsId}
        hidden={!showResults}
        className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-line-strong bg-surface py-1"
      >
        {results.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted">No files match.</p>
        ) : (
          <ul>
            {results.map((result, i) => (
              <li key={result.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  // Keeps focus in the input, so blur does not close the list first.
                  onMouseDown={(event) => event.preventDefault()}
                  // Not onMouseEnter: a list opening under a resting pointer would move
                  // the highlight away from the first result.
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(result.id)}
                  className={`flex w-full min-w-0 items-baseline gap-2 px-3 py-1.5 text-left ${
                    i === active ? "bg-foreground/[0.07]" : ""
                  }`}
                >
                  <span className="shrink-0 font-mono text-[13px] text-foreground">{result.name}</span>
                  <span className="truncate font-mono text-xs text-subtle">{result.directory}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {showResults ? `${results.length} ${results.length === 1 ? "file" : "files"} shown` : ""}
      </p>
    </div>
  );
}
