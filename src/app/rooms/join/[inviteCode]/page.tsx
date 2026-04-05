'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { AlertCircle, LocateFixed, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function JoinRoomPage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.inviteCode as string;
  const [status, setStatus] = useState<'loading' | 'preview' | 'joining' | 'error'>('loading');
  const [roomPreview, setRoomPreview] = useState<{ id: string; name: string; mood: string } | null>(null);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [budget, setBudget] = useState('500');
  const [locationName, setLocationName] = useState('');
  const [nearestStation, setNearestStation] = useState('');
  const [locationSet, setLocationSet] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [geoWarning, setGeoWarning] = useState('');

  useEffect(() => {
    async function lookupRoom() {
      try {
        const res = await fetch(`/api/rooms/${inviteCode}/preview`);
        if (!res.ok) {
          const err = await res.json();
          setError(err.error?.message || 'Room not found');
          setStatus('error');
          return;
        }
        const data = await res.json();
        setRoomPreview(data);
        setStatus('preview');
      } catch {
        setError('Failed to look up room');
        setStatus('error');
      }
    }
    lookupRoom();
  }, [inviteCode]);

  const handleJoin = async () => {
    if (!roomPreview) return;
    if (!displayName.trim()) {
      setError('Please enter your name before joining.');
      return;
    }
    if (!locationSet || !latLng) {
      setError('Please set your location before joining.');
      return;
    }

    const budgetNumber = Number(budget);
    if (!Number.isFinite(budgetNumber) || budgetNumber <= 0) {
      setError('Please enter a valid budget.');
      return;
    }

    setStatus('joining');
    try {
      const res = await fetch(`/api/rooms/${roomPreview.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim() || undefined,
          budget: budgetNumber,
          lat: latLng.lat,
          lng: latLng.lng,
          location_name: locationName,
          nearest_station: nearestStation,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error?.message || 'Failed to join');
        setStatus('error');
        return;
      }
      router.push(`/rooms/${roomPreview.id}`);
    } catch {
      setError('Failed to join room');
      setStatus('error');
    }
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.');
      return;
    }

    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`);
          const data = res.ok ? await res.json() : null;

          setLocationName(data?.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          setNearestStation(data?.nearest_station || 'Dadar');
          setLatLng({ lat: latitude, lng: longitude });
          setGeoWarning(data?.warning || '');
          setLocationSet(true);
        } catch {
          setError('Could not resolve your location. Try searching manually.');
        } finally {
          setGeoLoading(false);
        }
      },
      () => {
        setGeoLoading(false);
        setError('Location permission denied. Use manual search.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) {
        setError('Location not found. Try another area.');
        return;
      }
      const data = await res.json();
      setLocationName(data.display_name || searchQuery);
      setNearestStation(data.nearest_station || 'Dadar');
      setLatLng({ lat: Number(data.lat), lng: Number(data.lng) });
      setGeoWarning(data?.warning || '');
      setLocationSet(true);
      setError('');
    } catch {
      setError('Could not search location. Try again.');
    }
  };

  return (
    <div className="min-h-screen hero-gradient">
      <motion.div
        className="container-base section-base max-w-[760px]"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >
        <Card className="p-10 w-full max-w-md text-center mx-auto">
          {status === 'loading' && (
            <motion.div variants={fadeInUp}>
              <div className="text-4xl mb-4 animate-pulse-station">🔍</div>
              <p className="text-[var(--color-text-secondary)]">Looking up room...</p>
            </motion.div>
          )}

          {status === 'preview' && roomPreview && (
            <>
              <motion.div variants={fadeInUp} className="text-4xl mb-4">🎉</motion.div>
              <motion.h2 variants={fadeInUp} className="display-text text-2xl mb-2">
                {roomPreview.name}
              </motion.h2>
              <motion.p variants={fadeInUp} className="text-[var(--color-text-secondary)] mb-6">
                <span className="capitalize">{roomPreview.mood}</span> hangout
              </motion.p>
              <motion.div variants={fadeInUp} className="space-y-3 text-left mb-5">
                <div>
                      <label htmlFor="display-name" className="block text-xs text-[var(--color-text-secondary)] mb-1">
                        Your name
                  </label>
                  <Input
                    id="display-name"
                        placeholder="How your friends should see you"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="budget" className="block text-xs text-[var(--color-text-secondary)] mb-1">
                    Budget per person (INR)
                  </label>
                  <Input
                    id="budget"
                    type="number"
                    min={100}
                    max={10000}
                    step={50}
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                </div>

                <div>
                  <p className="block text-xs text-[var(--color-text-secondary)] mb-1">Location</p>
                  {locationSet ? (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm">
                        {locationName}
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)]">Nearest station: {nearestStation}</p>
                      {geoWarning ? (
                        <p className="text-xs text-[var(--color-warning)] inline-flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" /> {geoWarning}
                        </p>
                      ) : null}
                      <Button
                        variant="secondary"
                        className="h-[36px] px-3 text-xs"
                        onClick={() => setLocationSet(false)}
                      >
                        Change location
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        className="w-full"
                        onClick={handleGeolocation}
                        loading={geoLoading}
                        icon={!geoLoading ? <LocateFixed className="h-4 w-4" /> : undefined}
                      >
                        Use current location
                      </Button>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search area (e.g. Andheri West)"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                        />
                        <Button variant="secondary" onClick={handleManualSearch} icon={<Search className="h-4 w-4" />}>
                          Search
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
              {error ? (
                <motion.p variants={fadeInUp} className="text-sm text-[var(--color-danger)] mb-4 text-left">
                  {error}
                </motion.p>
              ) : null}
              <motion.div variants={fadeInUp}>
                <Button onClick={handleJoin} className="w-full" id="confirm-join-btn">
                  Join This Room
                </Button>
              </motion.div>
            </>
          )}

          {status === 'joining' && (
            <motion.div variants={fadeInUp}>
              <div className="text-4xl mb-4 animate-pulse-station">🚀</div>
              <p className="text-[var(--color-text-secondary)]">Joining room...</p>
            </motion.div>
          )}

          {status === 'error' && (
            <>
              <motion.div variants={fadeInUp} className="text-4xl mb-4">😬</motion.div>
              <motion.p variants={fadeInUp} className="text-[var(--color-danger)] mb-6">
                {error}
              </motion.p>
              <motion.div variants={fadeInUp}>
                <Link href="/dashboard" className="btn-secondary">
                  Back to Dashboard
                </Link>
              </motion.div>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
