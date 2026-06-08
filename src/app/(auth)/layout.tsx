import React from 'react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0C] text-foreground relative overflow-hidden items-center justify-center">
      {/* Ambient background grid and soft radial glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.008)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.008)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#DC143C]/4 rounded-full filter blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#00E5A0]/2 rounded-full filter blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md p-4 flex justify-center">
        {children}
      </div>
    </div>
  );
}
