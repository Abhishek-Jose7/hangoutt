'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Clock3, Landmark, MapPinned, ShieldCheck } from 'lucide-react';
import { useRoom, useItineraries } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { MapView } from '@/components/map/MapView';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ItineraryOption, AIItineraryResponse } from '@/types';

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
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

export default function ConfirmedPage() {
  const params = useParams();
  const roomId = params.id as string;
  const { data: room } = useRoom(roomId);
  const { data: itineraries } = useItineraries(roomId);
  const setRoom = useRoomStore((s) => s.setRoom);

  useRoomRealtime(roomId);

  useEffect(() => {
    if (room) setRoom(room);
  }, [room, setRoom]);

  const confirmedOptionId = room?.confirmed_itinerary?.itinerary_option_id;
  const typedItineraries = itineraries as ItineraryOption[] | undefined;
  const confirmed = typedItineraries?.find((it) => it.id === confirmedOptionId);
  const plan = confirmed?.plan as AIItineraryResponse | undefined;
  type MapMarker = {
    position: { lat: number; lng: number };
    title: string;
    color: string;
    popup: string;
  };

  const memberMarkers: MapMarker[] =
    room?.members
      ?.filter((member: { lat: number | null; lng: number | null }) => member.lat !== null && member.lng !== null)
      .map((member: {
        lat: number;
        lng: number;
        users?: { name?: string | null; email?: string | null };
        nearest_station?: string | null;
      }) => ({
        position: { lat: Number(member.lat), lng: Number(member.lng) },
        title: member.users?.name || member.users?.email || 'Member',
        color: '#60A5FA',
        popup: `<strong>${member.users?.name || member.users?.email || 'Member'}</strong><br/>${member.nearest_station || 'Station pending'}`,
      })) || [];

  const hubMarker: MapMarker[] = confirmed
    ? [{
        position: { lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) },
        title: `${confirmed.hub_name} Hub`,
        color: '#F5A623',
        popup: `<strong>${confirmed.hub_name}</strong><br/>Final meeting hub`,
      }]
    : [];

  const mapMarkers = [...hubMarker, ...memberMarkers];
  const travelLines = confirmed
    ? memberMarkers.map((member: MapMarker) => [member.position, { lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) }])
    : [];

  const stopMarkers: MapMarker[] =
    plan?.stops
      ?.filter((stop) => typeof stop.lat === 'number' && typeof stop.lng === 'number')
      .map((stop) => ({
        position: { lat: Number(stop.lat), lng: Number(stop.lng) },
        title: stop.place_name,
        color: '#DC143C',
        popup: `<strong>${stop.place_name}</strong><br/>${stop.start_time} • ₹${stop.estimated_cost_per_person}`,
      })) || [];

  const stopLines = stopMarkers.length > 1
    ? stopMarkers.slice(1).map((marker, idx) => [stopMarkers[idx].position, marker.position])
    : [];

  const hubToFirstStop = confirmed && stopMarkers.length > 0
    ? [[{ lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) }, stopMarkers[0].position]]
    : [];

  const allMarkers = [...mapMarkers, ...stopMarkers];
  const allPolylines = [...travelLines, ...hubToFirstStop, ...stopLines];

  return (
    <div className="min-h-screen">
      <Navbar badge={{ text: 'Confirmed', type: 'success' }} />

      <main className="container-base max-w-[980px] section-base">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          className="space-y-6"
        >
          <motion.div variants={fadeInUp} className="text-center mb-8">
            <div className="text-4xl mb-3">🎉</div>
            <h1 className="display-text text-3xl mb-2">
              {room?.name || 'Your Plan is Set!'}
            </h1>
            <p className="text-[var(--color-text-secondary)]">
              Here&apos;s your confirmed hangout itinerary
            </p>
          </motion.div>

          {confirmed && plan ? (
            <>
              {/* Summary Bar */}
              <motion.div
                variants={fadeInUp}
                className="mb-0"
              >
                <Card className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-[var(--color-accent)] inline-flex items-center gap-1.5">
                      <Landmark className="h-5 w-5" /> ₹{confirmed.total_cost_estimate}
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)]">per person</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold inline-flex items-center gap-1.5">
                      <Clock3 className="h-5 w-5" /> {confirmed.max_travel_time_mins}
                      <span className="text-sm font-normal text-[var(--color-text-secondary)]">min</span>
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)]">max travel</div>
                  </div>
                  <div>
                    <div className="text-2xl">
                      <span className={`badge ${getFairnessClass(confirmed.travel_fairness_score)}`}>
                        {getFairnessLabel(confirmed.travel_fairness_score)}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-1">fairness</div>
                  </div>
                </Card>
              </motion.div>

              {/* Hub Info */}
              <motion.div variants={fadeInUp} className="mb-0">
                <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center text-sm text-[var(--color-accent)]">
                    <MapPinned className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">Meeting Area: {confirmed.hub_name}</div>
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      Take the local train to {confirmed.hub_name} station
                    </div>
                  </div>
                </div>
                </Card>
              </motion.div>

              {/* Day Summary */}
              {plan.day_summary && (
                <motion.div
                  variants={fadeInUp}
                  className="p-4 rounded-xl bg-[var(--color-accent-glow)] border border-[var(--color-accent-muted)] text-center"
                >
                  <p className="text-sm italic text-[var(--color-text-primary)]">
                    &ldquo;{plan.day_summary}&rdquo;
                  </p>
                </motion.div>
              )}

              {/* Timeline */}
              {plan.station_guidance?.length ? (
                <motion.div variants={fadeInUp}>
                  <Card className="p-5">
                    <h3 className="font-semibold mb-3">When To Reach Your Station</h3>
                    <div className="space-y-2">
                      {plan.station_guidance.map((item, idx) => (
                        <div key={`${item.member_name}-${idx}`} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--color-text-secondary)] truncate max-w-[70%]">
                            {item.member_name} • {item.station}
                          </span>
                          <span className="font-mono text-[var(--color-text-primary)]">
                            {item.reach_station_by}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </motion.div>
              ) : null}

              {/* Timeline */}
              <motion.div variants={fadeInUp} className="relative">
                <div className="timeline-line" />

                <div className="space-y-6 pl-12">
                  {plan.stops?.map((stop, i) => (
                    <motion.div
                      key={stop.stop_number}
                      variants={fadeInUp}
                      custom={i}
                      className="relative"
                    >
                      <Card className="p-5">
                      {/* Timeline dot */}
                      <div
                        className="absolute -left-12 top-6 w-5 h-5 rounded-full bg-[var(--color-accent)] border-4 border-[var(--color-bg-base)]"
                        style={{ marginLeft: '10px' }}
                      />

                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 text-center">
                          <div className="font-mono text-sm font-bold text-[var(--color-accent)]">
                            {stop.start_time}
                          </div>
                          <div className="text-xs text-[var(--color-text-tertiary)]">
                            {stop.duration_mins}min
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg mb-1">
                            {stop.place_name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="badge badge-info capitalize">
                              {stop.place_type}
                            </span>
                            <span className="text-sm text-[var(--color-text-secondary)]">
                              {renderPrice(stop.estimated_cost_per_person)}{stop.estimated_cost_per_person > 0 ? ' per person' : ''}
                            </span>
                          </div>
                          {stop.vibe_note && (
                            <p className="text-sm text-[var(--color-text-secondary)] italic">
                              {stop.vibe_note}
                            </p>
                          )}
                          {stop.walk_from_previous_mins > 0 && (
                            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
                              🚶 {stop.walk_from_previous_mins}min walk • {stop.distance_from_previous_km ?? 0.8}km
                              {i === 0 ? ' from station' : ' from previous stop'}
                            </p>
                          )}
                        </div>
                      </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {confirmed && mapMarkers.length > 0 ? (
                <motion.div variants={fadeInUp} className="mt-0">
                  <Card className="p-5">
                  <h3 className="font-semibold mb-3">Travel Overview Map</h3>
                  <MapView
                    center={{ lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) }}
                    markers={allMarkers}
                    polylines={allPolylines}
                  />
                  </Card>
                </motion.div>
              ) : null}

              {/* Budget Footer */}
              <motion.div
                variants={fadeInUp}
                className="mt-0"
              >
                <Card className="p-5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold inline-flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-[var(--color-accent)]" /> Total Budget
                    </div>
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      ₹{plan.total_cost_per_person} + ₹{plan.contingency_buffer} buffer
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-[var(--color-accent)]">
                    ₹{plan.total_cost_per_person + plan.contingency_buffer}
                  </div>
                </Card>
              </motion.div>
            </>
          ) : (
            <motion.div variants={fadeInUp}>
              <Card className="p-12 text-center">
              <div className="text-4xl mb-4 animate-pulse-station">📋</div>
              <p className="text-[var(--color-text-secondary)]">Loading confirmed itinerary...</p>
              </Card>
            </motion.div>
          )}

          {/* Back to Dashboard */}
          <motion.div variants={fadeInUp} className="text-center mt-8">
            <Link href="/dashboard">
              <Button variant="secondary">Back to Dashboard</Button>
            </Link>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
