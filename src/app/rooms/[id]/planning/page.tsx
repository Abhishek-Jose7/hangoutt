'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, LocateFixed, Search, Sparkles, Wallet } from 'lucide-react';
import {
  useRoom,
  useRoomMembers,
  useUpdateMemberInfo,
  useGenerateItineraries,
} from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { RoomMemberWithUser } from '@/types';

export default function PlanningPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  const { data: room } = useRoom(roomId);
  const { data: members } = useRoomMembers(roomId);
  const updateMember = useUpdateMemberInfo(roomId);
  const generate = useGenerateItineraries(roomId);
  const status = useRoomStore((s) => s.status);
  const setRoom = useRoomStore((s) => s.setRoom);
  const setIsAdmin = useRoomStore((s) => s.setIsAdmin);

  const [budget, setBudget] = useState('500');
  const [locationName, setLocationName] = useState('');
  const [nearestStation, setNearestStation] = useState('');
  const [stationLine, setStationLine] = useState<string[]>([]);
  const [geoWarning, setGeoWarning] = useState('');
  const [locationSet, setLocationSet] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [meetupStartTime, setMeetupStartTime] = useState('12:00');

  useRoomRealtime(roomId);

  useEffect(() => {
    if (room) {
      setRoom(room);
      setIsAdmin(room.is_admin);
    }
  }, [room, setRoom, setIsAdmin]);

  useEffect(() => {
    if (status === 'generating') router.push(`/rooms/${roomId}/generating`);
    if (status === 'voting') router.push(`/rooms/${roomId}/voting`);
    if (status === 'confirmed') router.push(`/rooms/${roomId}/confirmed`);
  }, [status, roomId, router]);

  const handleGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert('Geolocation not supported');
      return;
    }

    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;

        if (latitude === 0 && longitude === 0) {
          alert('Invalid location detected. Please search manually.');
          setGeoLoading(false);
          return;
        }

        try {
          const res = await fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`);
          const data = res.ok ? await res.json() : null;

          setLocationName(data?.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          setNearestStation(data?.nearest_station || '');
          setStationLine(Array.isArray(data?.station_line) ? data.station_line : []);
          setGeoWarning(data?.warning || '');
          setLocationSet(true);

          await updateMember.mutateAsync({
            lat: latitude,
            lng: longitude,
            location_name: data?.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            nearest_station: data?.nearest_station || '',
          });
        } catch {
          setLocationName(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          setLocationSet(true);
        }

        setGeoLoading(false);
      },
      () => {
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [updateMember]);

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) return;
      const data = await res.json();

      setLocationName(data.display_name || searchQuery);
      setNearestStation(data.nearest_station || '');
      setStationLine(Array.isArray(data?.station_line) ? data.station_line : []);
      setGeoWarning(data?.warning || '');
      setLocationSet(true);

      await updateMember.mutateAsync({
        lat: data.lat,
        lng: data.lng,
        location_name: data.display_name || searchQuery,
        nearest_station: data.nearest_station || '',
      });
    } catch {
      // no-op
    }
  };

  const handleSubmit = async () => {
    try {
      await updateMember.mutateAsync({ budget: parseFloat(budget) || 500 });
      setSubmitted(true);
    } catch {
      // no-op
    }
  };

  const handleGenerate = async () => {
    try {
      generate.reset();
      await generate.mutateAsync({ meetup_start_time: meetupStartTime });
    } catch {
      // no-op
    }
  };

  const isAdmin = room?.is_admin;
  const typedMembers = members as RoomMemberWithUser[] | undefined;
  const membersReady = typedMembers?.filter((m) => m.lat !== null && m.budget !== null).length || 0;
  const totalMembers = typedMembers?.length || 0;
  const allReady = membersReady === totalMembers && totalMembers >= 2;
  const waitingMembers = Math.max(totalMembers - membersReady, 0);
  const readinessPercent = totalMembers > 0 ? Math.round((membersReady / totalMembers) * 100) : 0;

  return (
    <div className="saas-page">
      <div className="saas-shell saas-section space-y-6">
        <section className="saas-hero">
          <div className="relative z-[1] space-y-5">
            <span className="section-kicker">Planning Stage</span>
            <h1 className="saas-title">{room?.name || 'Planning Workspace'}</h1>
            <p className="saas-lead">Capture location and budget inputs, then generate options after the full team is ready.</p>

            <div className="saas-grid-4">
              <div className="saas-kpi"><p className="saas-kpi-label">Ready</p><p className="saas-kpi-value">{membersReady}</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Waiting</p><p className="saas-kpi-value">{waitingMembers}</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Completion</p><p className="saas-kpi-value">{readinessPercent}%</p></div>
              <div className="saas-kpi"><p className="saas-kpi-label">Role</p><p className="saas-kpi-value">{isAdmin ? 'Admin' : 'Member'}</p></div>
            </div>
          </div>
        </section>

        <section className="saas-grid-2 items-start">
          <div className="space-y-5">
            <div className="panel p-5 space-y-4">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Step 1: Location</p>
              {locationSet ? (
                <div className="saas-band space-y-2">
                  <p className="text-sm text-[var(--color-text-primary)]">{locationName}</p>
                  {nearestStation ? <p className="text-xs text-[var(--color-text-secondary)]">Nearest station: {nearestStation}</p> : null}
                  {stationLine.length ? (
                    <div className="flex flex-wrap gap-2">
                      {stationLine.map((line) => <span key={line} className="badge badge-info capitalize">{line} line</span>)}
                    </div>
                  ) : null}
                  {geoWarning ? (
                    <p className="text-xs text-[var(--color-warning)] inline-flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {geoWarning}
                    </p>
                  ) : null}
                  <Button variant="secondary" onClick={() => setLocationSet(false)}>Change Location</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Button onClick={handleGeolocation} disabled={geoLoading} className="w-full" id="use-location-btn">
                    {geoLoading ? 'Getting location...' : <><LocateFixed className="h-4 w-4" />Use Current Location</>}
                  </Button>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      className="flex-1"
                      placeholder="Search area, station, or locality"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                      id="location-search-input"
                    />
                    <Button onClick={handleManualSearch} variant="secondary" icon={<Search className="h-3.5 w-3.5" />}>Search</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="panel p-5 space-y-4">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Step 2: Budget</p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-text-secondary)] inline-flex items-center gap-1"><Wallet className="h-4 w-4" /> INR</span>
                <Input
                  type="number"
                  className="flex-1"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  min={100}
                  max={5000}
                  step={50}
                  id="budget-input"
                />
              </div>
              <input
                type="range"
                className="w-full accent-[var(--color-accent)]"
                min={100}
                max={3000}
                step={50}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
              <div className="flex justify-between text-xs text-[var(--color-text-tertiary)]">
                <span>₹100</span>
                <span>₹3,000</span>
              </div>
            </div>

            {!submitted ? (
              <Button onClick={handleSubmit} disabled={!locationSet || updateMember.isPending} loading={updateMember.isPending} className="w-full" id="ready-btn">
                Save My Inputs
              </Button>
            ) : (
              <div className="saas-band text-sm text-[var(--color-success)]">Your inputs are saved. Waiting for remaining members.</div>
            )}

            {isAdmin ? (
              <div className="panel p-5 space-y-4">
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Step 3: Generate</p>
                <label htmlFor="meetup-start-time" className="text-sm font-medium block">Group meetup start time</label>
                <Input
                  id="meetup-start-time"
                  type="time"
                  value={meetupStartTime}
                  onChange={(e) => setMeetupStartTime(e.target.value)}
                />
                <Button
                  onClick={handleGenerate}
                  disabled={!allReady || generate.isPending || !meetupStartTime}
                  loading={generate.isPending}
                  className="w-full"
                  id="generate-btn"
                  icon={!generate.isPending ? <Sparkles className="h-4 w-4" /> : undefined}
                >
                  {!allReady ? `Waiting for ${waitingMembers} members` : 'Generate Itineraries'}
                </Button>

                {generate.isError ? (
                  <p className="text-sm text-[var(--color-danger)]">{generate.error.message}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="space-y-4">
            <div className="panel p-5">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">Team readiness ({membersReady}/{totalMembers})</p>
              <div className="h-2 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden mt-3 mb-3">
                <div className="h-full bg-[var(--color-accent)]" style={{ width: `${readinessPercent}%` }} />
              </div>
              <div className="space-y-2">
                {typedMembers?.map((member) => (
                  <div key={member.user_id} className="saas-list-item flex items-center gap-2 text-sm">
                    <span className={member.lat !== null && member.budget !== null ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}>
                      {member.lat !== null && member.budget !== null ? '✓' : '○'}
                    </span>
                    <span className="truncate flex-1 text-[var(--color-text-primary)]">{member.users?.name || 'Anonymous'}</span>
                    {member.nearest_station ? <span className="text-xs text-[var(--color-text-tertiary)]">{member.nearest_station}</span> : null}
                  </div>
                ))}
              </div>
            </div>

            {updateMember.isError ? <p className="text-sm text-[var(--color-danger)]">{updateMember.error.message}</p> : null}
          </aside>
        </section>
      </div>
    </div>
  );
}
