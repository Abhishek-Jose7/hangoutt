'use client';

import React, { useState } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, DollarSign, Heart } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfilePage() {
  const [name, setName] = useState('Abhishek Jose');
  const [minBudget, setMinBudget] = useState('100');
  const [maxBudget, setMaxBudget] = useState('1500');
  const [travelRadius, setTravelRadius] = useState('8');
  
  const [favoriteActivities, setFavoriteActivities] = useState<string[]>([
    'CAFE',
    'RESTAURANT',
    'BOWLING',
    'ESCAPE_ROOM',
  ]);

  const allCategories = [
    'CAFE', 'RESTAURANT', 'PARK', 'ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'MOVIE', 'MALL', 'DESSERT', 'SPORTS', 'MUSEUM'
  ];

  const handleToggleActivity = (cat: string) => {
    setFavoriteActivities((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success('Profile preferences updated successfully!');
  };

  return (
    <PageContainer
      title="My Profile"
      subtitle="Manage your personal preferences for outing calculations."
    >
      <form onSubmit={handleSaveProfile} className="space-y-6 max-w-4xl font-sans text-sm relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left panel: Avatar & Basic Details */}
          <div className="space-y-6">
            <Card className="text-center border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
              <CardContent className="pt-6 flex flex-col items-center">
                <div className="h-20 w-20 rounded-full bg-[#DC143C]/10 border border-[#DC143C]/30 text-[#DC143C] flex items-center justify-center text-2xl font-campus font-bold overflow-hidden">
                  AJ
                </div>
                <h3 className="mt-4 text-base font-bold text-white font-campus tracking-widest uppercase">{name}</h3>
                <p className="text-[10px] font-mono text-neutral-500 uppercase mt-0.5">abhishek@example.com</p>
                
                <div className="mt-6 flex gap-2 w-full pt-4 border-t border-stone-900/40 justify-around text-center text-xs font-mono">
                  <div>
                    <p className="font-bold text-white text-sm">4</p>
                    <p className="text-neutral-500 text-[8px] uppercase tracking-wider">Outings</p>
                  </div>
                  <div>
                    <p className="font-bold text-[#DC143C] text-sm">3</p>
                    <p className="text-neutral-500 text-[8px] uppercase tracking-wider">Groups</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right panel: Details Forms & Preferences */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Basic Information */}
            <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
                  <User className="h-4 w-4 text-[#DC143C]" />
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-xs font-medium">
                  <Label htmlFor="profileName" className="uppercase text-neutral-400 font-mono text-[9px] tracking-wider">Display Name</Label>
                  <Input
                    id="profileName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-stone-950/80 border border-stone-850 text-white rounded-[8px] text-xs font-mono uppercase tracking-wider focus-visible:ring-1 focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] h-9"
                    required
                  />
                </div>
              </CardContent>
            </Card>

            {/* Budget & Location Preferences */}
            <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-[#DC143C]" />
                  Budget & Travel Limits
                </CardTitle>
                <CardDescription className="text-xs text-neutral-450 font-sans font-light">
                  Help the scoring engine suggest outings compatible with your bounds.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
                <div className="space-y-2">
                  <Label htmlFor="prefMin" className="uppercase text-neutral-400 font-mono text-[9px] tracking-wider">Default Min Budget (INR)</Label>
                  <Input
                    id="prefMin"
                    type="number"
                    value={minBudget}
                    onChange={(e) => setMinBudget(e.target.value)}
                    className="bg-stone-950/80 border border-stone-850 text-white rounded-[8px] text-xs font-mono uppercase tracking-wider focus-visible:ring-1 focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prefMax" className="uppercase text-neutral-400 font-mono text-[9px] tracking-wider">Default Max Budget (INR)</Label>
                  <Input
                    id="prefMax"
                    type="number"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                    className="bg-stone-950/80 border border-stone-850 text-white rounded-[8px] text-xs font-mono uppercase tracking-wider focus-visible:ring-1 focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] h-9"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="prefRadius" className="uppercase text-neutral-400 font-mono text-[9px] tracking-wider">Preferred Max Travel Radius (km)</Label>
                  <Input
                    id="prefRadius"
                    type="number"
                    value={travelRadius}
                    onChange={(e) => setTravelRadius(e.target.value)}
                    className="bg-stone-950/80 border border-stone-850 text-white rounded-[8px] text-xs font-mono uppercase tracking-wider focus-visible:ring-1 focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] h-9"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Favorite Activities */}
            <Card className="border border-stone-900/60 rounded-[12px] bg-stone-950/45 shadow-lg backdrop-blur-md">
              <CardHeader>
                <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
                  <Heart className="h-4 w-4 text-[#DC143C]" />
                  Favorite Activities
                </CardTitle>
                <CardDescription className="text-xs text-neutral-450 font-sans font-light">
                  Select categories you prefer. The recommendation system gives extra weight to these.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {allCategories.map((cat) => {
                    const isSelected = favoriteActivities.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleToggleActivity(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider border transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#DC143C] text-white border-transparent shadow-md'
                            : 'bg-stone-950 border-stone-850 text-neutral-500 hover:bg-stone-900 hover:text-white'
                        }`}
                      >
                        {cat.toLowerCase()}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end pt-4 border-t border-stone-900/40 pb-4">
                <Button 
                  type="submit" 
                  className="bg-[#DC143C] hover:bg-[#B80F2E] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-6 py-2.5 shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
                >
                  Save Preferences
                </Button>
              </CardFooter>
            </Card>

          </div>

        </div>
      </form>
    </PageContainer>
  );
}
