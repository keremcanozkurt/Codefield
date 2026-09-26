"use client";

import { useId, useRef, type Ref } from "react";

import { FAQ, SUPPORT_NOTE, SUPPORT_URL } from "@/lib/product";

const linkClass =
  "rounded px-1.5 py-0.5 text-sm text-subtle transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40";

export function HelpLinks() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => dialogRef.current?.showModal()} className={linkClass}>
        FAQ
      </button>
      <a
        href={SUPPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={SUPPORT_NOTE}
        aria-label="Support Codefield (opens in a new tab)"
        className={linkClass}
      >
        Support
      </a>
      <FaqDialog ref={dialogRef} />
    </div>
  );
}

// Full screen renders a second copy of these links above the page header, so
// the title id has to be unique per instance.
function FaqDialog({ ref }: { ref: Ref<HTMLDialogElement> }) {
  const titleId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="m-auto max-h-[85svh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
        <h2 id={titleId} className="text-base font-semibold tracking-tight">
          Frequently asked questions
        </h2>
        <form method="dialog">
          <button
            type="submit"
            aria-label="Close"
            className="grid size-8 place-items-center rounded-md text-subtle transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </form>
      </div>
      <dl className="divide-y divide-line px-6">
        {FAQ.map((entry) => (
          <div key={entry.question} className="py-4">
            <dt className="text-sm font-medium text-foreground">{entry.question}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted">
              <WithCode text={entry.answer} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-6 py-4 text-xs text-subtle">
        {SUPPORT_NOTE}{" "}
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted underline decoration-line-strong underline-offset-2 hover:text-foreground"
        >
          support.codefield.dev
        </a>
      </p>
    </dialog>
  );
}

function WithCode({ text }: { text: string }) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[12.5px] text-foreground">
        {part}
      </code>
    ) : (
      part
    ),
  );
}
