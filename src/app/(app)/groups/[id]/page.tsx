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
import { generatePlan, getPlansForGroupAction } from '@/actions/planner';
import { createVote, closeVoting, countVotes, getUserVoteForGroup } from '@/actions/votes';
import { Users, DollarSign, MapPin, Sparkles, Share2, Shield, ArrowRight, Loader2, Heart, RefreshCw, Award, Vote, Check } from 'lucide-react';
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

  // Planner and voting states
  const [plans, setPlans] = useState<any[]>([]);
  const [activePlanIdx, setActivePlanIdx] = useState<number>(0);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [userVotedPlanId, setUserVotedPlanId] = useState<string | null>(null);
  const [isCasting, setIsCasting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const carouselRef = React.useRef<HTMLDivElement>(null);

  const scrollToPlan = (idx: number) => {
    if (carouselRef.current) {
      const width = carouselRef.current.offsetWidth;
      carouselRef.current.scrollTo({
        left: idx * width,
        behavior: 'smooth'
      });
      setActivePlanIdx(idx);
    }
  };

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

        // If plans are generated, load plans, vote counts, and user's vote
        if (['VOTING', 'COMPLETED', 'ARCHIVED'].includes(res.data.group.status)) {
          const [plansRes, voteTalliesRes, userVoteRes] = await Promise.all([
            getPlansForGroupAction(groupId),
            countVotes(groupId),
            getUserVoteForGroup(groupId),
          ]);

          if (plansRes.success) {
            setPlans(plansRes.data);
          }
          if (voteTalliesRes.success) {
            const tallies = voteTalliesRes.data.reduce((acc: any, t: any) => {
              acc[t.planId] = t.count;
              return acc;
            }, {});
            setVotes(tallies);
          }
          if (userVoteRes.success) {
            setUserVotedPlanId(userVoteRes.data);
          }
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

    // Polling interval to reflect live updates (every 5 seconds)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [groupId]);

  const handleVoteCast = async (planId: string) => {
    setIsCasting(true);
    try {
      const res = await createVote({
        groupId: groupId,
        planId: planId,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit vote');
        setIsCasting(false);
        return;
      }

      toast.success('Vote cast successfully!');
      setUserVotedPlanId(planId);

      // Re-fetch tallies to ensure accuracy
      const voteTalliesRes = await countVotes(groupId);
      if (voteTalliesRes.success) {
        const tallies = voteTalliesRes.data.reduce((acc: any, t: any) => {
          acc[t.planId] = t.count;
          return acc;
        }, {});
        setVotes(tallies);
      }

      await loadData();
    } catch (_err) {
      toast.error('An error occurred submitting your vote.');
    } finally {
      setIsCasting(false);
    }
  };

  const handleCloseVoting = async () => {
    setIsClosing(true);
    try {
      const res = await closeVoting(groupId);

      if (!res.success) {
        toast.error(res.error.message || 'Failed to close voting');
        setIsClosing(false);
        return;
      }

      toast.success('Voting closed successfully! Winner declared.');
      await loadData();
    } catch (_err) {
      toast.error('An error occurred closing voting.');
    } finally {
      setIsClosing(false);
    }
  };

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

  const { group, members, budgetSummary, submittedBudgetUserIds, locations, currentUser } = data;
  const isAdmin = currentUser.role === 'ADMIN';

  // Retrieve vibes of the current user
  const currentMember = members.find((m: any) => m.userId === currentUser.id);
  let hasVibes = false;
  if (currentMember && currentMember.vibes) {
    try {
      hasVibes = JSON.parse(currentMember.vibes).length > 0;
    } catch (_e) {}
  }

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
      subtitle={`Lobby Status: ${group.status.replace('_', ' ')}`}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActivePlanIdx(0);
                toast.success("Reset active carousel view to Option A.");
              }}
              className="flex items-center gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary font-semibold tracking-wide"
            >
              <RefreshCw className="h-4 w-4" /> Reset View
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6 font-sans text-sm">
        
        {/* 1. Top Section Summary Card */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-neutral-950 via-neutral-950 to-primary/5 border border-border/60 p-5 rounded-2xl shadow-xl space-y-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex justify-between items-start gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-extrabold text-foreground tracking-tight flex flex-wrap items-center gap-2">
                <span>🎉 {group.name}</span>
              </h1>
              <p className="text-xs text-muted-foreground font-light line-clamp-1">{group.description || 'Experience-first Outing lobby'}</p>
            </div>
            
            <Badge variant="outline" className={`shrink-0 rounded-full py-1 px-3 text-[10px] font-bold uppercase tracking-wider ${
              group.status === 'VOTING' 
                ? 'bg-primary/15 text-primary border-primary/30 animate-pulse'
                : group.status === 'COMPLETED'
                  ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                  : 'bg-neutral-900 text-muted-foreground border-border'
            }`}>
              {group.status.replace('_', ' ').replace('COLLECTING ', '')}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/40 text-[11px] text-muted-foreground font-medium">
            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground/60 uppercase tracking-widest font-bold">Members</p>
              <p className="text-xs font-extrabold text-foreground flex items-center gap-1">
                <Users className="h-3 w-3 text-primary" /> {members.length}
              </p>
            </div>
            
            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground/60 uppercase tracking-widest font-bold">Budget Range</p>
              <p className="text-xs font-extrabold text-foreground">
                ₹{budgetSummary?.min || 300} - ₹{budgetSummary?.max || 700}
              </p>
            </div>

            <div className="space-y-0.5">
              <p className="text-[9px] text-muted-foreground/60 uppercase tracking-widest font-bold">Vibe</p>
              <p className="text-xs font-extrabold text-primary truncate">
                {group.vibes ? JSON.parse(group.vibes).slice(0, 2).map((v: string) => v.charAt(0) + v.slice(1).toLowerCase()).join(', ') : 'Creative, Foodie'}
              </p>
            </div>
          </div>
          
          <div className="pt-2 border-t border-border/30 text-[11px] text-muted-foreground">
            <p className="text-[9px] text-muted-foreground/60 uppercase tracking-widest font-bold mb-0.5">Location Spread</p>
            <p className="text-xs font-bold text-foreground truncate">
              {locations.length > 0 
                ? locations.map((l: any) => l.locationName?.split(',')[0].trim()).filter(Boolean).join(' • ')
                : 'Waiting for members...'}
            </p>
          </div>
        </Card>

        {/* Status Notification Banner (Cooking status) */}
        {isGeneratingState && (
          <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 p-4 rounded-xl text-primary text-xs font-semibold animate-pulse">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Itineraries are currently being cooked. Check back in a few seconds...</span>
            <Button size="xs" variant="ghost" onClick={loadData} className="ml-auto flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Reload
            </Button>
          </div>
        )}

        {/* 2. Member Progress Section (Before Generation) */}
        {!isVotingOrClosed && !isGeneratingState && (
          <Card className="border border-border/60 rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-md p-4 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border/40">
              <div>
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Members Ready
                </CardTitle>
                <p className="text-[10px] text-muted-foreground font-light mt-0.5">
                  Lobby registers green as soon as coordinates & budget caps are entered.
                </p>
              </div>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-extrabold py-0.5 px-2.5 rounded-lg shrink-0">
                {members.filter((m: any) => {
                  const hasBudget = submittedBudgetUserIds.includes(m.userId);
                  const hasLocation = locations.some((l: any) => l.userId === m.userId);
                  return hasBudget && hasLocation;
                }).length} / {members.length} Complete
              </Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-2 pt-1 font-medium">
              {members.map((member: any) => {
                const hasBudget = submittedBudgetUserIds.includes(member.userId);
                const hasLocation = locations.some((l: any) => l.userId === member.userId);
                const isReady = hasBudget && hasLocation;

                return (
                  <div key={member.userId} className="flex items-center justify-between p-2 bg-neutral-950/80 border border-neutral-900 rounded-xl text-xs hover:border-border/80 transition-all duration-200">
                    <span className="text-foreground font-bold truncate pr-1">{member.name}</span>
                    <span className="text-sm shrink-0 leading-none">
                      {isReady ? '🟢' : '🟡'}
                    </span>
                  </div>
                );
              })}
            </div>

            {isAdmin && (
              <div className="pt-2">
                <Button
                  onClick={handlePlanGeneration}
                  disabled={isGenerating || members.filter((m: any) => {
                    const hasBudget = submittedBudgetUserIds.includes(m.userId);
                    const hasLocation = locations.some((l: any) => l.userId === m.userId);
                    return hasBudget && hasLocation;
                  }).length !== members.length}
                  className="w-full bg-primary hover:bg-primary/95 text-primary-foreground font-bold rounded-xl uppercase tracking-wider text-xs py-3.5 shadow-md disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating Itineraries...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Itineraries
                    </>
                  )}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* 3. Horizontal Swipe Carousel of Itineraries (After Generation) */}
        {isVotingOrClosed && plans.length > 0 && (
          <Card className="border border-border/60 rounded-2xl bg-neutral-950/45 backdrop-blur-md shadow-lg p-4 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border/40">
              <div>
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Outing Itinerary Options
                </CardTitle>
                <p className="text-[10px] text-muted-foreground font-light mt-0.5">
                  Swipe through plans and cast your vote on your favorite option.
                </p>
              </div>
              <Badge variant="outline" className={`rounded-full py-0.5 px-2.5 text-[9px] font-bold uppercase tracking-wider ${
                group.votingStatus === 'OPEN' 
                  ? 'bg-primary/10 text-primary border-primary/20 animate-pulse' 
                  : 'bg-neutral-800 text-muted-foreground border-border'
              }`}>
                Voting: {group.votingStatus.toLowerCase()}
              </Badge>
            </div>

            {/* Scroll Carousel */}
            <div 
              ref={carouselRef}
              className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth scrollbar-none px-0.5"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              onScroll={(e) => {
                const container = e.currentTarget;
                const scrollLeft = container.scrollLeft;
                const width = container.offsetWidth;
                const newIdx = Math.round(scrollLeft / width);
                if (newIdx !== activePlanIdx && newIdx >= 0 && newIdx < plans.length) {
                  setActivePlanIdx(newIdx);
                }
              }}
            >
              {plans.map((plan, idx) => {
                const voteCount = votes[plan.id] || 0;
                const hasUserVoted = userVotedPlanId === plan.id;
                const isPlanWinner = group.winningPlanId === plan.id;
                
                const tierMap: Record<string, string> = {
                  BUDGET_FRIENDLY: 'Most Convenient',
                  BALANCED: 'Balanced Vibe',
                  PREMIUM: 'Premium Pick',
                };
                const tag = tierMap[plan.budgetTier] || 'Alternative Option';

                return (
                  <div 
                    key={plan.id}
                    className="w-full shrink-0 snap-center snap-always space-y-4"
                  >
                    <Card className="bg-black/40 border border-neutral-900/60 rounded-2xl p-5 shadow-inner">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="text-[9px] uppercase font-extrabold text-primary tracking-widest">{tag}</span>
                          <h3 className="text-base font-extrabold text-foreground mt-0.5 uppercase tracking-wide">{plan.name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5 font-light leading-relaxed line-clamp-1">{plan.tagline}</p>
                        </div>
                        {isPlanWinner ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/10 hover:text-emerald-500 rounded-full flex items-center gap-1 text-[9px] font-bold py-0.5 px-2.5 uppercase tracking-wide shrink-0">
                            <Award className="h-3 w-3" />
                            Winner
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/10 hover:text-primary rounded-full flex items-center gap-1 text-[9px] font-bold py-0.5 px-2.5 uppercase tracking-wide shrink-0">
                            <Vote className="h-3 w-3" />
                            {voteCount} votes
                          </Badge>
                        )}
                      </div>

                      {/* Compact Itinerary Flow using Actual places */}
                      <div className="flex flex-col items-center justify-center py-4 my-3 bg-neutral-950/75 rounded-2xl border border-neutral-900/85 space-y-2 text-center">
                        {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                          <React.Fragment key={sIdx}>
                            <div className="px-3">
                              <p className="text-xs font-bold text-foreground tracking-wide leading-snug">{slot.name}</p>
                              <p className="text-[9px] text-muted-foreground uppercase font-sans tracking-wide mt-0.5">
                                {slot.category.toLowerCase()} • {slot.arrivalTime} ({slot.durationMinutes}m)
                              </p>
                            </div>
                            {sIdx < (plan.slots.length - 1) && (
                              <span className="text-primary/70 font-black text-xs">↓</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>

                      {/* Travel and cost footer statistics */}
                      <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-border/40 text-center text-[10px] font-semibold text-muted-foreground uppercase">
                        <div className="space-y-0.5">
                          <p className="text-[9px] text-muted-foreground/60 tracking-wider">Per Head</p>
                          <p className="text-xs font-extrabold text-foreground">₹{plan.totalEstimatedCostPerHead}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] text-muted-foreground/60 tracking-wider">Avg Travel</p>
                          <p className="text-xs font-extrabold text-foreground">{plan.avgCabTime} mins</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] text-muted-foreground/60 tracking-wider">Plan Score</p>
                          <p className="text-xs font-extrabold text-primary">⭐ {(plan.score * 10).toFixed(1)}/10</p>
                        </div>
                      </div>
                    </Card>

                    {/* Voting Action */}
                    {group.votingStatus === 'OPEN' && (
                      <Button
                        size="sm"
                        disabled={isCasting || userVotedPlanId === plan.id}
                        onClick={() => handleVoteCast(plan.id)}
                        className={`w-full font-bold rounded-xl uppercase tracking-wider text-xs py-3.5 shadow-md transition-all duration-200 cursor-pointer ${
                          userVotedPlanId === plan.id
                            ? 'bg-emerald-600 hover:bg-emerald-600/90 text-white'
                            : 'bg-primary hover:bg-primary/95 text-primary-foreground'
                        }`}
                      >
                        {userVotedPlanId === plan.id ? (
                          <>
                            <Check className="mr-2 h-4 w-4" /> Voted & Accepted
                          </>
                        ) : (
                          <>
                            <Vote className="mr-2 h-4 w-4" /> Vote for Option {plan.planIndex}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Carousel Navigation Controls */}
            <div className="flex justify-between items-center mt-3 px-1">
              <Button 
                variant="outline" 
                size="xs" 
                disabled={activePlanIdx === 0} 
                onClick={() => scrollToPlan(activePlanIdx - 1)}
                className="rounded-lg border-border text-[10px] h-7 px-3.5 font-bold cursor-pointer"
              >
                Prev
              </Button>
              
              {/* Dots indicator */}
              <div className="flex gap-2">
                {plans.map((_, idx) => (
                  <span 
                    key={idx} 
                    onClick={() => scrollToPlan(idx)}
                    className={`h-2 w-2 rounded-full cursor-pointer transition-all duration-300 ${
                      idx === activePlanIdx ? 'bg-primary scale-125' : 'bg-neutral-800 hover:bg-neutral-700'
                    }`}
                  />
                ))}
              </div>

              <Button 
                variant="outline" 
                size="xs" 
                disabled={activePlanIdx === plans.length - 1} 
                onClick={() => scrollToPlan(activePlanIdx + 1)}
                className="rounded-lg border-border text-[10px] h-7 px-3.5 font-bold cursor-pointer"
              >
                Next
              </Button>
            </div>

            {isAdmin && group.votingStatus === 'OPEN' && (
              <div className="pt-2">
                <Button
                  variant="destructive"
                  onClick={handleCloseVoting}
                  disabled={isClosing}
                  className="w-full rounded-xl font-bold uppercase tracking-wider text-xs py-3.5 bg-red-650 hover:bg-red-600 cursor-pointer"
                >
                  Close Voting & Declare Winner
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* 4. Details Submission & Member overview (Locked post-generation to avoid clutter) */}
        {!isVotingOrClosed && (
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
                    <Button 
                      type="submit" 
                      disabled={isSubmittingBudget} 
                      className={`w-full rounded-lg uppercase tracking-wider font-bold text-xs transition-colors duration-200 ${
                        currentUser.budget !== null 
                          ? 'bg-emerald-600 hover:bg-emerald-600/90 text-white' 
                          : 'bg-primary hover:bg-primary/95 text-primary-foreground'
                      }`}
                    >
                      {isSubmittingBudget ? 'Saving...' : currentUser.budget !== null ? '✓ Budget Accepted' : 'Submit Budget'}
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
                      className={`w-full rounded-lg uppercase tracking-wider font-bold text-xs transition-colors duration-200 ${
                        currentUser.location !== null 
                          ? 'bg-emerald-600 hover:bg-emerald-600/90 text-white' 
                          : 'bg-primary hover:bg-primary/95 text-primary-foreground'
                      }`}
                    >
                      {isSubmittingLocation 
                        ? 'Saving Location...' 
                        : currentUser.location !== null 
                          ? '✓ Location Accepted' 
                          : 'Save Location Name'}
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
                    <Button 
                      type="submit" 
                      disabled={isSubmittingVibes} 
                      className={`w-full rounded-lg uppercase tracking-wider font-bold text-xs transition-colors duration-200 ${
                        hasVibes 
                          ? 'bg-emerald-600 hover:bg-emerald-600/90 text-white' 
                          : 'bg-primary hover:bg-primary/95 text-primary-foreground'
                      }`}
                    >
                      {isSubmittingVibes ? 'Saving...' : hasVibes ? '✓ Preferences Saved & Accepted' : 'Save Vibe Preferences'}
                    </Button>
                  </CardFooter>
                </form>
              </Card>

            </TabsContent>
          </Tabs>
        )}
      </div>
    </PageContainer>
  );
}
