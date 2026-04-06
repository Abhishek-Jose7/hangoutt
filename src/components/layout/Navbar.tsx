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
    <header className="sticky top-0 z-50 border-b border-[rgba(220,20,60,0.2)] bg-[rgba(6,6,8,0.86)] backdrop-blur-xl">
      <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-[rgba(220,20,60,0.78)] to-transparent" />
      <div className="saas-shell py-3 flex items-center justify-between gap-4 relative">
        <Link href="/dashboard" className="flex items-center gap-3 group min-w-0">
          <div className="w-10 h-10 rounded-lg border border-[rgba(220,20,60,0.62)] bg-[linear-gradient(135deg,#0d0d12,#1a1a24)] flex items-center justify-center text-white transition-all group-hover:shadow-[0_0_0_2px_rgba(220,20,60,0.24)]">
            <span className="font-display text-[17px] tracking-[0.08em] leading-none">HU</span>
          </div>
          <div className="min-w-0">
            <p className="font-display font-semibold text-[14px] tracking-[0.03em] text-[var(--color-text-primary)] leading-none">Hangout</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)] mt-1 max-sm:hidden">Planning Command</p>
          </div>
        </Link>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center max-lg:hidden">
          {badge ? (
            <span className={`badge badge-${badge.type}`}>
              {badge.text}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-[10px] uppercase font-mono tracking-[0.14em] text-[var(--color-text-tertiary)] border border-[rgba(220,20,60,0.28)] px-3 py-1 rounded-full bg-[rgba(220,20,60,0.11)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-strong)]" />
              REPLAY SAFE: LIVE
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="btn-secondary h-9 px-3 text-xs max-sm:hidden">Dashboard</Link>
          <Link href="/rooms/create" className="btn-secondary h-9 px-3 text-xs max-sm:hidden">New Room</Link>
          {rightContent}
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-8 h-8 border border-[rgba(220,20,60,0.35)] rounded-md shadow-[0_10px_26px_rgba(0,0,0,0.45)]'
              }
            }}
          />
        </div>
      </div>
    </header>
  );
}
