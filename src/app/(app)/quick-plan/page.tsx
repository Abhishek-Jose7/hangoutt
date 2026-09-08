'use client';

import React, { useRef, useState } from 'react';
import PageContainer from '@/components/shared/PageContainer';
import { generateQuickPlanAction, saveQuickPlanAction } from '@/actions/quickPlan';
import type { QuickPlanInput, QuickPlanMode } from '@/lib/services/quickPlan.service';
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Coins,
  Compass,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  SlidersHorizontal,
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

function getSlotImageUrl(slot: any): string | null {
  const url = slot.imageUrl;
  if (!url || typeof url !== 'string') return null;
  if (url.includes('unsplash.com') || url.includes('placehold.co') || url.includes('mumbai_map.webp') || url.includes('cafe_active.webp')) {
    return null;
  }
  return url;
}

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
  return (
    <div className="grid gap-5 xl:grid-cols-2" aria-label="Loading plans">
      {[0, 1].map((item) => (
        <div key={item} className="h-96 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
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
  const [showFormOnMobile, setShowFormOnMobile] = useState(true);
  const resultsRef = useRef<HTMLDivElement>(null);

  const toggleTag = (tag: string) => setTags((current) => current.includes(tag)
    ? current.filter((item) => item !== tag)
    : [...current, tag]);

  const buildInput = (currentSeed?: number): QuickPlanInput => ({
    mode, location: location.trim(), headcount, budget, perPerson, tags,
    outingDate: outingDate || undefined, outingTime: outingTime || undefined,
    seed: currentSeed ?? Math.floor(Math.random() * 1000000),
  });

  async function generate(isReRoll = false) {
    if (!location.trim()) {
      toast.error('Add a neighbourhood, landmark, or place first.');
      return;
    }
    setLoading(true);
    const runSeed = isReRoll ? Math.floor(Math.random() * 1000000) : Date.now();
    try {
      const result = await generateQuickPlanAction(buildInput(runSeed));
      if (!result.success) {
        toast.error(result.error?.message || 'Could not build plans.');
        return;
      }
      setPlans(result.data.plans || []);
      setAreaName(result.data.planningArea?.name || location);
      setSavedIds(new Set());
      if (result.data.requiredVenueMatched === false) toast.info('Could not match that place exactly. Plans still use its neighbourhood.');
      if (!(result.data.plans || []).length) toast.error('No good-fit plans found. Try a wider area or more budget.');
      
      // Auto collapse form on mobile after generating results to save scroll space
      if ((result.data.plans || []).length > 0) {
        setShowFormOnMobile(false);
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
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
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,340px)_1fr] items-start">
        {/* Input Controls Panel */}
        <section className="rounded-2xl border border-white/10 bg-[#131315] shadow-[0_8px_28px_rgba(0,0,0,0.28)] lg:sticky lg:top-24">
          {/* Mobile Collapsible Header Bar when plans exist */}
          {plans.length > 0 && (
            <div className="flex items-center justify-between p-4 lg:hidden border-b border-white/10">
              <div className="flex items-center gap-2 text-xs font-semibold text-white truncate">
                <MapPin size={15} className="text-[#DC143C] shrink-0" />
                <span className="truncate">{areaName || location}</span>
                <span className="text-neutral-500">·</span>
                <span>{headcount}p</span>
                <span className="text-neutral-500">·</span>
                <span>₹{budget}{perPerson ? '/head' : ' total'}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowFormOnMobile(!showFormOnMobile)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-[#ff6b7e] hover:bg-white/10 transition"
              >
                <SlidersHorizontal size={13} />
                {showFormOnMobile ? 'Hide filters' : 'Edit criteria'}
                {showFormOnMobile ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          )}

          <div className={`p-5 sm:p-6 ${plans.length > 0 && !showFormOnMobile ? 'hidden lg:block' : 'block'}`}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#DC143C]">Quick plan</p>
                <h2 className="mt-0.5 text-xl font-semibold tracking-[-0.03em] text-white">What sounds good?</h2>
              </div>
              <div className="rounded-xl bg-[#DC143C]/10 p-2 text-[#DC143C]">
                <Compass size={18} />
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-neutral-200">Start from</label>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">
                  {(Object.keys(MODES) as QuickPlanMode[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setMode(item)}
                      className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                        mode === item ? 'bg-[#DC143C]/15 text-[#ff6b7e] shadow-sm' : 'text-neutral-500 hover:text-white'
                      }`}
                    >
                      {MODES[item].label}
                    </button>
                  ))}
                </div>
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && generate(false)}
                  placeholder={MODES[mode].placeholder}
                  className="mt-2.5 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2.5 text-xs text-white placeholder:text-neutral-600 focus:border-[#DC143C] focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-neutral-500">{MODES[mode].hint}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-200">Who is coming?</label>
                  <div className="flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2">
                    <Users size={15} className="text-[#DC143C] shrink-0" />
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={headcount}
                      onChange={(event) => setHeadcount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                      className="w-full bg-transparent text-xs text-white focus:outline-none"
                    />
                    <span className="text-[11px] text-neutral-500">ppl</span>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-200">Spend mode</label>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setPerPerson(true)}
                      className={`rounded-lg py-1.5 text-[10px] font-semibold transition ${
                        perPerson ? 'bg-[#DC143C]/15 text-[#ff6b7e]' : 'text-neutral-500 hover:text-white'
                      }`}
                    >
                      /head
                    </button>
                    <button
                      type="button"
                      onClick={() => setPerPerson(false)}
                      className={`rounded-lg py-1.5 text-[10px] font-semibold transition ${
                        !perPerson ? 'bg-[#DC143C]/15 text-[#ff6b7e]' : 'text-neutral-500 hover:text-white'
                      }`}
                    >
                      Total
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-neutral-200">Your budget (₹)</label>
                <div className="relative">
                  <WalletCards size={15} className="absolute left-3 top-2.5 text-[#DC143C]" />
                  <input
                    type="number"
                    min={50}
                    step={100}
                    value={budget}
                    onChange={(event) => setBudget(Math.max(50, Number(event.target.value) || 50))}
                    className="w-full rounded-xl border border-white/15 bg-transparent py-2 pl-9 pr-3 text-xs text-white focus:border-[#DC143C] focus:outline-none"
                  />
                  <span className="absolute right-3 top-2 text-xs text-neutral-500">₹</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-neutral-200">
                  Set the mood <span className="font-normal text-neutral-500">optional</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {VIBES.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleTag(value)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        tags.includes(value)
                          ? 'border-[#DC143C] bg-[#DC143C]/10 text-[#ff6b7e]'
                          : 'border-white/15 text-neutral-400 hover:border-white/30'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-neutral-400">
                  Date
                  <input
                    type="date"
                    value={outingDate}
                    onChange={(event) => setOutingDate(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-2.5 py-2 text-xs font-normal text-white focus:outline-none"
                  />
                </label>
                <label className="text-[11px] font-semibold text-neutral-400">
                  Start time
                  <input
                    type="time"
                    value={outingTime}
                    onChange={(event) => setOutingTime(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-2.5 py-2 text-xs font-normal text-white focus:outline-none"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => generate(false)}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#DC143C] px-4 py-3 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(220,20,60,0.22)] transition hover:bg-[#B80F2E] active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {loading ? 'Finding a good route…' : plans.length ? 'Re-generate plans' : 'Build my outing'}
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </section>

        {/* Results Container */}
        <section aria-live="polite" className="min-w-0" ref={resultsRef}>
          {loading && <PlanSkeleton />}

          {!loading && !plans.length && (
            <div className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[#111316] p-6 text-center">
              <div className="mb-4 rounded-2xl bg-[#DC143C]/10 p-3.5 text-[#DC143C]">
                <MapPin size={24} />
              </div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">Good plans start with one detail</h2>
              <p className="mt-2 max-w-sm text-xs leading-5 text-neutral-400">
                Choose a neighbourhood or landmark, tell us who is coming, and we’ll line up a realistic mix of things to do, eat, and linger over.
              </p>
              <div className="mt-6 grid w-full max-w-md grid-cols-3 gap-2 text-left text-[11px] text-neutral-400">
                <div className="rounded-xl bg-white/5 p-2.5">
                  <MapPin size={14} className="mb-1.5 text-[#DC143C]" />Stay local
                </div>
                <div className="rounded-xl bg-white/5 p-2.5">
                  <Coins size={14} className="mb-1.5 text-[#DC143C]" />Respect budget
                </div>
                <div className="rounded-xl bg-white/5 p-2.5">
                  <CalendarDays size={14} className="mb-1.5 text-[#DC143C]" />Fit the day
                </div>
              </div>
            </div>
          )}

          {!loading && plans.length > 0 && (
            <>
              {/* Header with quick re-roll action */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#131315] px-4 py-3 sm:px-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DC143C]">Made for {areaName}</p>
                  <h2 className="text-lg font-semibold tracking-[-0.03em] text-white">Pick your kind of day</h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-xs text-neutral-400">{plans.length} routes</span>
                  <button
                    type="button"
                    onClick={() => generate(true)}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#DC143C] px-3.5 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-[#B80F2E] active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    Try another mix
                  </button>
                </div>
              </div>

              {/* Routes Grid: 2 columns on XL screens, 1 column on mobile/tablet */}
              <div className="grid gap-5 xl:grid-cols-2">
                {plans.map((plan, planIndex) => (
                  <article
                    key={plan.id}
                    className="flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#131315] shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition hover:border-white/20"
                  >
                    <div>
                      {/* Plan Header */}
                      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="mb-1 flex items-center gap-2">
                              <span className="rounded-md bg-[#DC143C]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff6b7e]">
                                Route {String(planIndex + 1).padStart(2, '0')}
                              </span>
                              {plan.budgetTier && (
                                <span className="text-[11px] text-neutral-400">
                                  {String(plan.budgetTier).replaceAll('_', ' ')}
                                </span>
                              )}
                            </div>
                            <h3 className="text-lg font-semibold tracking-[-0.03em] text-white">{plan.name}</h3>
                            {plan.tagline && <p className="mt-0.5 text-xs text-neutral-400 line-clamp-2">{plan.tagline}</p>}
                          </div>
                          <div className="flex gap-3 text-xs text-neutral-300 font-medium">
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays size={13} className="text-[#DC143C]" />
                              {formatDuration(plan.totalDurationMinutes)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Coins size={13} className="text-[#DC143C]" />
                              ₹{plan.totalEstimatedCostPerHead}/head
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Places List */}
                      <div className="space-y-3 p-4 sm:p-5">
                        {(plan.slots || [])
                          .slice()
                          .sort((a: any, b: any) => (a.slotOrder ?? a.order ?? 0) - (b.slotOrder ?? b.order ?? 0))
                          .map((slot: any, index: number) => {
                            const imageUrl = getSlotImageUrl(slot);
                            return (
                              <div
                                key={slot.id || index}
                                className="group flex flex-col sm:flex-row items-stretch gap-3 overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]"
                              >
                                {/* Venue Image Thumbnail or Styled Badge Header */}
                                {imageUrl ? (
                                  <div className="relative w-full sm:w-36 h-32 sm:h-auto shrink-0 overflow-hidden rounded-lg bg-neutral-900">
                                    <img
                                      src={imageUrl}
                                      alt={slot.name || slot.venueName}
                                      loading="lazy"
                                      decoding="async"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                      className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-105 group-hover:opacity-100"
                                    />
                                    <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-md bg-[#DC143C] text-[10px] font-bold text-white shadow-md">
                                      {String(index + 1).padStart(2, '0')}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="relative flex h-14 w-full sm:h-auto sm:w-20 shrink-0 flex-row sm:flex-col items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-2 text-center gap-2">
                                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#DC143C] text-[10px] font-bold text-white shadow-md shrink-0">
                                      {String(index + 1).padStart(2, '0')}
                                    </span>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-300 truncate">
                                      {formatMealType(slot)}
                                    </span>
                                  </div>
                                )}

                                {/* Place Content */}
                                <div className="flex flex-1 flex-col justify-between min-w-0 py-0.5">
                                  <div>
                                    <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                                      <span className="text-[#ff6b7e]">
                                        {slot.arrivalTime || 'Flexible'} · {formatMealType(slot)}
                                      </span>
                                      <span className="text-neutral-300 font-normal">
                                        ₹{slot.estimatedCostPerHead || 0} / person
                                      </span>
                                    </div>
                                    <h4 className="mt-1 truncate text-sm font-semibold text-white group-hover:text-[#ff6b7e] transition-colors">
                                      {slot.name || slot.venueName}
                                    </h4>
                                    {slot.note && (
                                      <p className="mt-1 text-xs leading-4 text-neutral-400 line-clamp-2 font-sans">
                                        {slot.note}
                                      </p>
                                    )}
                                  </div>

                                  <div className="mt-2.5 flex items-center justify-between gap-2 text-xs border-t border-white/5 pt-2">
                                    <a
                                      href={mapsUrl(slot, areaName)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#ff6b7e] hover:underline"
                                    >
                                      Directions <Navigation size={12} />
                                    </a>
                                    {venueUrl(slot) && (
                                      <a
                                        href={venueUrl(slot)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[11px] font-medium text-neutral-400 hover:text-white transition"
                                      >
                                        Venue page
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {/* Card Footer: Save Action */}
                    <div className="flex items-center justify-between gap-3 bg-[#111316] px-4 py-3 sm:px-5 border-t border-white/10">
                      <p className="text-[11px] text-neutral-500">Meals and breaks fit your start time.</p>
                      <button
                        type="button"
                        onClick={() => save(plan)}
                        disabled={savingId === plan.id || savedIds.has(plan.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                          savedIds.has(plan.id)
                            ? 'bg-[#DC143C]/15 text-[#ff6b7e]'
                            : 'bg-[#24272d] text-white hover:bg-[#30353d]'
                        }`}
                      >
                        {savingId === plan.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : savedIds.has(plan.id) ? (
                          <Check size={13} />
                        ) : (
                          <Bookmark size={13} />
                        )}
                        {savedIds.has(plan.id) ? 'Saved' : 'Save route'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
