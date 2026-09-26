// The mark slot is reserved for a logo and hidden while empty.
export function ProductMark({ size = "small" }: { size?: "small" | "large" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span data-slot="mark" aria-hidden="true" className="empty:hidden" />
      <span
        className={
          size === "large"
            ? "text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
            : "text-sm font-semibold tracking-tight text-foreground"
        }
      >
        Codefield
      </span>
    </span>
  );
}
