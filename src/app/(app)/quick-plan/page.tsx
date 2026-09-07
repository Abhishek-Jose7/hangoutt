'use client';

import React, { useState } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { generateQuickPlanAction, saveQuickPlanAction } from '@/actions/quickPlan';
import type { QuickPlanInput, QuickPlanMode } from '@/lib/services/quickPlan.service';
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  Coins,
  Compass,
  Loader2,
  MapPin,
  Navigation,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';

const MODES: Record<QuickPlanMode, { label: string; hint: string; placeholder: string }> = {
  AREA: { label: 'Neighbourhood', hint: 'Keep every stop in one local pocket.', placeholder: 'Bandra, Fort, Powai…' },
  VENUE: { label: 'Must-visit place', hint: 'Build around one place you already picked.', placeholder: 'Prithvi Theatre, Jio World Garden…' },
  PIN: { label: 'Landmark or address', hint: 'Start from a pin and fan out nearby.', placeholder: 'Carter Road Promenade…' },
};

const VIBES = [
  ['food', 'Good food'], ['date', 'Date night'], ['chill', 'Slow & easy'],
  ['adventure', 'Something active'], ['creative', 'Make something'], ['culture', 'Art & culture'],
  ['comedy', 'Live comedy'], ['music', 'Live music'], ['nightlife', 'After dark'], ['outdoors', 'Outside'],
];

function formatDuration(value: number) {
  const hours = Math.floor((value || 0) / 60);
  const minutes = (value || 0) % 60;
  return hours ? `${hours}h ${minutes ? `${minutes}m` : ''}`.trim() : `${minutes}m`;
}

function mapsUrl(slot: any, zone: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${slot.venueName || slot.name}, ${zone}, Mumbai`)}`;
}

function venueUrl(slot: any) {
  return slot.sourceUrl || slot.link || null;
}

function formatMealType(slot: any) {
  return slot.mealType
    ? String(slot.mealType).replaceAll('_', ' ').toLowerCase()
    : String(slot.category || 'stop').replaceAll('_', ' ').toLowerCase();
}

