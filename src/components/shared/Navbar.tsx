'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { Plus, LogIn, Clock, Users } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import CreateGroupDialog from './CreateGroupDialog';
import JoinGroupDialog from './JoinGroupDialog';

export default function Navbar() {
  const pathname = usePathname();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  const navItems = [
    { name: 'My Lobbies', href: '/groups', icon: Users },
    { name: 'History', href: '/history', icon: Clock },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-neutral-900 bg-black/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Logo */}
        <div className="flex items-center gap-8">
          <Link href="/groups" className="flex items-center gap-2">
            <span className="text-xl font-bold uppercase tracking-widest font-heading text-foreground">
              Hang<span className="text-primary italic font-serif lowercase">out</span>
            </span>
          </Link>
          
          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "text-xs uppercase tracking-wider font-bold transition-colors py-2 px-3 rounded-lg flex items-center gap-2",
                    isActive 
                      ? "bg-neutral-900 text-primary" 
                      : "text-muted-foreground hover:bg-neutral-900/50 hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
        
        {/* Actions & User profile */}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsCreateOpen(true)}
            size="sm"
            className="hidden sm:flex bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold uppercase tracking-wider rounded-lg px-3.5 py-2 gap-1.5 shadow-md active:scale-95 transition-transform"
          >
            <Plus className="h-4 w-4" />
            New Lobby
          </Button>
          
          <Button
            onClick={() => setIsJoinOpen(true)}
            size="sm"
            variant="outline"
            className="border-neutral-800 hover:bg-neutral-900 text-foreground text-xs font-bold uppercase tracking-wider rounded-lg px-3.5 py-2 gap-1.5 transition-colors"
          >
            <LogIn className="h-4 w-4 text-primary" />
            Join Lobby
          </Button>

          <div className="pl-2 border-l border-neutral-900">
            <UserButton 
              appearance={{
                elements: {
                  userButtonAvatarBox: 'w-8.5 h-8.5 border border-neutral-800 rounded-lg overflow-hidden',
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Global Modals */}
      <CreateGroupDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <JoinGroupDialog isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </header>
  );
}
