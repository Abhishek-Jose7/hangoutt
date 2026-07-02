'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getGroupDetailsAction } from '@/actions/groups';
import { getPlansForGroupAction, generatePlan } from '@/actions/planner';
import { createVote, closeVoting, countVotes, getUserVoteForGroup } from '@/actions/votes';
import { Clock, DollarSign, Sparkles, Check, Vote, Calendar, ArrowLeft, Loader2, Award, RefreshCw, Trees, Coffee, Utensils, Cake, Gamepad2, Coins, ChevronRight, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function PlannerPage() {
  const params = useParams();
  const groupId = params.groupId as string;

  const [group, setGroup] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [activePlanId, setActivePlanId] = useState<string>('');
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [userVotedPlanId, setUserVotedPlanId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [votingStatus, setVotingStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [loading, setLoading] = useState(true);
  const [isCasting, setIsCasting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [isRegenOpen, setIsRegenOpen] = useState(false);
  const [selectedRegenOpts, setSelectedRegenOpts] = useState<string[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [scrollIndex, setScrollIndex] = useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [expandedPlanTravel, setExpandedPlanTravel] = useState<Record<string, boolean>>({});
  const [expandedItineraries, setExpandedItineraries] = useState<Record<string, boolean>>({});
  const [activeDetailPlanId, setActiveDetailPlanId] = useState<string | null>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const width = target.offsetWidth;
    const left = target.scrollLeft;
    const newIndex = Math.round(left / (width || 1));
    if (newIndex !== scrollIndex && newIndex >= 0 && newIndex < plans.length) {
      setScrollIndex(newIndex);
    }
  };

  const budgetTierLabels: Record<string, string> = {
    'TRAVEL_FRIENDLY': 'LOWEST COMMUTE',
    'BUDGET_FRIENDLY': 'BUDGET FRIENDLY',
    'BALANCED': 'BEST OVERALL',
    'EXPERIENCE_FIRST': 'EXPERIENCE FIRST',
    'PREMIUM': 'EXPERIENCE FIRST',
  };

  const getFrontendFallbackImage = (category: string) => {
    const cat = (category ?? '').toUpperCase();
    if (['CAFE', 'RESTAURANT', 'DESSERT'].includes(cat)) {
      return '/images/cafe_active.png';
    }
    return '/images/mumbai_map.png';
  };

  const getCategoryIcon = (category: string) => {
    const cat = (category ?? '').toUpperCase();
    if (['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR'].includes(cat)) {
      return <Trees className="h-3.5 w-3.5 text-[#00E5A0]" />;
    }
    if (cat === 'CAFE') {
      return <Coffee className="h-3.5 w-3.5 text-[#FFD700]" />;
    }
    if (cat === 'RESTAURANT') {
      return <Utensils className="h-3.5 w-3.5 text-[#DC143C]" />;
    }
    if (cat === 'DESSERT') {
      return <Cake className="h-3.5 w-3.5 text-[#FF69B4]" />;
    }
    if (['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS', 'MALL'].includes(cat)) {
      return <Gamepad2 className="h-3.5 w-3.5 text-[#00BFFF]" />;
    }
    return <Sparkles className="h-3.5 w-3.5 text-[#A855F7]" />;
  };

  function getEndTime(startTimeStr: string, durationMinutes: number): string {
    try {
      const match = startTimeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return startTimeStr;
      let hour = parseInt(match[1]);
      const min = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && hour !== 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      
      const date = new Date();
      date.setHours(hour, min, 0, 0);
      date.setMinutes(date.getMinutes() + durationMinutes);
      
      let endHour = date.getHours();
      const endMin = date.getMinutes();
      const endAmpm = endHour >= 12 ? 'PM' : 'AM';
      endHour = endHour % 12;
      if (endHour === 0) endHour = 12;
      return `${endHour}:${endMin.toString().padStart(2, '0')} ${endAmpm}`;
    } catch {
      return startTimeStr;
    }
  }

  useEffect(() => {
    async function loadData() {
      try {
        const [groupRes, plansRes, voteTalliesRes, userVoteRes] = await Promise.all([
          getGroupDetailsAction(groupId),
          getPlansForGroupAction(groupId),
          countVotes(groupId),
          getUserVoteForGroup(groupId),
        ]);

        if (groupRes.success) {
          setGroup(groupRes.data.group);
          setMembers(groupRes.data.members || []);
          setIsAdmin(groupRes.data.currentUser.role === 'ADMIN');
          setCurrentUserId(groupRes.data.currentUser.userId);
          setVotingStatus(groupRes.data.group.votingStatus);
          if (groupRes.data.group.generationOptions) {
            try {
              const opts = JSON.parse(groupRes.data.group.generationOptions);
              if (Array.isArray(opts)) {
                setSelectedRegenOpts(opts);
              }
            } catch (_e) {}
          }
        }

        if (plansRes.success) {
          setPlans(plansRes.data);
          if (plansRes.data.length > 0) {
            setActivePlanId(plansRes.data[0].id);
          }
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
      } catch (err) {
        console.error('Failed to load data:', err);
        toast.error('Failed to load planner data.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [groupId]);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const res = await generatePlan(groupId, selectedRegenOpts);
      if (res.success) {
        toast.success('Itineraries regenerated successfully!');
        const [groupRes, plansRes] = await Promise.all([
          getGroupDetailsAction(groupId),
          getPlansForGroupAction(groupId)
        ]);
        if (groupRes.success) {
          setGroup(groupRes.data.group);
          setVotingStatus(groupRes.data.group.votingStatus);
        }
        if (plansRes.success) {
          setPlans(plansRes.data);
          if (plansRes.data.length > 0) {
            setActivePlanId(plansRes.data[0].id);
          }
        }
        setIsRegenOpen(false);
      } else {
        toast.error(res.error?.message || 'Failed to regenerate plans');
      }
    } catch (err) {
      console.error('Regeneration failed:', err);
      toast.error('An unexpected error occurred during regeneration.');
    } finally {
      setIsRegenerating(false);
    }
  };

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

      // Check if group status updated (e.g. automatically finalized because all members voted)
      const groupRes = await getGroupDetailsAction(groupId);
      if (groupRes.success) {
        setGroup(groupRes.data.group);
        setVotingStatus(groupRes.data.group.votingStatus);
      }
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
      setVotingStatus('CLOSED');
      
      const groupRes = await getGroupDetailsAction(groupId);
      if (groupRes.success) {
        setGroup(groupRes.data.group);
      }
    } catch (_err) {
      toast.error('An error occurred closing voting.');
    } finally {
      setIsClosing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-[#0A0A0C] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mb-4" />
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono font-bold">Initializing AI Planner Module...</p>
      </div>
    );
  }

  if (!group || plans.length === 0) {
    return (
      <PageContainer title="Planner Not Ready">
        <Card className="border border-stone-900 bg-stone-950/45 text-center p-8 rounded-[12px] backdrop-blur-md">
          <Sparkles className="h-8 w-8 text-[#DC143C] mx-auto mb-4" />
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-4">No plans generated yet. Complete detail collection to allow the Admin to build itineraries.</p>
          <Link href={`/groups/${groupId}`} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 transition-all' })}>
            Back to Workspace
          </Link>
        </Card>
      </PageContainer>
    );
  }

  const selectedPlan = plans.find(p => p.id === activePlanId) || plans[0];
  const isWinningPlan = group.winningPlanId === selectedPlan.id;

  return (
    <PageContainer
      title={group.name.toUpperCase()}
      subtitle={`ITINERARY CONFIGURATOR // PLANS FOR LOBBY ${group.id.substring(0, 8).toUpperCase()}`}
      actions={
        <div className="flex gap-2">
          <Link 
            href={`/groups/${group.id}`} 
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'border-stone-855 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md' })}
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#DC143C]" /> BACK TO WORKSPACE
          </Link>
          {isAdmin && votingStatus === 'OPEN' && (
            <Button
              size="sm"
              onClick={() => setIsRegenOpen(true)}
              className="bg-stone-900 border border-stone-800 hover:bg-stone-800 hover:text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5 text-[#DC143C]" />
              REGENERATE PLANS
            </Button>
          )}
          {isAdmin && votingStatus === 'OPEN' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCloseVoting}
              disabled={isClosing}
              className="bg-red-950/45 text-red-500 border border-red-900/50 hover:bg-red-950/80 hover:text-red-400 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2.5 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Calendar className="h-3.5 w-3.5" />
              LOCK WINNING PLAN
            </Button>
          )}
        </div>
      }
    >
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none gap-6 pb-6 w-full -mx-4 px-4 xl:mx-0 xl:px-0 xl:grid xl:grid-cols-2 xl:gap-8 xl:overflow-x-visible xl:pb-0"
      >
        {plans.map((plan) => {
          const isWinningPlan = group.winningPlanId === plan.id;
          const voteCount = votes[plan.id] || 0;

          const isRainySeason = (() => {
            if (!group?.outingDate) return true;
            const parts = group.outingDate.split('-');
            if (parts.length < 2) return true;
            const month = parseInt(parts[1]);
            return [6, 7, 8].includes(month); // June, July, August
          })();

          const myTravel = plan.memberTravelMetrics?.find((mt: any) => mt.userId === currentUserId);

          const foodCount = plan.slots?.filter((s: any) => ['CAFE', 'RESTAURANT', 'DESSERT'].includes(s.category.toUpperCase())).length || 0;
          const foodStars = foodCount >= 3 ? '⭐⭐⭐⭐⭐' : (foodCount === 2 ? '⭐⭐⭐⭐☆' : '⭐⭐⭐☆☆');
          
          const funCount = plan.slots?.filter((s: any) => ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'].includes(s.category.toUpperCase())).length || 0;
          const funStars = funCount >= 2 ? '⭐⭐⭐⭐★' : (funCount === 1 ? '⭐⭐⭐⭐☆' : '⭐⭐☆☆☆');
          
          const relaxCount = plan.slots?.filter((s: any) => s.category.toUpperCase() === 'PARK').length || 0;
          const relaxStars = relaxCount >= 2 ? '⭐⭐⭐⭐⭐' : (relaxCount === 1 ? '⭐⭐⭐⭐☆' : '⭐⭐☆☆☆');

          return (
            <Card key={plan.id} className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px] flex flex-col justify-between h-auto xl:h-[1220px] snap-center snap-always w-[88vw] sm:w-[540px] md:w-[620px] xl:w-full flex-shrink-0 xl:flex-shrink pb-4 sm:pb-5">
              <CardHeader className="pb-3 border-b border-stone-900/60 hidden xl:block">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-sm font-bold text-white uppercase font-mono tracking-widest">{plan.name}</CardTitle>
                      {isWinningPlan ? (
                        <Badge className="bg-[#00E5A0]/10 text-[#00E5A0] border border-[#00E5A0]/20 text-[9px] font-mono font-bold py-0.5 px-2 rounded-[4px]">
                          WINNING PLAN LOCKED
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 text-[9px] font-mono font-bold py-0.5 px-2 rounded-[4px]">
                          <Vote className="h-2.5 w-2.5 mr-1 inline text-[#DC143C]" />
                          {voteCount} votes
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-[11px] text-neutral-400 font-sans tracking-wide leading-relaxed">{plan.tagline}</CardDescription>
                  </div>
                  {votingStatus === 'OPEN' && (
                    <Button 
                      size="sm"
                      disabled={isCasting || userVotedPlanId === plan.id}
                      onClick={() => handleVoteCast(plan.id)}
                      className={`font-mono font-bold rounded-[8px] uppercase tracking-widest text-[10px] px-5 py-2 shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer whitespace-nowrap ${
                        userVotedPlanId === plan.id
                          ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                          : 'bg-[#DC143C] hover:bg-[#B80F2E] text-white'
                      }`}
                    >
                      {userVotedPlanId === plan.id ? (
                        <>
                          <Check className="mr-1 h-3.5 w-3.5 text-[#00E5A0] inline" /> VOTED
                        </>
                      ) : (
                        <>
                          <Vote className="mr-1 h-3.5 w-3.5 inline" /> CAST VOTE
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4 sm:pt-6 space-y-4 flex-grow flex flex-col justify-between">
                
                {/* Mobile/Tablet Collapsed View */}
                <div className="block xl:hidden space-y-4 font-mono text-xs">
                  {/* Custom Row with Cover photo on left, title & tagline on right */}
                  <div className="flex gap-4 items-start">
                    {/* Cover image on the left */}
                    <div className="w-[85px] h-[85px] sm:w-[105px] sm:h-[105px] rounded-[10px] overflow-hidden flex-shrink-0 relative bg-stone-900">
                      <img
                        src={plan.slots?.[0]?.imageUrl || getFrontendFallbackImage(plan.slots?.[0]?.category)}
                        alt={plan.name}
                        className="w-full h-full object-cover opacity-90"
                      />
                    </div>
                    
                    {/* Text and badges on the right */}
                    <div className="flex-grow space-y-1.5 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono truncate">
                          {plan.name} {plan.planIndex === 1 && <span className="text-[9px] text-neutral-400 normal-case font-sans font-normal block sm:inline mt-0.5 sm:mt-0 sm:ml-1.5">(Optimal meeting point)</span>}
                        </h3>
                        {/* Small vote count badge */}
                        <span className="bg-[#DC143C]/10 border border-[#DC143C]/20 text-[#DC143C] text-[7.5px] font-mono font-bold py-0.5 px-1.5 rounded-[4px] flex-shrink-0 flex items-center gap-0.5 whitespace-nowrap">
                          <Vote className="h-2 w-2" /> {voteCount} votes
                        </span>
                      </div>
                      
                      <p className="text-[10px] sm:text-[11px] text-neutral-400 leading-normal font-sans line-clamp-2">
                        {plan.tagline}
                      </p>
                      
                      {/* Tag Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <span className="bg-[#DC143C]/15 border border-[#DC143C]/30 text-[#DC143C] text-[7.5px] font-mono font-bold py-0.5 px-1.5 rounded-[4px] uppercase tracking-wide">
                          {budgetTierLabels[plan.budgetTier] || plan.budgetTier.replace('_', ' ')}
                        </span>
                        
                        <span className="bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[7.5px] font-mono font-bold py-0.5 px-1.5 rounded-[4px] uppercase tracking-wide">
                          {group.groupType === 'DATE' ? 'DATE FRIENDLY' : 'FRIENDS HANGOUT'}
                        </span>
                        
                        {!plan.slots?.some((s: any) => ['PARK', 'PROMENADE', 'BEACH', 'OUTDOOR'].includes(s.category.toUpperCase())) && (
                          <span className="bg-teal-500/15 border border-teal-500/30 text-teal-400 text-[7.5px] font-mono font-bold py-0.5 px-1.5 rounded-[4px] uppercase tracking-wide">
                            INDOOR FRIENDLY
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Redesigned 4-Column Stats Grid */}
                  <div className="grid grid-cols-4 gap-1.5 bg-[#DC143C]/5 border border-[#DC143C]/10 p-2.5 rounded-[8px] mt-3 font-mono text-[9px]">
                    {/* Cost Column */}
                    <div className="flex flex-col items-center justify-center text-center p-0.5 border-r border-stone-900/60">
                      <Coins className="h-3.5 w-3.5 text-[#DC143C] mb-1" />
                      <span className="text-[7.5px] text-neutral-400 uppercase tracking-wider">Cost / Head</span>
                      <span className="text-[10px] font-bold text-white mt-0.5">₹{Math.round(plan.totalEstimatedCostPerHead)}</span>
                      <span className="text-[6.5px] text-neutral-500 truncate mt-0.5 max-w-[70px]">
                        ₹{Math.max(0, Math.round((plan.totalEstimatedCostPerHead * 0.85)/50)*50)}–{Math.round((plan.totalEstimatedCostPerHead * 1.15)/50)*50}
                      </span>
                    </div>

                    {/* Commute Column */}
                    <div className="flex flex-col items-center justify-center text-center p-0.5 border-r border-stone-900/60">
                      <Clock className="h-3.5 w-3.5 text-[#DC143C] mb-1" />
                      <span className="text-[7.5px] text-neutral-400 uppercase tracking-wider">Avg Commute</span>
                      <span className="text-[10px] font-bold text-white mt-0.5">{plan.avgTotalTime} mins</span>
                      <span className="text-[6.5px] text-neutral-500 truncate mt-0.5 max-w-[70px]">
                        ({plan.shortestTravelTime}–{plan.longestTravelTime}m) range
                      </span>
                    </div>

                    {/* Duration Column */}
                    <div className="flex flex-col items-center justify-center text-center p-0.5 border-r border-stone-900/60">
                      <Clock className="h-3.5 w-3.5 text-[#DC143C] mb-1" />
                      <span className="text-[7.5px] text-neutral-400 uppercase tracking-wider">Duration</span>
                      <span className="text-[10px] font-bold text-white mt-0.5">
                        {Math.floor(plan.totalDurationMinutes / 60)}h {plan.totalDurationMinutes % 60}m
                      </span>
                      <span className="text-[6.5px] text-neutral-500 mt-0.5">(with travel)</span>
                    </div>

                    {/* Score Column */}
                    <div className="flex flex-col items-center justify-center text-center p-0.5">
                      <Star className="h-3.5 w-3.5 text-[#FFD700] mb-1 fill-[#FFD700]/10" />
                      <span className="text-[7.5px] text-neutral-400 uppercase tracking-wider">Plan Score</span>
                      <span className="text-[10px] font-bold text-white mt-0.5">{(plan.score * 10).toFixed(1)}/10</span>
                      <span className="text-[6.5px] text-[#00E5A0] mt-0.5 font-bold">{(plan.score * 100).toFixed(0)}% match</span>
                    </div>
                  </div>

                  {/* Clean Horizontal Timeline pathway */}
                  <div className="bg-stone-900/25 border border-stone-900/60 p-2.5 rounded-[8px] mt-3 font-mono">
                    <div className="flex items-center justify-between w-full">
                      {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, sIdx: number) => {
                        const transitMin = slot.travelToNextMinutes;
                        return (
                          <React.Fragment key={sIdx}>
                            {/* Slot Item */}
                            <div className="flex flex-col items-center justify-center text-center min-w-[65px] max-w-[90px] flex-shrink-0">
                              {/* Icon + Name row */}
                              <div className="flex items-center gap-1">
                                {getCategoryIcon(slot.category)}
                                <span className="text-[8.5px] font-bold text-white truncate max-w-[60px] uppercase">
                                  {slot.name}
                                </span>
                              </div>
                              {/* Time */}
                              <span className="text-[7px] text-neutral-400 mt-1 font-semibold">
                                {slot.arrivalTime}
                              </span>
                            </div>
                            
                            {/* Transit Transition Arrow */}
                            {sIdx < plan.slots.length - 1 && (
                              <div className="flex-grow flex flex-col items-center justify-center min-w-[15px] px-0.5 relative">
                                <div className="w-full border-t border-dashed border-stone-800 absolute top-1/2 -translate-y-1/2 left-0 z-0"></div>
                                <div className="bg-[#0A0A0C] px-1 rounded-[4px] border border-stone-900 text-[6.5px] text-[#DC143C] font-bold z-10 flex items-center gap-0.5 whitespace-nowrap">
                                  <span>➔</span>
                                  <span>{transitMin || 15}m</span>
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mobile Action Buttons */}
                  <div className="flex gap-2.5 mt-4 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveDetailPlanId(plan.id)}
                      className="border-stone-850 bg-stone-950/50 hover:bg-stone-900 text-neutral-300 text-[8.5px] font-mono font-bold uppercase tracking-widest rounded-[6px] px-3 py-2.5 transition-all flex items-center justify-center gap-1 cursor-pointer flex-1"
                    >
                      VIEW HIGHLIGHTS
                    </Button>
                    {votingStatus === 'OPEN' && (
                      <Button
                        size="sm"
                        disabled={isCasting || userVotedPlanId === plan.id}
                        onClick={() => handleVoteCast(plan.id)}
                        className={`font-mono font-bold rounded-[6px] uppercase tracking-widest text-[8.5px] px-4 py-2.5 transition-all flex items-center justify-center gap-1 cursor-pointer flex-[1.4] shadow-md ${
                          userVotedPlanId === plan.id
                            ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                            : 'bg-[#DC143C] hover:bg-[#B80F2E] text-white'
                        }`}
                      >
                        {userVotedPlanId === plan.id ? (
                          <>
                            <Check className="h-3 w-3 text-[#00E5A0]" /> VOTED
                          </>
                        ) : (
                          <>
                            <Vote className="h-3 w-3" /> VOTE FOR THIS PLAN
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Always-Expanded Desktop View */}
                <div className="hidden xl:block xl:space-y-6 w-full flex-grow xl:flex xl:flex-col xl:justify-between">
                  <div className="space-y-6 flex-grow flex flex-col justify-between w-full">
                    <div className="space-y-6">

                      {/* Monsoon active warning */}
                      {isRainySeason && (
                        <div className="bg-[#DC143C]/5 border border-[#DC143C]/20 p-2.5 rounded-[6px] text-[8.5px] text-neutral-400 font-mono flex items-start gap-1.5 leading-snug">
                          <span className="text-[11px] leading-none">☔</span>
                          <span><strong>Monsoon Active (July):</strong> Outdoor locations like parks/promenades are susceptible to rain. Re-generate with "More Indoor" if weather conditions worsen.</span>
                        </div>
                      )}

                      {/* Cost & Duration Banner */}
                      <div className="grid grid-cols-3 gap-4 bg-[#DC143C]/10 border border-[#DC143C]/20 p-4 rounded-[8px] text-center font-mono">
                        <div>
                          <p className="text-[9px] text-neutral-400 uppercase tracking-widest">Expected Spend</p>
                          <p className="text-sm font-bold text-white mt-1">
                            ₹{Math.max(0, Math.round((plan.totalEstimatedCostPerHead * 0.85)/50)*50)}–{Math.round((plan.totalEstimatedCostPerHead * 1.15)/50)*50}
                            <span className="text-[8px] text-neutral-500 font-normal block mt-0.5">/ HEAD</span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-neutral-400 uppercase tracking-widest">Total Duration</p>
                          <p className="text-sm font-bold text-white mt-1">
                            {Math.floor(plan.totalDurationMinutes / 60)}H {plan.totalDurationMinutes % 60}M
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-neutral-400 uppercase tracking-widest">Budget Strategy</p>
                          <Badge variant="outline" className="mt-1 bg-stone-950 border border-stone-850 uppercase text-[8px] font-bold text-[#DC143C] py-0.5 px-2 rounded-[4px] font-mono">
                            {budgetTierLabels[plan.budgetTier] || plan.budgetTier.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>

                      {/* Why Recommended reasons display */}
                      {plan.whyRecommended && Array.isArray(plan.whyRecommended) && plan.whyRecommended.length > 0 && (
                        <div className="bg-stone-900/40 border border-stone-850 p-4 rounded-[8px] space-y-2">
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C]">Why This Outing?</h4>
                          <div className="grid grid-cols-1 gap-2 mt-1">
                            {plan.whyRecommended.slice(0, 4).map((reason: string, rIdx: number) => (
                              <div key={rIdx} className="flex items-center gap-2 text-[10px] text-neutral-300 font-mono">
                                <Check className="h-3.5 w-3.5 text-[#00E5A0] flex-shrink-0 font-bold" />
                                <span>{reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-355">
                      
                      {/* Personalized Commute summary */}
                      {myTravel && (
                        <div className="bg-stone-900/40 border border-stone-900/60 p-3 rounded-[8px] text-[10px] font-mono space-y-1.5">
                          <div className="flex justify-between items-center text-neutral-300">
                            <span className="text-[#00E5A0] font-bold uppercase tracking-wider">👤 YOUR PERSONAL COMMUTE:</span>
                            <span className="font-bold text-white">Total: {myTravel.totalTime}m (₹{myTravel.totalCost})</span>
                          </div>
                          <div className="text-[9px] text-neutral-400 flex flex-wrap gap-2.5">
                            {myTravel.trainTime > 0 && <span className="flex items-center gap-0.5">🚆 Train: {myTravel.trainTime}m</span>}
                            {(myTravel.cabTime > 0 || myTravel.autoTime > 0) && <span className="flex items-center gap-0.5">🚕 Cab/Auto: {myTravel.cabTime || myTravel.autoTime}m</span>}
                            {myTravel.walkTime > 0 && <span className="flex items-center gap-0.5">🚶 Walk: {myTravel.walkTime}m</span>}
                          </div>
                        </div>
                      )}

                      {/* Vibe / Fun / Adventure Meter */}
                      <div className="grid grid-cols-3 gap-2 text-[9px] text-neutral-400 font-mono bg-stone-900/20 border border-stone-900/60 p-3 rounded-[8px]">
                        <div className="flex flex-col gap-0.5">
                          <span>🍔 Food Vibe:</span>
                          <span className="text-white font-bold">{foodStars}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span>🕹️ Fun/Arcade:</span>
                          <span className="text-white font-bold">{funStars}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span>🚶 Relax Vibe:</span>
                          <span className="text-white font-bold">{relaxStars}</span>
                        </div>
                      </div>

                      {/* Confidence Metrics & Trade-offs */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-900/20 border border-stone-900/60 p-4 rounded-[8px] font-mono text-[10px]">
                        <div className="space-y-2.5 border-r border-stone-900/60 pr-2">
                          <h5 className="text-[8.5px] font-bold text-neutral-400 uppercase tracking-widest">Match Metrics</h5>
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[9px]">
                              <span className="text-neutral-400 font-semibold">Overall Match:</span>
                              <span className="font-bold text-[#00E5A0]">{(plan.score * 100).toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-stone-900 h-1 rounded-full overflow-hidden">
                              <div className="bg-[#00E5A0] h-full" style={{ width: `${plan.score * 100}%` }}></div>
                            </div>
                          </div>
                          
                          {/* Dynamic score breakdown display */}
                          <div className="pt-2 border-t border-stone-900/40 space-y-1.5 text-[8px] text-neutral-400">
                            <div className="flex justify-between items-center">
                              <span>✈ Travel (35% weight):</span>
                              <span className="font-semibold text-white">{(plan.travelScore * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>💵 Budget (25% weight):</span>
                              <span className="font-semibold text-white">{(plan.budgetScore * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>🎯 Preferences (20% weight):</span>
                              <span className="font-semibold text-white">{(plan.groupTypeMatchScore * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>★ Venue Quality (15% weight):</span>
                              <span className="font-semibold text-white">{(plan.popularityScore * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span>☔ Weather (5% weight):</span>
                              <span className="font-semibold text-white">{(plan.vibeMatchScore * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1.5 pl-2 flex flex-col justify-between">
                          <h5 className="text-[8.5px] font-bold text-[#DC143C] uppercase tracking-widest">Insights</h5>
                          <ul className="space-y-1 text-[8.5px] leading-tight text-neutral-300">
                            {plan.budgetTier === 'TRAVEL_FRIENDLY' && (
                              <>
                                <li className="text-[#00E5A0]">+ Lowest travel time</li>
                                <li className="text-neutral-400">− Fewer arcade choices</li>
                              </>
                            )}
                            {plan.budgetTier === 'BUDGET_FRIENDLY' && (
                              <>
                                <li className="text-[#00E5A0]">+ Extremely pocket-friendly</li>
                                <li className="text-neutral-400">− Longer commutes for some</li>
                              </>
                            )}
                            {plan.budgetTier === 'BALANCED' && (
                              <>
                                <li className="text-[#00E5A0]">+ Great rating/commute split</li>
                                <li className="text-neutral-400">− Popular spots get crowded</li>
                              </>
                            )}
                            {plan.budgetTier === 'EXPERIENCE_FIRST' && (
                              <>
                                <li className="text-[#00E5A0]">+ Premium gaming & food</li>
                                <li className="text-neutral-400">− Higher budget required</li>
                              </>
                            )}
                          </ul>
                        </div>
                      </div>

                      {/* Commute Disparity Warning */}
                      {plan.memberTravelMetrics && plan.memberTravelMetrics.length > 0 && (
                        (() => {
                          const maxMetric = plan.memberTravelMetrics.reduce((max: any, m: any) => m.totalTime > max.totalTime ? m : max, plan.memberTravelMetrics[0]);
                          const maxMember = members.find((m: any) => m.userId === maxMetric.userId);
                          if (maxMetric.totalTime > plan.avgTotalTime + 15) {
                            return (
                              <div className="bg-[#DC143C]/5 border border-[#DC143C]/20 p-2.5 rounded-[6px] text-[8.5px] text-neutral-400 font-mono flex items-start gap-1.5 leading-snug">
                                <span className="text-sm">⚠️</span>
                                <span><strong>Commute Disparity:</strong> {maxMember?.name || 'A participant'} travels the most ({maxMetric.totalTime} mins). Everyone else is under {plan.avgTotalTime + 5} mins. Consider matching their transit choice.</span>
                              </div>
                            );
                          }
                          return null;
                        })()
                      )}

                      {/* Timeline slots */}
                      <div className="relative border-l border-stone-900/60 pl-6 ml-3 space-y-6 font-mono text-xs">
                        {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, index: number) => {
                          return (
                            <div key={index} className="relative">
                              {/* Timeline point */}
                              <span className="absolute -left-[35px] top-1.5 flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#DC143C] text-[#0A0A0C] text-[10px] font-mono font-bold shadow-md">
                                {slot.slotOrder}
                              </span>
                              
                              <div className="bg-stone-950/80 border border-stone-900 rounded-[12px] overflow-hidden shadow-lg flex flex-col sm:flex-row hover:border-[#DC143C]/20 transition-all duration-200 sm:min-h-[144px]">
                                {/* Slot Image */}
                                <div className="relative w-full sm:w-36 h-28 sm:h-auto flex-shrink-0 bg-stone-900/50">
                                  <img
                                    src={slot.imageUrl || getFrontendFallbackImage(slot.category)}
                                    alt={slot.name}
                                    className="w-full h-full object-cover opacity-85 hover:opacity-100 transition-opacity duration-300"
                                  />
                                </div>
                                <div className="p-4 flex-grow space-y-2 flex flex-col justify-between">
                                  <div className="flex justify-between items-start gap-2">
                                    <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {slot.link ? (
                                          <a
                                            href={slot.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:underline hover:text-[#ff3b5f] transition-colors"
                                          >
                                            <h4 className="text-xs font-bold text-white uppercase tracking-widest font-mono">
                                              {slot.name.toUpperCase()}
                                            </h4>
                                          </a>
                                        ) : (
                                          <h4 className="text-xs font-bold text-white uppercase tracking-widest font-mono">
                                            {slot.name.toUpperCase()}
                                          </h4>
                                        )}
                                        {slot.link && (
                                          <a
                                            href={slot.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[#DC143C] hover:text-[#ff3b5f] transition-colors inline-flex items-center"
                                            title="View location or book"
                                          >
                                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                              <polyline points="15 3 21 3 21 9" />
                                              <line x1="10" y1="14" x2="21" y2="3" />
                                            </svg>
                                          </a>
                                        )}
                                      </div>
                                      <span className="inline-block mt-1 px-2.5 py-0.5 bg-stone-900 text-neutral-400 border border-stone-850 rounded-[4px] text-[8px] font-mono font-bold uppercase tracking-widest">
                                        {slot.category}
                                      </span>
                                    </div>
                                    <span className="text-[9px] font-bold text-[#DC143C] bg-[#DC143C]/10 border border-[#DC143C]/20 px-2 py-0.5 rounded-[4px] font-mono whitespace-nowrap">
                                      {slot.arrivalTime} – {getEndTime(slot.arrivalTime, slot.durationMinutes)} ({slot.durationMinutes}m)
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-neutral-400 font-sans tracking-wide leading-relaxed font-light mt-2">
                                    {slot.note}
                                  </p>
                                  <div className="pt-2 border-t border-stone-900/60 flex justify-between items-center text-[9px] font-bold text-neutral-400 font-mono">
                                    <span className="flex items-center gap-1">
                                      <DollarSign className="h-3 w-3 text-[#DC143C]" />
                                      EXPECTED SPEND: ₹{slot.estimatedCostPerHead === 0 ? '0 (Free)' : `${Math.max(0, Math.round((slot.estimatedCostPerHead * 0.75)/50)*50)} – ₹${Math.round((slot.estimatedCostPerHead * 1.25)/50)*50}`}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Transit transition connector */}
                              {index < plan.slots.length - 1 && slot.travelToNextMinutes !== null && (
                                <div className="my-6 relative pl-4 border-l border-dashed border-stone-700/80 text-[10px] text-neutral-400 font-mono flex flex-col justify-center gap-1 min-h-[48px] -ml-6">
                                  <span className="absolute -left-[4px] h-2 w-2 rounded-full bg-stone-700 border border-stone-600" />
                                  <div className="flex items-center gap-2">
                                    <span>⏱️ TRANSIT TRANSITION:</span>
                                    <span className="text-white font-bold">{slot.travelToNextMinutes} mins</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-neutral-500 font-bold uppercase text-[9px] mt-0.5">
                                    {slot.travelToNextMinutes > 15 ? (
                                      <>
                                        <span className="text-neutral-400 flex items-center gap-0.5">🚕 AUTO/CAB: ₹{slot.travelToNextCost || Math.ceil((30 + Math.max(0, (slot.travelToNextMinutes / 3.0) - 1.5) * 15) / Math.min(3, group?.memberCount || 2))}</span>
                                        <span>•</span>
                                        <span className="text-neutral-400 flex items-center gap-0.5">🚶 WALK: 5 mins</span>
                                      </>
                                    ) : (
                                      <span className="text-neutral-400 flex items-center gap-0.5">🚶 WALK ONLY: {slot.travelToNextMinutes} mins</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Return trip commute estimator */}
                      <div className="bg-stone-950 border border-dashed border-stone-850/60 p-3 flex justify-between items-center text-[9px] font-mono text-neutral-400 rounded-[8px]">
                        <span className="flex items-center gap-1">🏠 ESTIMATED RETURN COMMUTE</span>
                        <span className="text-white font-bold">~{plan.avgTotalTime} mins | ₹{plan.avgTotalCost} avg</span>
                      </div>

                      {/* Transit Grid */}
                      {plan.memberTravelMetrics && plan.memberTravelMetrics.length > 0 && (
                        <div className="border-t border-stone-900/60 pt-6 mt-6">
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="text-[10px] font-bold text-white uppercase tracking-widest font-mono flex items-center gap-1.5">
                              <svg className="h-4 w-4 text-[#DC143C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                <path d="M2 12h20" />
                              </svg>
                              YOUR TRAVEL BREAKDOWN
                            </h4>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedPlanTravel(prev => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                              className="text-[9px] font-mono text-[#DC143C] hover:bg-stone-900 hover:text-white rounded-[6px] h-7 px-3 cursor-pointer"
                            >
                              {expandedPlanTravel[plan.id] ? 'HIDE MEMBERS' : 'SHOW MEMBERS'}
                            </Button>
                          </div>

                          {!expandedPlanTravel[plan.id] ? (
                            <div className="bg-stone-950/50 border border-stone-900/80 rounded-[8px] p-3 text-[10px] font-mono text-neutral-400 space-y-1.5">
                              <div className="flex justify-between">
                                <span>Average Commute Time:</span>
                                <span className="text-white font-bold">{plan.avgTotalTime} mins</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Commute Time Range:</span>
                                <span className="text-white">{plan.shortestTravelTime}m – {plan.longestTravelTime}m</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Average Commute Cost:</span>
                                <span className="text-[#DC143C] font-bold">₹{plan.avgTotalCost}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="overflow-x-auto bg-stone-950/80 border border-stone-900 rounded-[12px] p-3 shadow-lg">
                              <table className="w-full text-left border-collapse font-mono text-[10px]">
                                <thead>
                                  <tr className="border-b border-stone-850 text-neutral-400 font-bold">
                                    <th className="py-2 px-3">Member</th>
                                    <th className="py-2 px-3">Train</th>
                                    <th className="py-2 px-3">Cab / Auto</th>
                                    <th className="py-2 px-3">Walk</th>
                                    <th className="py-2 px-3 text-right">Total Commute</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {plan.memberTravelMetrics.map((mt: any) => {
                                    const memberObj = members.find((m: any) => m.userId === mt.userId);
                                    const name = memberObj ? memberObj.name : 'Participant';
                                    return (
                                      <tr key={mt.id} className="border-b border-stone-900/40 hover:bg-stone-900/20 text-neutral-300">
                                        <td className="py-2 px-3 font-semibold text-white">{name}</td>
                                        <td className="py-2 px-3">
                                          {mt.trainTime > 0 ? (
                                            <span>{mt.trainTime}m <span className="text-neutral-500">(₹{mt.trainCost})</span></span>
                                          ) : (
                                            <span className="text-neutral-600">N/A</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3">
                                          {mt.cabTime > 0 || mt.autoTime > 0 ? (
                                            <span>{mt.cabTime || mt.autoTime}m <span className="text-neutral-500">(₹{mt.cabCost || mt.autoCost})</span></span>
                                          ) : (
                                            <span className="text-neutral-600">N/A</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3">
                                          {mt.walkTime > 0 ? (
                                            <span>{mt.walkTime}m</span>
                                          ) : (
                                            <span className="text-neutral-600">0m</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-right font-bold text-white">
                                          {mt.totalTime}m <span className="text-[#DC143C] font-semibold">(₹{mt.totalCost})</span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
              {votingStatus === 'OPEN' && (
                <CardFooter className="p-4 border-t border-stone-900/60 bg-black/15 flex justify-end rounded-b-[12px]">
                  <Button 
                    size="sm"
                    disabled={isCasting || userVotedPlanId === plan.id}
                    onClick={() => handleVoteCast(plan.id)}
                    className={`font-mono font-bold rounded-[8px] uppercase tracking-widest text-[10px] w-full py-2.5 shadow-md transition-all hover:scale-[101%] active:scale-[99%] cursor-pointer ${
                      userVotedPlanId === plan.id
                        ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                        : 'bg-[#DC143C] hover:bg-[#B80F2E] text-white'
                    }`}
                  >
                    {userVotedPlanId === plan.id ? (
                      <>
                        <Check className="mr-1.5 h-3.5 w-3.5 text-[#00E5A0] inline" /> VOTED FOR THIS
                      </>
                    ) : (
                      <>
                        <Vote className="mr-1.5 h-3.5 w-3.5 inline" /> VOTE FOR THIS ITINERARY
                      </>
                    )}
                  </Button>
                </CardFooter>
              )}
            </Card>
          );
        })}
      </div>

      {/* Swipe Dots Indicator for Mobile */}
      <div className="flex xl:hidden justify-center items-center gap-2 mt-4">
        {plans.map((_, idx) => (
          <button
            key={idx}
            onClick={() => {
              if (scrollRef.current) {
                const cardWidth = scrollRef.current.children[idx]?.getBoundingClientRect().width || 0;
                const gap = 24; // matches gap-6
                scrollRef.current.scrollTo({
                  left: idx * (cardWidth + gap),
                  behavior: 'smooth'
                });
                setScrollIndex(idx);
              }
            }}
            className={`h-2 w-2 rounded-full transition-all duration-300 ${
              scrollIndex === idx ? 'bg-[#DC143C] w-4' : 'bg-neutral-700 hover:bg-neutral-500'
            }`}
            aria-label={`Go to slide ${idx + 1}`}
          />
        ))}
      </div>

      {/* AI Outing Trade-offs & Comparisons Dashboard */}
      {plans.length > 0 && (
        <Card className="border border-stone-900 bg-stone-950/45 text-white rounded-[12px] p-6 font-mono text-xs w-full mt-10">
          <CardHeader className="p-0 pb-4 border-b border-stone-900">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-[#DC143C]">AI Outing Trade-offs & Comparisons</CardTitle>
            <CardDescription className="text-[10px] text-neutral-400 font-sans">Comparing travel times, costs, and outdoor monsoon protection for the 4 generated routes.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-[10.5px]">
              {plans.map((p) => {
                const typeLabel = budgetTierLabels[p.budgetTier] || p.budgetTier.replace('_', ' ');
                const hasPark = p.slots.some((s: any) => s.category.toUpperCase() === 'PARK');
                return (
                  <div key={p.id} className="bg-stone-900/20 border border-stone-900/60 p-4 rounded-[8px] space-y-3 flex flex-col justify-between hover:border-[#DC143C]/20 transition-all duration-200">
                    <div>
                      <Badge className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 uppercase text-[8px] font-bold py-0.5 px-2 mb-2 rounded-[4px]">
                        {typeLabel}
                      </Badge>
                      <h4 className="font-bold text-white uppercase text-xs tracking-wider">{p.name}</h4>
                      <p className="text-[9px] text-neutral-400 mt-1 leading-normal font-sans">{p.tagline}</p>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-stone-900/40 text-[9.5px]">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Activities Cost:</span>
                        <span className="text-white font-bold">₹{p.totalEstimatedCostPerHead - p.avgTotalCost}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Commute Time:</span>
                        <span className="text-white font-bold">{p.avgTotalTime} mins avg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Rain Safety:</span>
                        <span className={hasPark ? 'text-neutral-400' : 'text-[#00E5A0] font-bold'}>
                          {hasPark ? '☔ 67% (Outdoor Stop)' : '☔ 100% (Indoor Only)'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Regeneration Modal */}
      {isRegenOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 font-mono">
          <Card className="w-full max-w-md border border-stone-900 bg-stone-950 text-white rounded-[12px] shadow-2xl overflow-hidden">
            <CardHeader className="border-b border-stone-900 pb-4">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin-slow" />
                Regenerate Itineraries
              </CardTitle>
              <CardDescription className="text-[10px] text-neutral-400 font-sans">
                Adjust preferences to regenerate a new set of 4 premium outings for the group.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-3.5">
              <div className="space-y-2.5">
                {[
                  { id: 'Cheaper', label: 'Cheaper Outings', desc: 'Prioritize lower cost cafes and free activities' },
                  { id: 'More Activities', label: 'More Activities', desc: 'Focus slots on bowling, arcades, and sports' },
                  { id: 'More Food', label: 'More Food / Culinary', desc: 'Focus slots on cafes, restaurants, and desserts' },
                  { id: 'More Indoor', label: 'More Indoor Options', desc: 'Exclude outdoor parks and scenic areas' },
                  { id: 'More Creative', label: 'More Creative Outings', desc: 'Focus slots on pottery, painting, and workshops' },
                  { id: 'More Romantic', label: 'More Romantic', desc: 'Boost cafes, scenic spots, and live music for date vibes' },
                  { id: 'Less Travel', label: 'Less Travel Commute', desc: 'Limit radius to 5km around the group midpoint' }
                ].map((opt) => {
                  const isChecked = selectedRegenOpts.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-3 p-3 rounded-[8px] border transition-all cursor-pointer ${
                        isChecked 
                          ? 'border-[#DC143C]/40 bg-[#DC143C]/5' 
                          : 'border-stone-900 bg-stone-950 hover:bg-stone-900/40 hover:border-stone-850'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setSelectedRegenOpts(prev => prev.filter(x => x !== opt.id));
                          } else {
                            setSelectedRegenOpts(prev => [...prev, opt.id]);
                          }
                        }}
                        className="mt-1 h-3.5 w-3.5 border-stone-800 text-[#DC143C] focus:ring-[#DC143C] rounded accent-[#DC143C]"
                      />
                      <div className="flex flex-col gap-0.5 select-none">
                        <span className="text-[10px] font-bold text-white uppercase tracking-wider">{opt.label}</span>
                        <span className="text-[9px] text-neutral-400 font-sans leading-tight">{opt.desc}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </CardContent>
            <CardFooter className="border-t border-stone-900 pt-4 bg-black/25 flex justify-end gap-2.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsRegenOpen(false)}
                disabled={isRegenerating}
                className="border-stone-850 bg-stone-950 hover:bg-stone-900 text-neutral-300 text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="bg-[#DC143C] hover:bg-[#B80F2E] text-white text-[10px] font-mono font-bold uppercase tracking-widest rounded-[8px] px-4 py-2 flex items-center gap-1.5 shadow-md shadow-[#DC143C]/10"
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    REGENERATING...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    REGENERATE
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Detailed Plan Highlights Dialog Modal */}
      {activeDetailPlanId && (() => {
        const plan = plans.find(p => p.id === activeDetailPlanId);
        if (!plan) return null;

        const isWinningPlan = group.winningPlanId === plan.id;
        const voteCount = votes[plan.id] || 0;

        const isRainySeason = (() => {
          if (!group?.outingDate) return true;
          const parts = group.outingDate.split('-');
          if (parts.length < 2) return true;
          const month = parseInt(parts[1]);
          return [6, 7, 8].includes(month); // June, July, August
        })();

        const myTravel = plan.memberTravelMetrics?.find((mt: any) => mt.userId === currentUserId);

        const foodCount = plan.slots?.filter((s: any) => ['CAFE', 'RESTAURANT', 'DESSERT'].includes(s.category.toUpperCase())).length || 0;
        const foodStars = foodCount >= 3 ? '⭐⭐⭐⭐⭐' : (foodCount === 2 ? '⭐⭐⭐⭐☆' : '⭐⭐⭐☆☆');
        
        const funCount = plan.slots?.filter((s: any) => ['ARCADE', 'BOWLING', 'ESCAPE_ROOM', 'SPORTS'].includes(s.category.toUpperCase())).length || 0;
        const funStars = funCount >= 2 ? '⭐⭐⭐⭐★' : (funCount === 1 ? '⭐⭐⭐⭐☆' : '⭐⭐☆☆☆');
        
        const relaxCount = plan.slots?.filter((s: any) => s.category.toUpperCase() === 'PARK').length || 0;
        const relaxStars = relaxCount >= 2 ? '⭐⭐⭐⭐⭐' : (relaxCount === 1 ? '⭐⭐⭐⭐☆' : '⭐⭐☆☆☆');

        return (
          <Dialog open={activeDetailPlanId !== null} onOpenChange={(open) => !open && setActiveDetailPlanId(null)}>
            <DialogContent className="sm:max-w-xl md:max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-none border border-stone-900 bg-stone-950/98 text-white rounded-[12px] p-5 sm:p-6 backdrop-blur-md font-mono text-xs">
              <DialogHeader className="border-b border-stone-900 pb-3 mb-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="space-y-1">
                    <DialogTitle className="text-sm font-bold text-white uppercase tracking-widest">{plan.name}</DialogTitle>
                    <p className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed mt-1">{plan.tagline}</p>
                  </div>
                  {isWinningPlan ? (
                    <Badge className="bg-[#00E5A0]/10 text-[#00E5A0] border border-[#00E5A0]/20 text-[9px] font-bold py-0.5 px-2 rounded-[4px] flex-shrink-0">
                      WINNING PLAN LOCKED
                    </Badge>
                  ) : (
                    <Badge className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 text-[9px] py-0.5 px-2 rounded-[4px] flex-shrink-0">
                      {voteCount} votes
                    </Badge>
                  )}
                </div>
              </DialogHeader>

              <div className="space-y-6">
                {/* Monsoon active warning */}
                {isRainySeason && (
                  <div className="bg-[#DC143C]/5 border border-[#DC143C]/20 p-2.5 rounded-[6px] text-[8.5px] text-neutral-400 flex items-start gap-1.5 leading-snug">
                    <span className="text-[11px] leading-none">☔</span>
                    <span><strong>Monsoon Active (July):</strong> Outdoor locations like parks/promenades are susceptible to rain. Re-generate with "More Indoor" if weather conditions worsen.</span>
                  </div>
                )}

                {/* Cost & Duration Banner */}
                <div className="grid grid-cols-3 gap-3 bg-[#DC143C]/10 border border-[#DC143C]/20 p-3.5 rounded-[8px] text-center">
                  <div>
                    <p className="text-[8px] text-neutral-400 uppercase tracking-widest">Expected Spend</p>
                    <p className="text-[11px] font-bold text-white mt-1">
                      ₹{Math.max(0, Math.round((plan.totalEstimatedCostPerHead * 0.85)/50)*50)}–{Math.round((plan.totalEstimatedCostPerHead * 1.15)/50)*50}
                      <span className="text-[7.5px] text-neutral-500 font-normal block mt-0.5">/ HEAD</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-neutral-400 uppercase tracking-widest">Total Duration</p>
                    <p className="text-[11px] font-bold text-white mt-1">
                      {Math.floor(plan.totalDurationMinutes / 60)}H {plan.totalDurationMinutes % 60}M
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-neutral-400 uppercase tracking-widest">Budget Strategy</p>
                    <Badge variant="outline" className="mt-1 bg-stone-950 border border-stone-850 uppercase text-[7.5px] font-bold text-[#DC143C] py-0.5 px-1.5 rounded-[4px] font-mono">
                      {budgetTierLabels[plan.budgetTier] || plan.budgetTier.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>

                {/* Why Recommended */}
                {plan.whyRecommended && (() => {
                  let recList = [];
                  try {
                    recList = typeof plan.whyRecommended === 'string' ? JSON.parse(plan.whyRecommended) : plan.whyRecommended;
                  } catch {
                    recList = plan.whyRecommended;
                  }
                  if (!Array.isArray(recList) || recList.length === 0) return null;
                  return (
                    <div className="bg-stone-900/40 border border-stone-850 p-3.5 rounded-[8px] space-y-2">
                      <h4 className="text-[9px] font-bold uppercase tracking-widest text-[#DC143C]">Why This Outing?</h4>
                      <div className="grid grid-cols-1 gap-2 mt-1">
                        {recList.slice(0, 4).map((reason: string, rIdx: number) => (
                          <div key={rIdx} className="flex items-center gap-2 text-[9px] text-neutral-300">
                            <Check className="h-3 w-3 text-[#00E5A0] flex-shrink-0 font-bold" />
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Personalized Commute summary */}
                {myTravel && (
                  <div className="bg-stone-900/40 border border-stone-900/60 p-3 rounded-[8px] text-[9px] space-y-1.5">
                    <div className="flex justify-between items-center text-neutral-300">
                      <span className="text-[#00E5A0] font-bold uppercase tracking-wider">👤 YOUR PERSONAL COMMUTE:</span>
                      <span className="font-bold text-white">Total: {myTravel.totalTime}m (₹{myTravel.totalCost})</span>
                    </div>
                    <div className="text-[8px] text-neutral-400 flex flex-wrap gap-2.5">
                      {myTravel.trainTime > 0 && <span className="flex items-center gap-0.5">🚆 Train: {myTravel.trainTime}m</span>}
                      {(myTravel.cabTime > 0 || myTravel.autoTime > 0) && <span className="flex items-center gap-0.5">🚕 Cab/Auto: {myTravel.cabTime || myTravel.autoTime}m</span>}
                      {myTravel.walkTime > 0 && <span className="flex items-center gap-0.5">🚶 Walk: {myTravel.walkTime}m</span>}
                    </div>
                  </div>
                )}

                {/* Vibe Meter */}
                <div className="grid grid-cols-3 gap-2 text-[8px] text-neutral-400 bg-stone-900/20 border border-stone-900/60 p-3 rounded-[8px]">
                  <div className="flex flex-col gap-0.5">
                    <span>🍔 Food Vibe:</span>
                    <span className="text-white font-bold">{foodStars}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span>🕹️ Fun/Arcade:</span>
                    <span className="text-white font-bold">{funStars}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span>🚶 Relax Vibe:</span>
                    <span className="text-white font-bold">{relaxStars}</span>
                  </div>
                </div>

                {/* Match metrics & Tradeoffs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-900/20 border border-stone-900/60 p-4 rounded-[8px] text-[9px]">
                  <div className="space-y-2.5 border-r border-stone-900/60 pr-2">
                    <h5 className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest">Match Metrics</h5>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[9px]">
                        <span className="text-neutral-400 font-semibold">Overall Match:</span>
                        <span className="font-bold text-[#00E5A0]">{(plan.score * 100).toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-stone-900 h-1 rounded-full overflow-hidden">
                        <div className="bg-[#00E5A0] h-full" style={{ width: `${plan.score * 100}%` }}></div>
                      </div>
                    </div>
                    
                    <div className="pt-2 border-t border-stone-900/40 space-y-1.5 text-[8px] text-neutral-400">
                      <div className="flex justify-between items-center">
                        <span>✈ Travel (35% weight):</span>
                        <span className="font-semibold text-white">{(plan.travelScore * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>💵 Budget (25% weight):</span>
                        <span className="font-semibold text-white">{(plan.budgetScore * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>🎯 Preferences (20% weight):</span>
                        <span className="font-semibold text-white">{(plan.groupTypeMatchScore * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>★ Venue Quality (15% weight):</span>
                        <span className="font-semibold text-white">{(plan.popularityScore * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>☔ Weather (5% weight):</span>
                        <span className="font-semibold text-white">{(plan.vibeMatchScore * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5 pl-2 flex flex-col justify-between">
                    <h5 className="text-[8px] font-bold text-[#DC143C] uppercase tracking-widest">Insights</h5>
                    <ul className="space-y-1 text-[8px] leading-tight text-neutral-300">
                      {plan.budgetTier === 'TRAVEL_FRIENDLY' && (
                        <>
                          <li className="text-[#00E5A0]">+ Lowest travel time</li>
                          <li className="text-neutral-400">− Fewer arcade choices</li>
                        </>
                      )}
                      {plan.budgetTier === 'BUDGET_FRIENDLY' && (
                        <>
                          <li className="text-[#00E5A0]">+ Extremely pocket-friendly</li>
                          <li className="text-neutral-400">− Longer commutes for some</li>
                        </>
                      )}
                      {plan.budgetTier === 'BALANCED' && (
                        <>
                          <li className="text-[#00E5A0]">+ Great rating/commute split</li>
                          <li className="text-neutral-400">− Popular spots get crowded</li>
                        </>
                      )}
                      {plan.budgetTier === 'EXPERIENCE_FIRST' && (
                        <>
                          <li className="text-[#00E5A0]">+ Premium gaming & food</li>
                          <li className="text-neutral-400">− Higher budget required</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>

                {/* Timeline slots */}
                <div className="relative border-l border-stone-900/60 pl-6 ml-3 space-y-6 text-[10px]">
                  {plan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, index: number) => (
                    <div key={index} className="relative">
                      <span className="absolute -left-[35px] top-1.5 flex h-5 w-5 items-center justify-center rounded-[4px] bg-[#DC143C] text-[#0A0A0C] text-[9px] font-bold shadow-md">
                        {slot.slotOrder}
                      </span>
                      
                      <div className="bg-stone-950/80 border border-stone-900 rounded-[10px] overflow-hidden shadow-lg p-3 hover:border-[#DC143C]/20 transition-all duration-200">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h4 className="text-[10.5px] font-bold text-white uppercase tracking-widest">{slot.name}</h4>
                            <span className="inline-block mt-1 px-1.5 py-0.5 bg-stone-900 text-neutral-400 border border-stone-850 rounded-[4px] text-[7.5px] font-bold uppercase tracking-widest">
                              {slot.category}
                            </span>
                          </div>
                          <span className="text-[8px] font-bold text-[#DC143C] bg-[#DC143C]/10 border border-[#DC143C]/20 px-1.5 py-0.5 rounded-[4px] whitespace-nowrap">
                            {slot.arrivalTime} – {getEndTime(slot.arrivalTime, slot.durationMinutes)} ({slot.durationMinutes}m)
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-400 font-sans tracking-wide leading-relaxed mt-2">
                          {slot.note}
                        </p>
                        <div className="pt-2 border-t border-stone-900/60 flex justify-between items-center text-[8px] text-neutral-400 font-bold mt-2">
                          <span className="flex items-center gap-0.5">
                            <DollarSign className="h-2.5 w-2.5 text-[#DC143C]" />
                            EXPECTED SPEND: ₹{slot.estimatedCostPerHead === 0 ? '0 (Free)' : `${Math.max(0, Math.round((slot.estimatedCostPerHead * 0.75)/50)*50)} – ₹${Math.round((slot.estimatedCostPerHead * 1.25)/50)*50}`}
                          </span>
                        </div>
                      </div>

                      {/* Transit transition connector */}
                      {index < plan.slots.length - 1 && slot.travelToNextMinutes !== null && (
                        <div className="my-4 relative pl-4 border-l border-dashed border-stone-700/80 text-[9px] text-neutral-400 flex flex-col justify-center gap-0.5 min-h-[40px] -ml-6">
                          <span className="absolute -left-[4px] h-1.5 w-1.5 rounded-full bg-stone-700 border border-stone-600" />
                          <div className="flex items-center gap-2">
                            <span>⏱️ TRANSIT TRANSITION:</span>
                            <span className="text-white font-bold">{slot.travelToNextMinutes} mins</span>
                          </div>
                          {slot.travelToNextMinutes > 15 ? (
                            <span className="text-neutral-500 font-bold uppercase text-[8px] mt-0.5">
                              🚕 AUTO/CAB: ₹{slot.travelToNextCost || Math.ceil((30 + (slot.travelToNextMinutes / 3) * 15) / 2)} • 🚶 WALK: 5 mins
                            </span>
                          ) : (
                            <span className="text-neutral-500 font-bold uppercase text-[8px] mt-0.5">
                              🚶 WALK ONLY: {slot.travelToNextMinutes} mins
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Return commute */}
                <div className="bg-stone-950 border border-dashed border-stone-850/60 p-2.5 flex justify-between items-center text-[8.5px] text-neutral-400 rounded-[8px]">
                  <span>🏠 ESTIMATED RETURN COMMUTE</span>
                  <span className="text-white font-bold">~{plan.avgTotalTime} mins | ₹{plan.avgTotalCost} avg</span>
                </div>

                {/* Member travel table */}
                {plan.memberTravelMetrics && plan.memberTravelMetrics.length > 0 && (
                  <div className="border-t border-stone-900/60 pt-4">
                    <h4 className="text-[9px] font-bold text-white uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      YOUR TRAVEL BREAKDOWN
                    </h4>
                    <div className="bg-stone-950 border border-stone-900 rounded-[8px] overflow-hidden">
                      <table className="w-full text-left text-[8px] leading-normal">
                        <thead>
                          <tr className="border-b border-stone-900 bg-stone-900/20 text-neutral-500 uppercase tracking-wider font-bold">
                            <th className="py-2 px-2.5">Participant</th>
                            <th className="py-2 px-2">Transit Breakdown</th>
                            <th className="py-2 px-2.5 text-right">Total Commute</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-900">
                          {plan.memberTravelMetrics.map((mt: any, mtIdx: number) => {
                            const memberObj = members.find((m: any) => m.userId === mt.userId);
                            return (
                              <tr key={mtIdx} className="hover:bg-stone-900/20 text-neutral-300">
                                <td className="py-1.5 px-2.5 font-bold text-white">
                                  {memberObj?.name || 'Participant'}
                                </td>
                                <td className="py-1.5 px-2 font-mono text-[7.5px] text-neutral-400">
                                  {mt.trainTime > 0 && <span>🚆 {mt.trainTime}m </span>}
                                  {mt.cabTime > 0 && <span>🚕 {mt.cabTime}m </span>}
                                  {mt.walkTime > 0 && <span>🚶 {mt.walkTime}m</span>}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-bold text-white">
                                  {mt.totalTime}m <span className="text-[#DC143C] font-semibold">(₹{mt.totalCost})</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </PageContainer>
  );
}
