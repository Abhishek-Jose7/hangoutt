import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

interface NavbarProps {
  badge?: {
    text: string;
    type: 'accent' | 'warning' | 'info' | 'success' | 'danger';
  };
  rightContent?: React.ReactNode;
}

export function Navbar({ badge, rightContent }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border-subtle)] bg-[rgba(7,7,8,0.86)] backdrop-blur-xl">
      <div className="w-full max-w-[1240px] mx-auto px-6 py-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-2 group justify-self-start">
          <div className="w-8 h-8 rounded-xl bg-[var(--color-accent)] flex items-center justify-center text-white transition-transform group-hover:scale-105">
            <span className="font-display font-bold text-sm leading-none">H</span>
          </div>
          <span className="font-display font-semibold text-lg tracking-tight text-[var(--color-text-primary)]">
            Hangout.
          </span>
        </Link>

        <div className="justify-self-center">
          {badge && (
            <span className={`badge badge-${badge.type} inline-flex`}>
              {badge.text}
            </span>
          )}
          {!badge && (
            <span className="hidden md:inline-flex text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
              Smart AI Hangout Planner
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 justify-self-end">
          {rightContent}
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-9 h-9 border border-[var(--color-border-default)]'
              }
            }}
          />
        </div>
      </div>
    </header>
  );
}
