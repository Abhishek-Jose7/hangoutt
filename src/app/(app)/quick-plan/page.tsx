'use client';

import React, { useState } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Users, Coins, Sparkles, Loader2, Clock, Check, Bookmark, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { generateQuickPlanAction, saveQuickPlanAction } from '@/actions/quickPlan';
import type { QuickPlanInput, QuickPlanMode } from '@/lib/services/quickPlan.service';

const MODE_LABELS: Record<QuickPlanMode, { label: string; hint: string; placeholder: string }> = {
  AREA: { label: 'Area', hint: 'A neighbourhood or locality', placeholder: 'e.g. Bandra' },
  VENUE: { label: 'Specific place', hint: 'A place you must visit', placeholder: 'e.g. Prithvi Theatre' },
  PIN: { label: 'Exact map location', hint: 'An address or landmark', placeholder: 'e.g. Carter Road Promenade' },
};

const TAGS = ['food', 'date', 'chill', 'adventure', 'creative', 'culture', 'nightlife', 'shopping', 'outdoors'];

function formatDuration(min: number) {
  const h = Math.floor((min || 0) / 60);
  const m = (min || 0) % 60;
  return `${h}H ${m}M`;
}

function directionsUrl(slot: any, zone?: string) {
  if (slot.link) return slot.link;
  const q = encodeURIComponent(`${slot.venueName || slot.name} ${zone || 'Mumbai'}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function QuickPlanSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-56 bg-stone-900/70" />
        <Skeleton className="h-3 w-24 bg-stone-900/70" />
      </div>
      {[0, 1, 2].map((card) => (
        <Card key={card} className="border border-stone-900/60 bg-stone-950/50 rounded-[12px] overflow-hidden">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-40 bg-stone-900/70" />
                <Skeleton className="h-3 w-72 max-w-full bg-stone-900/70" />
              </div>
              <Skeleton className="h-5 w-24 bg-stone-900/70 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-3 w-20 bg-stone-900/70" />
              <Skeleton className="h-3 w-24 bg-stone-900/70" />
              <Skeleton className="h-3 w-28 bg-stone-900/70" />
            </div>
            <div className="space-y-2">
              {[0, 1, 2].map((slot) => (
                <div key={slot} className="flex items-start gap-3 p-3 bg-stone-900/40 border border-stone-900 rounded-[6px]">
                  <Skeleton className="h-5 w-5 rounded-[4px] bg-stone-800/80 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-2.5 w-28 bg-stone-800/80" />
                    <Skeleton className="h-3.5 w-48 max-w-full bg-stone-800/80" />
                  </div>
                  <Skeleton className="h-3 w-12 bg-stone-800/80 shrink-0" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function QuickPlanPage() {
  const [mode, setMode] = useState<QuickPlanMode>('AREA');
  const [location, setLocation] = useState('');
  const [headcount, setHeadcount] = useState(2);
  const [budget, setBudget] = useState(1000);
  const [perPerson, setPerPerson] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [outingDate, setOutingDate] = useState('');
  const [outingTime, setOutingTime] = useState('');

  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [areaName, setAreaName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const buildInput = (): QuickPlanInput => ({
    mode,
    location: location.trim(),
    headcount,
    budget,
    perPerson,
    tags,
    outingDate: outingDate || undefined,
    outingTime: outingTime || undefined,
  });

  const toggleTag = (t: string) =>
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const handleGenerate = async () => {
    if (!location.trim()) { toast.error('Enter a location.'); return; }
    setLoading(true);
    try {
      const res = await generateQuickPlanAction(buildInput());
      if (!res.success) {
        toast.error(res.error?.message || 'Failed to generate itineraries');
        return;
      }
      setPlans(res.data.plans || []);
      setAreaName(res.data.planningArea?.name || location);
      setSavedIds(new Set());
      if (res.data.requiredVenueMatched === false) {
        toast.info(`Couldn't find "${res.data.requiredVenueName}" in our catalog — built plans around that spot instead.`);
      }
      if ((res.data.plans || []).length === 0) {
        toast.error('No itineraries could be built. Try a wider area or higher budget.');
      }
    } catch (_e) {
      toast.error('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (plan: any) => {
    setSavingId(plan.id);
    try {
      const res = await saveQuickPlanAction(plan, buildInput());
      if (!res.success) {
        toast.error(res.error?.message || 'Failed to save');
        return;
      }
      setSavedIds(prev => new Set(prev).add(plan.id));
      toast.success('Saved to your history.');
    } catch (_e) {
      toast.error('An error occurred saving.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <PageContainer
      title="Quick Plan"
      subtitle="ONE LOCATION // INSTANT ITINERARIES — SAME ENGINE, NO GROUP SETUP"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 font-mono">
        {/* Form */}
        <Card className="border border-stone-900 bg-stone-950/60 rounded-[12px] h-fit lg:sticky lg:top-4">
          <CardContent className="p-5 space-y-6">
            {/* Location mode */}
            <div className="space-y-2.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C]">Where are you going?</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(MODE_LABELS) as QuickPlanMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-2 py-2 rounded-[6px] border text-[9px] font-bold uppercase tracking-wider transition-all ${
                      mode === m ? 'border-[#DC143C]/50 bg-[#DC143C]/10 text-white' : 'border-stone-800 bg-stone-950 text-neutral-400 hover:bg-stone-900'
                    }`}
                  >
                    {MODE_LABELS[m].label}
                  </button>
                ))}
              </div>
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder={MODE_LABELS[mode].placeholder}
                className="w-full bg-stone-950 border border-stone-800 rounded-[8px] px-3 py-2.5 text-xs text-white focus:border-[#DC143C] focus:outline-none"
              />
              <p className="text-[9px] text-neutral-500 font-sans">{MODE_LABELS[mode].hint}</p>
            </div>

            {/* People */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-300 flex items-center gap-1.5"><Users className="h-3 w-3 text-[#DC143C]" /> People</label>
              <input
                type="number" min={1} max={20} value={headcount}
                onChange={e => setHeadcount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                className="w-full bg-stone-950 border border-stone-800 rounded-[8px] px-3 py-2.5 text-xs text-white focus:border-[#DC143C] focus:outline-none"
              />
            </div>

            {/* Budget */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-300 flex items-center gap-1.5"><Coins className="h-3 w-3 text-[#DC143C]" /> Budget (₹)</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPerPerson(true)}
                  className={`px-2 py-2 rounded-[6px] border text-[9px] font-bold uppercase tracking-wider transition-all ${perPerson ? 'border-[#DC143C]/50 bg-[#DC143C]/10 text-white' : 'border-stone-800 bg-stone-950 text-neutral-400 hover:bg-stone-900'}`}
                >Per person</button>
                <button
                  onClick={() => setPerPerson(false)}
                  className={`px-2 py-2 rounded-[6px] border text-[9px] font-bold uppercase tracking-wider transition-all ${!perPerson ? 'border-[#DC143C]/50 bg-[#DC143C]/10 text-white' : 'border-stone-800 bg-stone-950 text-neutral-400 hover:bg-stone-900'}`}
                >Total</button>
              </div>
              <input
                type="number" min={50} step={100} value={budget}
                onChange={e => setBudget(Math.max(50, parseInt(e.target.value) || 50))}
                className="w-full bg-stone-950 border border-stone-800 rounded-[8px] px-3 py-2.5 text-xs text-white focus:border-[#DC143C] focus:outline-none"
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-300">What are you looking for?</label>
              <div className="flex flex-wrap gap-1.5">
                {TAGS.map(t => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider transition-all ${
                      tags.includes(t) ? 'border-[#DC143C]/50 bg-[#DC143C]/10 text-white' : 'border-stone-800 bg-stone-950 text-neutral-400 hover:bg-stone-900'
                    }`}
                  >{t}</button>
                ))}
              </div>
            </div>

            {/* Optional date/time */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">Date</label>
                <input type="date" value={outingDate} onChange={e => setOutingDate(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-[8px] px-2 py-2 text-[11px] text-white focus:border-[#DC143C] focus:outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">Time</label>
                <input type="time" value={outingTime} onChange={e => setOutingTime(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-[8px] px-2 py-2 text-[11px] text-white focus:border-[#DC143C] focus:outline-none" />
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-[#DC143C] hover:bg-[#B80F2E] text-white text-[10px] font-bold uppercase tracking-widest rounded-[8px] py-3 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {plans.length > 0 ? 'Generate Again' : 'Generate'}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          {loading && (<>
            <QuickPlanSkeleton />
            <div className="hidden flex-col items-center justify-center py-20 text-neutral-500">
              <Loader2 className="h-8 w-8 animate-spin text-[#DC143C] mb-3" />
              <p className="text-[10px] uppercase tracking-widest">Building itineraries in {location || 'your area'}…</p>
            </div>
          </>)}

          {!loading && plans.length === 0 && (
            <Card className="border border-stone-900 bg-stone-950/45 rounded-[12px] p-10 text-center">
              <MapPin className="h-8 w-8 text-[#DC143C] mx-auto mb-4" />
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Pick a spot, set your budget and vibe, then generate. Every stop stays in that locality.
              </p>
            </Card>
          )}

          {!loading && plans.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-widest text-neutral-500">
                {plans.length} itineraries in <span className="text-white">{areaName}</span> · every stop stays here
              </p>
              {plans.map((plan) => (
                <Card key={plan.id} className="border border-stone-900/60 bg-stone-950/50 rounded-[12px] overflow-hidden">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wide">{plan.name}</h3>
                        {plan.tagline && <p className="text-[11px] text-neutral-400 font-sans mt-0.5">{plan.tagline}</p>}
                      </div>
                      <Badge className="bg-stone-900 text-neutral-300 border border-stone-800 text-[9px] font-bold uppercase shrink-0">
                        {(plan.budgetTier || '').replace('_', ' ')}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-4 text-[10px] text-neutral-300">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-[#DC143C]" />{formatDuration(plan.totalDurationMinutes)}</span>
                      <span className="inline-flex items-center gap-1"><Coins className="h-3 w-3 text-[#DC143C]" />₹{plan.totalEstimatedCostPerHead}/head</span>
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-[#DC143C]" />{plan.meetupZone}</span>
                    </div>

                    <div className="space-y-2">
                      {(plan.slots || []).sort((a: any, b: any) => a.slotOrder - b.slotOrder).map((slot: any, i: number) => (
                        <div key={slot.id || i} className="flex items-start gap-3 p-3 bg-stone-900/40 border border-stone-900 rounded-[6px]">
                          <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-[#DC143C]/10 text-[#DC143C] text-[10px] font-bold border border-[#DC143C]/20 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-widest text-neutral-500">{slot.arrivalTime} · {slot.category}</p>
                            <p className="text-xs font-bold text-white truncate">{slot.name}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] text-neutral-300">₹{slot.estimatedCostPerHead}</span>
                            <a href={directionsUrl(slot, plan.meetupZone)} target="_blank" rel="noreferrer" className="text-[9px] text-[#DC143C] uppercase tracking-widest inline-flex items-center gap-0.5">
                              <Navigation className="h-2.5 w-2.5" />Map
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="p-4 border-t border-stone-900/60 bg-black/15 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => handleSave(plan)}
                      disabled={savingId === plan.id || savedIds.has(plan.id)}
                      className={`text-[10px] font-bold uppercase tracking-widest rounded-[8px] py-2.5 px-4 flex items-center gap-1.5 ${
                        savedIds.has(plan.id)
                          ? 'bg-[#00E5A0]/10 border border-[#00E5A0]/20 text-[#00E5A0]'
                          : 'bg-[#DC143C] hover:bg-[#B80F2E] text-white'
                      }`}
                    >
                      {savingId === plan.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedIds.has(plan.id) ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                      {savedIds.has(plan.id) ? 'Saved' : 'Save to History'}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
