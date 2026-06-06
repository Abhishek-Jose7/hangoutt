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
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-[#0A0A0C] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#EB690B] mb-4" />
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
    <PageContainer
      title={group.name.toUpperCase()}
      subtitle={`WORKSPACE ID: ${group.id.substring(0, 8).toUpperCase()} // STATUS: ${group.status.replace('_', ' ')}`}
      actions={
        (group.status !== 'COMPLETED' && group.status !== 'ARCHIVED') ? (
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleShareCode} 
              className="border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
            >
              <Share2 className="h-3.5 w-3.5 text-[#EB690B]" />
              Share Code
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-6 font-mono text-xs">
        
        {/* 1. Top Section Summary Card */}
        <Card className="relative overflow-hidden border border-stone-900/60 bg-stone-950/45 p-6 rounded-[12px] shadow-lg backdrop-blur-md space-y-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#EB690B]/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex justify-between items-start gap-4">
            <div className="space-y-1">
              <h1 className="text-lg font-bold text-white uppercase tracking-wider flex flex-wrap items-center gap-2 font-mono">
                <span>Lobby Protocol // {group.name}</span>
              </h1>
              <p className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed line-clamp-1">{group.description || 'Experience-focused custom outings planning system.'}</p>
            </div>
            
            <Badge variant="outline" className={`shrink-0 font-mono rounded-[4px] py-1 px-2.5 text-[9px] font-bold uppercase tracking-widest ${
              group.status === 'VOTING' 
                ? 'bg-[#EB690B]/10 text-[#EB690B] border-[#EB690B]/20 animate-pulse'
                : group.status === 'COMPLETED'
                  ? 'bg-[#00E5A0]/10 text-[#00E5A0] border-[#00E5A0]/20'
                  : 'bg-stone-900/40 text-neutral-400 border-stone-850'
            }`}>
              {group.status.replace('_', ' ').replace('COLLECTING ', '')}
            </Badge>
          </div>

          {/* Conditional Invite Section (only if NOT completed/archived) */}
          {group.status !== 'COMPLETED' && group.status !== 'ARCHIVED' && (
            <div className="flex flex-wrap items-center gap-3 bg-stone-950/80 border border-stone-900/80 p-3 rounded-[8px] text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-neutral-500 font-bold uppercase tracking-widest text-[9px] font-mono">Invite Code:</span>
                <code className="bg-stone-900 border border-stone-850 px-2 py-0.5 rounded-[4px] text-[#EB690B] font-mono select-all font-bold text-xs">{group.inviteCode}</code>
              </div>
              <span className="text-stone-850 hidden sm:inline">|</span>
              <div className="flex items-center gap-1.5 truncate max-w-full">
                <span className="text-neutral-500 font-bold uppercase tracking-widest text-[9px] font-mono">Invite Link:</span>
                <a 
                  href={typeof window !== 'undefined' ? `${window.location.origin}/join/${group.inviteCode}` : `/join/${group.inviteCode}`} 
                  className="text-[#EB690B] hover:text-[#D4590A] transition-colors font-mono font-bold truncate max-w-[180px] sm:max-w-xs hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {typeof window !== 'undefined' ? `${window.location.origin}/join/${group.inviteCode}` : `/join/${group.inviteCode}`}
                </a>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-900/60 text-[11px] text-neutral-400 font-medium">
            <div className="space-y-0.5">
              <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold font-mono">Members</p>
              <p className="text-xs font-bold text-white flex items-center gap-1 font-mono">
                <Users className="h-3 w-3 text-[#EB690B]" /> {members.length}
              </p>
            </div>
            
            <div className="space-y-0.5">
              <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold font-mono">Budget Range</p>
              <p className="text-xs font-bold text-white font-mono">
                ₹{budgetSummary?.min || 300} - ₹{budgetSummary?.max || 700}
              </p>
            </div>

            <div className="space-y-0.5">
              <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold font-mono">Vibe</p>
              <p className="text-xs font-bold text-[#EB690B] uppercase font-mono truncate">
                {group.vibes ? JSON.parse(group.vibes).slice(0, 2).map((v: string) => v.toUpperCase()).join(' • ') : 'CREATIVE • FOODIE'}
              </p>
            </div>
          </div>
          
          <div className="pt-2 border-t border-stone-900/60 text-[11px] text-neutral-400">
            <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold font-mono mb-0.5">Location Spread</p>
            <p className="text-xs font-bold text-white truncate font-mono">
              {locations.length > 0 
                ? locations.map((l: any) => l.locationName?.split(',')[0].trim().toUpperCase()).filter(Boolean).join(' • ')
                : 'WAITING FOR MEMBERS...'}
            </p>
          </div>
        </Card>

        {/* Status Notification Banner (Cooking status) */}
        {isGeneratingState && (
          <div className="flex items-center gap-3 bg-[#EB690B]/10 border border-[#EB690B]/20 p-4 rounded-[8px] text-[#EB690B] text-[10px] font-bold uppercase tracking-wider animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>AI Itineraries are currently being cooked. Check back shortly...</span>
            <Button size="xs" variant="ghost" onClick={loadData} className="ml-auto flex items-center gap-1 text-[9px] hover:bg-[#EB690B]/20 text-[#EB690B] hover:text-[#EB690B]">
              <RefreshCw className="h-3 w-3 animate-spin" /> Reload
            </Button>
          </div>
        )}

        {/* 2. Member Progress Section (Before Generation) */}
        {!isVotingOrClosed && !isGeneratingState && (
          <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg p-5 rounded-[12px] space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-stone-900/60">
              <div className="space-y-0.5">
                <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Members Sync Status
                </CardTitle>
                <p className="text-[9px] text-neutral-400 font-sans tracking-wide leading-relaxed">
                  Lobby registers complete as soon as starting coordinates and budgets are saved.
                </p>
              </div>
              <Badge variant="outline" className="bg-[#EB690B]/10 text-[#EB690B] border-[#EB690B]/20 text-[9px] font-mono font-bold py-0.5 px-2.5 rounded-[4px] shrink-0">
                {members.filter((m: any) => {
                  const hasBudget = submittedBudgetUserIds.includes(m.userId);
                  const hasLocation = locations.some((l: any) => l.userId === m.userId);
                  return hasBudget && hasLocation;
                }).length} / {members.length} SYNCED
              </Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-2 pt-1 font-medium">
              {members.map((member: any) => {
                const hasBudget = submittedBudgetUserIds.includes(member.userId);
                const hasLocation = locations.some((l: any) => l.userId === member.userId);
                const isReady = hasBudget && hasLocation;

                return (
                  <div key={member.userId} className="flex items-center justify-between p-3 bg-stone-950/80 border border-stone-900 rounded-[8px] text-[11px] hover:border-stone-850 transition-all duration-200 font-mono">
                    <span className="text-white font-bold truncate pr-1">{member.name.toUpperCase()}</span>
                    <span className="text-[10px] shrink-0 leading-none flex items-center gap-1.5 font-bold">
                      {isReady ? (
                        <><span className="h-1.5 w-1.5 rounded-full bg-[#00E5A0] shadow-[0_0_8px_#00E5A0]" /> READY</>
                      ) : (
                        <><span className="h-1.5 w-1.5 rounded-full bg-[#EB690B] shadow-[0_0_8px_#EB690B] animate-pulse" /> PENDING</>
                      )}
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
                  className="w-full bg-[#EB690B] hover:bg-[#D4590A] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] py-3.5 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      COOKING ITINERARIES...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4 text-[#0A0A0C] fill-white" />
                      GENERATE ITINERARIES
                    </>
                  )}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* 3. Horizontal Swipe Carousel (Mobile) & Grid (Desktop) of Itineraries */}
        {isVotingOrClosed && plans.length > 0 && (
          <div className="space-y-6">
            {/* Case A: Outing Completed / Winner Declared */}
            {(group.status === 'COMPLETED' || group.status === 'ARCHIVED') ? (
              (() => {
                const winner = plans.find((p: any) => p.id === group.winningPlanId) || plans[0];
                return (
                  <Card className="relative overflow-hidden border border-[#00E5A0]/20 rounded-[12px] bg-stone-950/45 backdrop-blur-md shadow-lg p-6 space-y-6">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#00E5A0]/5 rounded-full blur-3xl pointer-events-none" />
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-stone-900/60 pb-4">
                      <div>
                        <span className="text-[9px] uppercase font-bold text-[#00E5A0] tracking-widest flex items-center gap-1 font-mono">
                          <Award className="h-3.5 w-3.5 text-[#00E5A0]" /> Final Outing Protocol
                        </span>
                        <h2 className="text-lg font-bold text-white mt-1 uppercase tracking-wide font-mono">{winner.name}</h2>
                        <p className="text-xs text-neutral-400 mt-0.5 font-sans leading-relaxed tracking-wide">{winner.tagline}</p>
                      </div>
                      
                      <Badge className="bg-[#00E5A0]/10 text-[#00E5A0] border border-[#00E5A0]/20 rounded-[4px] flex items-center gap-1.5 text-[9px] font-mono font-bold py-1 px-3 uppercase tracking-widest">
                        <Check className="h-3.5 w-3.5" /> Outing Locked
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Left: Final Itinerary slots flow */}
                      <div className="lg:col-span-2 space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-1.5 font-mono">
                          📍 Primary Node: {winner.meetupZone.toUpperCase()}
                        </h3>
                        
                        <div className="flex flex-col items-stretch justify-start py-2 space-y-3">
                          {winner.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                            <React.Fragment key={sIdx}>
                              <div className="flex items-start gap-4 p-4 bg-stone-950/80 border border-stone-900 rounded-[8px]">
                                <span className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#00E5A0]/10 text-[#00E5A0] text-xs font-mono font-bold border border-[#00E5A0]/20 shrink-0">
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
                                  <span className="text-[#00E5A0]/60 font-black text-sm">↓</span>
                                </div>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>

                      {/* Right: Summary details */}
                      <div className="space-y-4 bg-stone-950/80 border border-stone-900 rounded-[8px] p-5 h-fit text-[11px]">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#EB690B] font-mono">Itinerary Analysis</h3>
                        
                        <div className="divide-y divide-stone-900/60 text-[11px] font-mono space-y-3">
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
                            <span className="font-extrabold text-[#EB690B]">{(winner.score * 10).toFixed(1)}/10</span>
                          </div>
                          <div className="flex justify-between py-2">
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
                <Card className="block md:hidden border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg p-4 space-y-4 rounded-[12px]">
                  <div className="flex justify-between items-center pb-2 border-b border-stone-900/60">
                    <div className="space-y-0.5">
                      <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        Outing Options
                      </CardTitle>
                      <p className="text-[9px] text-neutral-400 font-sans tracking-wide leading-relaxed">
                        Swipe through plans and lock your vote on your preferred routing.
                      </p>
                    </div>
                    <Badge variant="outline" className={`rounded-[4px] py-0.5 px-2.5 text-[9px] font-mono font-bold uppercase tracking-widest shrink-0 ${
                      group.votingStatus === 'OPEN' 
                        ? 'bg-[#EB690B]/10 text-[#EB690B] border-[#EB690B]/20 animate-pulse' 
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
                      const hasUserVoted = userVotedPlanId === plan.id;

                      return (
                        <div 
                          key={plan.id}
                          className="w-full shrink-0 snap-center snap-always space-y-4"
                        >
                          <Card className="bg-stone-950/80 border border-stone-900 rounded-[12px] p-5 shadow-inner">
                            <div className="flex justify-between items-start gap-2">
                              <div>
                                <span className="text-[9px] uppercase font-bold text-[#EB690B] tracking-widest flex items-center gap-1 font-mono">
                                  📍 Zone: {plan.meetupZone.toUpperCase()}
                                </span>
                                <h3 className="text-sm font-bold text-white mt-1.5 uppercase tracking-wider font-mono">{plan.name}</h3>
                                <p className="text-[10px] text-neutral-400 mt-0.5 font-sans tracking-wide leading-relaxed line-clamp-1">{plan.tagline}</p>
                              </div>
                              <Badge variant="secondary" className="bg-[#EB690B]/10 text-[#EB690B] border border-[#EB690B]/20 hover:bg-[#EB690B]/10 hover:text-[#EB690B] rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2.5 uppercase tracking-widest shrink-0">
                                <Vote className="h-3 w-3" />
                                {voteCount} VOTES
                              </Badge>
                            </div>

                            {/* Compact Itinerary Flow using Actual places */}
                            <div className="flex flex-col items-center justify-center py-4 my-3 bg-stone-950/90 rounded-[8px] border border-stone-900/60 space-y-2 text-center">
                              {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                                <React.Fragment key={sIdx}>
                                  <div className="px-3">
                                    <p className="text-[11px] font-bold text-white tracking-wider leading-snug font-mono">{slot.name.toUpperCase()}</p>
                                    <p className="text-[9px] text-neutral-400 uppercase font-mono tracking-widest mt-0.5">
                                      {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}M)
                                    </p>
                                  </div>
                                  {sIdx < (plan.slots.length - 1) && (
                                    <span className="text-[#EB690B]/70 font-black text-xs">↓</span>
                                  )}
                                </React.Fragment>
                              ))}
                            </div>

                            {/* Travel and cost footer statistics */}
                            <div className="grid grid-cols-3 gap-2 mt-4 pt-3.5 border-t border-stone-900/60 text-center text-[10px] font-bold text-neutral-400 uppercase font-mono">
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
                                <p className="text-xs font-bold text-[#EB690B]">{(plan.score * 10).toFixed(1)}/10</p>
                              </div>
                            </div>
                          </Card>

                          {/* Voting Action */}
                          {group.votingStatus === 'OPEN' && (
                            <Button
                              size="sm"
                              disabled={isCasting || userVotedPlanId === plan.id}
                              onClick={() => handleVoteCast(plan.id)}
                              className={`w-full font-mono font-bold rounded-[8px] uppercase tracking-widest text-[10px] py-3.5 shadow-md transition-all duration-200 cursor-pointer ${
                                userVotedPlanId === plan.id
                                  ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                                  : 'bg-[#EB690B] hover:bg-[#D4590A] text-white'
                              }`}
                            >
                              {userVotedPlanId === plan.id ? (
                                <>
                                  <Check className="mr-2 h-4 w-4 text-[#00E5A0]" /> VOTE REGISTERED
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
                      className="border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] h-7 px-3.5 cursor-pointer"
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
                            idx === activePlanIdx ? 'bg-[#EB690B] scale-125' : 'bg-stone-900 hover:bg-stone-800'
                          }`}
                        />
                      ))}
                    </div>

                    <Button 
                      variant="outline" 
                      size="xs" 
                      disabled={activePlanIdx === plans.length - 1} 
                      onClick={() => scrollToPlan(activePlanIdx + 1)}
                      className="border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] h-7 px-3.5 cursor-pointer"
                    >
                      Next
                    </Button>
                  </div>
                </Card>

                {/* 2. Desktop Grid View (hidden md:grid) */}
                <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {plans.map((plan) => {
                    const voteCount = votes[plan.id] || 0;
                    const hasUserVoted = userVotedPlanId === plan.id;

                    return (
                      <Card key={plan.id} className="border border-stone-900/60 bg-stone-950/45 p-5 shadow-lg backdrop-blur-md flex flex-col justify-between space-y-4 rounded-[12px]">
                        <div className="space-y-4">
                          <div className="flex justify-between items-start gap-2 border-b border-stone-900/60 pb-3">
                            <div>
                              <span className="text-[9px] uppercase font-bold text-[#EB690B] tracking-widest flex items-center gap-1 font-mono">
                                📍 Zone: {plan.meetupZone.toUpperCase()}
                              </span>
                              <h3 className="text-xs font-bold text-white mt-1.5 uppercase tracking-widest font-mono line-clamp-1">{plan.name}</h3>
                              <p className="text-[10px] text-neutral-400 mt-0.5 font-sans tracking-wide leading-relaxed line-clamp-2 min-h-[2.5rem]">{plan.tagline}</p>
                            </div>
                            <Badge variant="secondary" className="bg-[#EB690B]/10 text-[#EB690B] border border-[#EB690B]/20 rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2 uppercase tracking-widest shrink-0">
                              <Vote className="h-3 w-3" />
                              {voteCount}
                            </Badge>
                          </div>

                          {/* Timeline Listing */}
                          <div className="flex flex-col items-center justify-center py-3 bg-stone-950/90 rounded-[8px] border border-stone-900 space-y-1.5 text-center min-h-[14rem]">
                            {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => (
                              <React.Fragment key={sIdx}>
                                <div className="px-2">
                                  <p className="text-[11px] font-bold text-white tracking-wider leading-snug font-mono line-clamp-2">{slot.name.toUpperCase()}</p>
                                  <p className="text-[9px] text-neutral-400 uppercase font-mono tracking-widest mt-0.5">
                                    {slot.category} • {slot.arrivalTime} ({slot.durationMinutes}M)
                                  </p>
                                </div>
                                {sIdx < (plan.slots.length - 1) && (
                                  <span className="text-[#EB690B]/70 font-black text-[10px]">↓</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>

                          {/* Stats Grid */}
                          <div className="grid grid-cols-3 gap-1 py-3 border-t border-b border-stone-900/60 text-center text-[9px] font-bold text-neutral-400 uppercase font-mono">
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
                              <p className="text-xs font-bold text-[#EB690B]">{(plan.score * 10).toFixed(1)}</p>
                            </div>
                          </div>
                        </div>

                        {/* Voting Action */}
                        {group.votingStatus === 'OPEN' && (
                          <Button
                            size="sm"
                            disabled={isCasting || userVotedPlanId === plan.id}
                            onClick={() => handleVoteCast(plan.id)}
                            className={`w-full font-mono font-bold rounded-[8px] uppercase tracking-widest text-[9px] py-3 shadow-md transition-all duration-200 cursor-pointer ${
                              userVotedPlanId === plan.id
                                ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                                : 'bg-[#EB690B] hover:bg-[#D4590A] text-white'
                            }`}
                          >
                            {userVotedPlanId === plan.id ? (
                              <>
                                <Check className="mr-1.5 h-3.5 w-3.5 text-[#00E5A0]" /> VOTED
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
                  className="w-full bg-red-950/45 text-red-500 border border-red-900/50 hover:bg-red-950/80 hover:text-red-400 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] py-3.5 transition-all cursor-pointer"
                >
                  Close Voting & Declare Winner
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 4. Details Submission & Member overview (Locked post-generation to avoid clutter) */}
        {!isVotingOrClosed && (
          <Tabs defaultValue="workspace" className="space-y-6">
            <TabsList className="bg-stone-950 border border-stone-900 p-1 w-full max-w-md justify-start grid grid-cols-2 rounded-[8px] font-mono">
              <TabsTrigger 
                value="workspace" 
                className="text-[10px] font-mono font-bold uppercase tracking-widest py-2.5 rounded-[6px] data-[state=active]:bg-[#EB690B] data-[state=active]:text-white text-neutral-400 hover:text-white transition-all"
              >
                Workspace Overview
              </TabsTrigger>
              <TabsTrigger 
                value="inputs" 
                className="text-[10px] font-mono font-bold uppercase tracking-widest py-2.5 rounded-[6px] data-[state=active]:bg-[#EB690B] data-[state=active]:text-white text-neutral-400 hover:text-white transition-all"
              >
                Submit My Details
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: OVERVIEW */}
            <TabsContent value="workspace" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Members List */}
              <div className="lg:col-span-2 space-y-6">
                <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px]">
                  <CardHeader>
                    <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-2">
                      <Users className="h-4 w-4 text-[#EB690B]" />
                      Members Sync Status ({members.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-stone-900/60 p-0 px-6 pb-6">
                    {members.map((member: any) => {
                      const isOwner = member.role === 'ADMIN';
                      
                      return (
                        <div key={member.userId} className="flex items-center justify-between py-3">
                          <div className="flex items-center gap-3">
                            {member.imageUrl ? (
                              <img
                                src={member.imageUrl}
                                alt={member.name}
                                className="h-9 w-9 rounded-[6px] object-cover border border-stone-900"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded-[6px] bg-stone-900 border border-stone-850 flex items-center justify-center font-mono font-bold text-xs uppercase text-[#EB690B]">
                                {member.name.charAt(0)}
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                                {member.name.toUpperCase()}
                                {isOwner && (
                                  <Badge variant="outline" className="bg-[#EB690B]/10 text-[#EB690B] border-[#EB690B]/20 text-[9px] font-mono font-bold uppercase rounded-[4px] py-0.5 px-2 flex items-center gap-0.5">
                                    <Shield className="h-2.5 w-2.5 text-[#EB690B]" />
                                    ADMIN
                                  </Badge>
                                )}
                              </p>
                              <p className="text-[10px] text-neutral-400 font-mono">{member.email}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            {member.vibes && (
                              <span className="text-[10px] text-neutral-400 font-mono uppercase tracking-wider">
                                {JSON.parse(member.vibes).slice(0, 2).join(' • ').toUpperCase()}
                              </span>
                            )}
                            <span className="flex items-center text-[9px] uppercase text-[#00E5A0] font-mono font-bold">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#00E5A0] mr-1.5" />
                              CONNECTED
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Locations List */}
                <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px]">
                  <CardHeader>
                    <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[#EB690B]" />
                      Geographic Node Registry
                    </CardTitle>
                    <CardDescription className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed font-light">
                      Outing starting nodes submitted by lobby participants. Specific coordinates are masked for privacy unless you are the lobby Admin.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 font-medium">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {locations.map((loc: any, idx: number) => {
                        return (
                          <div key={idx} className="flex justify-between items-center p-3 bg-stone-950/90 border border-stone-900 rounded-[8px] font-mono text-[11px]">
                            <span className="font-bold text-white uppercase tracking-wide">{loc.name}</span>
                            <span className="text-[#EB690B] text-[11px] font-semibold flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 text-[#EB690B]" /> {loc.locationName || 'Location Saved'}
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
                <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px] text-[11px] font-mono">
                  <CardHeader>
                    <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B]">Budget Analysis</CardTitle>
                    <CardDescription className="text-[10px] text-neutral-400 uppercase leading-relaxed font-light font-mono">
                      Calculated limits from submitted envelopes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2 font-medium">
                    <div className="flex justify-between py-2 border-b border-stone-900/60">
                      <span className="text-neutral-400">ENVELOPES RECEIVED</span>
                      <span className="font-bold text-white">
                        {budgetSummary?.submittedCount || 0} OF {members.length}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-stone-900/60">
                      <span className="text-neutral-400">FLOOR LIMIT (MIN)</span>
                      <span className="font-bold text-white">₹{budgetSummary?.min || 0}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-stone-900/60">
                      <span className="text-neutral-400">CEILING LIMIT (MAX)</span>
                      <span className="font-bold text-white">₹{budgetSummary?.max || 0}</span>
                    </div>
                    <div className="flex justify-between py-2.5 border border-[#EB690B]/20 bg-[#EB690B]/10 px-3 rounded-[8px] text-[#EB690B] font-bold uppercase">
                      <span>GROUP PROTOCOL BUDGET CAP</span>
                      <span>₹{budgetSummary?.avg || 0}</span>
                    </div>
                  </CardContent>
                  <CardFooter className="bg-black/20 pt-4 border-t border-stone-900/60 flex flex-col items-stretch rounded-b-[12px]">
                    <span className="text-[9px] text-neutral-500 text-center italic font-sans leading-relaxed">
                      Note: Budgets are guide-ranges. The system constructs various target strategies.
                    </span>
                  </CardFooter>
                </Card>
              </div>

            </TabsContent>

            {/* TAB 2: INPUTS FORM */}
            <TabsContent value="inputs" className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Submit Budget */}
              <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px]">
                <CardHeader>
                  <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-[#EB690B]" />
                    Budget Thresholds
                  </CardTitle>
                  <CardDescription className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed font-light">
                    Enter your maximum spending cap for this outing (₹50 — ₹100,000).
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleBudgetSubmit}>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="budgetInput" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Your Max Budget (INR)</Label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#EB690B] font-bold">₹</span>
                        <Input
                          id="budgetInput"
                          type="number"
                          min={50}
                          max={100000}
                          value={budgetVal}
                          onChange={(e) => setBudgetVal(e.target.value)}
                          placeholder="500"
                          className="pl-8 bg-stone-950/80 border border-stone-850 text-white rounded-[8px] font-mono text-xs focus-visible:ring-[#EB690B] focus-visible:border-[#EB690B]"
                          required
                          disabled={isSubmittingBudget}
                        />
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    {currentUser.budget !== null ? (
                      <div className="w-full bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0] text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] py-2.5 text-center flex items-center justify-center gap-1.5">
                        <Check className="h-3.5 w-3.5" /> Budget Registered
                      </div>
                    ) : (
                      <Button 
                        type="submit" 
                        disabled={isSubmittingBudget} 
                        className="bg-[#EB690B] hover:bg-[#D4590A] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] w-full py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
                      >
                        {isSubmittingBudget ? 'Saving...' : 'Submit Budget'}
                      </Button>
                    )}
                  </CardFooter>
                </form>
              </Card>

              {/* Submit Location Name */}
              <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px]">
                <CardHeader>
                  <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-[#EB690B]" />
                    Starting Coordinates
                  </CardTitle>
                  <CardDescription className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed font-light">
                    Enter your starting location name/neighborhood (e.g. Dadar, Indiranagar) or auto-detect it.
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleLocationSubmit}>
                  <CardContent className="space-y-4">
                    <div className="space-y-2.5">
                      <Label htmlFor="locationInput" className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-400">Location Name or Neighborhood</Label>
                      <Input
                        id="locationInput"
                        type="text"
                        value={addressVal}
                        onChange={(e) => setAddressVal(e.target.value)}
                        placeholder="e.g. Dadar, Mumbai or Koramangala, Bengaluru"
                        className="bg-stone-950/80 border border-stone-850 text-white rounded-[8px] font-mono text-xs focus-visible:ring-[#EB690B] focus-visible:border-[#EB690B]"
                        required
                        disabled={isSubmittingLocation || isCollectingMembers}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-2 pt-0">
                    {currentUser.location !== null ? (
                      <div className="w-full bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0] text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] py-2.5 text-center flex items-center justify-center gap-1.5 mb-1">
                        <Check className="h-3.5 w-3.5" /> Coordinates Synced
                      </div>
                    ) : (
                      <Button 
                        type="submit" 
                        disabled={isSubmittingLocation || isCollectingMembers} 
                        className="bg-[#EB690B] hover:bg-[#D4590A] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] w-full py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
                      >
                        {isSubmittingLocation ? 'Saving Node...' : 'Save Location Name'}
                      </Button>
                    )}
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={handleAutoDetect}
                      disabled={isSubmittingLocation || isCollectingMembers} 
                      className="border border-stone-855 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] w-full py-2.5 transition-all"
                    >
                      Auto-Detect Coordinates
                    </Button>
                  </CardFooter>
                </form>
              </Card>

              {/* Submit Vibe Preferences */}
              <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px] md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#EB690B] flex items-center gap-2">
                    <Heart className="h-4 w-4 text-[#EB690B]" />
                    Outing Vibes Selection
                  </CardTitle>
                  <CardDescription className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed font-light">
                    Choose the target vibe properties. These guide the experience-matching vector score.
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
                            className={`px-3 py-1.5 rounded-[6px] border text-[9px] font-mono font-bold uppercase tracking-widest transition-all duration-200 cursor-pointer ${
                              isSelected 
                                ? 'bg-[#EB690B] border-[#EB690B] text-white shadow-sm shadow-[#EB690B]/25'
                                : 'bg-stone-950/80 border-stone-850 hover:border-[#EB690B]/50 text-neutral-400 hover:text-white'
                            }`}
                          >
                            {vibe}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                  <CardFooter>
                    {hasVibes ? (
                      <div className="w-full bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0] text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] py-2.5 text-center flex items-center justify-center gap-1.5">
                        <Check className="h-3.5 w-3.5" /> Vibes Locked & Saved
                      </div>
                    ) : (
                      <Button 
                        type="submit" 
                        disabled={isSubmittingVibes} 
                        className="bg-[#EB690B] hover:bg-[#D4590A] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] w-full py-2.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
                      >
                        {isSubmittingVibes ? 'Saving...' : 'Save Vibes Preference'}
                      </Button>
                    )}
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
