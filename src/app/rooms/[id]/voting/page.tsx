'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Clock3, Landmark, Sparkles, Vote } from 'lucide-react';
import { useRoom, useItineraries, useVotes, useCastVote, useConfirmItinerary } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ItineraryOption, AIItineraryResponse } from '@/types';

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

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const strategyLabels: Record<string, string> = {
  geometric: '📐 Center Point',
  minimax_transit: '⚖️ Fairest Travel',
  min_total_transit: '⚡ Most Efficient',
  cultural_hub: '🎭 Vibe Match',
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

  const handleVote = async (optionId: string) => {
    try {
      await castVote.mutateAsync(optionId);
    } catch {
      // error
    }
  };

  const handleConfirm = async (optionId: string) => {
    try {
      await confirmItinerary.mutateAsync(optionId);
    } catch {
      // error
    }
  };

  const getVoteCount = (optionId: string) => {
    return votesData?.votes?.find(
      (v: { itinerary_option_id: string; count: number }) => v.itinerary_option_id === optionId
    )?.count || 0;
  };

  return (
    <div className="min-h-screen">
      <Navbar badge={{ text: 'Voting', type: 'accent' }} />

      <main className="container-base max-w-[1120px] section-base">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          className="space-y-6"
        >
          <motion.div variants={fadeInUp}>
            <Card className="p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h1 className="display-text text-[28px] sm:text-[34px] mb-1">Pick your plan</h1>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {votesData
                      ? `${votesData.total_votes}/${votesData.total_members} voted`
                      : 'Vote for your favourite itinerary'}
                  </p>
                </div>
                <span className="badge badge-info inline-flex items-center gap-1">
                  <Vote className="h-3 w-3" /> Live voting
                </span>
              </div>
            </Card>
          </motion.div>

          {isAdmin && !allVoted ? (
            <motion.div variants={fadeInUp}>
              <Card className="p-4 border-[var(--color-warning)]/40 bg-[rgba(245,158,11,0.08)]">
                <p className="text-sm text-[var(--color-warning)] inline-flex items-center gap-2">
                  <Clock3 className="h-4 w-4" /> {missingVotes} members haven&apos;t voted yet. You can still confirm if needed.
                </p>
              </Card>
            </motion.div>
          ) : null}

          {isAdmin && isTie ? (
            <motion.div variants={fadeInUp}>
              <Card className="p-4 border-[var(--color-info)]/40 bg-[rgba(59,130,246,0.08)]">
                <p className="text-sm text-[var(--color-info)] inline-flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> Tie detected. Confirm one of the tied top options.
                </p>
              </Card>
            </motion.div>
          ) : null}

          <div className="grid md:grid-cols-2 gap-6">
            {typedItineraries?.map((option, i) => {
              const plan = option.plan as AIItineraryResponse;
              const isVoted = userVote === option.id;
              const voteCount = getVoteCount(option.id);
              const isExpanded = expandedId === option.id;
              const canConfirmThisOption = canConfirmNow && topOptionIds.includes(option.id);

              return (
                <motion.div
                  key={option.id}
                  variants={fadeInUp}
                  custom={i}
                  className={`overflow-hidden transition-all h-full ${
                    isVoted ? 'border-[var(--color-accent)] glow-accent' : ''
                  }`}
                >
                  <Card className="p-0 h-full flex flex-col">
                  {/* Card Header */}
                  <div className="p-5 border-b border-[var(--color-border-subtle)]">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="text-xs text-[var(--color-text-tertiary)] mb-1">
                          {strategyLabels[option.hub_strategy] || option.hub_strategy}
                        </div>
                        <h3 className="font-bold text-xl">{option.hub_name}</h3>
                      </div>
                      <div className="text-right">
                        <span className={`badge ${getFairnessClass(option.travel_fairness_score)}`}>
                          {getFairnessLabel(option.travel_fairness_score)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-[var(--color-text-secondary)]">
                      <span className="inline-flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> ₹{option.total_cost_estimate}/person</span>
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> ~{option.max_travel_time_mins}min max travel</span>
                      <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> {plan.stops?.length || 0} stops</span>
                    </div>

                    {plan.day_summary && (
                      <p className="mt-3 text-sm text-[var(--color-text-secondary)] italic">
                        &ldquo;{plan.day_summary}&rdquo;
                      </p>
                    )}
                  </div>

                  {/* Expand/Collapse */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : option.id)}
                    className="w-full px-5 py-2 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors text-center"
                  >
                    {isExpanded ? '▲ Hide details' : '▼ Show itinerary'}
                  </button>

                  <AnimatePresence>
                    {isExpanded && plan.stops && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-3 space-y-3">
                          {plan.stops.map((stop) => (
                            <div
                              key={stop.stop_number}
                              className="flex gap-3 p-3 rounded-lg bg-[var(--color-bg-elevated)]"
                            >
                              <div className="text-center flex-shrink-0">
                                <div className="font-mono text-xs text-[var(--color-accent)]">
                                  {stop.start_time}
                                </div>
                                <div className="text-xs text-[var(--color-text-tertiary)]">
                                  {stop.duration_mins}min
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">
                                  {stop.place_name}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="badge badge-info text-[10px]">
                                    {stop.place_type}
                                  </span>
                                  <span className="text-xs text-[var(--color-text-tertiary)]">
                                    ₹{stop.estimated_cost_per_person}
                                  </span>
                                </div>
                                {stop.vibe_note && (
                                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1 italic">
                                    {stop.vibe_note}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Vote */}
                  <div className="p-5 border-t border-[var(--color-border-subtle)] mt-auto">
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={() => handleVote(option.id)}
                        disabled={castVote.isPending}
                        variant={isVoted ? 'primary' : 'secondary'}
                        className="flex-1"
                        id={`vote-btn-${option.id}`}
                        icon={isVoted ? <CheckCircle2 className="h-4 w-4" /> : undefined}
                      >
                        {isVoted ? '✓ Your vote' : 'Vote for this'}
                      </Button>
                      {showCounts && (
                        <span className="text-sm text-[var(--color-text-secondary)] font-mono">
                          {voteCount} vote{voteCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {isAdmin && (
                      canConfirmThisOption ? (
                        <Button
                          onClick={() => handleConfirm(option.id)}
                          disabled={confirmItinerary.isPending}
                          variant="secondary"
                          className="mt-2 w-full"
                          id={`confirm-btn-${option.id}`}
                          title={isTie ? 'Tie detected: pick one of the tied options' : 'Top-voted option'}
                          loading={confirmItinerary.isPending}
                        >
                          Confirm This Plan
                        </Button>
                      ) : null
                    )}
                  </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {(!typedItineraries || typedItineraries.length === 0) && (
            <motion.div variants={fadeInUp}>
              <Card className="p-12 text-center">
              <div className="text-4xl mb-4 animate-pulse-station">🗳️</div>
              <p className="text-[var(--color-text-secondary)]">
                Loading itinerary options...
              </p>
              </Card>
            </motion.div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
