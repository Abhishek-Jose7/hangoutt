'use client';

import React, { useState, use } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { MOCK_PLANS, MOCK_GROUPS } from '@/lib/utils/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createVote, closeVoting } from '@/actions/votes';
import { Clock, DollarSign, Sparkles, Check, Vote, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function PlannerPage({ params }: { params: Promise<{ groupId: string }> }) {
  const resolvedParams = use(params);
  const groupId = resolvedParams.groupId;

  // Find group from mock
  const group = MOCK_GROUPS.find(g => g.id === groupId) || MOCK_GROUPS[0];

  const [activePlanId, setActivePlanId] = useState(MOCK_PLANS[0].id);
  const [votes, setVotes] = useState<Record<string, number>>({
    plan_chill_bowl: 3,
    plan_action_packed: 1,
    plan_budget_friendly: 0,
  });
  const [userVotedPlanId, setUserVotedPlanId] = useState<string | null>(null);
  const [isCasting, setIsCasting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [votingStatus, setVotingStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');

  const selectedPlan = MOCK_PLANS.find(p => p.id === activePlanId) || MOCK_PLANS[0];

  const handleVoteCast = async (planId: string) => {
    setIsCasting(true);
    try {
      const res = await createVote({
        groupId: group.id,
        planId: planId,
      });

      if (!res.success) {
        toast.error(res.error.message || 'Failed to submit vote');
        setIsCasting(false);
        return;
      }

      toast.success('Vote cast successfully!');
      
      // Update local aggregates
      setVotes(prev => {
        const next = { ...prev };
        if (userVotedPlanId) {
          next[userVotedPlanId] = Math.max(0, next[userVotedPlanId] - 1);
        }
        next[planId] = (next[planId] || 0) + 1;
        return next;
      });
      setUserVotedPlanId(planId);
    } catch (_err) {
      toast.error('An error occurred submitting your vote.');
    } finally {
      setIsCasting(false);
    }
  };

  const handleCloseVoting = async () => {
    setIsClosing(true);
    try {
      const res = await closeVoting(group.id);

      if (!res.success) {
        toast.error(res.error.message || 'Failed to close voting');
        setIsClosing(false);
        return;
      }

      toast.success('Voting session closed! Winner declared.');
      setVotingStatus('CLOSED');
    } catch (_err) {
      toast.error('An error occurred closing voting.');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <PageContainer
      title="Itinerary Planner"
      subtitle={`Outing choices generated automatically for ${group.name}`}
      actions={
        <div className="flex gap-2 font-sans text-xs">
          <Link 
            href={`/groups/${group.id}`} 
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'rounded-lg border-border hover:bg-primary/10 hover:text-primary font-semibold tracking-wide' })}
          >
            Back to Group
          </Link>
          {votingStatus === 'OPEN' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCloseVoting}
              disabled={isClosing}
              className="flex items-center gap-1.5 rounded-lg font-semibold tracking-wide font-sans text-xs"
            >
              <Calendar className="h-4 w-4" />
              Close Voting
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
            <Badge variant="outline" className={votingStatus === 'OPEN' ? 'bg-primary/10 text-primary border-primary/20 rounded-full font-semibold uppercase py-0.5 px-2.5 text-[9px]' : 'bg-muted text-muted-foreground border border-border rounded-full font-semibold uppercase py-0.5 px-2.5 text-[9px]'}>
              Voting: {votingStatus.toLowerCase()}
            </Badge>
          </div>

          <div className="space-y-3">
            {MOCK_PLANS.map((plan) => {
              const isActive = plan.id === activePlanId;
              const voteCount = votes[plan.id] || 0;
              const hasUserVoted = userVotedPlanId === plan.id;
              
              return (
                <Card 
                  key={plan.id}
                  onClick={() => setActivePlanId(plan.id)}
                  className={`cursor-pointer transition border rounded-xl bg-card shadow-sm hover:border-primary/50 ${
                    isActive ? 'border-primary' : 'border-border'
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-1">
                      <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wide">{plan.name}</CardTitle>
                      <Badge variant="secondary" className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/10 hover:text-primary rounded-full flex items-center gap-1 text-[9px] font-bold py-0.5 px-2">
                        <Vote className="h-2.5 w-2.5" />
                        {voteCount} votes
                      </Badge>
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
                  <CardFooter className="p-3 bg-black/40 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground rounded-b-xl">
                    <span>
                      {plan.slots.length} Activities scheduled
                    </span>
                    {hasUserVoted && (
                      <span className="text-primary font-bold flex items-center gap-0.5 uppercase">
                        <Check className="h-3 w-3" />
                        Voted
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
          <Card className="border border-border rounded-xl bg-card shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <CardTitle className="text-base font-bold text-foreground uppercase font-heading tracking-wide">{selectedPlan.name}</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground font-light mt-1">{selectedPlan.tagline}</CardDescription>
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
              <div className="grid grid-cols-2 gap-4 bg-primary/10 border border-primary/20 p-4 rounded-xl text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Estimated Budget</p>
                  <p className="text-lg font-extrabold text-foreground mt-1">₹{selectedPlan.totalEstimatedCostPerHead} <span className="text-[10px] text-muted-foreground font-light">/ head</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total Duration</p>
                  <p className="text-lg font-extrabold text-foreground mt-1">
                    {Math.floor(selectedPlan.totalDurationMinutes / 60)}h {selectedPlan.totalDurationMinutes % 60}m
                  </p>
                </div>
              </div>

              {/* Timeline slots */}
              <div className="relative border-l border-border pl-6 ml-3 space-y-6">
                {selectedPlan.slots.map((slot, index) => {
                  return (
                    <div key={index} className="relative">
                      {/* Timeline point */}
                      <span className="absolute -left-[35px] top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shadow-sm">
                        {slot.order}
                      </span>
                      
                      <div className="bg-black border border-border rounded-xl p-4 shadow-sm space-y-2 text-xs">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h4 className="text-sm font-bold text-foreground uppercase tracking-wide">{slot.venueName}</h4>
                            <span className="inline-block mt-1 px-2.5 py-0.5 bg-muted text-muted-foreground border border-border rounded-full text-[9px] font-bold uppercase tracking-wider font-sans">
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
                        <div className="pt-2 border-t border-border flex justify-between items-center text-[10px] font-medium text-muted-foreground">
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
