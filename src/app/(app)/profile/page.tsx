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
      <form onSubmit={handleSaveProfile} className="space-y-6 max-w-4xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left panel: Avatar & Basic Details */}
          <div className="space-y-6">
            <Card className="text-center shadow-sm">
              <CardContent className="pt-6 flex flex-col items-center">
                <div className="h-24 w-24 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-3xl font-extrabold text-slate-500 overflow-hidden">
                  AJ
                </div>
                <h3 className="mt-4 text-lg font-bold text-slate-900">{name}</h3>
                <p className="text-sm text-slate-500">abhishek@example.com</p>
                <div className="mt-4 flex gap-2 w-full pt-4 border-t border-slate-100 justify-around text-center text-xs">
                  <div>
                    <p className="font-extrabold text-slate-900">4</p>
                    <p className="text-slate-400">Outings</p>
                  </div>
                  <div>
                    <p className="font-extrabold text-indigo-600">3</p>
                    <p className="text-slate-400">Groups</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right panel: Details Forms & Preferences */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Basic Preferences */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <User className="h-4 w-4 text-indigo-600" />
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profileName">Display Name</Label>
                  <Input
                    id="profileName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
            </Card>

            {/* Budget & Location Preferences */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-indigo-600" />
                  Budget & Travel Limits
                </CardTitle>
                <CardDescription>
                  Help the scoring engine suggest outings compatible with your bounds.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="prefMin">Default Min Budget (INR)</Label>
                  <Input
                    id="prefMin"
                    type="number"
                    value={minBudget}
                    onChange={(e) => setMinBudget(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prefMax">Default Max Budget (INR)</Label>
                  <Input
                    id="prefMax"
                    type="number"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="prefRadius">Preferred Max Travel Radius (km)</Label>
                  <Input
                    id="prefRadius"
                    type="number"
                    value={travelRadius}
                    onChange={(e) => setTravelRadius(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Favorite Activities */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Heart className="h-4 w-4 text-indigo-600" />
                  Favorite Activities
                </CardTitle>
                <CardDescription>
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end pt-4 border-t border-slate-100">
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white shadow">
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
