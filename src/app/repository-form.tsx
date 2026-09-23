"use client";

import { useState, type FormEvent } from "react";

import { parseRepositoryUrl } from "@/lib/repository-url";

export function RepositoryForm() {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const result = parseRepositoryUrl(value);
  const isEmpty = value.trim() === "";
  const error = touched && !isEmpty && !result.ok ? result.error : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-10">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="repository-url" className="sr-only">
          GitHub repository URL
        </label>
        <input
          id="repository-url"
          name="repository"
          type="url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="https://github.com/owner/repository"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby="repository-url-error"
          className="h-11 min-w-0 rounded-md border border-line bg-surface px-3.5 text-base sm:flex-1 sm:text-[15px] text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-2 focus:outline-foreground/40 aria-invalid:border-danger/60 aria-invalid:hover:border-danger/60 aria-invalid:focus:border-danger/60"
        />
        <button
          type="submit"
          disabled={!result.ok}
          className="h-11 shrink-0 rounded-md bg-foreground px-4 text-base sm:text-[15px] font-medium text-background transition-colors duration-150 enabled:hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60 disabled:cursor-not-allowed disabled:bg-foreground/35 disabled:text-background/80"
        >
          Generate constellation
        </button>
      </div>
      {/* Kept mounted with a reserved line so the live region announces changes and the layout does not shift. */}
      <p
        id="repository-url-error"
        aria-live="polite"
        className="mt-2 min-h-5 text-sm text-danger"
      >
        {error}
      </p>
    </form>
  );
}