function PlanSkeleton() {
  return <div className="space-y-4" aria-label="Loading plans">{[0, 1].map((item) => <div key={item} className="h-72 animate-pulse rounded-2xl bg-white/5" />)}</div>;
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

  const toggleTag = (tag: string) => setTags((current) => current.includes(tag)
    ? current.filter((item) => item !== tag)
    : [...current, tag]);

  const buildInput = (): QuickPlanInput => ({
    mode, location: location.trim(), headcount, budget, perPerson, tags,
    outingDate: outingDate || undefined, outingTime: outingTime || undefined,
  });

  async function generate() {
    if (!location.trim()) {
      toast.error('Add a neighbourhood, landmark, or place first.');
      return;
    }
    setLoading(true);
    try {
      const result = await generateQuickPlanAction(buildInput());
      if (!result.success) {
        toast.error(result.error?.message || 'Could not build plans.');
        return;
      }
      setPlans(result.data.plans || []);
      setAreaName(result.data.planningArea?.name || location);
      setSavedIds(new Set());
      if (result.data.requiredVenueMatched === false) toast.info('Could not match that place exactly. Plans still use its neighbourhood.');
      if (!(result.data.plans || []).length) toast.error('No good-fit plans found. Try a wider area or more budget.');
    } catch {
      toast.error('Could not build plans. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function save(plan: any) {
    setSavingId(plan.id);
    try {
      const result = await saveQuickPlanAction(plan, buildInput());
      if (!result.success) {
        toast.error(result.error?.message || 'Could not save plan.');
        return;
      }
      setSavedIds((current) => new Set(current).add(plan.id));
      toast.success('Saved to history.');
    } catch {
      toast.error('Could not save plan.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <PageContainer title="Make a plan" subtitle="One place to start. A full outing to follow.">
      <div className="grid gap-7 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <section className="h-fit rounded-2xl border border-white/10 bg-[#131315] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.28)] sm:p-6 lg:sticky lg:top-24">
          <div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#DC143C]">Quick plan</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">What sounds good?</h2></div><div className="rounded-xl bg-[#DC143C]/10 p-2 text-[#DC143C]"><Compass size={20} /></div></div>
          <div className="space-y-6">
            <div><label className="mb-2 block text-sm font-semibold text-neutral-200">Start from</label><div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">{(Object.keys(MODES) as QuickPlanMode[]).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-lg px-2 py-2.5 text-[11px] font-semibold transition ${mode === item ? 'bg-[#DC143C]/15 text-[#ff6b7e] shadow-sm' : 'text-neutral-500 hover:text-white'}`}>{MODES[item].label}</button>)}</div><input value={location} onChange={(event) => setLocation(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && generate()} placeholder={MODES[mode].placeholder} className="mt-3 w-full rounded-xl border border-white/15 bg-transparent px-3.5 py-3 text-sm text-white placeholder:text-neutral-600 focus:border-[#DC143C] focus:outline-none" /><p className="mt-2 text-xs text-neutral-500">{MODES[mode].hint}</p></div>
            <div><label className="mb-2 block text-sm font-semibold text-neutral-200">Who is coming?</label><div className="flex items-center gap-3 rounded-xl border border-white/15 px-3.5 py-3"><Users size={17} className="text-[#DC143C]" /><input type="number" min={1} max={20} value={headcount} onChange={(event) => setHeadcount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} className="w-full bg-transparent text-sm text-white focus:outline-none" /><span className="text-xs text-neutral-500">people</span></div></div>
            <div><label className="mb-2 block text-sm font-semibold text-neutral-200">Your spend</label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setPerPerson(true)} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${perPerson ? 'border-[#DC143C] bg-[#DC143C]/10 text-[#ff6b7e]' : 'border-white/15 text-neutral-500'}`}>Per person</button><button type="button" onClick={() => setPerPerson(false)} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${!perPerson ? 'border-[#DC143C] bg-[#DC143C]/10 text-[#ff6b7e]' : 'border-white/15 text-neutral-500'}`}>Total group</button></div><div className="relative mt-2"><WalletCards size={16} className="absolute left-3.5 top-3.5 text-[#DC143C]" /><input type="number" min={50} step={100} value={budget} onChange={(event) => setBudget(Math.max(50, Number(event.target.value) || 50))} className="w-full rounded-xl border border-white/15 bg-transparent py-3 pl-10 pr-3 text-sm text-white focus:border-[#DC143C] focus:outline-none" /><span className="absolute right-3.5 top-3 text-xs text-neutral-500">₹</span></div></div>
            <div><label className="mb-2 block text-sm font-semibold text-neutral-200">Set the mood <span className="font-normal text-neutral-500">optional</span></label><div className="flex flex-wrap gap-2">{VIBES.map(([value, label]) => <button key={value} type="button" onClick={() => toggleTag(value)} className={`rounded-full border px-3 py-2 text-xs font-medium transition ${tags.includes(value) ? 'border-[#DC143C] bg-[#DC143C]/10 text-[#ff6b7e]' : 'border-white/15 text-neutral-500 hover:border-white/30'}`}>{label}</button>)}</div></div>
            <div className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-neutral-500">Date<input type="date" value={outingDate} onChange={(event) => setOutingDate(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2.5 text-xs font-normal text-white focus:outline-none" /></label><label className="text-xs font-semibold text-neutral-500">Start time<input type="time" value={outingTime} onChange={(event) => setOutingTime(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2.5 text-xs font-normal text-white focus:outline-none" /></label></div>
            <p className="-mt-3 text-[11px] leading-4 text-neutral-500">Leave date or time blank to use Mumbai local system time when generating.</p>
            <button type="button" onClick={generate} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#DC143C] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,20,60,0.22)] transition hover:-translate-y-0.5 hover:bg-[#B80F2E] active:translate-y-0 disabled:cursor-wait disabled:opacity-60">{loading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}{loading ? 'Finding a good route…' : plans.length ? 'Try another mix' : 'Build my outing'}<ChevronRight size={16} /></button>
          </div>
        </section>

        <section aria-live="polite" className="min-w-0">
          {loading && <PlanSkeleton />}
          {!loading && !plans.length && <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[#111316] px-8 text-center"><div className="mb-5 rounded-2xl bg-[#DC143C]/10 p-4 text-[#DC143C]"><MapPin size={27} /></div><h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">Good plans start with one detail</h2><p className="mt-3 max-w-md text-sm leading-6 text-neutral-400">Choose a place, tell us who is coming, and we’ll line up a realistic mix of things to do, eat, and linger over.</p><div className="mt-7 grid w-full max-w-lg grid-cols-3 gap-2 text-left text-xs text-neutral-400"><div className="rounded-xl bg-white/5 p-3"><MapPin size={15} className="mb-2 text-[#DC143C]" />Stay local</div><div className="rounded-xl bg-white/5 p-3"><Coins size={15} className="mb-2 text-[#DC143C]" />Respect budget</div><div className="rounded-xl bg-white/5 p-3"><CalendarDays size={15} className="mb-2 text-[#DC143C]" />Fit the day</div></div></div>}
          {!loading && plans.length > 0 && <><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#DC143C]">Made for {areaName}</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">Pick your kind of day</h2></div><p className="text-xs text-neutral-500">{plans.length} routes · stops kept nearby</p></div><div className="space-y-5">{plans.map((plan, planIndex) => <article key={plan.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#131315] shadow-[0_8px_28px_rgba(0,0,0,0.28)]"><div className="border-b border-white/10 px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><span className="rounded-md bg-[#DC143C]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff6b7e]">Route {String(planIndex + 1).padStart(2, '0')}</span>{plan.budgetTier && <span className="text-xs text-neutral-500">{String(plan.budgetTier).replaceAll('_', ' ')}</span>}</div><h3 className="text-xl font-semibold tracking-[-0.03em] text-white">{plan.name}</h3>{plan.tagline && <p className="mt-1 max-w-xl text-sm text-neutral-400">{plan.tagline}</p>}</div><div className="flex gap-4 text-xs text-neutral-400"><span className="inline-flex items-center gap-1.5"><CalendarDays size={14} className="text-[#DC143C]" />{formatDuration(plan.totalDurationMinutes)}</span><span className="inline-flex items-center gap-1.5"><Coins size={14} className="text-[#DC143C]" />₹{plan.totalEstimatedCostPerHead}/head</span></div></div></div><div className="divide-y divide-white/10 px-5 sm:px-6">{(plan.slots || []).slice().sort((a: any, b: any) => (a.slotOrder ?? a.order ?? 0) - (b.slotOrder ?? b.order ?? 0)).map((slot: any, index: number) => <div key={slot.id || index} className="group flex items-start gap-3 py-4"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#DC143C]/10 text-xs font-bold text-[#ff6b7e]">{String(index + 1).padStart(2, '0')}</div><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-neutral-500">{slot.arrivalTime || 'Flexible'} · {formatMealType(slot)}</p><p className="mt-1 truncate text-base font-semibold text-white">{slot.name || slot.venueName}</p>{slot.note && <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-400">{slot.note}</p>}<p className="mt-1 text-xs text-neutral-500">₹{slot.estimatedCostPerHead || 0} per person</p></div><div className="mt-1 flex shrink-0 items-center gap-3"><a href={mapsUrl(slot, areaName)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#ff6b7e] opacity-80 transition group-hover:opacity-100">Directions <Navigation size={13} /></a>{venueUrl(slot) && <a href={venueUrl(slot)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-neutral-400 transition hover:text-white">Venue page</a>}</div></div>)}</div><div className="flex items-center justify-between gap-3 bg-[#111316] px-5 py-4 sm:px-6"><p className="text-xs text-neutral-500">Meals and breaks follow your start time.</p><button type="button" onClick={() => save(plan)} disabled={savingId === plan.id || savedIds.has(plan.id)} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold transition ${savedIds.has(plan.id) ? 'bg-[#DC143C]/15 text-[#ff6b7e]' : 'bg-[#24272d] text-white hover:bg-[#30353d]'}`}>{savingId === plan.id ? <Loader2 size={14} className="animate-spin" /> : savedIds.has(plan.id) ? <Check size={14} /> : <Bookmark size={14} />}{savedIds.has(plan.id) ? 'Saved' : 'Save route'}</button></div></article>)}</div></>}
        </section>
      </div>
    </PageContainer>
  );
}
