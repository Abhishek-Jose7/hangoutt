'use client';

import React, { useState, use } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { MOCK_GROUPS, MOCK_USERS } from '@/lib/utils/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { submitBudget } from '@/actions/budgets';
import { saveLocation } from '@/actions/locations';
import { generatePlan } from '@/actions/planner';
import { Users, DollarSign, MapPin, Sparkles, Share2, Shield, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function GroupDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const groupId = resolvedParams.id;
  
  // Find group from mock or fallback
  const group = MOCK_GROUPS.find(g => g.id === groupId) || MOCK_GROUPS[0];
  
  // Form states
  const [budgetVal, setBudgetVal] = useState('');
  const [latVal, setLatVal] = useState('12.9348'); // default Koramangala lat
  const [lngVal, setLngVal] = useState('77.6189'); // default Koramangala lng
  
  const [isSubmittingBudget, setIsSubmittingBudget] = useState(false);
  const [isSubmittingLocation, setIsSubmittingLocation] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Group budget aggregates mock values
  const [budgetSummary, setBudgetSummary] = useState({
    min: 150,
    avg: 430,
    max: 900,
    total: 1720,
    submittedCount: 4,
    totalMembers: 4,
  });

  // Mock locations list
  const [locations, setLocations] = useState([
    { name: 'Abhishek J.', lat: 12.9348, lng: 77.6189 },
    { name: 'Sarah C.', lat: 12.9716, lng: 77.5946 },
    { name: 'Marcus M.', lat: 12.9279, lng: 77.6271 },
  ]);

  const handleBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingBudget(true);
    const amount = parseInt(budgetVal);
    
    try {
      const res = await submitBudget({
        groupId: group.id,
        maxBudget: amount,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit budget');
        setIsSubmittingBudget(false);
        return;
      }

      toast.success('Budget submitted successfully!');
      setBudgetVal('');
      // Update local state summary for demonstration
      setBudgetSummary(prev => ({
        ...prev,
        submittedCount: prev.submittedCount + 1,
        avg: Math.round((prev.total + amount) / (prev.submittedCount + 1)),
        total: prev.total + amount,
      }));
    } catch (_err) {
      toast.error('An error occurred submitting budget.');
    } finally {
      setIsSubmittingBudget(false);
    }
  };

  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLocation(true);
    const lat = parseFloat(latVal);
    const lng = parseFloat(lngVal);

    try {
      const res = await saveLocation({
        groupId: group.id,
        lat,
        lng,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit location');
        setIsSubmittingLocation(false);
        return;
      }

      toast.success('Location registered successfully!');
      // Append to local coordinates showcase
      setLocations(prev => [...prev, { name: 'You (Submitted)', lat, lng }]);
    } catch (_err) {
      toast.error('An error occurred submitting coordinates.');
    } finally {
      setIsSubmittingLocation(false);
    }
  };

  const handlePlanGeneration = async () => {
    setIsGenerating(true);
    try {
      const res = await generatePlan(group.id);
      
      if (!res.success) {
        toast.error(res.error.message || 'Failed to generate itineraries');
        setIsGenerating(false);
        return;
      }

      toast.success('Itineraries generated successfully! Opening Planner.');
      router.push(`/planner/${group.id}`);
    } catch (_err) {
      toast.error('An error occurred generating plans.');
      setIsGenerating(false);
    }
  };

  const handleShareCode = () => {
    if (navigator.share) {
      navigator.share({
        title: `Join ${group.name} on Hangout`,
        text: `Use invite code ${group.inviteCode} to plan our next meetup!`,
        url: window.location.origin + `/join/${group.inviteCode}`,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(group.inviteCode);
      toast.success(`Invite code "${group.inviteCode}" copied to clipboard!`);
    }
  };

  return (
    <PageContainer
      title={group.name}
      subtitle={group.description || 'Coordinating outing plans.'}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleShareCode} className="flex items-center gap-1">
            <Share2 className="h-4 w-4" />
            Share Code
          </Button>
          <Button
            size="sm"
            onClick={handlePlanGeneration}
            disabled={isGenerating}
            className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            Generate Plans
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Workspace Quick Information */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-indigo-50 border-indigo-100 flex items-center p-4 gap-3 shadow-sm">
            <div className="p-3 bg-indigo-100 rounded-full text-indigo-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-indigo-600 font-bold uppercase tracking-wider">Group Code</p>
              <p className="text-lg font-mono font-extrabold text-indigo-900">{group.inviteCode}</p>
            </div>
          </Card>

          <Card className="bg-emerald-50 border-emerald-100 flex items-center p-4 gap-3 shadow-sm">
            <div className="p-3 bg-emerald-100 rounded-full text-emerald-700">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider">Group Budget (Avg)</p>
              <p className="text-lg font-extrabold text-emerald-900">₹{budgetSummary.avg}</p>
            </div>
          </Card>

          <Card className="bg-sky-50 border-sky-100 flex items-center p-4 gap-3 shadow-sm">
            <div className="p-3 bg-sky-100 rounded-full text-sky-700">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-sky-600 font-bold uppercase tracking-wider">Midpoint Coordinates</p>
              <p className="text-sm font-bold text-slate-700">Calculated near Koramangala</p>
            </div>
          </Card>
        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="workspace" className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1 w-full max-w-md justify-start grid grid-cols-2">
            <TabsTrigger value="workspace" className="font-semibold text-xs py-2 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-600">
              Workspace Overview
            </TabsTrigger>
            <TabsTrigger value="inputs" className="font-semibold text-xs py-2 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-600">
              Submit My Details
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: OVERVIEW */}
          <TabsContent value="workspace" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Members List */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-400" />
                    Members List ({group.memberCount})
                  </CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-slate-100 p-0 px-6 pb-6">
                  {MOCK_USERS.map((user, idx) => {
                    const isOwner = idx === 0;
                    return (
                      <div key={user.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={user.imageUrl}
                            alt={user.name}
                            className="h-10 w-10 rounded-full object-cover border border-slate-200"
                          />
                          <div>
                            <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                              {user.name}
                              {isOwner && (
                                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] font-bold py-0 flex items-center gap-0.5">
                                  <Shield className="h-2.5 w-2.5" />
                                  Owner
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-slate-400">{user.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="flex items-center text-xs text-slate-500 font-medium">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5" />
                            Active
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Locations List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    Coordinates Registered
                  </CardTitle>
                  <CardDescription>
                    Map pins submitted by participants. Locations are shared privately.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-slate-100 border border-slate-200 p-8 rounded-xl text-center">
                    <MapPin className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-500 font-medium">
                      Map preview placeholder. Midpoint will center search nearby venues.
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {locations.map((loc, idx) => (
                      <div key={idx} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                        <span className="font-semibold text-slate-700">{loc.name}</span>
                        <span className="font-mono text-slate-400">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Aggregates Dashboard */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-bold">Group Outing Aggregates</CardTitle>
                  <CardDescription>
                    Aggregated budget parameters. Individual submissions are kept strictly private.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Budgets Submitted</span>
                    <span className="font-bold text-slate-800">
                      {budgetSummary.submittedCount} of {budgetSummary.totalMembers}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Min Budget Limit</span>
                    <span className="font-bold text-slate-800">₹{budgetSummary.min}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Max Budget Limit</span>
                    <span className="font-bold text-slate-800">₹{budgetSummary.max}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-100 bg-emerald-50 px-2 rounded">
                    <span className="text-emerald-700 font-bold">Average Capacity</span>
                    <span className="font-extrabold text-emerald-900">₹{budgetSummary.avg}</span>
                  </div>
                </CardContent>
                <CardFooter className="bg-slate-50 pt-4 flex flex-col items-stretch">
                  <Link
                    href={`/planner/${group.id}`}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                      className: 'w-full justify-between font-semibold border-slate-200',
                    })}
                  >
                    View Scoring Results <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardFooter>
              </Card>
            </div>

          </TabsContent>

          {/* TAB 2: INPUTS FORM */}
          <TabsContent value="inputs" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Submit Budget */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-indigo-600" />
                  Submit Budget Limits
                </CardTitle>
                <CardDescription>
                  Enter your maximum spending limit for this meetup (between ₹50 and ₹100,000).
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleBudgetSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="budgetInput">Your Max Budget (INR)</Label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 font-bold">₹</span>
                      <Input
                        id="budgetInput"
                        type="number"
                        min={50}
                        max={100000}
                        value={budgetVal}
                        onChange={(e) => setBudgetVal(e.target.value)}
                        placeholder="500"
                        className="pl-8"
                        required
                        disabled={isSubmittingBudget}
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSubmittingBudget} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow">
                    {isSubmittingBudget ? 'Saving...' : 'Submit Budget'}
                  </Button>
                </CardFooter>
              </form>
            </Card>

            {/* Submit Coordinates */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-600" />
                  Register Location
                </CardTitle>
                <CardDescription>
                  Enter your starting latitude and longitude coordinates to help compute the fair midpoint.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleLocationSubmit}>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="latitudeInput">Latitude</Label>
                      <Input
                        id="latitudeInput"
                        type="number"
                        step="0.0001"
                        min={-90}
                        max={90}
                        value={latVal}
                        onChange={(e) => setLatVal(e.target.value)}
                        required
                        disabled={isSubmittingLocation}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="longitudeInput">Longitude</Label>
                      <Input
                        id="longitudeInput"
                        type="number"
                        step="0.0001"
                        min={-180}
                        max={180}
                        value={lngVal}
                        onChange={(e) => setLngVal(e.target.value)}
                        required
                        disabled={isSubmittingLocation}
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSubmittingLocation} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow">
                    {isSubmittingLocation ? 'Registering...' : 'Register Coordinates'}
                  </Button>
                </CardFooter>
              </form>
            </Card>

          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
