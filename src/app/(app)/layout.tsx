import React from 'react';
import Navbar from '@/components/shared/Navbar';
import Sidebar from '@/components/shared/Sidebar';
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
      
      <div className="flex flex-1 relative">
        {/* Sidebar Navigation (Desktop) */}
        <Sidebar />
        
        {/* Core Content Body (offsets for desktop sidebar) */}
        <main className="flex-1 md:pl-64 min-w-0 flex flex-col">
          {children}
        </main>
      </div>

      {/* Pinned Bottom Navigation (Mobile) */}
      <BottomNavigation />
    </div>
  );
}
