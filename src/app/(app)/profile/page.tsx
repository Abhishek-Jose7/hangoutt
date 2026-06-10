'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, DollarSign, Heart, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUser } from '@clerk/nextjs';
import { getUserPreferencesAction, updateUserProfile } from '@/actions/users';

export default function ProfilePage() {
  const { user, isLoaded: isClerkLoaded } = useUser();
  const [name, setName] = useState('');
  const [minBudget, setMinBudget] = useState('0');
  const [maxBudget, setMaxBudget] = useState('10000');
  const [travelRadius, setTravelRadius] = useState('15');
  const [favoriteActivities, setFavoriteActivities] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);

  const allCategories = [
    'CAFE', 'RESTAURANT', 'PARK', 'ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'MOVIE', 'MALL', 'DESSERT', 'SPORTS', 'MUSEUM'
  ];

  useEffect(() => {
    if (user) {
      setName(user.fullName || '');
    }
  }, [user]);

  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const res = await getUserPreferencesAction();
        if (res.success && res.data) {
          const dbUser = res.data;
          if (dbUser.name) setName(dbUser.name);
          if (dbUser.preferredBudgetMin !== null && dbUser.preferredBudgetMin !== undefined) {
            setMinBudget(dbUser.preferredBudgetMin.toString());
          }
          if (dbUser.preferredBudgetMax !== null && dbUser.preferredBudgetMax !== undefined) {
            setMaxBudget(dbUser.preferredBudgetMax.toString());
          }
          if (dbUser.favoriteActivities) {
            try {
              const acts = JSON.parse(dbUser.favoriteActivities);
              if (Array.isArray(acts)) {
                setFavoriteActivities(acts);
              }
            } catch (_e) {
              const acts = dbUser.favoriteActivities.split(',').map((s: string) => s.trim());
              setFavoriteActivities(acts);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching user preferences:', err);
      } finally {
        setDbLoading(false);
      }
    };
    fetchPrefs();
  }, []);

  const handleToggleActivity = (cat: string) => {
    setFavoriteActivities((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);

    try {
      // 1. Update Clerk name
      const parts = name.trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';
      await user.update({
        firstName,
        lastName,
      });

      // 2. Update DB profile preferences
      const minB = parseInt(minBudget) || 0;
      const maxB = parseInt(maxBudget) || 10000;
      const res = await updateUserProfile(name, minB, maxB, favoriteActivities);

      if (!res.success) {
        toast.error(res.error.message || 'Failed to save profile preferences in database.');
      } else {
        toast.success('Profile and preferences updated successfully!');
      }
    } catch (err) {
      console.error(err);
      toast.error('An error occurred while updating profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const userEmail = user?.primaryEmailAddress?.emailAddress || 'no-email@clerk.com';

  if (!isClerkLoaded || dbLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-[#0A0A0C] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mb-4" />
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono font-bold">Initializing Profile...</p>
      </div>
    );
  }

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
                  {user?.imageUrl ? (
                    <img src={user.imageUrl} alt={name} className="w-full h-full object-cover" />
                  ) : (
                    name.split(' ').map((p) => p.charAt(0)).join('').toUpperCase() || 'U'
                  )}
                </div>
                <h3 className="mt-4 text-base font-bold text-white font-campus tracking-widest uppercase">{name || 'User'}</h3>
                <p className="text-[10px] font-mono text-neutral-500 uppercase mt-0.5">{userEmail}</p>
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                    disabled={isSaving}
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
                        disabled={isSaving}
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
                  disabled={isSaving}
                  className="bg-[#DC143C] hover:bg-[#B80F2E] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-6 py-2.5 shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      Saving...
                    </>
                  ) : (
                    'Save Preferences'
                  )}
                </Button>
              </CardFooter>
            </Card>

          </div>

        </div>
      </form>
    </PageContainer>
  );
}
