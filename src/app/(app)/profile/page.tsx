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
      <form onSubmit={handleSaveProfile} className="space-y-6 max-w-4xl font-sans text-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left panel: Avatar & Basic Details */}
          <div className="space-y-6">
            <Card className="text-center border border-border rounded-xl bg-card shadow-sm">
              <CardContent className="pt-6 flex flex-col items-center">
                <div className="h-20 w-20 rounded-full bg-primary/10 border border-primary text-primary flex items-center justify-center text-2xl font-extrabold overflow-hidden">
                  AJ
                </div>
                <h3 className="mt-4 text-base font-bold text-foreground font-heading tracking-wide uppercase">{name}</h3>
                <p className="text-xs text-muted-foreground">abhishek@example.com</p>
                
                <div className="mt-6 flex gap-2 w-full pt-4 border-t border-border justify-around text-center text-xs font-semibold">
                  <div>
                    <p className="font-extrabold text-foreground text-sm">4</p>
                    <p className="text-muted-foreground text-[10px]">Outings</p>
                  </div>
                  <div>
                    <p className="font-extrabold text-primary text-sm">3</p>
                    <p className="text-muted-foreground text-[10px]">Groups</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right panel: Details Forms & Preferences */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Basic Information */}
            <Card className="border border-border rounded-xl bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5 text-xs font-medium">
                  <Label htmlFor="profileName" className="uppercase text-foreground">Display Name</Label>
                  <Input
                    id="profileName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                    required
                  />
                </div>
              </CardContent>
            </Card>

            {/* Budget & Location Preferences */}
            <Card className="border border-border rounded-xl bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Budget & Travel Limits
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-light">
                  Help the scoring engine suggest outings compatible with your bounds.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
                <div className="space-y-1.5">
                  <Label htmlFor="prefMin" className="uppercase text-foreground">Default Min Budget (INR)</Label>
                  <Input
                    id="prefMin"
                    type="number"
                    value={minBudget}
                    onChange={(e) => setMinBudget(e.target.value)}
                    className="bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prefMax" className="uppercase text-foreground">Default Max Budget (INR)</Label>
                  <Input
                    id="prefMax"
                    type="number"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                    className="bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="prefRadius" className="uppercase text-foreground">Preferred Max Travel Radius (km)</Label>
                  <Input
                    id="prefRadius"
                    type="number"
                    value={travelRadius}
                    onChange={(e) => setTravelRadius(e.target.value)}
                    className="bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Favorite Activities */}
            <Card className="border border-border rounded-xl bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <Heart className="h-4 w-4 text-primary" />
                  Favorite Activities
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-light">
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
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                            : 'bg-black border-border text-muted-foreground hover:bg-primary/10 hover:text-primary'
                        }`}
                      >
                        {cat.toLowerCase()}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end pt-4 border-t border-border">
                <Button type="submit" className="bg-primary hover:bg-primary/95 text-primary-foreground text-xs font-bold rounded-lg shadow-sm">
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
