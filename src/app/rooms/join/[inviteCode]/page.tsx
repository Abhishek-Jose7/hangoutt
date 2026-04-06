'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, LocateFixed, MapPinned, Search, UserRound, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { WebsiteHero, WebsitePage } from '@/components/site/WebsiteLayout';

export default function JoinRoomPage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.inviteCode as string;
  const [status, setStatus] = useState<'loading' | 'preview' | 'joining' | 'error'>('loading');
  const [roomPreview, setRoomPreview] = useState<{ id: string; name: string; mood: string } | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [budget, setBudget] = useState('500');
  const [locationName, setLocationName] = useState('');
  const [nearestStation, setNearestStation] = useState('');
  const [locationSet, setLocationSet] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [geoWarning, setGeoWarning] = useState('');

  const budgetNumber = useMemo(() => Number(budget), [budget]);
  const validBudget = Number.isFinite(budgetNumber) && budgetNumber > 0;
  const canContinueIdentity = displayName.trim().length >= 2;
  const canContinueLocation = locationSet && !!latLng;

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
        setStep(0);
      } catch {
        setError('Failed to look up room');
        setStatus('error');
      }
    }
    void lookupRoom();
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
    if (!validBudget) {
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
          setError('');
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

  const stepItems = [
    { title: 'Identity', icon: UserRound, complete: canContinueIdentity },
    { title: 'Location', icon: MapPinned, complete: canContinueLocation },
    { title: 'Budget', icon: Wallet, complete: validBudget },
  ];

  return (
    <WebsitePage>
      <WebsiteHero>
          {status === 'loading' ? (
            <div className="relative z-[1] text-center py-12">
              <span className="section-kicker">Join Room</span>
              <h1 className="saas-title mt-4">Resolving Invite Code</h1>
              <p className="saas-lead mx-auto mt-3">We are verifying room details before onboarding you.</p>
            </div>
          ) : null}

          {status === 'preview' && roomPreview ? (
            <div className="saas-grid-2 relative z-[1] items-start">
              <div className="space-y-4">
                <span className="section-kicker">Invite Accepted</span>
                <h1 className="saas-title">Join {roomPreview.name}</h1>
                <p className="saas-lead">
                  Provide your details once so we can generate fair and budget-aware options for the full group.
                </p>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Onboarding Steps</p>
                  <div className="saas-band">
                    <div className="grid grid-cols-3 gap-2">
                      {stepItems.map((item, index) => {
                        const Icon = item.icon;
                        const active = index === step;
                        return (
                          <button
                            key={item.title}
                            type="button"
                            onClick={() => setStep(index)}
                            className={`rounded-xl border px-2 py-2 text-left ${
                              active
                                ? 'border-[var(--color-accent)] bg-[rgba(220,20,60,0.12)]'
                                : 'border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)]'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              {item.complete ? (
                                <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
                              ) : (
                                <Icon className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                              )}
                              <span className="text-xs text-[var(--color-text-primary)]">{item.title}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel p-6 space-y-4">
                {step === 0 ? (
                  <div className="space-y-3">
                    <label htmlFor="display-name" className="text-sm font-medium block">Display name</label>
                    <Input
                      id="display-name"
                      placeholder="How your friends should see you"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={() => {
                          if (!canContinueIdentity) {
                            setError('Please enter a display name to continue.');
                            return;
                          }
                          setError('');
                          setStep(1);
                        }}
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="space-y-3">
                    {locationSet ? (
                      <div className="saas-band space-y-2">
                        <p className="text-sm text-[var(--color-text-primary)]">{locationName}</p>
                        <p className="text-xs text-[var(--color-text-secondary)]">Nearest station: {nearestStation}</p>
                        {geoWarning ? (
                          <p className="text-xs text-[var(--color-warning)] inline-flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {geoWarning}
                          </p>
                        ) : null}
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setLocationSet(false);
                            setLatLng(null);
                            setLocationName('');
                            setNearestStation('');
                            setGeoWarning('');
                            setSearchQuery('');
                          }}
                        >
                          Change Location
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          className="w-full"
                          onClick={handleGeolocation}
                          loading={geoLoading}
                          icon={!geoLoading ? <LocateFixed className="h-4 w-4" /> : undefined}
                        >
                          Use Current Location
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
                      </>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <Button variant="secondary" onClick={() => setStep(0)}>
                        Back
                      </Button>
                      <Button
                        onClick={() => {
                          if (!canContinueLocation) {
                            setError('Set your location before continuing.');
                            return;
                          }
                          setError('');
                          setStep(2);
                        }}
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="space-y-4">
                    <label htmlFor="budget" className="text-sm font-medium block">Budget per person (INR)</label>
                    <Input
                      id="budget"
                      type="number"
                      min={100}
                      max={10000}
                      step={50}
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />

                    <div className="saas-band text-sm space-y-2">
                      <p className="text-[var(--color-text-primary)]">Review before join</p>
                      <p className="text-[var(--color-text-secondary)]">Name: {displayName.trim() || 'Not set'}</p>
                      <p className="text-[var(--color-text-secondary)]">Location: {locationName || 'Not set'}</p>
                      <p className="text-[var(--color-text-secondary)]">Station: {nearestStation || 'Not set'}</p>
                      <p className="text-[var(--color-text-secondary)]">Budget: ₹{validBudget ? budgetNumber : '—'}</p>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                      <Button onClick={handleJoin} className="min-w-[130px]" id="confirm-join-btn">Join Room</Button>
                    </div>
                  </div>
                ) : null}

                {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
              </div>
            </div>
          ) : null}

          {status === 'joining' ? (
            <div className="relative z-[1] text-center py-12">
              <span className="section-kicker">Finalizing</span>
              <h1 className="saas-title mt-4">Joining The Room</h1>
              <p className="saas-lead mx-auto mt-3">Applying your preferences and connecting you to the room workflow.</p>
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="relative z-[1] text-center py-12 w-full">
              <span className="section-kicker">Join Failed</span>
              <h1 className="saas-title mt-4">Could Not Complete Join</h1>
              <p className="text-sm text-[var(--color-danger)] mt-3">{error}</p>
              <div className="mt-6">
                <Link href="/dashboard" className="btn-secondary">Back To Dashboard</Link>
              </div>
            </div>
          ) : null}
      </WebsiteHero>
    </WebsitePage>
  );
}
