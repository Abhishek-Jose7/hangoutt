import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export default function Navbar() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-bold uppercase tracking-widest font-heading text-foreground">
              Hang<span className="text-primary italic font-serif lowercase">out</span>
            </span>
          </Link>
        </div>
        
        <div className="flex items-center gap-4">
          <UserButton 
            appearance={{
              elements: {
                userButtonAvatarBox: 'w-9 h-9 border border-border rounded-none',
              }
            }}
          />
        </div>
      </div>
    </header>
  );
}
