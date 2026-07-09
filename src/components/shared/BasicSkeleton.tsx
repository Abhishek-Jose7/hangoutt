import React from 'react';
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Original fallback skeleton
export default function BasicSkeleton() {
  return (
    <Card className="w-full max-w-[343px] p-4 flex flex-col gap-4 border border-stone-900 bg-stone-950/45 shadow-md">
      {/* Aspect Ratio 21/9 for image placeholder */}
      <div className="relative w-full aspect-[21/9] overflow-hidden rounded-[4px]">
        <Skeleton className="absolute inset-0 h-full w-full bg-[#1c1917]/60" />
      </div>
      
      {/* Typography/text lines */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-full bg-[#1c1917]/60" />
        <Skeleton className="h-3 w-[90%] bg-[#1c1917]/60" />
        <Skeleton className="h-3 w-[75%] bg-[#1c1917]/60" />
      </div>
    </Card>
  );
}

// Skeleton for the Lobbies/Groups page cards
export function GroupCardSkeleton() {
  return (
    <Card className="relative overflow-hidden flex flex-col justify-between rounded-[4px] border border-[#353534] bg-[#0e0e0e]/70 h-[220px] shadow-lg">
      <div className="absolute left-0 top-0 h-full w-1 bg-stone-850" />
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2">
          <Skeleton className="h-4 w-28 bg-[#1c1917]/60" />
          <Skeleton className="h-3 w-16 bg-[#1c1917]/60 rounded-full" />
        </div>
        <div className="space-y-1.5 mt-3">
          <Skeleton className="h-3 w-full bg-[#1c1917]/60" />
          <Skeleton className="h-3 w-[85%] bg-[#1c1917]/60" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        <Skeleton className="h-3 w-32 bg-[#1c1917]/60" />
        <Skeleton className="h-3 w-24 bg-[#1c1917]/60" />
      </CardContent>
      <CardFooter className="pt-3.5 border-t border-[#353534] flex justify-end bg-black/20 px-6 pb-4">
        <Skeleton className="h-4 w-24 bg-[#1c1917]/60" />
      </CardFooter>
    </Card>
  );
}

// Skeleton for the Outing History list cards
export function HistoryCardSkeleton() {
  return (
    <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 p-6 space-y-4 shadow-lg">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20 bg-[#1c1917]/60" />
          <Skeleton className="h-5 w-48 bg-[#1c1917]/60" />
          <Skeleton className="h-3 w-64 bg-[#1c1917]/60" />
        </div>
        <Skeleton className="h-5 w-20 bg-[#1c1917]/60 rounded-full" />
      </div>
      <div className="pt-4 border-t border-stone-900/40 space-y-3">
        <Skeleton className="h-3.5 w-24 bg-[#1c1917]/60" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-16 bg-[#1c1917]/60 rounded-full" />
          <Skeleton className="h-5 w-20 bg-[#1c1917]/60 rounded-full" />
          <Skeleton className="h-5 w-14 bg-[#1c1917]/60 rounded-full" />
        </div>
        <div className="pt-3 border-t border-stone-900/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <Skeleton className="h-3.5 w-48 bg-[#1c1917]/60" />
          <Skeleton className="h-3.5 w-32 bg-[#1c1917]/60" />
        </div>
      </div>
    </Card>
  );
}

// Skeleton for the My Profile page form layout
export function ProfileSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl font-sans text-sm relative z-10">
      {/* Left panel skeleton */}
      <div className="space-y-6">
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 p-6 flex flex-col items-center">
          <Skeleton className="h-20 w-20 rounded-full bg-[#1c1917]/60" />
          <Skeleton className="h-4 w-28 bg-[#1c1917]/60 mt-4" />
          <Skeleton className="h-3 w-40 bg-[#1c1917]/60 mt-1.5" />
        </Card>
      </div>

      {/* Right form panels skeleton */}
      <div className="md:col-span-2 space-y-6">
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 p-6 space-y-4">
          <Skeleton className="h-4 w-32 bg-[#1c1917]/60" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-9 w-full bg-[#1c1917]/60" />
            <Skeleton className="h-9 w-full bg-[#1c1917]/60" />
          </div>
        </Card>
        
        <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 p-6 space-y-4">
          <Skeleton className="h-4 w-44 bg-[#1c1917]/60" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-8 w-full bg-[#1c1917]/60" />
            <Skeleton className="h-8 w-full bg-[#1c1917]/60" />
          </div>
        </Card>
      </div>
    </div>
  );
}

// Skeleton for the Group details workspace module
export function WorkspaceSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-6 relative z-10">
      {/* Protocol Header Skeleton */}
      <div className="border-l-4 border-stone-850 pl-6 py-3 bg-[#0e0e0e]/40 rounded-r-[4px] flex flex-col gap-2">
        <Skeleton className="h-4 w-24 bg-stone-900/60" />
        <Skeleton className="h-8 w-60 bg-stone-900/60" />
        <Skeleton className="h-3 w-80 bg-stone-900/60" />
      </div>
      
      {/* Double column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border border-[#353534] bg-[#0e0e0e]/70 p-6 space-y-4">
            <Skeleton className="h-4 w-40 bg-[#1c1917]/60" />
            <div className="space-y-2 mt-2">
              <Skeleton className="h-8 w-full bg-[#1c1917]/60" />
              <Skeleton className="h-8 w-full bg-[#1c1917]/60" />
            </div>
          </Card>
          <Card className="border border-[#353534] bg-[#0e0e0e]/70 p-6 space-y-4">
            <Skeleton className="h-4 w-44 bg-[#1c1917]/60" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24 bg-[#1c1917]/60" />
              <Skeleton className="h-10 w-24 bg-[#1c1917]/60" />
            </div>
          </Card>
        </div>
        
        <div className="space-y-6">
          <Card className="border border-[#353534] bg-[#0e0e0e]/70 p-6 space-y-4">
            <Skeleton className="h-4 w-28 bg-[#1c1917]/60" />
            <div className="space-y-3 mt-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full bg-[#1c1917]/60" />
                <Skeleton className="h-4 w-24 bg-[#1c1917]/60" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full bg-[#1c1917]/60" />
                <Skeleton className="h-4 w-20 bg-[#1c1917]/60" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Skeleton for the AI Planner page
export function PlannerSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto relative z-10">
      {/* Left panel: Itineraries/timeline */}
      <div className="lg:col-span-2 space-y-6">
        <Card className="border border-[#353534] bg-[#0e0e0e]/70 p-6 space-y-4">
          <Skeleton className="h-4 w-40 bg-[#1c1917]/60" />
          <div className="space-y-4 pt-4 border-l border-stone-850 pl-4 ml-2">
            <div className="relative">
              <Skeleton className="absolute -left-[21px] top-1 h-3.5 w-3.5 rounded-full bg-[#1c1917]/60" />
              <Skeleton className="h-4 w-28 bg-[#1c1917]/60" />
              <Skeleton className="h-16 w-full bg-[#1c1917]/60 mt-2" />
            </div>
            <div className="relative mt-6">
              <Skeleton className="absolute -left-[21px] top-1 h-3.5 w-3.5 rounded-full bg-[#1c1917]/60" />
              <Skeleton className="h-4 w-32 bg-[#1c1917]/60" />
              <Skeleton className="h-16 w-full bg-[#1c1917]/60 mt-2" />
            </div>
          </div>
        </Card>
      </div>

      {/* Right panel: summary & actions */}
      <div className="space-y-6">
        <Card className="border border-[#353534] bg-[#0e0e0e]/70 p-6 space-y-4">
          <Skeleton className="h-4 w-28 bg-[#1c1917]/60" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-full bg-[#1c1917]/60" />
            <Skeleton className="h-8 w-full bg-[#1c1917]/60" />
          </div>
        </Card>
      </div>
    </div>
  );
}
