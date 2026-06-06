'use client';

import React, { useState, useEffect, use } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getGroupDetailsAction, startDetailsCollectionAction } from '@/actions/groups';
import { submitBudget } from '@/actions/budgets';
import { saveLocation, reverseGeocodeAction } from '@/actions/locations';
import { submitMemberVibes } from '@/actions/members';
import { generatePlan } from '@/actions/planner';
import { Users, DollarSign, MapPin, Sparkles, Share2, Shield, ArrowRight, Loader2, Heart, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const AVAILABLE_VIBES = [
  'CHILL', 'CREATIVE', 'FOODIE', 'CULTURAL', 'COMPETITIVE', 'ROMANTIC', 'LUXURY', 'BUDGET', 'ADVENTUROUS'
];

export default function GroupDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const groupId = resolvedParams.id;
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Form states
  const [budgetVal, setBudgetVal] = useState('');
  const [latVal, setLatVal] = useState('12.9348'); // default Koramangala lat
  const [lngVal, setLngVal] = useState('77.6189'); // default Koramangala lng
  const [addressVal, setAddressVal] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  
  const [isSubmittingBudget, setIsSubmittingBudget] = useState(false);
  const [isSubmittingLocation, setIsSubmittingLocation] = useState(false);
  const [isSubmittingVibes, setIsSubmittingVibes] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmittingCollection, setIsSubmittingCollection] = useState(false);

  const loadData = async () => {
    try {
      const res = await getGroupDetailsAction(groupId);
      if (res.success) {
        setData(res.data);
        if (res.data.currentUser.budget) {
          setBudgetVal(res.data.currentUser.budget.toString());
        }
        if (res.data.currentUser.location) {
          setLatVal(res.data.currentUser.location.lat.toString());
          setLngVal(res.data.currentUser.location.lng.toString());
          setAddressVal(res.data.currentUser.location.locationName || `${res.data.currentUser.location.lat}, ${res.data.currentUser.location.lng}`);
        }
        
        // Retrieve vibes of the current user from member registry
        const currentMember = res.data.members.find((m: any) => m.userId === res.data.currentUser.id);
        if (currentMember && currentMember.vibes) {
          try {
            setSelectedVibes(JSON.parse(currentMember.vibes));
          } catch (_e) {}
        }
      } else {
        toast.error(res.error.message || 'Failed to fetch group details');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [groupId]);

  const handleBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingBudget(true);
    const amount = parseInt(budgetVal);
    
    try {
      const res = await submitBudget({
        groupId: groupId,
        maxBudget: amount,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit budget');
        return;
      }

      toast.success('Budget submitted successfully!');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting budget.');
    } finally {
      setIsSubmittingBudget(false);
    }
  };

  const handleStartDetailsCollection = async () => {
    setIsSubmittingCollection(true);
    try {
      const res = await startDetailsCollectionAction(groupId);
      if (!res.success) {
        toast.error(res.error.message || 'Failed to start details collection');
        return;
      }
      toast.success('Lobby locked! Details collection has started.');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred starting details collection.');
    } finally {
      setIsSubmittingCollection(false);
    }
  };

  const handleAutoDetect = () => {
    if (navigator.geolocation) {
      toast.loading("Detecting your location name...");
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setLatVal(latitude.toString());
          setLngVal(longitude.toString());
          try {
            const res = await reverseGeocodeAction(latitude, longitude);
            toast.dismiss();
            if (res.success && res.data) {
              setAddressVal(res.data);
              toast.success(`Location detected: ${res.data}! Press save to register.`);
            } else {
              setAddressVal(`Detected Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
              toast.success("Location coordinates detected! Press save to register.");
            }
          } catch (err) {
            toast.dismiss();
            setAddressVal(`Detected Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
            toast.success("Location coordinates detected! Press save to register.");
          }
        },
        (error) => {
          toast.dismiss();
          toast.error("Failed to detect location: " + error.message);
        }
      );
    } else {
      toast.error("Geolocation is not supported by this browser.");
    }
  };

  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLocation(true);
    const isAutoDetect = addressVal.startsWith('Detected Location') || (latVal !== '12.9348' || lngVal !== '77.6189');
    const lat = isAutoDetect ? parseFloat(latVal) : undefined;
    const lng = isAutoDetect ? parseFloat(lngVal) : undefined;

    try {
      const res = await saveLocation({
        groupId: groupId,
        locationName: addressVal,
        lat,
        lng,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit location');
        return;
      }

      toast.success('Location registered successfully!');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting coordinates.');
    } finally {
      setIsSubmittingLocation(false);
    }
  };

  const handleVibesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingVibes(true);

    try {
      const res = await submitMemberVibes(groupId, selectedVibes);
      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit vibe preferences');
        return;
      }

      toast.success('Vibe preferences saved successfully!');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting vibes.');
    } finally {
      setIsSubmittingVibes(false);
    }
  };

  const handlePlanGeneration = async () => {
    setIsGenerating(true);
    try {
      const res = await generatePlan(groupId);
      
      if (!res.success) {
        toast.error(res.error.message || 'Failed to generate itineraries');
        setIsGenerating(false);
        return;
      }

      toast.success('Itineraries generated successfully! Opening Planner.');
      router.push(`/planner/${groupId}`);
    } catch (_err) {
      toast.error('An error occurred generating plans.');
      setIsGenerating(false);
    }
  };

  const handleShareCode = () => {
    if (data?.group?.inviteCode) {
      const code = data.group.inviteCode;
      if (navigator.share) {
        navigator.share({
          title: `Join ${data.group.name} on Hangout`,
          text: `Use invite code ${code} to plan our next meetup!`,
          url: window.location.origin + `/join/${code}`,
        }).catch(console.error);
      } else {
        navigator.clipboard.writeText(code);
        toast.success(`Invite code "${code}" copied to clipboard!`);
      }
    }
  };

  const toggleVibe = (vibe: string) => {
    setSelectedVibes(prev => 
      prev.includes(vibe) ? prev.filter(v => v !== vibe) : [...prev, vibe]
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-black text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Loading group workspace...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <PageContainer title="Group Details">
        <Card className="border border-border bg-neutral-950/40 text-center p-8 rounded-xl">
          <p className="text-sm text-muted-foreground mb-4">Lobby workspace not found or you are not a member.</p>
          <Link href="/groups" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'rounded-lg border-border' })}>
            Back to Lobbies
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const { group, members, budgetSummary, locations, currentUser } = data;
  const isAdmin = currentUser.role === 'ADMIN';

  // State checks
  const isCollectingMembers = group.status === 'COLLECTING_MEMBERS';
  const isCollectingDetails = group.status === 'COLLECTING_DETAILS';
  const isReady = group.status === 'READY_TO_GENERATE';
  const isGeneratingState = group.status === 'GENERATING';
  const isVotingOrClosed = ['VOTING', 'COMPLETED', 'ARCHIVED'].includes(group.status);
  const hasSubmittedSelf = currentUser.budget !== null && currentUser.location !== null;

  return (
    <PageContainer
      title={group.name}
      subtitle={`Lobby Category: ${group.groupType.toLowerCase()} / Status: ${group.status.replace('_', ' ')}`}
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

          {isVotingOrClosed && (
            <Link
              href={`/planner/${group.id}`}
              className={buttonVariants({
                size: 'sm',
                className: 'bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 rounded-lg font-semibold tracking-wide shadow-sm'
              })}
            >
              <Sparkles className="h-4 w-4" />
              View Itineraries
            </Link>
          )}

          {isReady && isAdmin && (
            <Button
              size="sm"
              onClick={handlePlanGeneration}
              disabled={isGenerating}
              className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-1.5 rounded-lg font-semibold tracking-wide shadow-sm"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Plans
                </>
              )}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6 font-sans text-sm">
        {/* Status notification banner */}
        {isGeneratingState && (
          <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 p-4 rounded-xl text-primary text-xs font-semibold animate-pulse">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Itineraries are currently being cooked. Check back in a few seconds...</span>
            <Button size="xs" variant="ghost" onClick={loadData} className="ml-auto flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Reload
            </Button>
          </div>
        )}

        {isCollectingMembers && (
          <div className="flex items-center justify-between gap-3 bg-neutral-900/50 border border-neutral-800 p-4 rounded-xl text-muted-foreground text-xs">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary animate-pulse" />
              <span>Lobby is accepting members. Share the invite code to add friends. Once everyone has joined, the admin can lock the lobby.</span>
            </div>
            {isAdmin && (
              <Button 
                onClick={handleStartDetailsCollection}
                disabled={isSubmittingCollection}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-[10px] h-7 rounded-lg"
              >
                {isSubmittingCollection ? 'Locking Lobby...' : 'Lock Lobby'}
              </Button>
            )}
          </div>
        )}

        {isCollectingDetails && (
          <div className="flex items-center gap-2 bg-neutral-900/50 border border-neutral-800 p-4 rounded-xl text-muted-foreground text-xs">
            <Users className="h-4 w-4 text-primary" />
            <span>Waiting for all members to submit budget and location details. Once everyone submits, the admin can generate plans.</span>
          </div>
        )}

        {isReady && !isAdmin && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl text-emerald-500 text-xs font-semibold">
            <Sparkles className="h-4 w-4 text-emerald-500 animate-pulse" />
            <span>Lobby is fully ready! Waiting for the admin to initiate itinerary generation.</span>
          </div>
        )}

        {/* Workspace Quick Information */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-neutral-950/40 border border-border flex items-center p-5 gap-4 rounded-xl shadow-sm">
            <Users className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Group Code</p>
              <p className="text-base font-mono font-extrabold text-foreground">{group.inviteCode}</p>
            </div>
          </Card>

          <Card className="bg-neutral-950/40 border border-border flex items-center p-5 gap-4 rounded-xl shadow-sm">
            <DollarSign className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Budget Ceiling (Avg)</p>
              <p className="text-base font-extrabold text-foreground">₹{budgetSummary?.avg || 0}</p>
            </div>
          </Card>

          <Card className="bg-neutral-950/40 border border-border flex items-center p-5 gap-4 rounded-xl shadow-sm">
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
              <Card className="border border-border rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    Members Lobby ({members.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border/60 p-0 px-6 pb-6">
                  {members.map((member: any) => {
                    const isOwner = member.role === 'ADMIN';
                    const hasSubmittedDetails = 
                      budgetSummary.submittedCount > 0 && 
                      currentUser.id === member.userId ? (currentUser.budget && currentUser.location) : true; // visual indicator proxy
                    
                    return (
                      <div key={member.userId} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          {member.imageUrl ? (
                            <img
                              src={member.imageUrl}
                              alt={member.name}
                              className="h-9 w-9 rounded-full object-cover border border-border"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-full bg-neutral-900 border border-border flex items-center justify-center font-bold text-xs uppercase text-primary">
                              {member.name.charAt(0)}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-bold text-foreground flex items-center gap-2">
                              {member.name}
                              {isOwner && (
                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[9px] font-semibold uppercase rounded-full py-0.5 px-2.5 flex items-center gap-0.5">
                                  <Shield className="h-2.5 w-2.5" />
                                  Admin
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {member.vibes && (
                            <span className="text-[10px] text-muted-foreground font-light italic">
                              {JSON.parse(member.vibes).slice(0, 2).join(', ').toLowerCase()}
                            </span>
                          )}
                          <span className="flex items-center text-[10px] uppercase text-primary font-bold">
                            <span className="h-2 w-2 rounded-full bg-primary mr-1.5" />
                            Joined
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Locations List */}
              <Card className="border border-neutral-900 rounded-xl bg-neutral-950/20 backdrop-blur-md shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    Geographic Registry
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground font-light">
                    Outing starting nodes submitted by lobby participants. Specific coordinates are masked for privacy unless you are the lobby Admin.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 font-medium">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {locations.map((loc: any, idx: number) => {
                      return (
                        <div key={idx} className="flex justify-between items-center p-3 bg-black border border-neutral-900 rounded-lg">
                          <span className="font-bold text-foreground uppercase tracking-wide">{loc.name}</span>
                          <span className="text-primary text-[11px] font-semibold flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-primary" /> {loc.locationName || 'Location Saved'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Itinerary Placeholder */}
              {hasSubmittedSelf && !isVotingOrClosed && (
                <Card className="border border-neutral-900 bg-neutral-950/20 backdrop-blur-md rounded-xl p-8 text-center space-y-4 shadow-sm">
                  <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                    <Sparkles className="h-6 w-6 animate-pulse text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Outing Itineraries (Pending)</h3>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                      You have submitted your budget and location. Once all members finish entering their details, the admin ({group.creatorId === currentUser.id ? 'you' : 'the group host'}) will generate the outing itineraries.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto pt-2 text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                    <div className="border border-neutral-900/50 bg-black/20 p-3 rounded-lg flex flex-col items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-neutral-800" />
                      Option A (Budget-Friendly)
                    </div>
                    <div className="border border-neutral-900/50 bg-black/20 p-3 rounded-lg flex flex-col items-center gap-1 flex-1">
                      <span className="h-2 w-2 rounded-full bg-neutral-800" />
                      Option B (Balanced)
                    </div>
                    <div className="border border-neutral-900/50 bg-black/20 p-3 rounded-lg flex flex-col items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-neutral-800" />
                      Option C (Premium)
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Aggregates Dashboard */}
            <div className="space-y-6">
              <Card className="border border-border rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-sm text-xs">
                <CardHeader>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary">Budget Aggregates</CardTitle>
                  <CardDescription className="text-[10px] text-muted-foreground uppercase leading-relaxed font-light">
                    Computed aggregates from submitted budgets.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-2 font-medium">
                  <div className="flex justify-between py-2 border-b border-border/60">
                    <span className="text-muted-foreground">Submitted Envelopes</span>
                    <span className="font-bold text-foreground">
                      {budgetSummary?.submittedCount || 0} of {members.length}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/60">
                    <span className="text-muted-foreground">Floor Limit (Min)</span>
                    <span className="font-bold text-foreground">₹{budgetSummary?.min || 0}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border/60">
                    <span className="text-muted-foreground">Ceiling Limit (Max)</span>
                    <span className="font-bold text-foreground">₹{budgetSummary?.max || 0}</span>
                  </div>
                  <div className="flex justify-between py-2.5 border border-primary/20 bg-primary/10 px-3 rounded-lg text-primary font-bold uppercase">
                    <span>Group Budget Cap</span>
                    <span>₹{budgetSummary?.avg || 0}</span>
                  </div>
                </CardContent>
                <CardFooter className="bg-black/20 pt-4 border-t border-border flex flex-col items-stretch rounded-b-xl">
                  <span className="text-[10px] text-muted-foreground text-center italic">
                    Note: Budgets are not hard limits. The planner will construct options mapping different strategies.
                  </span>
                </CardFooter>
              </Card>
            </div>

          </TabsContent>

          {/* TAB 2: INPUTS FORM */}
          <TabsContent value="inputs" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Submit Budget */}
            <Card className="border border-border rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-sm">
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

            {/* Submit Location Name */}
            <Card className="border border-neutral-900 rounded-xl bg-neutral-950/20 backdrop-blur-md shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  Submit Outing Location
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-light">
                  Enter your starting location name/neighborhood (e.g. Dadar, Indiranagar) or auto-detect it.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleLocationSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-2.5">
                    <Label htmlFor="locationInput" className="text-xs uppercase text-foreground">Location Name or Neighborhood</Label>
                    <Input
                      id="locationInput"
                      type="text"
                      value={addressVal}
                      onChange={(e) => setAddressVal(e.target.value)}
                      placeholder="e.g. Dadar, Mumbai or Koramangala, Bengaluru"
                      className="bg-black border border-neutral-900 text-foreground rounded-lg text-xs focus-visible:ring-primary"
                      required
                      disabled={isSubmittingLocation || isCollectingMembers}
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-2 pt-0">
                  <Button 
                    type="submit" 
                    disabled={isSubmittingLocation || isCollectingMembers} 
                    className="w-full bg-primary hover:bg-primary/95 text-primary-foreground rounded-lg uppercase tracking-wider font-bold text-xs"
                  >
                    {isSubmittingLocation ? 'Saving Location...' : 'Save Location Name'}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleAutoDetect}
                    disabled={isSubmittingLocation || isCollectingMembers} 
                    className="w-full border-neutral-800 text-foreground hover:bg-neutral-900 rounded-lg uppercase tracking-wider font-bold text-xs"
                  >
                    Auto-Detect Location
                  </Button>
                </CardFooter>
              </form>
            </Card>

            {/* Submit Vibe Preferences */}
            <Card className="border border-border rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-sm md:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <Heart className="h-4 w-4 text-primary" />
                  Select Vibe Preferences
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-light">
                  Choose the mood and type of outing you want. These will feed the experience matching scorer.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleVibesSubmit}>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 pt-2">
                    {AVAILABLE_VIBES.map((vibe) => {
                      const isSelected = selectedVibes.includes(vibe);
                      return (
                        <button
                          type="button"
                          key={vibe}
                          onClick={() => toggleVibe(vibe)}
                          disabled={isSubmittingVibes}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                            isSelected 
                              ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/25'
                              : 'bg-black border-border hover:border-primary/50 text-muted-foreground'
                          }`}
                        >
                          {vibe.toLowerCase()}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={isSubmittingVibes} className="w-full bg-primary hover:bg-primary/95 text-primary-foreground rounded-lg uppercase tracking-wider font-bold text-xs">
                    {isSubmittingVibes ? 'Saving...' : 'Save Vibe Preferences'}
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
