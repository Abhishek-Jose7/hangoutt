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
    <div className="flex flex-col min-h-screen bg-[#0A0A0C] text-foreground relative overflow-x-hidden">
      {/* Dynamic Ambient Background Grids and Soft Radial Glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.008)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.008)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#EB690B]/4 rounded-full filter blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#00E5A0]/2 rounded-full filter blur-[120px]" />
      </div>

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
