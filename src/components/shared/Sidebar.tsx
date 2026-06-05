'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, History, User, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Sidebar() {
  const pathname = usePathname();

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Groups', href: '/groups', icon: Users },
    { name: 'History', href: '/history', icon: History },
    { name: 'Profile', href: '/profile', icon: User },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:pt-16 border-r border-border bg-background">
      <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto px-4 gap-4">
        <nav className="flex-grow space-y-1">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  isActive
                    ? 'bg-primary/10 text-primary font-bold'
                    : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
                  'group flex items-center px-4 py-2.5 text-xs font-sans font-semibold tracking-wide rounded-lg transition-colors gap-3'
                )}
              >
                <item.icon
                  className={cn(
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                    'flex-shrink-0 h-4.5 w-4.5'
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
