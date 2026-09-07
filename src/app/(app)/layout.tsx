'use client';

import React from 'react';
import Navbar from '@/components/shared/Navbar';
import BottomNavigation from '@/components/shared/BottomNavigation';

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell flex min-h-[100dvh] flex-col bg-background text-foreground relative overflow-x-hidden">
      {/* App shell stays on one dark palette. */}

      {/* Interactive App Shell Container */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Top Header */}
        <Navbar />
        
        <div className="flex flex-1 relative justify-center">
          {/* Core Content Body */}
          <main className="flex-1 min-w-0 flex flex-col md:pl-0 max-w-7xl w-full">
            {children}
          </main>
        </div>

        {/* Pinned Bottom Navigation (Mobile) */}
        <BottomNavigation />
      </div>
    </div>
  );
}
