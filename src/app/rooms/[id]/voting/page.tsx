'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Clock3, Landmark, Sparkles, Vote } from 'lucide-react';
import { useRoom, useItineraries, useVotes, useCastVote, useConfirmItinerary } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ItineraryOption, AIItineraryResponse } from '@/types';
import { WebsiteHero, WebsitePage, WebsiteSection } from '@/components/site/WebsiteLayout';

interface VotesPayload {
  votes: Array<{ itinerary_option_id: string; count: number }>;
  user_vote: string | null;
  total_votes: number;
  total_members: number;
  is_admin: boolean;
  show_counts: boolean;
  all_voted: boolean;
  missing_votes: number;
  auto_confirmed: boolean;
  can_confirm_now: boolean;
  top_option_ids: string[];
  is_tie: boolean;
  confirm_warning: string | null;
}

const strategyLabels: Record<string, string> = {
  geometric: 'Center Point',
  minimax_transit: 'Fairest Travel',
  min_total_transit: 'Most Efficient',
  cultural_hub: 'Vibe Match',
};

function getFairnessClass(score: number): string {
  if (score >= 0.85) return 'fairness-high';
  if (score >= 0.65) return 'fairness-medium';
  return 'fairness-low';
}

function getFairnessLabel(score: number): string {
  if (score >= 0.85) return 'Very Fair';
  if (score >= 0.65) return 'Reasonably Fair';
  return 'Uneven';
}

function renderPrice(value: number): string {
  return value > 0 ? `₹${value}` : 'Price unavailable';
}

function renderMinutes(value?: number): string {
  if (!value || value <= 0) return 'N/A';
  return `${value} min`;
}

function renderPercent(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return `${Math.round(value)}%`;
}

function renderRating(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'N/A';
  return `${value.toFixed(1)} / 5`;
}

