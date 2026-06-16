'use client';

import React, { useState, useEffect } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getGroupDetailsAction } from '@/actions/groups';
import { getPlansForGroupAction, generatePlan } from '@/actions/planner';
import { createVote, closeVoting, countVotes, getUserVoteForGroup } from '@/actions/votes';
import { Clock, DollarSign, Sparkles, Check, Vote, Calendar, ArrowLeft, Loader2, Award, RefreshCw } from 'lucide-react';
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono text-xs">
        
        {/* Navigation / List Panel */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              Itinerary Choices
            </h2>
            <Badge variant="outline" className={votingStatus === 'OPEN' ? 'bg-[#DC143C]/10 text-[#DC143C] border-[#DC143C]/20 rounded-[4px] font-mono font-bold uppercase py-0.5 px-2.5 text-[9px]' : 'bg-stone-900/40 text-neutral-400 border border-stone-850 rounded-[4px] font-mono font-bold uppercase py-0.5 px-2.5 text-[9px]'}>
              VOTING: {votingStatus.toLowerCase()}
            </Badge>
          </div>

          <div className="space-y-3">
            {plans.map((plan) => {
              const isActive = plan.id === activePlanId;
              const voteCount = votes[plan.id] || 0;
              const hasUserVoted = userVotedPlanId === plan.id;
              const isPlanWinner = group.winningPlanId === plan.id;
              
              return (
                <Card 
                  key={plan.id}
                  onClick={() => setActivePlanId(plan.id)}
                  className={`cursor-pointer transition duration-200 border rounded-[12px] bg-stone-950/45 backdrop-blur-md shadow-lg hover:border-[#DC143C]/50 ${
                    isActive ? 'border-[#DC143C] shadow-[#DC143C]/5' : 'border-stone-900/60'
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-1">
                      <CardTitle className="text-xs font-bold text-white uppercase tracking-widest font-mono">{plan.name}</CardTitle>
                      {isPlanWinner ? (
                        <Badge className="bg-[#00E5A0]/10 text-[#00E5A0] border border-[#00E5A0]/20 hover:bg-[#00E5A0]/10 hover:text-[#00E5A0] rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2">
                          <Award className="h-2.5 w-2.5" />
                          Winner
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-[#DC143C]/10 text-[#DC143C] border border-[#DC143C]/20 hover:bg-[#DC143C]/10 hover:text-[#DC143C] rounded-[4px] flex items-center gap-1 text-[9px] font-mono font-bold py-0.5 px-2">
                          <Vote className="h-2.5 w-2.5" />
                          {voteCount} votes
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-[10px] text-neutral-400 mt-0.5 line-clamp-1">{plan.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-[10px] text-neutral-400 flex justify-between font-mono font-medium">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-[#DC143C]" />
                      {Math.round(plan.totalDurationMinutes / 60)}h {plan.totalDurationMinutes % 60}m
                    </span>
                    <span className="font-bold text-white">
                      ₹{plan.totalEstimatedCostPerHead} / head
                    </span>
                  </CardContent>
                  <CardFooter className="p-3 bg-black/20 border-t border-stone-900/60 flex items-center justify-between text-[9px] text-neutral-400 font-mono rounded-b-[12px]">
                    <span>
                      {plan.slots.length} ACTIVITES SCHEDULED
                    </span>
                    {hasUserVoted && (
                      <span className="text-[#00E5A0] font-bold flex items-center gap-0.5 uppercase text-[9px]">
                        <Check className="h-3 w-3 text-[#00E5A0]" />
                        MY VOTE
                      </span>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Detailed Timeline View Panel */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border border-stone-900/60 bg-stone-950/45 backdrop-blur-md shadow-lg rounded-[12px]">
            <CardHeader className="pb-3 border-b border-stone-900/60">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold text-white uppercase font-mono tracking-widest">{selectedPlan.name}</CardTitle>
                    {isWinningPlan && (
                      <Badge className="bg-[#00E5A0]/10 text-[#00E5A0] border border-[#00E5A0]/20 text-[9px] font-mono font-bold py-0.5 px-2 rounded-[4px]">
                        WINNING PLAN LOCKED
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs text-neutral-400 font-sans tracking-wide leading-relaxed">{selectedPlan.tagline}</CardDescription>
                </div>
                {votingStatus === 'OPEN' && (
                  <Button 
                    size="sm"
                    disabled={isCasting || userVotedPlanId === selectedPlan.id}
                    onClick={() => handleVoteCast(selectedPlan.id)}
                    className={`font-mono font-bold rounded-[8px] uppercase tracking-widest text-[10px] px-5 py-2 shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                      userVotedPlanId === selectedPlan.id
                        ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                        : 'bg-[#DC143C] hover:bg-[#B80F2E] text-white'
                    }`}
                  >
                    {userVotedPlanId === selectedPlan.id ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5 text-[#00E5A0]" /> VOTED
                      </>
                    ) : (
                      <>
                        <Vote className="mr-1 h-3.5 w-3.5" /> CAST VOTE
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              
              {/* Cost & Duration Banner */}
              <div className="grid grid-cols-3 gap-4 bg-[#DC143C]/10 border border-[#DC143C]/20 p-4 rounded-[8px] text-center font-mono">
                <div>
                  <p className="text-[9px] text-neutral-400 uppercase tracking-widest">Estimated Budget</p>
                  <p className="text-base font-bold text-white mt-1">₹{selectedPlan.totalEstimatedCostPerHead} <span className="text-[9px] text-neutral-500 font-normal">/ HEAD</span></p>
                </div>
                <div>
                  <p className="text-[9px] text-neutral-400 uppercase tracking-widest">Total Duration</p>
                  <p className="text-base font-bold text-white mt-1">
                    {Math.floor(selectedPlan.totalDurationMinutes / 60)}H {selectedPlan.totalDurationMinutes % 60}M
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-neutral-400 uppercase tracking-widest">Budget Strategy</p>
                  <Badge variant="outline" className="mt-1 bg-stone-950 border border-stone-850 uppercase text-[9px] font-bold text-[#DC143C] py-0.5 px-2.5 rounded-[4px] font-mono">
                    {selectedPlan.budgetTier.replace('_', ' ')}
                  </Badge>
                </div>
              </div>

              {/* Why Recommended reasons display */}
              {selectedPlan.whyRecommended && Array.isArray(selectedPlan.whyRecommended) && selectedPlan.whyRecommended.length > 0 && (
                <div className="bg-stone-900/40 border border-stone-850 p-4 rounded-[8px] space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C]">Why This Outing?</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                    {selectedPlan.whyRecommended.map((reason: string, rIdx: number) => (
                      <div key={rIdx} className="flex items-center gap-2 text-[10px] text-neutral-300 font-mono">
                        <Check className="h-3.5 w-3.5 text-[#00E5A0] flex-shrink-0 font-bold" />
                        <span>{reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline slots */}
              <div className="relative border-l border-stone-900/60 pl-6 ml-3 space-y-6 font-mono text-xs">
                {selectedPlan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, index: number) => {
                  return (
                    <div key={index} className="relative">
                      {/* Timeline point */}
                      <span className="absolute -left-[35px] top-1.5 flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#DC143C] text-[#0A0A0C] text-[10px] font-mono font-bold shadow-md">
                        {slot.slotOrder}
                      </span>
                      
                      <div className="bg-stone-950/80 border border-stone-900 rounded-[12px] overflow-hidden shadow-lg flex flex-col sm:flex-row hover:border-[#DC143C]/20 transition-all duration-200">
                        {/* Slot Image */}
                        {slot.imageUrl && (
                          <div className="relative w-full sm:w-36 h-28 sm:h-auto flex-shrink-0 bg-stone-900/50">
                            <img
                              src={slot.imageUrl}
                              alt={slot.name}
                              className="w-full h-full object-cover opacity-85 hover:opacity-100 transition-opacity duration-300"
                            />
                          </div>
                        )}
                        <div className="p-4 flex-grow space-y-2">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-xs font-bold text-white uppercase tracking-widest font-mono">
                                  {slot.name.toUpperCase()}
                                </h4>
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
                              {slot.arrivalTime} ({slot.durationMinutes}M)
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-400 font-sans tracking-wide leading-relaxed font-light mt-2">
                            {slot.note}
                          </p>
                          <div className="pt-2 border-t border-stone-900/60 flex justify-between items-center text-[9px] font-bold text-neutral-400 font-mono">
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3 text-[#DC143C]" />
                              ESTIMATED: ₹{slot.estimatedCostPerHead}
                            </span>
                            {slot.travelToNextMinutes !== null && (
                              <span className="text-[#DC143C] font-bold flex items-center gap-1.5 uppercase text-[9px]">
                                <span className="flex items-center gap-0.5">
                                  <svg className="h-3 w-3 text-[#DC143C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h2" />
                                    <circle cx="7" cy="17" r="2" />
                                    <circle cx="17" cy="17" r="2" />
                                  </svg>
                                  AUTO: ₹{slot.travelToNextCost || Math.ceil((30 + Math.max(0, (slot.travelToNextMinutes / 3.0) - 1.5) * 15) / Math.min(3, group?.memberCount || 2))}
                                </span>
                                <span className="text-neutral-600">//</span>
                                <span>TRANSIT: {slot.travelToNextMinutes} MINS</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Transit Grid */}
              {selectedPlan.memberTravelMetrics && selectedPlan.memberTravelMetrics.length > 0 && (
                <div className="border-t border-stone-900/60 pt-6 mt-6">
                  <h4 className="text-[10px] font-bold text-white uppercase tracking-widest font-mono flex items-center gap-1.5 mb-2.5">
                    <svg className="h-4 w-4 text-[#DC143C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      <path d="M2 12h20" />
                    </svg>
                    YOUR TRAVEL BREAKDOWN (TRANSIT GRID)
                  </h4>
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
                        {selectedPlan.memberTravelMetrics.map((mt: any) => {
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
                </div>
              )}

            </CardContent>
          </Card>
        </div>
 
      </div>

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
    </PageContainer>
  );
}
