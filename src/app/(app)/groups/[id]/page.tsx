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
      subtitle={`Lobby Status: Active coordination / Outing category: ${group.groupType.toLowerCase()}`}
      actions={
        <div className="flex gap-2 font-sans text-xs">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleShareCode} 
            className="flex items-center gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary font-semibold tracking-wide"
          >
            <Share2 className="h-4 w-4 text-primary" />
            Share Code
          </Button>
          <Button
            size="sm"
            onClick={handlePlanGeneration}
            disabled={isGenerating}
            className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 rounded-lg font-semibold tracking-wide shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            Generate Plans
          </Button>
        </div>
      }
    >
      <div className="space-y-6 font-sans text-sm">
        
        {/* Workspace Quick Information */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          
          <Card className="bg-card border border-border flex items-center p-5 gap-4 rounded-xl shadow-sm">
            <Users className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Group Code</p>
              <p className="text-base font-mono font-extrabold text-foreground">{group.inviteCode}</p>
            </div>
          </Card>

          <Card className="bg-card border border-border flex items-center p-5 gap-4 rounded-xl shadow-sm">
            <DollarSign className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Budget Ceiling (Avg)</p>
              <p className="text-base font-extrabold text-foreground">₹{budgetSummary.avg}</p>
            </div>
          </Card>

          <Card className="bg-card border border-border flex items-center p-5 gap-4 rounded-xl shadow-sm">
            <MapPin className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Midpoint Location</p>
              <p className="text-sm font-semibold text-foreground">Calculated Near Lobby</p>
            </div>
          </Card>

        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="workspace" className="space-y-6">
          <TabsList className="bg-black border border-border p-1 w-full max-w-md justify-start grid grid-cols-2 rounded-lg font-sans">
            <TabsTrigger 
              value="workspace" 
              className="text-xs font-semibold py-2.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:text-foreground"
            >
              Workspace Overview
            </TabsTrigger>
            <TabsTrigger 
              value="inputs" 
              className="text-xs font-semibold py-2.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:text-foreground"
            >
              Submit My Details
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: OVERVIEW */}
          <TabsContent value="workspace" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Members List */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="border border-border rounded-xl bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    Members Lobby ({group.memberCount})
                  </CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border p-0 px-6 pb-6">
                  {MOCK_USERS.map((user, idx) => {
                    const isOwner = idx === 0;
                    return (
                      <div key={user.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={user.imageUrl}
                            alt={user.name}
                            className="h-9 w-9 rounded-full object-cover border border-border"
                          />
                          <div>
                            <p className="text-sm font-bold text-foreground flex items-center gap-2">
                              {user.name}
                              {isOwner && (
                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-semibold uppercase rounded-full py-0.5 px-2.5 flex items-center gap-0.5">
                                  <Shield className="h-2.5 w-2.5" />
                                  Owner
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="flex items-center text-[10px] uppercase text-primary font-bold">
                            <span className="h-2 w-2 rounded-full bg-primary mr-1.5" />
                            Active
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Locations List */}
              <Card className="border border-border rounded-xl bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    Geographic Registry
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground font-light">
                    Coordinate nodes submitted privately by lobby participants.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-accent/10 border border-border p-8 rounded-lg text-center text-xs">
                    <MapPin className="h-6 w-6 text-primary mx-auto mb-2" />
                    <p className="text-muted-foreground font-medium">
                      Map preview placeholder. Midpoint will center searches nearby.
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {locations.map((loc, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 bg-black border border-border rounded-lg">
                        <span className="font-bold text-foreground uppercase tracking-wide">{loc.name}</span>
                        <span className="font-mono text-primary text-[11px]">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Aggregates Dashboard */}
            <div className="space-y-6">
              <Card className="border border-border rounded-xl bg-card shadow-sm text-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary">Scoring Specifications</CardTitle>
                  <CardDescription className="text-[10px] text-muted-foreground uppercase leading-relaxed font-light">
                    Aggregated values computed from private envelopes.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-2 font-medium">
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Submitted Envelopes</span>
                    <span className="font-bold text-foreground">
                      {budgetSummary.submittedCount} of {budgetSummary.totalMembers}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Floor Limit (Min)</span>
                    <span className="font-bold text-foreground">₹{budgetSummary.min}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Ceiling Limit (Max)</span>
                    <span className="font-bold text-foreground">₹{budgetSummary.max}</span>
                  </div>
                  <div className="flex justify-between py-2.5 border border-primary/20 bg-primary/10 px-3 rounded-lg text-primary font-bold uppercase">
                    <span>Group Budget Cap</span>
                    <span>₹{budgetSummary.avg}</span>
                  </div>
                </CardContent>
                <CardFooter className="bg-black pt-4 border-t border-border flex flex-col items-stretch rounded-b-xl">
                  <Link
                    href={`/planner/${group.id}`}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                      className: 'w-full justify-between text-xs tracking-wider rounded-lg border-border hover:bg-primary/10 hover:text-primary',
                    })}
                  >
                    View Scoring Results <ArrowRight className="h-3.5 w-3.5 text-primary" />
                  </Link>
                </CardFooter>
              </Card>
            </div>

          </TabsContent>

          {/* TAB 2: INPUTS FORM */}
          <TabsContent value="inputs" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Submit Budget */}
            <Card className="border border-border rounded-xl bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Submit Budget Limits
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-light">
                  Enter your maximum spending cap for this outing (₹50 — ₹100,000).
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleBudgetSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="budgetInput" className="text-xs uppercase text-foreground">Your Max Budget (INR)</Label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary font-bold">₹</span>
                      <Input
                        id="budgetInput"
                        type="number"
                        min={50}
                        max={100000}
                        value={budgetVal}
                        onChange={(e) => setBudgetVal(e.target.value)}
                        placeholder="500"
                        className="pl-8 bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                        required
                        disabled={isSubmittingBudget}
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSubmittingBudget} className="w-full bg-primary hover:bg-primary/95 text-primary-foreground rounded-lg uppercase tracking-wider font-bold text-xs">
                    {isSubmittingBudget ? 'Saving...' : 'Submit Budget'}
                  </Button>
                </CardFooter>
              </form>
            </Card>

            {/* Submit Coordinates */}
            <Card className="border border-border rounded-xl bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  Register Coordinates
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-light">
                  Register your starting coordinates to calculate the optimal midpoint.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleLocationSubmit}>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1.5">
                      <Label htmlFor="latitudeInput" className="uppercase text-foreground">Latitude</Label>
                      <Input
                        id="latitudeInput"
                        type="number"
                        step="0.0001"
                        min={-90}
                        max={90}
                        value={latVal}
                        onChange={(e) => setLatVal(e.target.value)}
                        className="bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                        required
                        disabled={isSubmittingLocation}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="longitudeInput" className="uppercase text-foreground">Longitude</Label>
                      <Input
                        id="longitudeInput"
                        type="number"
                        step="0.0001"
                        min={-180}
                        max={180}
                        value={lngVal}
                        onChange={(e) => setLngVal(e.target.value)}
                        className="bg-black border border-border text-foreground rounded-lg text-xs focus-visible:ring-primary"
                        required
                        disabled={isSubmittingLocation}
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSubmittingLocation} className="w-full bg-primary hover:bg-primary/95 text-primary-foreground rounded-lg uppercase tracking-wider font-bold text-xs">
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
