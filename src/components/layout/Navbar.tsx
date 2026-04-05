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
    <header className="sticky top-0 z-50 bg-[rgba(10,10,12,0.85)] backdrop-blur-xl border-b border-[var(--color-border-subtle)]">
      <div className="container-base py-3 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center text-white transition-transform group-hover:scale-105">
            <span className="font-display font-bold text-sm leading-none">H</span>
          </div>
          <span className="font-display font-semibold text-[15px] tracking-tight hidden sm:block">
            Hangout.
          </span>
        </Link>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          {badge ? (
            <span className={`badge badge-${badge.type}`}>
              {badge.text}
            </span>
          ) : (
            <span className="hidden sm:inline-block text-[10px] uppercase font-mono tracking-widest text-[var(--color-text-tertiary)] border border-[var(--color-border-subtle)] px-3 py-1 rounded-full bg-[var(--color-bg-surface)]">
              Room Sync: Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {rightContent}
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-8 h-8 border border-[var(--color-border-default)] rounded-lg'
              }
            }}
          />
        </div>
      </div>
    </header>
  );
}