export default function VotingPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  const { data: room } = useRoom(roomId);
  const { data: itineraries } = useItineraries(roomId);
  const { data: votesDataRaw } = useVotes(roomId);
  const castVote = useCastVote(roomId);
  const confirmItinerary = useConfirmItinerary(roomId);
  const status = useRoomStore((s) => s.status);
  const setRoom = useRoomStore((s) => s.setRoom);
  const setIsAdmin = useRoomStore((s) => s.setIsAdmin);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const votesData = votesDataRaw as VotesPayload | undefined;

  useRoomRealtime(roomId);

  useEffect(() => {
    if (room) {
      setRoom(room);
      setIsAdmin(room.is_admin);
    }
  }, [room, setRoom, setIsAdmin]);

  useEffect(() => {
    if (status === 'confirmed') router.push(`/rooms/${roomId}/confirmed`);
  }, [status, roomId, router]);

  const isAdmin = room?.is_admin;
  const userVote = votesData?.user_vote;
  const showCounts = votesData?.show_counts;
  const allVoted = votesData?.all_voted;
  const canConfirmNow = votesData?.can_confirm_now;
  const missingVotes = votesData?.missing_votes || 0;
  const topOptionIds = votesData?.top_option_ids || [];
  const isTie = votesData?.is_tie || false;
  const typedItineraries = itineraries as ItineraryOption[] | undefined;
  const voteProgress = votesData && votesData.total_members > 0
    ? Math.round((votesData.total_votes / votesData.total_members) * 100)
    : 0;

  const handleVote = async (optionId: string) => {
    try {
      await castVote.mutateAsync(optionId);
    } catch {
      // no-op
    }
  };

  const handleConfirm = async (optionId: string) => {
    try {
      await confirmItinerary.mutateAsync(optionId);
    } catch {
      // no-op
    }
  };

  const getVoteCount = (optionId: string) => {
    return votesData?.votes?.find((v) => v.itinerary_option_id === optionId)?.count || 0;
  };

  return (
    <WebsitePage>
        <WebsiteHero>
          <div className="relative z-[1] space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div>
                <span className="section-kicker">Voting Stage</span>
                <h1 className="saas-title mt-3">Pick The Final Plan</h1>
                <p className="saas-lead mt-3">Compare each itinerary on fairness, travel time, and cost before confirming the final outcome.</p>
              </div>
              <span className="badge badge-info inline-flex items-center gap-1"><Vote className="h-3 w-3" /> Live voting</span>
            </div>

            <div className="saas-grid-4">
              <div className="saas-kpi"><p className="saas-kpi-label">Votes</p><p className="saas-kpi-value">{votesData?.total_votes || 0}</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Members</p><p className="saas-kpi-value">{votesData?.total_members || 0}</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Progress</p><p className="saas-kpi-value">{voteProgress}%</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Options</p><p className="saas-kpi-value">{typedItineraries?.length || 0}</p></div>
            </div>
          </div>
        </WebsiteHero>

        {isAdmin && !allVoted ? (
          <div className="panel p-4 border-[rgba(255,193,7,0.3)] bg-[rgba(255,193,7,0.08)] text-sm text-[var(--color-warning)] inline-flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            {missingVotes} members have not voted yet. You can still confirm if needed.
          </div>
        ) : null}

        {isAdmin && isTie ? (
          <div className="panel p-4 border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.08)] text-sm text-[var(--color-info)] inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Tie detected. Confirm one of the top-tied options.
          </div>
        ) : null}

        <WebsiteSection className="grid md:grid-cols-2 gap-5">
          {typedItineraries?.map((option) => {
            const plan = option.plan as AIItineraryResponse;
            const isVoted = userVote === option.id;
            const voteCount = getVoteCount(option.id);
            const isExpanded = expandedId === option.id;
            const canConfirmThisOption = canConfirmNow && topOptionIds.includes(option.id);

            return (
              <Card key={option.id} className={`p-0 overflow-hidden ${isVoted ? 'border-[var(--color-accent)] glow-accent' : ''}`}>
                <div className="p-5 border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.015)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{strategyLabels[option.hub_strategy] || option.hub_strategy}</p>
                      <p className="text-xs text-[var(--color-text-tertiary)] mt-2">{plan.area || option.hub_name}</p>
                      <h3 className="text-xl font-semibold text-[var(--color-text-primary)] mt-1">{plan.short_title || `${option.hub_name} - Grounded itinerary`}</h3>
                    </div>
                    <span className={`badge ${getFairnessClass(option.travel_fairness_score)}`}>{getFairnessLabel(option.travel_fairness_score)}</span>
                  </div>

                  {plan.flow_summary ? <p className="text-sm text-[var(--color-text-secondary)] mt-3">{plan.flow_summary}</p> : null}

                  <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                    <div className="saas-list-item inline-flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> {renderPrice(option.total_cost_estimate)}/person</div>
                    <div className="saas-list-item inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {renderMinutes(plan.duration_total_mins)} total</div>
                    <div className="saas-list-item inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {plan.travel_summary?.avg_total_travel_mins || option.avg_travel_time_mins} min avg</div>
                    <div className="saas-list-item inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Vibe {renderPercent(plan.dominant_vibe_match_pct)}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : option.id)}
                  className="w-full px-5 py-2 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                >
                  {isExpanded ? 'Hide details' : 'Show details'}
                </button>

                {isExpanded && plan.stops ? (
                  <div className="px-5 pb-4 space-y-2">
                    <div className="saas-list-item">
                      <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Flow</p>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                        {plan.stops.map((stop, idx) => (
                          <span key={`flow-${stop.stop_number}`} className="inline-flex items-center gap-1">
                            {stop.map_url ? (
                              <Link href={stop.map_url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
                                {stop.place_name}
                              </Link>
                            ) : (
                              <span>{stop.place_name}</span>
                            )}
                            {idx < plan.stops.length - 1 ? <span className="text-[var(--color-text-tertiary)]">-&gt;</span> : null}
                          </span>
                        ))}
                      </div>
                    </div>

                    {plan.stops.map((stop) => (
                      <div key={stop.stop_number} className="saas-list-item">
                        <div className="flex items-center justify-between gap-2">
                          {stop.map_url ? (
                            <Link href={stop.map_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--color-accent)] hover:underline">
                              {stop.place_name}
                            </Link>
                          ) : (
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{stop.place_name}</p>
                          )}
                          <span className="text-xs text-[var(--color-text-tertiary)]">{stop.start_time}</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                          {stop.category_label || stop.place_type} • {renderPrice(stop.estimated_cost_per_person)} • {stop.duration_mins} min • ⭐ {renderRating(stop.place_rating)}
                        </p>
                      </div>
                    ))}

                    {plan.budget_breakdown ? (
                      <div className="saas-list-item text-xs text-[var(--color-text-secondary)]">
                        <p>Budget: ₹{plan.budget_breakdown.stop_cost_total} + ₹{plan.budget_breakdown.contingency_buffer} contingency = ₹{plan.budget_breakdown.total_with_contingency}</p>
                        <p>Cap: ₹{plan.budget_breakdown.cap_per_person} • {plan.budget_breakdown.within_cap ? 'within cap' : 'over cap'}</p>
                      </div>
                    ) : null}

                    {plan.member_travel_breakdown?.length ? (
                      <div className="saas-list-item">
                        <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Per-user travel suitability</p>
                        <div className="space-y-1">
                          {plan.member_travel_breakdown.map((member) => (
                            <p key={member.user_id} className="text-xs text-[var(--color-text-secondary)]">
                              {member.member_name}: {member.total_travel_mins} min total ({member.to_hub_mins} to hub + {member.in_area_travel_mins} in area) • budget {member.suits_budget ? 'ok' : 'tight'} • travel {member.suits_travel ? 'ok' : 'high'}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {plan.why_this_option ? (
                      <p className="text-xs text-[var(--color-text-secondary)]">Why this works: {plan.why_this_option}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="p-5 border-t border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.015)] space-y-2">
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => handleVote(option.id)}
                      disabled={castVote.isPending}
                      variant={isVoted ? 'primary' : 'secondary'}
                      className="flex-1"
                      id={`vote-btn-${option.id}`}
                      icon={isVoted ? <CheckCircle2 className="h-4 w-4" /> : undefined}
                    >
                      {isVoted ? 'Your Vote' : 'Vote For This'}
                    </Button>
                    {showCounts ? (
                      <span className="text-sm text-[var(--color-text-secondary)] font-mono">{voteCount} vote{voteCount !== 1 ? 's' : ''}</span>
                    ) : null}
                  </div>

                  {isAdmin && canConfirmThisOption ? (
                    <Button
                      onClick={() => handleConfirm(option.id)}
                      disabled={confirmItinerary.isPending}
                      variant="secondary"
                      className="w-full"
                      id={`confirm-btn-${option.id}`}
                      loading={confirmItinerary.isPending}
                    >
                      Confirm This Plan
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </WebsiteSection>

        {(!typedItineraries || typedItineraries.length === 0) ? (
          <div className="panel p-12 text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">Loading itinerary options...</p>
          </div>
        ) : null}
    </WebsitePage>
  );
}
