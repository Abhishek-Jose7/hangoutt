export function Footer() {
  return (
    <footer className="relative py-8 border-t border-[rgba(220,20,60,0.16)] bg-[rgba(5,5,7,0.92)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(220,20,60,0.9)] to-transparent" />
      <div className="saas-shell flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-[linear-gradient(145deg,#111119,#1b1b25)] border border-[rgba(220,20,60,0.42)] flex items-center justify-center text-white text-[10px] shadow-[0_10px_24px_rgba(0,0,0,0.45)]">
            <span className="font-display tracking-[0.08em]">HU</span>
          </div>
          <span className="font-sans font-medium text-[12px] text-[var(--color-text-secondary)] tracking-wide">
            Hangout © 2026
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-mono">
          Black Scarlet Protocol: Plan. Vote. Confirm.
        </p>
      </div>
    </footer>
  );
}
