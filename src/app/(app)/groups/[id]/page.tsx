'use client';

import React, { useState, useEffect } from 'react';
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
import { submitMemberVibes, updateMemberPresenceAction } from '@/actions/members';
import { generatePlan, getPlansForGroupAction } from '@/actions/planner';
import { createVote, closeVoting, countVotes, getUserVoteForGroup } from '@/actions/votes';
import { Users, DollarSign, MapPin, Sparkles, Share2, Shield, ArrowRight, Loader2, Heart, RefreshCw, Award, Vote, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

const AVAILABLE_VIBES = [
  'CHILL', 'CREATIVE', 'FOODIE', 'CULTURAL', 'COMPETITIVE', 'ROMANTIC', 'LUXURY', 'BUDGET', 'ADVENTUROUS'
];

export default function GroupDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Form states
  const [budgetVal, setBudgetVal] = useState('');
  const [travelIncluded, setTravelIncluded] = useState(true);
  const [latVal, setLatVal] = useState('19.0178'); // default Dadar lat
  const [lngVal, setLngVal] = useState('72.8478'); // default Dadar lng
  const [addressVal, setAddressVal] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  
  const [isSubmittingBudget, setIsSubmittingBudget] = useState(false);
  const [isSubmittingLocation, setIsSubmittingLocation] = useState(false);
  const [isSubmittingVibes, setIsSubmittingVibes] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmittingCollection, setIsSubmittingCollection] = useState(false);
  const [isUpdatingPresence, setIsUpdatingPresence] = useState<string | null>(null);

  // Planner and voting states
  const [plans, setPlans] = useState<any[]>([]);
  const [activePlanIdx, setActivePlanIdx] = useState<number>(0);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [userVotedPlanId, setUserVotedPlanId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
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
        if (res.data.currentUser.travelIncluded !== undefined) {
          setTravelIncluded(res.data.currentUser.travelIncluded);
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
        travelIncluded,
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
      toast.success('Group locked! Details collection has started.');
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
          try {
            const res = await reverseGeocodeAction(latitude, longitude);
            toast.dismiss();
            if (res.success && res.data) {
              const { name, lat, lng } = res.data;
              setAddressVal(name);
              setLatVal(lat.toString());
              setLngVal(lng.toString());
              toast.success(`Location detected: ${name}! Press save to register.`);
            } else {
              setLatVal(latitude.toString());
              setLngVal(longitude.toString());
              setAddressVal(`Detected Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
              toast.success("Location coordinates detected! Press save to register.");
            }
          } catch (err) {
            toast.dismiss();
            setLatVal(latitude.toString());
            setLngVal(longitude.toString());
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
    let lat: number | undefined = parseFloat(latVal);
    let lng: number | undefined = parseFloat(lngVal);

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
        travelIncluded,
      });

      let lat: number | undefined = parseFloat(latVal);
      let lng: number | undefined = parseFloat(lngVal);
      const locationRes = await saveLocation({
        groupId: groupId,
        locationName: addressVal || "My Location",
        lat,
        lng,
      });

      const vibesRes = await submitMemberVibes(groupId, selectedVibes);

      if (budgetRes.success && locationRes.success && vibesRes.success) {
        toast.success("Group details synced successfully!");
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

  const handlePlanGeneration = async (options: string[] = []) => {
    console.log('handlePlanGeneration triggered for groupId:', groupId, 'options:', options);
    setIsGenerating(true);
    try {
      const res = await generatePlan(groupId, options);
      console.log('generatePlan response:', res);
      
      if (!res.success) {
        toast.error(res.error.message || 'Failed to generate itineraries');
        setIsGenerating(false);
        return;
      }

      toast.success('Itineraries generated successfully! Opening Planner.');
      router.push(`/planner/${groupId}`);
    } catch (err) {
      console.error('handlePlanGeneration error:', err);
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
      <PageContainer title="Group Workspace">
        <Card className="border border-stone-900 bg-stone-950/45 text-center p-8 rounded-[12px] backdrop-blur-md">
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-4">Workspace not found or you are not a member.</p>
          <Link href="/groups" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'border-stone-800 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 transition-all' })}>
            Back to Groups
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
    <main className="relative min-h-screen pt-10 pb-24 md:pb-10 bg-black text-[#e5e2e1] overflow-x-hidden">
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
              Group: {group.name}
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

        {/* If voting status is active but plans list is empty, show a recovery/loading card */}
        {isVotingOrClosed && plans.length === 0 && (
          <Card className="border border-stone-900 bg-stone-950/45 text-center p-8 rounded-[12px] backdrop-blur-md">
            <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mx-auto mb-4" />
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Loading itineraries...</p>
            <p className="text-[10px] text-neutral-500 font-mono">If this takes too long or they failed to generate, please regenerate.</p>
            {isAdmin && (
              <Button
                onClick={() => handlePlanGeneration()}
                disabled={isGenerating}
                className="mt-4 bg-[#DC143C] hover:bg-[#B80F2E] text-black text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] px-4 py-2 flex items-center justify-center mx-auto"
              >
                Regenerate Itineraries
              </Button>
            )}
          </Card>
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
                                      &ldquo;{slot.note}&rdquo;
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
                <div className="block md:hidden space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      ITINERARY OPTIONS
                    </span>
                    <Badge variant="outline" className={`rounded-[4px] py-0.5 px-2.5 text-[9px] font-mono font-bold uppercase tracking-widest ${
                      group.votingStatus === 'OPEN' 
                        ? 'bg-[#DC143C]/10 text-[#DC143C] border-[#DC143C]/20 animate-pulse' 
                        : 'bg-stone-900/40 text-neutral-400 border-stone-850'
                    }`}>
                      VOTING: {group.votingStatus.replace('_', ' ')}
                    </Badge>
                  </div>

                  <div 
                    ref={carouselRef}
                    className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth scrollbar-none pb-4"
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
                    {plans.map((plan) => {
                      const voteCount = votes[plan.id] || 0;
                      const isExpanded = expandedPlanId === plan.id;
                      const placesText = plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((s: any) => s.name).join(' → ') || 'No places specified';

                      return (
                        <div key={plan.id} className="w-full shrink-0 snap-center snap-always px-1">
                          <Card 
                            className="bg-[#0e0e0e]/95 border border-[#353534] rounded-[12px] p-5 shadow-lg flex flex-col justify-between gap-4 cursor-pointer hover:border-[#DC143C]/40 transition-all select-none"
                            onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                          >
                            <div className="space-y-3">
                              <div className="flex justify-between items-start gap-2 border-b border-[#353534]/50 pb-2.5">
                                <div>
                                  <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest font-mono">
                                    📍 Location
                                  </span>
                                  <h3 className="text-base font-bold text-white mt-0.5 uppercase tracking-wide font-mono">
                                    {plan.meetupZone}
                                  </h3>
                                  <p className="text-[10.5px] text-[#DC143C] font-mono font-semibold uppercase tracking-wider mt-1">
                                    {plan.name}
                                  </p>
                                </div>
                                <Badge variant="secondary" className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2 uppercase tracking-widest shrink-0">
                                  <Vote className="h-3 w-3" />
                                  {voteCount} VOTES
                                </Badge>
                              </div>

                              <div className="space-y-1">
                                <span className="text-[9px] uppercase font-mono text-neutral-500 tracking-wider font-bold">TAGLINE</span>
                                <p className="text-xs text-neutral-300 font-sans tracking-wide leading-relaxed">{plan.tagline}</p>
                              </div>

                              <div className="space-y-1">
                                <span className="text-[9px] uppercase font-mono text-neutral-500 tracking-wider font-bold">PLACES</span>
                                <p className="text-xs text-white font-mono tracking-wider font-bold line-clamp-2 leading-snug">{placesText}</p>
                              </div>

                              {/* Travel and cost indicators */}
                              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#353534]/40 text-[10px] font-mono text-neutral-400">
                                <div className="bg-[#1c1b1b]/50 p-2 rounded-[6px] border border-[#353534]/30 space-y-0.5">
                                  <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">ESTIMATED OUTING COST</span>
                                  <span className="text-white font-bold">₹{plan.totalEstimatedCostPerHead} / Head</span>
                                </div>
                                <div className="bg-[#1c1b1b]/50 p-2 rounded-[6px] border border-[#353534]/30 space-y-0.5">
                                  <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">AVERAGE TRAVEL TIME</span>
                                  <span className="text-white font-bold">~{plan.avgCabTime} Mins (Cab)</span>
                                </div>
                                <div className="bg-[#1c1b1b]/50 p-2 rounded-[6px] border border-[#353534]/30 space-y-0.5">
                                  <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">CAB JOURNEY COST</span>
                                  <span className="text-white font-bold">₹{plan.avgCabCost} avg</span>
                                </div>
                                <div className="bg-[#1c1b1b]/50 p-2 rounded-[6px] border border-[#353534]/30 space-y-0.5">
                                  <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">TRAIN TIME & COST</span>
                                  <span className="text-white font-bold">~{plan.avgTrainTime}m / ₹{plan.avgTrainCost}</span>
                                </div>
                              </div>

                              {/* Expand Prompt indicator */}
                              <div className="flex items-center justify-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-neutral-500 pt-1">
                                {isExpanded ? (
                                  <>
                                    <ChevronUp className="h-3.5 w-3.5 text-neutral-500" />
                                    TAP TO COLLAPSE DETAILS
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="h-3.5 w-3.5 text-[#DC143C]" />
                                    TAP TO EXPAND DETAILS
                                  </>
                                )}
                              </div>

                              {/* Expanded content */}
                              {isExpanded && (
                                <div className="pt-3.5 border-t border-[#353534] space-y-4 animate-in fade-in slide-in-from-top-2 duration-250 text-left">
                                  <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest font-mono block">
                                    Itinerary Timeline
                                  </span>
                                  <div className="space-y-2.5">
                                    {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                                      <div key={sIdx} className="flex gap-3 items-start bg-black/40 p-3 rounded-[6px] border border-[#353534]">
                                        <span className="w-5 h-5 flex items-center justify-center bg-[#DC143C]/10 border border-[#DC143C]/20 text-[#DC143C] text-[10px] font-mono rounded-[4px] shrink-0 mt-0.5">
                                          {slot.slotOrder}
                                        </span>
                                        <div className="space-y-0.5">
                                          <p className="text-xs font-mono font-bold text-white uppercase">{slot.name}</p>
                                          <p className="text-[9px] font-mono text-neutral-400">
                                            {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}m) • ₹{slot.estimatedCostPerHead}/head
                                          </p>
                                          {slot.note && <p className="text-[10px] text-neutral-500 font-sans italic mt-1.5">&ldquo;{slot.note}&rdquo;</p>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="bg-black/25 p-3 rounded-[6px] border border-[#353534]/50 space-y-2">
                                    <span className="text-[9px] uppercase font-bold text-[#00E1AB] tracking-widest font-mono block">
                                      Itinerary Score Details
                                    </span>
                                    <div className="grid grid-cols-2 gap-2 text-[9.5px] font-mono text-neutral-400">
                                      <div>Experience: <span className="text-white">{(plan.experienceScore * 10).toFixed(1)}/10</span></div>
                                      <div>Travel Time: <span className="text-white">{(plan.travelScore * 10).toFixed(1)}/10</span></div>
                                      <div>Budget fit: <span className="text-white">{(plan.budgetScore * 10).toFixed(1)}/10</span></div>
                                      <div>Fairness index: <span className="text-white">{(plan.fairnessScore * 10).toFixed(1)}/10</span></div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Vote Action */}
                            {group.votingStatus === 'OPEN' && (
                              <Button
                                size="sm"
                                disabled={isCasting || userVotedPlanId === plan.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVoteCast(plan.id);
                                }}
                                className={`w-full font-mono font-bold rounded-[8px] uppercase tracking-widest text-[10.5px] py-4.5 shadow-md transition-all duration-200 cursor-pointer ${
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
                                    <Vote className="mr-2 h-4 w-4" /> VOTE FOR THIS
                                  </>
                                )}
                              </Button>
                            )}
                          </Card>
                        </div>
                      );
                    })}
                  </div>

                  {/* Carousel Indicators */}
                  <div className="flex justify-between items-center px-1.5">
                    <Button 
                      variant="outline" 
                      size="xs" 
                      disabled={activePlanIdx === 0} 
                      onClick={() => scrollToPlan(activePlanIdx - 1)}
                      className="border-[#353534] bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] h-7 px-3.5 cursor-pointer animate-none"
                    >
                      Prev
                    </Button>
                    
                    <div className="flex gap-2">
                      {plans.map((_, idx) => (
                        <span 
                          key={idx} 
                          onClick={() => scrollToPlan(idx)}
                          className={`h-2 w-2 rounded-full cursor-pointer transition-all duration-300 ${
                            idx === activePlanIdx ? 'bg-[#DC143C] scale-125' : 'bg-stone-900 hover:bg-stone-850'
                          }`}
                        />
                      ))}
                    </div>

                    <Button 
                      variant="outline" 
                      size="xs" 
                      disabled={activePlanIdx === plans.length - 1} 
                      onClick={() => scrollToPlan(activePlanIdx + 1)}
                      className="border-[#353534] bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] h-7 px-3.5 cursor-pointer animate-none"
                    >
                      Next
                    </Button>
                  </div>
                </div>

                {/* 2. Desktop Bento View (hidden md:grid) */}
                <div className="hidden md:grid grid-cols-6 gap-6 items-start">
                  {plans.map((plan, idx) => {
                    const voteCount = votes[plan.id] || 0;
                    const isFeatured = idx === 0;
                    const isExpanded = expandedPlanId === plan.id || isFeatured; // featured is expanded by default
                    const colSpan = isFeatured ? 'col-span-6 lg:col-span-4' : 'col-span-3 lg:col-span-2';
                    const placesText = plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((s: any) => s.name).join(' → ') || 'No places specified';

                    return (
                      <Card 
                        key={plan.id} 
                        className={`border border-[#353534] bg-[#0e0e0e]/85 p-6 shadow-lg backdrop-blur-md flex flex-col justify-between gap-5 rounded-[12px] hover:border-[#DC143C]/40 transition-all cursor-pointer ${colSpan}`}
                        onClick={() => {
                          if (!isFeatured) {
                            setExpandedPlanId(expandedPlanId === plan.id ? null : plan.id);
                          }
                        }}
                      >
                        <div className="space-y-4">
                          <div className="flex justify-between items-start gap-2 border-b border-[#353534]/50 pb-3.5">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest font-mono">
                                  📍 Zone: {plan.meetupZone}
                                </span>
                                {isFeatured && (
                                  <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[7.5px] font-mono font-bold py-0 px-1.5 uppercase tracking-widest rounded-[3px]">
                                    TOP RECOMMENDATION
                                  </Badge>
                                )}
                              </div>
                              <h3 className="text-base font-bold text-white mt-1 uppercase tracking-wide font-mono truncate">{plan.name}</h3>
                              <p className="text-[11px] text-neutral-400 font-sans tracking-wide leading-relaxed mt-0.5 line-clamp-1">{plan.tagline}</p>
                            </div>
                            <Badge variant="secondary" className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 rounded-[4px] flex items-center gap-1.5 text-[9px] font-mono font-bold py-1 px-3 uppercase tracking-widest shrink-0">
                              <Vote className="h-3.5 w-3.5" />
                              {voteCount} VOTES
                            </Badge>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[9.5px] uppercase font-mono text-neutral-500 tracking-wider font-bold">PLACES</span>
                            <p className="text-xs font-mono font-bold text-white tracking-wide leading-snug truncate">{placesText}</p>
                          </div>

                          {/* Stats Row */}
                          <div className="grid grid-cols-3 gap-3 bg-[#131313]/95 border border-[#353534]/40 rounded-[6px] p-3 text-center text-[10px] font-mono text-neutral-400">
                            <div>
                              <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">COST / HEAD</span>
                              <span className="text-white font-bold text-xs">₹{plan.totalEstimatedCostPerHead}</span>
                            </div>
                            <div>
                              <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">AVG CAB TIME</span>
                              <span className="text-white font-bold text-xs">{plan.avgCabTime} Mins</span>
                            </div>
                            <div>
                              <span className="text-[8px] text-neutral-500 uppercase tracking-wider block">PLAN SCORE</span>
                              <span className="text-[#DC143C] font-bold text-xs">{(plan.score * 10).toFixed(1)}/10</span>
                            </div>
                          </div>

                          {!isFeatured && (
                            <div className="flex items-center justify-center gap-1 text-[9px] font-mono uppercase tracking-widest text-neutral-500">
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3 w-3" /> CLICK TO COLLAPSE
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3" /> CLICK FOR DETAILS
                                </>
                              )}
                            </div>
                          )}

                          {/* Collapsible details for non-featured OR default for featured */}
                          {isExpanded && (
                            <div className="pt-4 border-t border-[#353534] space-y-4 animate-in fade-in slide-in-from-top-2 duration-250 text-left">
                              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">ITINERARY TIMELINE</h4>
                              
                              <div className="grid grid-cols-1 gap-2.5">
                                {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                                  <div key={sIdx} className="flex gap-3 items-start bg-black/45 p-3.5 border border-[#353534] rounded-[6px]">
                                    <span className="w-5 h-5 flex items-center justify-center bg-[#DC143C]/10 border border-[#DC143C]/20 text-[#DC143C] text-[10px] font-mono rounded-[4px] shrink-0 mt-0.5">
                                      {slot.slotOrder}
                                    </span>
                                    <div className="space-y-0.5 flex-1 min-w-0">
                                      <p className="text-xs font-mono font-bold text-white uppercase truncate">{slot.name}</p>
                                      <p className="text-[9px] font-mono text-neutral-400">
                                        {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}m) • ₹{slot.estimatedCostPerHead}/head
                                      </p>
                                      {slot.note && <p className="text-[10.5px] text-neutral-500 font-sans italic mt-1">&ldquo;{slot.note}&rdquo;</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Travel breakdown stats */}
                              <div className="bg-black/20 p-3 rounded-[6px] border border-[#353534]/50 space-y-2 text-[10px] font-mono text-neutral-400">
                                <h5 className="text-[9px] font-mono font-bold text-[#00E1AB] uppercase tracking-wider">Detailed Commute & Score Metrics</h5>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                  <div>Cab Cost: <span className="text-white font-bold">~₹{plan.avgCabCost} avg</span></div>
                                  <div>Train Cost: <span className="text-white font-bold">~₹{plan.avgTrainCost} avg</span></div>
                                  <div>Avg Train time: <span className="text-white font-bold">~{plan.avgTrainTime} mins</span></div>
                                  <div>Fairness Index: <span className="text-white font-bold">{(plan.travelFairnessScore * 10).toFixed(1)}/10</span></div>
                                  <div>Experience: <span className="text-white">{(plan.experienceScore * 10).toFixed(1)}/10</span></div>
                                  <div>Budget Match: <span className="text-white">{(plan.budgetScore * 10).toFixed(1)}/10</span></div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Voting Action */}
                        {group.votingStatus === 'OPEN' && (
                          <Button
                            size="sm"
                            disabled={isCasting || userVotedPlanId === plan.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVoteCast(plan.id);
                            }}
                            className={`w-full font-mono font-bold rounded-[8px] uppercase tracking-widest text-[9.5px] py-3.5 shadow-md transition-all duration-200 cursor-pointer ${
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
                                <Vote className="mr-2 h-4 w-4" /> VOTE FOR THIS
                              </>
                            )}
                          </Button>
                        )}
                      </Card>
                    );
                  })}

                  {/* 3. Live Vote Distribution Bento Block */}
                  <Card className="col-span-3 lg:col-span-2 border border-[#353534] bg-[#0e0e0e]/85 p-6 shadow-lg rounded-[12px] flex flex-col justify-between gap-5 min-h-[300px]">
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-bold text-[#DC143C] tracking-widest flex items-center gap-1.5 font-mono">
                        <Vote className="h-3.5 w-3.5" /> Live Consensus
                      </span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wider font-mono">Vote Distribution</h3>
                      <p className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed">
                        Visualizing alignments across proposed routes.
                      </p>
                    </div>

                    <div className="space-y-3.5 flex-1 py-1">
                      {plans.map((p) => {
                        const pVotes = votes[p.id] || 0;
                        const totalVotes = Object.values(votes).reduce((sum, v) => sum + v, 0);
                        const pct = totalVotes > 0 ? (pVotes / totalVotes) * 100 : 0;
                        return (
                          <div key={p.id} className="space-y-1">
                            <div className="flex justify-between text-[10px] font-mono">
                              <span className="text-white font-semibold uppercase truncate max-w-[130px]">{p.name}</span>
                              <span className="text-neutral-400 font-bold">{pVotes} ({pct.toFixed(0)}%)</span>
                            </div>
                            <div className="h-2 bg-black border border-stone-850 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-[#DC143C] to-[#B80F2E] transition-all duration-500 rounded-full" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-3.5 border-t border-[#353534]/50 text-center font-mono text-[9px] text-neutral-500 uppercase tracking-widest">
                      TOTAL VOTES REGISTERED: {Object.values(votes).reduce((sum, v) => sum + v, 0)}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Generate Again options for Admin */}
            {isAdmin && group.status !== 'COMPLETED' && group.status !== 'ARCHIVED' && (
              <Card className="border border-stone-900 bg-[#0e0e0e]/80 backdrop-blur-md p-6 rounded-[8px] space-y-4">
                <div className="flex items-center gap-2 border-b border-[#353534] pb-3">
                  <RefreshCw className="h-4.5 w-4.5 text-[#DC143C]" />
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                    Generate Again (Admin Panel)
                  </h3>
                </div>
                <p className="text-[10.5px] text-neutral-400 font-sans leading-relaxed">
                  Unhappy with the current options? Regenerate with specific planning constraints.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                  {[
                    { id: 'Cheaper', label: 'Cheaper outing' },
                    { id: 'More Activities', label: 'More activities' },
                    { id: 'More Food', label: 'More cafes/food' },
                    { id: 'More Romantic', label: 'More romantic' },
                    { id: 'More Indoor', label: 'More indoor places' },
                    { id: 'Less Travel', label: 'Minimize travel' },
                  ].map((opt) => {
                    const isSelected = selectedOptions.includes(opt.id);
                    return (
                      <label key={opt.id} className="cursor-pointer flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-400 select-none">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedOptions(prev =>
                              prev.includes(opt.id) ? prev.filter(x => x !== opt.id) : [...prev, opt.id]
                            );
                          }}
                          className="h-3.5 w-3.5 rounded border-[#353534] bg-black text-[#DC143C] focus:ring-0 accent-[#DC143C] cursor-pointer"
                        />
                        <span className={isSelected ? 'text-[#DC143C]' : 'text-neutral-400'}>
                          {opt.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <Button
                  onClick={() => handlePlanGeneration(selectedOptions)}
                  disabled={isGenerating}
                  className="w-full mt-3 bg-[#DC143C] hover:bg-[#B80F2E] text-black text-[10px] font-mono font-bold uppercase tracking-widest rounded-[4px] py-3 transition-all cursor-pointer shadow-[0_0_15px_rgba(220,20,60,0.2)] flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-black" />
                      COOKING NEW PLANS...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 text-black" />
                      REGENERATE ITINERARIES
                    </>
                  )}
                </Button>
              </Card>
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
                      <li key={member.userId} className={`flex items-center gap-3 transition-all ${isSynced ? '' : 'opacity-75'}`}>
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
                          <p className="font-mono font-bold text-[11px] text-white uppercase truncate flex items-center gap-1.5">
                            {member.name}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isSynced ? 'bg-[#00E1AB] animate-pulse shadow-[0_0_6px_#00E1AB]' : 'bg-stone-850'}`} />
                            <span className={`text-[8.5px] font-mono font-bold uppercase flex items-center gap-1 ${isSynced ? 'text-[#00E1AB]' : 'text-neutral-500'}`}>
                              {isSynced ? 'ACCEPTED' : 'Pending'}
                              {isSynced && <Check className="h-3 w-3 text-[#00E1AB]" />}
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
                      type="button"
                      onClick={() => handlePlanGeneration()}
                      disabled={isGenerating || members.length === 0}
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
                    <span className="text-[#DC143C]"></span>Enter Location
                    {currentUser.location !== null && (
                      <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider">
                        ACCEPTED
                      </Badge>
                    )}
                  </h2>
                  <MapPin className="text-[#DC143C] h-4 w-4" />
                </div>
                <div className="p-5 space-y-4">
                  <div className="relative h-40 w-full bg-[#1c1b1b] border border-[#353534] rounded-[4px] overflow-hidden flex flex-col justify-center px-6 sm:px-10 space-y-5">
                    <div className="absolute inset-0 opacity-20 pointer-events-none"></div>
                    <div className="scanning-line opacity-10"></div>
                    
                    <div className="space-y-1.5 relative z-10">
                      <label className="font-mono text-[8.5px] text-[#DC143C] uppercase tracking-widest font-bold">Enter nearest local station</label>
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

                </div>
              </section>

              <div className="grid md:grid-cols-2 gap-6">
                
                {/* Protocol Step 2: Budget */}
                <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <span className="text-[#DC143C]"></span> Budget
                      {currentUser.budget !== null && (
                        <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider">
                          ACCEPTED
                        </Badge>
                      )}
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
                        placeholder="Enter your maximum budget" 
                        type="number"
                        min="50"
                        max="100000"
                        required
                        disabled={isSubmittingDetails}
                      />
                    </div>
                    <div className="flex items-center space-x-2 pt-2">
                      <input
                        id="travelIncluded"
                        type="checkbox"
                        checked={travelIncluded}
                        onChange={(e) => setTravelIncluded(e.target.checked)}
                        disabled={isSubmittingDetails}
                        className="h-3.5 w-3.5 rounded border-[#353534] bg-black text-[#DC143C] focus:ring-0 accent-[#DC143C] cursor-pointer"
                      />
                      <Label htmlFor="travelIncluded" className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-neutral-400 cursor-pointer">
                        Travel cost included? (Yes / No)
                      </Label>
                    </div>
                  </div>
                </section>

                {/* Protocol Step 3: Vibes */}
                <section className="bg-[#0e0e0e]/80 backdrop-blur-md border border-[#353534] rounded-[8px] flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#353534] bg-[#1c1b1b]">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <span className="text-[#DC143C]"></span>Vibe
                      {hasVibes && (
                        <Badge className="bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-[4px] uppercase tracking-wider">
                          ACCEPTED
                        </Badge>
                      )}
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
                  <p className="text-[10px] text-neutral-500 font-sans italic mt-1.5 leading-normal">
                    Your location, budget threshold, and vibe criteria are compiled privately to isolate a coordinates centroid and optimal itineraries.
                  </p>
                </div>
                
                <Button 
                  type="submit" 
                  disabled={isSubmittingDetails || isSubmittingBudget || isSubmittingLocation || isSubmittingVibes}
                  className={`w-full md:w-auto px-10 py-5 font-mono font-bold text-sm uppercase tracking-widest hover:scale-105 active:scale-95 transition-all rounded-[4px] flex items-center justify-center gap-3 cursor-pointer ${
                    hasSubmittedSelf 
                      ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/30 text-[#00E1AB] hover:bg-[#00E1AB]/20 shadow-[0_0_15px_rgba(0,225,171,0.15)]'
                      : 'bg-[#DC143C] hover:bg-[#B80F2E] text-black shadow-[0_0_15px_rgba(220,20,60,0.3)] hover:shadow-[0_0_20px_rgba(220,20,60,0.55)]'
                  }`}
                >
                  {isSubmittingDetails ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-black" />
                      SYNCING DETAILS...
                    </>
                  ) : hasSubmittedSelf ? (
                    <>
                      <Check className="h-4 w-4 text-[#00E1AB]" />
                      DETAILS SYNCED & ACCEPTED
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
