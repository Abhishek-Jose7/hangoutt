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

      // Since we are mocking the database rows for votes, we handle the local display state
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
      subtitle={`Outing options generated for ${group.name}`}
      actions={
        <div className="flex gap-2">
          <Link href={`/groups/${group.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Back to Group
          </Link>
          {votingStatus === 'OPEN' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCloseVoting}
              disabled={isClosing}
              className="flex items-center gap-1"
            >
              <Calendar className="h-4 w-4" />
              Close Voting
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Navigation / List Panel */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              Itinerary Choices
            </h2>
            <Badge variant="outline" className={votingStatus === 'OPEN' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500'}>
              Voting: {votingStatus}
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
                  className={`cursor-pointer transition border hover:border-indigo-200 ${
                    isActive ? 'border-2 border-indigo-600 shadow-sm bg-indigo-50/10' : 'border-slate-200'
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-1">
                      <CardTitle className="text-sm font-extrabold text-slate-800">{plan.name}</CardTitle>
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-1">
                        <Vote className="h-3 w-3" />
                        {voteCount}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs line-clamp-1">{plan.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 text-xs text-slate-500 flex justify-between">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      {Math.round(plan.totalDurationMinutes / 60)}h {plan.totalDurationMinutes % 60}m
                    </span>
                    <span className="flex items-center gap-0.5 font-bold text-slate-700">
                      ₹{plan.totalEstimatedCostPerHead} / head
                    </span>
                  </CardContent>
                  <CardFooter className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">
                      {plan.slots.length} Slots scheduled
                    </span>
                    {hasUserVoted && (
                      <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                        <Check className="h-3.5 w-3.5" />
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
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <CardTitle className="text-lg font-bold text-slate-900">{selectedPlan.name}</CardTitle>
                  <CardDescription className="text-sm text-slate-500 mt-1">{selectedPlan.tagline}</CardDescription>
                </div>
                {votingStatus === 'OPEN' && (
                  <Button 
                    size="sm"
                    disabled={isCasting || userVotedPlanId === selectedPlan.id}
                    onClick={() => handleVoteCast(selectedPlan.id)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow"
                  >
                    {userVotedPlanId === selectedPlan.id ? (
                      <>
                        <Check className="mr-1 h-4 w-4" /> Voted
                      </>
                    ) : (
                      <>
                        <Vote className="mr-1 h-4 w-4" /> Vote for Plan
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              
              {/* Cost & Duration Banner */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                <div>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Estimated Budget</p>
                  <p className="text-xl font-extrabold text-slate-800 mt-1">₹{selectedPlan.totalEstimatedCostPerHead} <span className="text-xs text-slate-400 font-medium">/head</span></p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Total Duration</p>
                  <p className="text-xl font-extrabold text-slate-800 mt-1">
                    {Math.floor(selectedPlan.totalDurationMinutes / 60)}h {selectedPlan.totalDurationMinutes % 60}m
                  </p>
                </div>
              </div>

              {/* Timeline slots */}
              <div className="relative border-l border-slate-200 pl-6 ml-3 space-y-6">
                {selectedPlan.slots.map((slot, index) => {
                  return (
                    <div key={index} className="relative">
                      {/* Timeline point */}
                      <span className="absolute -left-9 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 ring-4 ring-white text-indigo-700 text-xs font-bold">
                        {slot.order}
                      </span>
                      
                      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">{slot.venueName}</h4>
                            <span className="inline-block mt-0.5 px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase">
                              {slot.category}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                            {slot.arrivalTime} ({slot.durationMinutes}m)
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed font-medium">
                          {slot.note}
                        </p>
                        <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3.5 w-3.5" />
                            Estimated: ₹{slot.estimatedCostPerHead}
                          </span>
                          {slot.travelToNextMinutes !== null && (
                            <span className="text-indigo-500 font-bold flex items-center gap-1">
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
