'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton, useUser } from '@clerk/nextjs';
import { Plus, LogIn, Clock, Users, Database } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import CreateGroupDialog from './CreateGroupDialog';
import JoinGroupDialog from './JoinGroupDialog';
import { isAdminEmail } from '@/lib/auth/adminEmails';

export default function Navbar() {
  const pathname = usePathname();
  const { user } = useUser();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const isAdmin = isAdminEmail(userEmail);

  const navItems = [
    { name: 'My Groups', href: '/groups', icon: Users },
    { name: 'History', href: '/history', icon: Clock },
    ...(isAdmin ? [{ name: 'Admin Places', href: '/admin/places', icon: Database }] : []),
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-stone-900 bg-stone-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Logo */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-[17px] font-campus font-bold uppercase tracking-[0.15em] text-white">
              HANG<span className="text-[#DC143C] font-serif-display lowercase italic font-normal">out</span>
            </span>
          </Link>
          
          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-3">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "text-[10px] font-mono uppercase tracking-widest font-bold transition-all py-1.5 px-3 rounded-[6px] flex items-center gap-2",
                    isActive 
                      ? "bg-stone-900 text-[#DC143C] border border-stone-800" 
                      : "text-neutral-400 hover:bg-stone-900/50 hover:text-white"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
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
            className="hidden sm:flex bg-[#DC143C] hover:bg-[#B80F2E] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
          >
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
          
          <Button
            onClick={() => setIsJoinOpen(true)}
            size="sm"
            variant="outline"
            className="border-stone-800 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <LogIn className="h-3.5 w-3.5 text-[#DC143C]" />
            Join Group
          </Button>

          <div className="pl-2 border-l border-stone-900">
            <UserButton 
              appearance={{
                elements: {
                  userButtonAvatarBox: 'w-8.5 h-8.5 border border-stone-850 rounded-[8px] overflow-hidden',
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
