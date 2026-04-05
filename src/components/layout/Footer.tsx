export function Footer() {
  return (
    <footer className="py-6 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
      <div className="container-base flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] flex items-center justify-center text-white text-[10px]">
            <span className="font-display font-bold opacity-80">H</span>
          </div>
          <span className="font-sans font-medium text-[12px] text-[var(--color-text-secondary)]">
            Hangout © 2026
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)]">
          Constructed symmetrically. No empty spaces.
        </p>
      </div>
    </footer>
  );
}
