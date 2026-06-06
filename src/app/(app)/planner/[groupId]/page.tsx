'use client';

import React, { useState, useEffect, use } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getGroupDetailsAction } from '@/actions/groups';
import { getPlansForGroupAction } from '@/actions/planner';
import { createVote, closeVoting, countVotes, getUserVoteForGroup } from '@/actions/votes';
import { Clock, DollarSign, Sparkles, Check, Vote, Calendar, ArrowLeft, Loader2, Award } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function PlannerPage({ params }: { params: Promise<{ groupId: string }> }) {
  const resolvedParams = use(params);
  const groupId = resolvedParams.groupId;

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
          setIsAdmin(groupRes.data.currentUser.role === 'ADMIN');
          setVotingStatus(groupRes.data.group.votingStatus);
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
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-black text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Loading generated plans...</p>
      </div>
    );
  }

  if (!group || plans.length === 0) {
    return (
      <PageContainer title="Planner Not Ready">
        <Card className="border border-border bg-neutral-950/40 text-center p-8 rounded-xl">
          <Sparkles className="h-10 w-10 text-neutral-800 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-4">No plans generated yet. Complete detail collection to allow the Admin to build itineraries.</p>
          <Link href={`/groups/${groupId}`} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'rounded-lg border-border' })}>
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
      title={group.name}
      subtitle={`Itinerary options built using Ola Maps & Groq AI`}
      actions={
        <div className="flex gap-2 font-sans text-xs">
          <Link 
            href={`/groups/${group.id}`} 
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'rounded-lg border-border hover:bg-primary/10 hover:text-primary font-semibold tracking-wide' })}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Lobby
          </Link>
          {isAdmin && votingStatus === 'OPEN' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCloseVoting}
              disabled={isClosing}
              className="flex items-center gap-1.5 rounded-lg font-semibold tracking-wide font-sans text-xs bg-red-650 hover:bg-red-600"
            >
              <Calendar className="h-4 w-4" />
              Close Voting & Lock Plan
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans text-sm">
        
        {/* Navigation / List Panel */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              Itinerary Choices
            </h2>
            <Badge variant="outline" className={votingStatus === 'OPEN' ? 'bg-primary/10 text-primary border-primary/20 rounded-full font-semibold uppercase py-0.5 px-2.5 text-[9px]' : 'bg-neutral-800 text-muted-foreground border border-border rounded-full font-semibold uppercase py-0.5 px-2.5 text-[9px]'}>
              Voting: {votingStatus.toLowerCase()}
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
                  className={`cursor-pointer transition duration-200 border rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-sm hover:border-primary/50 ${
                    isActive ? 'border-primary shadow-primary/5' : 'border-border'
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-1">
                      <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wide">{plan.name}</CardTitle>
                      {isPlanWinner ? (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/10 hover:text-emerald-500 rounded-full flex items-center gap-1 text-[9px] font-bold py-0.5 px-2">
                          <Award className="h-2.5 w-2.5" />
                          Winner
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/10 hover:text-primary rounded-full flex items-center gap-1 text-[9px] font-bold py-0.5 px-2">
                          <Vote className="h-2.5 w-2.5" />
                          {voteCount} votes
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{plan.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-[10px] text-muted-foreground flex justify-between font-medium">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      {Math.round(plan.totalDurationMinutes / 60)}h {plan.totalDurationMinutes % 60}m
                    </span>
                    <span className="font-bold text-foreground">
                      ₹{plan.totalEstimatedCostPerHead} / head
                    </span>
                  </CardContent>
                  <CardFooter className="p-3 bg-black/20 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground rounded-b-xl">
                    <span>
                      {plan.slots.length} Activities scheduled
                    </span>
                    {hasUserVoted && (
                      <span className="text-primary font-bold flex items-center gap-0.5 uppercase text-[9px]">
                        <Check className="h-3 w-3" />
                        My Vote
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
          <Card className="border border-border rounded-xl bg-neutral-950/40 backdrop-blur-md shadow-sm">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold text-foreground uppercase font-heading tracking-wide">{selectedPlan.name}</CardTitle>
                    {isWinningPlan && (
                      <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-bold py-0.5 px-2 rounded-full">
                        Lock Winning Plan
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs text-muted-foreground font-light">{selectedPlan.tagline}</CardDescription>
                </div>
                {votingStatus === 'OPEN' && (
                  <Button 
                    size="sm"
                    disabled={isCasting || userVotedPlanId === selectedPlan.id}
                    onClick={() => handleVoteCast(selectedPlan.id)}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold rounded-lg uppercase tracking-wider text-[10px] px-5 py-2 shadow-sm"
                  >
                    {userVotedPlanId === selectedPlan.id ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5" /> Voted
                      </>
                    ) : (
                      <>
                        <Vote className="mr-1 h-3.5 w-3.5" /> Vote for Plan
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              
              {/* Cost & Duration Banner */}
              <div className="grid grid-cols-3 gap-4 bg-primary/10 border border-primary/20 p-4 rounded-xl text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Estimated Budget</p>
                  <p className="text-lg font-extrabold text-foreground mt-1">₹{selectedPlan.totalEstimatedCostPerHead} <span className="text-[10px] text-muted-foreground font-light">/ head</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total Duration</p>
                  <p className="text-lg font-extrabold text-foreground mt-1 font-mono">
                    {Math.floor(selectedPlan.totalDurationMinutes / 60)}h {selectedPlan.totalDurationMinutes % 60}m
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Budget Strategy</p>
                  <Badge variant="outline" className="mt-1 bg-black border-border/80 uppercase text-[9px] font-bold text-primary py-0.5 px-2.5">
                    {selectedPlan.budgetTier.replace('_', ' ')}
                  </Badge>
                </div>
              </div>

              {/* Timeline slots */}
              <div className="relative border-l border-border/60 pl-6 ml-3 space-y-6">
                {selectedPlan.slots?.sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, index: number) => {
                  return (
                    <div key={index} className="relative">
                      {/* Timeline point */}
                      <span className="absolute -left-[35px] top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm">
                        {slot.slotOrder}
                      </span>
                      
                      <div className="bg-black border border-border/60 rounded-xl p-4 shadow-sm space-y-2 text-xs">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h4 className="text-sm font-bold text-foreground uppercase tracking-wide">{slot.name}</h4>
                            <span className="inline-block mt-1 px-2.5 py-0.5 bg-neutral-900 text-muted-foreground border border-border/50 rounded-full text-[9px] font-bold uppercase tracking-wider font-sans">
                              {slot.category.toLowerCase()}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full font-mono">
                            {slot.arrivalTime} ({slot.durationMinutes}m)
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed font-light mt-2">
                          {slot.note}
                        </p>
                        <div className="pt-2 border-t border-border/60 flex justify-between items-center text-[10px] font-medium text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 text-primary" />
                            Estimated: ₹{slot.estimatedCostPerHead}
                          </span>
                          {slot.travelToNextMinutes !== null && (
                            <span className="text-primary font-bold flex items-center gap-1 uppercase text-[9px]">
                              Travel Next: {slot.travelToNextMinutes} mins
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </CardContent>
          </Card>
        </div>
 
      </div>
    </PageContainer>
  );
}
