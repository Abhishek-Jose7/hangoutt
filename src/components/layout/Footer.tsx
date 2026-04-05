import React from "react";

export function Footer() {
  return (
    <footer className="px-6 py-12 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/90 backdrop-blur-sm">
      <div className="w-full max-w-[1200px] mx-auto">
        <div className="max-w-[760px] mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-xs">
              <span className="font-display font-bold">H</span>
            </div>
            <span className="font-display font-bold text-lg text-[var(--color-text-primary)]">
              Hangout.
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Smart AI Hangout Planner for fair travel, better plans, and cleaner group decisions.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-1.5">
           <p className="text-xs text-[var(--color-text-tertiary)] font-mono tracking-wide text-center">
             ROOM_SYNC: LIVE
           </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
