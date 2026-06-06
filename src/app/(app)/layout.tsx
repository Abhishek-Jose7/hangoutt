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
    <div className="flex flex-col min-h-screen bg-background">
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
  );
}
