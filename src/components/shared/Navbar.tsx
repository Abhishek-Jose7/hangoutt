import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export default function Navbar() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          {/* Mobile menu trigger could go here, but we use bottom nav for mobile */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-indigo-600 sm:text-2xl">Hangout</span>
          </Link>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Clerk user menu */}
          <UserButton 
            appearance={{
              elements: {
                userButtonAvatarBox: 'w-9 h-9 border border-slate-200',
              }
            }}
          />
        </div>
      </div>
    </header>
  );
}
