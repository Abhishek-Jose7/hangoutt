'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { motion } from 'framer-motion';
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
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { RoomMemberWithUser } from '@/types';

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

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
          // Reverse geocode via our own API to avoid exposing keys
          const res = await fetch(
            `/api/geocode?lat=${latitude}&lng=${longitude}`
          );
          const data = res.ok ? await res.json() : null;

          setLocationName(
            data?.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          );
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
        // Show manual search
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [updateMember]);

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery)}`
      );
      if (res.ok) {
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
      }
    } catch {
      // silent fail
    }
  };

  const handleSubmit = async () => {
    try {
      await updateMember.mutateAsync({
        budget: parseFloat(budget) || 500,
      });
      setSubmitted(true);
    } catch {
      // error shown
    }
  };

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync();
    } catch {
      // error shown
    }
  };

  const isAdmin = room?.is_admin;
  const typedMembers = members as RoomMemberWithUser[] | undefined;
  const membersReady =
    typedMembers?.filter(
      (m) => m.lat !== null && m.budget !== null
    ).length || 0;
  const totalMembers = typedMembers?.length || 0;
  const allReady = membersReady === totalMembers && totalMembers >= 2;

  return (
    <div className="min-h-screen">
      <Navbar badge={{ text: 'Planning', type: 'warning' }} />

      <main className="container-base max-w-[1100px] section-base">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          className="space-y-6"
        >
          <motion.div variants={fadeInUp}>
            <Card className="p-5 sm:p-6">
              <h1 className="display-text text-[28px] sm:text-[34px] mb-1">
                {room?.name || 'Planning'}
              </h1>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Set your location and budget so we can build balanced itinerary options.
              </p>
            </Card>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
            <motion.div variants={fadeInUp} className="space-y-6">
              {/* Location Section */}
              <Card className="p-5 sm:p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <LocateFixed className="h-4 w-4 text-[var(--color-accent)]" /> Where are you starting from?
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              We&apos;ll find the fairest meeting point for everyone
            </p>

            {locationSet ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-bg-elevated)]">
                  <span className="text-[var(--color-success)]">✓</span>
                  <span className="text-sm flex-1 truncate">{locationName}</span>
                </div>
                {nearestStation && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-accent">🚈 {nearestStation}</span>
                    {stationLine.map((line) => (
                      <span key={line} className="badge badge-info capitalize">
                        {line} line
                      </span>
                    ))}
                  </div>
                )}
                {geoWarning ? (
                  <p className="text-xs text-[var(--color-warning)] inline-flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> {geoWarning}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => setLocationSet(false)}
                  className="h-[36px] px-3 text-xs"
                >
                  Change location
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  onClick={handleGeolocation}
                  disabled={geoLoading}
                  className="w-full"
                  id="use-location-btn"
                >
                  {geoLoading ? (
                    <span className="animate-pulse-station">Getting location...</span>
                  ) : (
                    'Use My Current Location'
                  )}
                </Button>
                <div className="text-center text-xs text-[var(--color-text-tertiary)]">or</div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    className="flex-1"
                    placeholder="Search for your area (e.g. Andheri West)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                    id="location-search-input"
                  />
                  <Button onClick={handleManualSearch} variant="secondary" icon={<Search className="h-3.5 w-3.5" />}>
                    Search
                  </Button>
                </div>
              </div>
            )}
              </Card>

              {/* Budget Section */}
              <Card className="p-5 sm:p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[var(--color-accent)]" /> Your budget per person
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              This helps us find places within your range
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)] text-sm font-medium">₹</span>
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
              className="w-full mt-3 accent-[var(--color-accent)]"
              min={100}
              max={3000}
              step={50}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <div className="flex justify-between text-xs text-[var(--color-text-tertiary)] mt-1">
              <span>₹100</span>
              <span>₹3,000</span>
            </div>
              </Card>

              {/* Submit */}
              {!submitted ? (
              <Button
                onClick={handleSubmit}
                disabled={!locationSet || updateMember.isPending}
                loading={updateMember.isPending}
                className="w-full"
                id="ready-btn"
              >
                I&apos;m Ready
              </Button>
              ) : (
                <div className="p-4 rounded-xl bg-[rgba(74,222,128,0.1)] text-[var(--color-success)] text-sm text-center">
                  ✓ You&apos;re all set! Waiting for others...
                </div>
              )}

              {/* Generate Button (Admin only) */}
              {isAdmin && (
                <Button
                  onClick={handleGenerate}
                  disabled={!allReady || generate.isPending}
                  loading={generate.isPending}
                  className="w-full"
                  id="generate-btn"
                  icon={!generate.isPending ? <Sparkles className="h-4 w-4" /> : undefined}
                >
                  {!allReady
                    ? `Waiting for ${totalMembers - membersReady} members`
                    : 'Generate Itineraries'}
                </Button>
              )}

              {isAdmin && generate.isError ? (
                <p className="text-sm text-[var(--color-danger)] mt-2 text-center">
                  {generate.error.message}
                </p>
              ) : null}
            </motion.div>

            <motion.div variants={fadeInUp} className="space-y-6">
              {/* Ready Status */}
              <Card className="p-5">
            <div className="text-sm font-medium mb-3 text-[var(--color-text-secondary)]">
              Members Ready ({membersReady}/{totalMembers})
            </div>
            <div className="w-full bg-[var(--color-bg-elevated)] rounded-full h-2 mb-3">
              <div
                className="bg-[var(--color-accent)] h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${totalMembers > 0 ? (membersReady / totalMembers) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="space-y-1">
              {typedMembers?.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 text-sm">
                  <span className={m.lat !== null ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}>
                    {m.lat !== null ? '✓' : '○'}
                  </span>
                  <span>{m.users?.name || 'Anonymous'}</span>
                  {m.lat !== null && m.nearest_station && (
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      — {m.nearest_station}
                    </span>
                  )}
                </div>
              ))}
            </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-medium mb-2">Planning flow</p>
                <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                  <p>1. Everyone shares location and budget.</p>
                  <p>2. Admin generates itinerary options.</p>
                  <p>3. Group votes and confirms one final plan.</p>
                </div>
                {!isAdmin ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-3">
                    Waiting for the admin to trigger generation once everyone is ready.
                  </p>
                ) : null}
              </Card>
              {updateMember.isError ? (
                <p className="text-sm text-[var(--color-danger)] text-center">
                  {updateMember.error.message}
                </p>
              ) : null}
            </motion.div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
