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
      toast.loading("Detecting your precise location...");
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
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
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

  const [isSubmittingDetails, setIsSubmittingDetails] = useState(false);

  const handleUnifiedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingDetails(true);
    
    try {
      const budgetAmount = parseInt(budgetVal) || 2000;
      const budgetRes = await submitBudget({
        groupId: groupId,
        maxBudget: budgetAmount,
      });

      const lat = parseFloat(latVal) || undefined;
      const lng = parseFloat(lngVal) || undefined;
      const locationRes = await saveLocation({
        groupId: groupId,
        locationName: addressVal || "My Location",
        lat,
        lng,
      });

      const vibesRes = await submitMemberVibes(groupId, selectedVibes);

      if (budgetRes.success && locationRes.success && vibesRes.success) {
        toast.success("Lobby details synced successfully!");
      } else {
        const errorMsg = (!budgetRes.success ? (budgetRes as any).error?.message : '') || 
                         (!locationRes.success ? (locationRes as any).error?.message : '') || 
                         (!vibesRes.success ? (vibesRes as any).error?.message : '') || 
                         "Details failed to save";
        toast.error(errorMsg);
      }
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during details submission.");
    } finally {
      setIsSubmittingDetails(false);
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
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-[#0A0A0C] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mb-4" />
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono font-bold">Initializing Workspace Module...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <PageContainer title="Lobby Workspace">
        <Card className="border border-stone-900 bg-stone-950/45 text-center p-8 rounded-[12px] backdrop-blur-md">
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-4">Workspace not found or you are not a member.</p>
          <Link href="/groups" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'border-stone-800 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 transition-all' })}>
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
    <main className="hud-grid relative min-h-screen pt-10 pb-24 md:pb-10 bg-[#131313] text-[#e5e2e1] overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-6 relative z-10">
        
        {/* Protocol Header */}
        <div className="border-l-4 border-[#DC143C] pl-6 py-3 bg-[#0e0e0e]/40 rounded-r-[4px] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 text-[#DC143C] mb-1.5">
              <Shield className="h-4.5 w-4.5" />
              <span className="font-mono text-[10px] font-bold tracking-[0.2em] uppercase">
                STATUS: {group.status.replace('_', ' ')}
              </span>
            </div>
            <h1 className="font-sans text-3xl font-normal text-white uppercase leading-none tracking-wide">
              LOBBY: {group.name}
            </h1>
            <p className="font-mono text-[10px] text-neutral-400 mt-2 flex flex-wrap items-center gap-2">
              <span>UUID: {group.id.substring(0, 8).toUpperCase()}</span>
              <span className="text-neutral-600">|</span>
              <span>INVITE CODE:</span>
              <code className="bg-stone-900 border border-stone-850 px-2 py-0.5 rounded-[4px] text-[#DC143C] font-mono select-all font-bold text-[11px]">{group.inviteCode}</code>
            </p>
          </div>
          
          {group.status !== 'COMPLETED' && group.status !== 'ARCHIVED' && (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleShareCode} 
                className="border-[#353534] bg-[#1c1b1b]/55 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] px-4 py-2.5 gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
              >
                <Share2 className="h-3.5 w-3.5 text-[#DC143C]" />
                Share Code
              </Button>
            </div>
          )}
        </div>

        {/* Status Notification Banner (Cooking status) */}
        {isGeneratingState && (
          <div className="flex items-center gap-3 bg-[#DC143C]/10 border border-[#DC143C]/20 p-4 rounded-[4px] text-[#DC143C] text-[10px] font-bold uppercase tracking-wider animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin text-[#DC143C]" />
            <span>AI Itineraries are currently being cooked. Check back shortly...</span>
            <Button size="xs" variant="ghost" onClick={loadData} className="ml-auto flex items-center gap-1 text-[9px] hover:bg-[#DC143C]/20 text-[#DC143C] hover:text-[#DC143C]">
              <RefreshCw className="h-3 w-3 animate-spin" /> Reload
            </Button>
          </div>
        )}

        {/* Horizontal Swipe Carousel (Mobile) & Grid (Desktop) of Itineraries */}
        {isVotingOrClosed && plans.length > 0 && (
          <div className="space-y-6">
            {/* Case A: Outing Completed / Winner Declared */}
            {(group.status === 'COMPLETED' || group.status === 'ARCHIVED') ? (
              (() => {
                const winner = plans.find((p: any) => p.id === group.winningPlanId) || plans[0];
                return (
                  <Card className="relative overflow-hidden border border-[#00E1AB]/20 rounded-[8px] bg-[#0e0e0e]/80 backdrop-blur-md shadow-lg p-6 space-y-6">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#00E1AB]/5 rounded-full blur-3xl pointer-events-none" />
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#353534] pb-4">
                      <div>
                        <span className="text-[9px] uppercase font-bold text-[#00E1AB] tracking-widest flex items-center gap-1 font-mono">
                          <Award className="h-3.5 w-3.5 text-[#00E1AB]" /> Final Outing Protocol
                        </span>
                        <h2 className="text-lg font-bold text-white mt-1 uppercase tracking-wide font-mono">{winner.name}</h2>
                        <p className="text-xs text-neutral-400 mt-0.5 font-sans leading-relaxed tracking-wide">{winner.tagline}</p>
                      </div>
                      
                      <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 rounded-[4px] flex items-center gap-1.5 text-[9px] font-mono font-bold py-1 px-3 uppercase tracking-widest">
                        <Check className="h-3.5 w-3.5" /> Outing Locked
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Left: Final Itinerary slots flow */}
                      <div className="lg:col-span-2 space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5 font-mono">
                          📍 Primary Node: {winner.meetupZone.toUpperCase()}
                        </h3>
                        
                        <div className="flex flex-col items-stretch justify-start py-2 space-y-3">
                          {winner.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                            <React.Fragment key={sIdx}>
                              <div className="flex items-start gap-4 p-4 bg-[#1c1b1b] border border-[#353534] rounded-[4px]">
                                <span className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#00E1AB]/10 text-[#00E1AB] text-xs font-mono font-bold border border-[#00E1AB]/20 shrink-0">
                                  {slot.slotOrder}
                                </span>
                                <div className="space-y-1">
                                  <h4 className="text-sm font-bold text-white leading-snug font-mono">{slot.name.toUpperCase()}</h4>
                                  <p className="text-[10px] text-neutral-400 uppercase font-mono tracking-widest">
                                    {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}M)
                                  </p>
                                  {slot.note && (
                                    <p className="text-[11px] text-neutral-400 font-sans leading-relaxed italic mt-1.5">
                                      "{slot.note}"
                                    </p>
                                  )}
                                </div>
                              </div>
                              {sIdx < (winner.slots.length - 1) && (
                                <div className="flex justify-center my-0.5">
                                  <span className="text-[#00E1AB]/60 font-black text-sm">↓</span>
                                </div>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>

                      {/* Right: Summary details */}
                      <div className="space-y-4 bg-[#1c1b1b] border border-[#353534] rounded-[4px] p-5 h-fit text-[11px]">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C] font-mono">Itinerary Analysis</h3>
                        
                        <div className="divide-y divide-[#353534] text-[11px] font-mono space-y-3">
                          <div className="flex justify-between py-2">
                            <span className="text-neutral-400">ESTIMATED COST</span>
                            <span className="font-extrabold text-white">₹{winner.totalEstimatedCostPerHead} / PERSON</span>
                          </div>
                          <div className="flex justify-between py-2">
                            <span className="text-neutral-400">COMMUTE TIME</span>
                            <span className="font-extrabold text-white">~{winner.avgCabTime} MINS</span>
                          </div>
                          <div className="flex justify-between py-2">
                            <span className="text-neutral-400">ITINERARY SCORE</span>
                            <span className="font-extrabold text-[#DC143C]">{(winner.score * 10).toFixed(1)}/10</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-[#353534]">
                            <span className="text-neutral-400">MEETUP ZONE</span>
                            <span className="font-extrabold text-white uppercase">{winner.meetupZone}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })()
            ) : (
              /* Case B: Voting Phase */
              <div className="space-y-6">
                {/* 1. Mobile Carousel View (block md:hidden) */}
                <Card className="block md:hidden border border-[#353534] bg-[#0e0e0e]/80 backdrop-blur-md shadow-lg p-4 space-y-4 rounded-[8px]">
                  <div className="flex justify-between items-center pb-2 border-b border-[#353534]">
                    <div className="space-y-0.5">
                      <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        Outing Options
                      </CardTitle>
                      <p className="text-[9px] text-neutral-400 font-sans tracking-wide leading-relaxed">
                        Swipe through plans and lock your vote on your preferred routing.
                      </p>
                    </div>
                    <Badge variant="outline" className={`rounded-[4px] py-0.5 px-2.5 text-[9px] font-mono font-bold uppercase tracking-widest shrink-0 ${
                      group.votingStatus === 'OPEN' 
                        ? 'bg-[#DC143C]/10 text-[#DC143C] border-[#DC143C]/20 animate-pulse' 
                        : 'bg-stone-900/40 text-neutral-400 border-stone-850'
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

                      return (
                        <div 
                          key={plan.id}
                          className="w-full shrink-0 snap-center snap-always space-y-4"
                        >
                          <Card className="bg-[#1c1b1b] border border-[#353534] rounded-[8px] p-5 shadow-inner">
                            <div className="flex justify-between items-start gap-2">
                              <div>
                                <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest flex items-center gap-1 font-mono">
                                  📍 Zone: {plan.meetupZone.toUpperCase()}
                                </span>
                                <h3 className="text-sm font-bold text-white mt-1.5 uppercase tracking-wider font-mono">{plan.name}</h3>
                                <p className="text-[10px] text-neutral-400 mt-0.5 font-sans tracking-wide leading-relaxed line-clamp-1">{plan.tagline}</p>
                              </div>
                              <Badge variant="secondary" className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 hover:bg-[#DC143C]/10 hover:text-[#DC143C] rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2.5 uppercase tracking-widest shrink-0">
                                <Vote className="h-3 w-3" />
                                {voteCount} VOTES
                              </Badge>
                            </div>

                            {/* Compact Itinerary Flow using Actual places */}
                            <div className="flex flex-col items-center justify-center py-4 my-3 bg-[#0e0e0e]/90 rounded-[4px] border border-[#353534] space-y-2 text-center">
                              {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                                <React.Fragment key={sIdx}>
                                  <div className="px-3">
                                    <p className="text-[11px] font-bold text-white tracking-wider leading-snug font-mono">{slot.name.toUpperCase()}</p>
                                    <p className="text-[9px] text-neutral-400 uppercase font-mono tracking-widest mt-0.5">
                                      {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}M)
                                    </p>
                                  </div>
                                  {sIdx < (plan.slots.length - 1) && (
                                    <span className="text-[#DC143C]/70 font-black text-xs">↓</span>
                                  )}
                                </React.Fragment>
                              ))}
                            </div>

                            {/* Travel and cost footer statistics */}
                            <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-[#353534] text-center text-[10px] font-bold text-neutral-400 uppercase font-mono">
                              <div className="space-y-0.5">
                                <p className="text-[9px] text-neutral-500 tracking-wider">Per Head</p>
                                <p className="text-xs font-bold text-white">₹{plan.totalEstimatedCostPerHead}</p>
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-[9px] text-neutral-500 tracking-wider">Avg Travel</p>
                                <p className="text-xs font-bold text-white">{plan.avgCabTime} M</p>
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-[9px] text-neutral-500 tracking-wider">Score</p>
                                <p className="text-xs font-bold text-[#DC143C]">{(plan.score * 10).toFixed(1)}/10</p>
                              </div>
                            </div>
                          </Card>

                          {/* Voting Action */}
                          {group.votingStatus === 'OPEN' && (
                            <Button
                              size="sm"
                              disabled={isCasting || userVotedPlanId === plan.id}
                              onClick={() => handleVoteCast(plan.id)}
                              className={`w-full font-mono font-bold rounded-[4px] uppercase tracking-widest text-[10px] py-3.5 shadow-md transition-all duration-200 cursor-pointer ${
                                userVotedPlanId === plan.id
                                  ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/20 text-[#00E1AB]'
                                  : 'bg-[#DC143C] hover:bg-[#B80F2E] text-black font-bold'
                              }`}
                            >
                              {userVotedPlanId === plan.id ? (
                                <>
                                  <Check className="mr-2 h-4 w-4 text-[#00E1AB]" /> VOTE REGISTERED
                                </>
                              ) : (
                                <>
                                  <Vote className="mr-2 h-4 w-4" /> SUBMIT VOTE FOR PLAN {plan.planIndex}
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
                      className="border-[#353534] bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] h-7 px-3.5 cursor-pointer"
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
                            idx === activePlanIdx ? 'bg-[#DC143C] scale-125' : 'bg-stone-900 hover:bg-stone-800'
                          }`}
                        />
                      ))}
                    </div>

                    <Button 
                      variant="outline" 
                      size="xs" 
                      disabled={activePlanIdx === plans.length - 1} 
                      onClick={() => scrollToPlan(activePlanIdx + 1)}
                      className="border-[#353534] bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] h-7 px-3.5 cursor-pointer"
                    >
                      Next
                    </Button>
                  </div>
                </Card>

                {/* 2. Desktop Grid View (hidden md:grid) */}
                <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {plans.map((plan) => {
                    const voteCount = votes[plan.id] || 0;

                    return (
                      <Card key={plan.id} className="border border-[#353534] bg-[#0e0e0e]/80 p-5 shadow-lg backdrop-blur-md flex flex-col justify-between space-y-4 rounded-[8px]">
                        <div className="space-y-4">
                          <div className="flex justify-between items-start gap-2 border-b border-[#353534] pb-3">
                            <div>
                              <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest flex items-center gap-1 font-mono">
                                📍 Zone: {plan.meetupZone.toUpperCase()}
                              </span>
                              <h3 className="text-xs font-bold text-white mt-1.5 uppercase tracking-widest font-mono line-clamp-1">{plan.name}</h3>
                              <p className="text-[10px] text-neutral-400 mt-0.5 font-sans tracking-wide leading-relaxed line-clamp-2 min-h-[2.5rem]">{plan.tagline}</p>
                            </div>
                            <Badge variant="secondary" className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2 uppercase tracking-widest shrink-0">
                              <Vote className="h-3 w-3" />
                              {voteCount}
                            </Badge>
                          </div>

                          {/* Timeline Listing */}
                          <div className="flex flex-col items-center justify-center py-3 bg-[#131313]/95 rounded-[4px] border border-[#353534] space-y-1.5 text-center min-h-[14rem]">
                            {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                              <React.Fragment key={sIdx}>
                                <div className="px-2">
                                  <p className="text-[11px] font-bold text-white tracking-wider leading-snug font-mono line-clamp-2">{slot.name.toUpperCase()}</p>
                                  <p className="text-[9px] text-neutral-400 uppercase font-mono tracking-widest mt-0.5">
                                    {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}M)
                                  </p>
                                </div>
                                {sIdx < (plan.slots.length - 1) && (
                                  <span className="text-[#DC143C]/70 font-black text-[10px]">↓</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>

                          {/* Stats Grid */}
                          <div className="grid grid-cols-3 gap-1 py-3 border-t border-b border-[#353534] text-center text-[9px] font-bold text-neutral-400 uppercase font-mono">
                            <div className="space-y-0.5">
                              <p className="text-[8px] text-neutral-500 tracking-wider">Per Head</p>
                              <p className="text-xs font-bold text-white">₹{plan.totalEstimatedCostPerHead}</p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[8px] text-neutral-500 tracking-wider">Avg Travel</p>
                              <p className="text-xs font-bold text-white">{plan.avgCabTime} M</p>
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[8px] text-neutral-500 tracking-wider">Score</p>
                              <p className="text-xs font-bold text-[#DC143C]">{(plan.score * 10).toFixed(1)}</p>
                            </div>
                          </div>
                        </div>

                        {/* Voting Action */}
                        {group.votingStatus === 'OPEN' && (
                          <Button
                            size="sm"
                            disabled={isCasting || userVotedPlanId === plan.id}
                            onClick={() => handleVoteCast(plan.id)}
                            className={`w-full font-mono font-bold rounded-[4px] uppercase tracking-widest text-[9px] py-3 shadow-md transition-all duration-200 cursor-pointer ${
                              userVotedPlanId === plan.id
                                ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/20 text-[#00E1AB]'
                                : 'bg-[#DC143C] hover:bg-[#B80F2E] text-black'
                            }`}
                          >
                            {userVotedPlanId === plan.id ? (
                              <>
                                <Check className="mr-1.5 h-3.5 w-3.5 text-[#00E1AB]" /> VOTED
                              </>
                            ) : (
                              <>
                                <Vote className="mr-1.5 h-3.5 w-3.5" /> VOTE PLAN {plan.planIndex}
                              </>
                            )}
                          </Button>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Admin Close Button (rendered at bottom during open voting phase) */}
            {isAdmin && group.votingStatus === 'OPEN' && (
              <div className="pt-2">
                <Button
                  variant="destructive"
                  onClick={handleCloseVoting}
                  disabled={isClosing}
                  className="w-full bg-red-950/45 text-red-500 border border-red-900/50 hover:bg-red-950/80 hover:text-red-400 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] py-3.5 transition-all cursor-pointer"
                >
                  Close Voting & Declare Winner
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 4. Details Submission & Member overview (Locked post-generation to avoid clutter) */}
        {!isVotingOrClosed && (
          <div className="flex flex-col md:grid md:grid-cols-12 gap-6 pt-4 text-left">
            
            {/* Left: Sidebar Member Sync Status */}
            <aside className="md:col-span-3 space-y-6">
              
              {/* Member Sync Card */}
              <div className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] p-6 relative overflow-hidden rounded-[8px]">
                <div className="scanning-line opacity-20" />
                
                <h3 className="font-mono text-xs font-bold text-[#DC143C] uppercase mb-6 flex justify-between items-center tracking-wider">
                  Member Sync
                  <span className="text-neutral-400 text-[9px] font-bold">
                    {members.length > 0 
                      ? Math.round((members.filter((m: any) => submittedBudgetUserIds.includes(m.userId) && locations.some((l: any) => l.userId === m.userId)).length / members.length) * 100)
                      : 0}% ACTIVE
                  </span>
                </h3>

                <ul className="space-y-4">
                  {members.map((member: any) => {
                    const hasBudget = submittedBudgetUserIds.includes(member.userId);
                    const hasLocation = locations.some((l: any) => l.userId === member.userId);
                    const isSynced = hasBudget && hasLocation;

                    return (
                      <li key={member.userId} className={`flex items-center gap-3 transition-all ${isSynced ? '' : 'opacity-70 grayscale hover:grayscale-0 hover:opacity-100'}`}>
                        <div className={`w-9 h-9 border p-0.5 rounded-[4px] flex-shrink-0 ${isSynced ? 'border-[#DC143C] shadow-[0_0_8px_rgba(220,20,60,0.25)] bg-[#DC143C]/5' : 'border-[#353534]'}`}>
                          {member.imageUrl ? (
                            <img src={member.imageUrl} alt={member.name} className="w-full h-full object-cover rounded-[2px]" />
                          ) : (
                            <div className="w-full h-full bg-stone-900 border border-[#353534] flex items-center justify-center font-mono font-bold text-[10px] uppercase text-[#DC143C] rounded-[2px]">
                              {member.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono font-bold text-[11px] text-white uppercase truncate">{member.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isSynced ? 'bg-[#00E1AB] animate-pulse shadow-[0_0_6px_#00E1AB]' : 'bg-stone-850'}`} />
                            <span className={`text-[8.5px] font-mono font-bold uppercase ${isSynced ? 'text-[#00E1AB]' : 'text-neutral-500'}`}>
                              {isSynced ? 'Synced' : 'Pending'}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {isAdmin && (
                  <div className="pt-6 border-t border-[#353534]/50 mt-6">
                    <Button
                      onClick={handlePlanGeneration}
                      disabled={isGenerating || members.filter((m: any) => {
                        const hasBudget = submittedBudgetUserIds.includes(m.userId);
                        const hasLocation = locations.some((l: any) => l.userId === m.userId);
                        return hasBudget && hasLocation;
                      }).length !== members.length}
                      className="w-full bg-[#DC143C] hover:bg-[#B80F2E] text-black text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] py-3.5 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-[0_0_15px_rgba(220,20,60,0.3)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin text-black" />
                          COOKING ITINERARIES...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4 text-black fill-black" />
                          GENERATE ITINERARIES
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

            </aside>

            {/* Center/Right: Data Collection Flow */}
            <form onSubmit={handleUnifiedSubmit} className="md:col-span-9 space-y-6">
              
              {/* Protocol Step 1: Location */}
              <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <span className="text-[#DC143C]">01</span> Phase: Extraction Point
                  </h2>
                  <MapPin className="text-[#DC143C] h-4 w-4" />
                </div>
                <div className="p-5 space-y-4">
                  <div className="relative h-40 w-full bg-[#1c1b1b] border border-[#353534] rounded-[4px] overflow-hidden flex flex-col justify-center px-6 sm:px-10 space-y-5">
                    <div className="absolute inset-0 hud-grid opacity-20 pointer-events-none"></div>
                    <div className="scanning-line opacity-10"></div>
                    
                    <div className="space-y-1.5 relative z-10">
                      <label className="font-mono text-[8.5px] text-[#DC143C] uppercase tracking-widest font-bold">Primary Search neighborhood</label>
                      <div className="relative flex items-center">
                        <Input 
                          value={addressVal}
                          onChange={(e) => setAddressVal(e.target.value)}
                          className="w-full bg-black/60 border border-[#353534] py-5 pl-10 pr-24 text-xs font-mono focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] text-white rounded-[4px]" 
                          placeholder="QUERY COORDINATES (CITY, AREA, OR NEIGHBORHOOD)" 
                          type="text"
                          required
                          disabled={isSubmittingDetails}
                        />
                        <button
                          type="button"
                          onClick={handleAutoDetect}
                          disabled={isSubmittingDetails}
                          className="absolute right-2.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-850 text-[8.5px] font-mono font-bold text-neutral-300 rounded-[4px] border border-stone-800 transition-colors uppercase tracking-wider"
                        >
                          Auto Detect
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] font-mono text-neutral-500 uppercase px-1">
                    <span>Signal Strength: Optimal</span>
                    <span className="text-[#00E1AB]">GPS_LOCKED_V2.4</span>
                  </div>
                </div>
              </section>

              <div className="grid md:grid-cols-2 gap-6">
                
                {/* Protocol Step 2: Budget */}
                <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <span className="text-[#DC143C]">02</span> Resource Tier
                    </h2>
                    <DollarSign className="text-[#DC143C] h-4 w-4" />
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-center space-y-2">
                    <label className="font-mono text-[8.5px] text-neutral-500 uppercase tracking-widest font-bold">Max Budget (INR)</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-neutral-400 font-mono text-xs">₹</span>
                      <Input 
                        value={budgetVal}
                        onChange={(e) => setBudgetVal(e.target.value)}
                        className="w-full bg-black/60 border border-[#353534] py-5 pl-7 pr-4 text-xs font-mono focus-visible:ring-[#DC143C] focus-visible:border-[#DC143C] text-white rounded-[4px]" 
                        placeholder="MAXIMUM OUTING SPEND PER HEAD" 
                        type="number"
                        min="0"
                        required
                        disabled={isSubmittingDetails}
                      />
                    </div>
                  </div>
                </section>

                {/* Protocol Step 3: Vibes */}
                <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <span className="text-[#DC143C]">03</span> Atmospheric Profile
                    </h2>
                    <Heart className="text-[#DC143C] h-4 w-4" />
                  </div>
                  <div className="p-5 flex-1 flex flex-wrap gap-2 content-center items-center justify-start bg-[#0e0e0e]/40">
                    {AVAILABLE_VIBES.map((vibe) => {
                      const isSelected = selectedVibes.includes(vibe);
                      return (
                        <label key={vibe} className="cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => toggleVibe(vibe)}
                            disabled={isSubmittingDetails}
                            className="peer sr-only" 
                          />
                          <span className="inline-block px-3 py-1.5 font-mono text-[9px] font-bold border border-[#353534] bg-[#1c1b1b] text-neutral-400 peer-checked:border-[#DC143C] peer-checked:text-[#DC143C] peer-checked:bg-[#DC143C]/10 transition-all uppercase rounded-[4px] hover:border-stone-850">
                            {vibe}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>

              </div>

              {/* Submission Action */}
              <div className="flex flex-col md:flex-row items-center gap-6 pt-5 border-t border-[#353534]/50">
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-3 text-neutral-400 font-mono text-[9px] uppercase tracking-wide">
                    <span className="w-1.5 h-1.5 bg-[#DC143C] rounded-full shadow-[0_0_6px_#DC143C]"></span>
                    Encryption Level: AES-256
                    <span className="w-1.5 h-1.5 bg-[#DC143C] rounded-full shadow-[0_0_6px_#DC143C] ml-2"></span>
                    Protocol: Double-Blind Consensus Selection
                  </div>
                  <p className="text-[10px] text-neutral-500 font-sans italic mt-1.5 leading-normal">
                    Your location, budget threshold, and vibe criteria are compiled privately to isolate a coordinates centroid and optimal itineraries.
                  </p>
                </div>
                
                <Button 
                  type="submit" 
                  disabled={isSubmittingDetails || isSubmittingBudget || isSubmittingLocation || isSubmittingVibes}
                  className="w-full md:w-auto px-10 py-5 bg-[#DC143C] hover:bg-[#B80F2E] text-black font-mono font-bold text-sm uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(220,20,60,0.3)] hover:shadow-[0_0_20px_rgba(220,20,60,0.55)] rounded-[4px] flex items-center justify-center gap-3 cursor-pointer"
                >
                  {isSubmittingDetails ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-black" />
                      SYNCING DETAILS...
                    </>
                  ) : (
                    <>
                      SUBMIT MY DETAILS
                      <ArrowRight className="h-4 w-4 text-black" />
                    </>
                  )}
                </Button>
              </div>

            </form>
          </div>
        )}
      </div>
    </main>
  );
}
