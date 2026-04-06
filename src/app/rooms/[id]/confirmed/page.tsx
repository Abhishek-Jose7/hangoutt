'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Clock3, Landmark, MapPinned, ShieldCheck } from 'lucide-react';
import { useRoom, useItineraries } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { MapView } from '@/components/map/MapView';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ItineraryOption, AIItineraryResponse } from '@/types';
import { WebsiteHero, WebsitePage, WebsiteSection } from '@/components/site/WebsiteLayout';

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

type MapMarker = {
  position: { lat: number; lng: number };
  title: string;
  color: string;
  popup: string;
};

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
        color: '#6fa8ff',
        popup: `<strong>${member.users?.name || member.users?.email || 'Member'}</strong><br/>${member.nearest_station || 'Station pending'}`,
      })) || [];

  const hubMarker: MapMarker[] = confirmed
    ? [
        {
          position: { lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) },
          title: `${confirmed.hub_name} Hub`,
          color: '#ff3f66',
          popup: `<strong>${confirmed.hub_name}</strong><br/>Final meeting hub`,
        },
      ]
    : [];

  const travelLines = confirmed
    ? memberMarkers.map((member: MapMarker) => [member.position, { lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) }])
    : [];

  const stopMarkers: MapMarker[] =
    plan?.stops
      ?.filter((stop) => typeof stop.lat === 'number' && typeof stop.lng === 'number')
      .map((stop) => ({
        position: { lat: Number(stop.lat), lng: Number(stop.lng) },
        title: stop.place_name,
        color: '#dc143c',
        popup: `<strong>${stop.place_name}</strong><br/>${stop.start_time} • ₹${stop.estimated_cost_per_person}`,
      })) || [];

  const stopLines = stopMarkers.length > 1
    ? stopMarkers.slice(1).map((marker, idx) => [stopMarkers[idx].position, marker.position])
    : [];

  const hubToFirstStop = confirmed && stopMarkers.length > 0
    ? [[{ lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) }, stopMarkers[0].position]]
    : [];

  const allMarkers = [...hubMarker, ...memberMarkers, ...stopMarkers];
  const allPolylines = [...travelLines, ...hubToFirstStop, ...stopLines];

  return (
    <WebsitePage>
        <WebsiteHero>
          <div className="relative z-[1] space-y-4">
            <span className="section-kicker">Confirmed Stage</span>
            <h1 className="saas-title">{room?.name || 'Final Plan Locked'}</h1>
            <p className="saas-lead">Your group selected this itinerary. Travel and activity details are now finalized.</p>
            {confirmed ? (
              <span className={`badge ${getFairnessClass(confirmed.travel_fairness_score)}`}>{getFairnessLabel(confirmed.travel_fairness_score)}</span>
            ) : null}
          </div>
        </WebsiteHero>

        {confirmed && plan ? (
          <>
            <WebsiteSection className="saas-grid-4">
              <div className="saas-kpi">
                <p className="saas-kpi-label">Cost / Person</p>
                <p className="saas-kpi-value inline-flex items-center gap-1"><Landmark className="h-4 w-4" /> {renderPrice(confirmed.total_cost_estimate)}</p>
              </div>
              <div className="saas-kpi">
                <p className="saas-kpi-label">Max Travel</p>
                <p className="saas-kpi-value inline-flex items-center gap-1"><Clock3 className="h-4 w-4" /> {confirmed.max_travel_time_mins} min</p>
              </div>
              <div className="saas-kpi">
                <p className="saas-kpi-label">Hub Area</p>
                <p className="saas-kpi-value inline-flex items-center gap-1"><MapPinned className="h-4 w-4" /> {confirmed.hub_name}</p>
              </div>
              <div className="saas-kpi">
                <p className="saas-kpi-label">Stops</p>
                <p className="saas-kpi-value">{plan.stops?.length || 0}</p>
              </div>
            </WebsiteSection>

            <WebsiteSection className="saas-grid-2 items-start">
              <div className="space-y-4">
                <Card className="p-5">
                  <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-3">Itinerary Timeline</h2>
                  <div className="space-y-2">
                    {plan.stops?.map((stop, idx) => (
                      <div key={stop.stop_number} className="saas-list-item">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{idx + 1}. {stop.place_name}</p>
                          <span className="text-xs text-[var(--color-text-tertiary)]">{stop.start_time}</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                          {stop.place_type} • {stop.duration_mins} min • {renderPrice(stop.estimated_cost_per_person)}
                        </p>
                        {stop.vibe_note ? <p className="text-xs text-[var(--color-text-tertiary)] mt-1 italic">{stop.vibe_note}</p> : null}
                      </div>
                    ))}
                  </div>
                </Card>

                {plan.station_guidance?.length ? (
                  <Card className="p-5">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">Reach Station By</h3>
                    <div className="space-y-2">
                      {plan.station_guidance.map((item, idx) => (
                        <div key={`${item.member_name}-${idx}`} className="saas-list-item flex items-center justify-between gap-3">
                          <span className="text-sm text-[var(--color-text-secondary)] truncate">{item.member_name} • {item.station}</span>
                          <span className="text-sm font-mono text-[var(--color-text-primary)]">{item.reach_station_by}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : null}
              </div>

              <aside className="space-y-4">
                {confirmed && allMarkers.length ? (
                  <Card className="p-5">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">Travel Overview Map</h3>
                    <MapView
                      center={{ lat: Number(confirmed.hub_lat), lng: Number(confirmed.hub_lng) }}
                      markers={allMarkers}
                      polylines={allPolylines}
                    />
                  </Card>
                ) : null}

                <Card className="p-5">
                  <p className="text-sm font-semibold inline-flex items-center gap-2 text-[var(--color-text-primary)]">
                    <ShieldCheck className="h-4 w-4 text-[var(--color-accent)]" />
                    Budget Snapshot
                  </p>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                    ₹{plan.total_cost_per_person} + ₹{plan.contingency_buffer} contingency
                  </p>
                  <p className="text-2xl font-bold text-[var(--color-accent)] mt-2">
                    ₹{plan.total_cost_per_person + plan.contingency_buffer}
                  </p>
                </Card>
              </aside>
            </WebsiteSection>
          </>
        ) : (
          <div className="panel p-10 text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">Loading confirmed itinerary...</p>
          </div>
        )}

        <div className="text-center">
          <Link href="/dashboard">
            <Button variant="secondary">Back To Dashboard</Button>
          </Link>
        </div>
    </WebsitePage>
  );
}
