export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16 sm:px-8">
      <div className="w-full max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Codefield
        </h1>
        <p className="mt-3 max-w-md text-base leading-relaxed text-muted sm:text-lg">
          Turn a public GitHub repository into an interactive map of its code.
        </p>

        <form className="mt-10 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="repository-url" className="sr-only">
            GitHub repository URL
          </label>
          <input
            id="repository-url"
            name="repository"
            type="url"
            placeholder="https://github.com/owner/repository"
            autoComplete="off"
            spellCheck={false}
            className="h-11 min-w-0 rounded-md border border-line bg-surface px-3.5 text-base sm:flex-1 sm:text-[15px] text-foreground placeholder:text-subtle transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-2 focus:outline-foreground/40"
          />
          {/* Disabled until repository analysis exists; a disabled default button also blocks Enter-key submission. */}
          <button
            type="submit"
            disabled
            className="h-11 shrink-0 rounded-md bg-foreground px-4 text-base sm:text-[15px] font-medium text-background transition-colors duration-150 enabled:hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60 disabled:cursor-not-allowed disabled:bg-foreground/35 disabled:text-background/80"
          >
            Generate constellation
          </button>
        </form>
      </div>
    </main>
  );
}
