import { getSharedPlanAction } from '@/actions/planner';
import Link from 'next/link';
import { MapPin, Clock, Coins } from 'lucide-react';
import ShareButton from './ShareButton';

export const dynamic = 'force-dynamic';

function formatDuration(min: number) {
  const h = Math.floor((min || 0) / 60);
  const m = (min || 0) % 60;
  return `${h}H ${m}M`;
}

export default async function SharePlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const res = await getSharedPlanAction(planId);

  if (!res.success || !res.data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-stone-950 text-white p-6 font-mono">
        <div className="text-center space-y-3">
          <p className="text-sm uppercase tracking-widest text-neutral-400">Itinerary not found or no longer available.</p>
          <Link href="/" className="text-[#DC143C] text-xs uppercase tracking-widest">Go to Hangout</Link>
        </div>
      </main>
    );
  }

  const plan = res.data;
  const slots: any[] = plan.slots || [];

  return (
    <main className="min-h-screen bg-stone-950 text-white font-mono">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-[#DC143C]">HANGOUT</Link>
          <ShareButton
            planName={plan.name}
            groupName={plan.groupName}
            outingDate={plan.outingDate}
            totalCost={plan.totalEstimatedCostPerHead}
          />
        </div>

        <div className="space-y-1.5 mb-8">
          <p className="text-[10px] uppercase tracking-widest text-[#DC143C]">{plan.groupName || 'Group Outing'}</p>
          <h1 className="text-2xl font-bold uppercase tracking-wide text-white">{plan.name}</h1>
          {plan.tagline && <p className="text-sm text-neutral-400 font-sans">{plan.tagline}</p>}
          <div className="flex flex-wrap gap-4 pt-3 text-[11px] text-neutral-300">
            {plan.meetupZone && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[#DC143C]" />{plan.meetupZone}</span>}
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#DC143C]" />{formatDuration(plan.totalDurationMinutes)}</span>
            <span className="inline-flex items-center gap-1.5"><Coins className="h-3.5 w-3.5 text-[#DC143C]" />₹{plan.totalEstimatedCostPerHead}/head</span>
            {plan.outingDate && <span className="text-neutral-500">{plan.outingDate}{plan.outingTime ? ` · ${plan.outingTime}` : ''}</span>}
          </div>
        </div>

        <div className="space-y-4">
          {slots.map((slot, i) => (
            <div key={slot.id || i} className="border border-stone-900 bg-stone-950/60 rounded-[12px] overflow-hidden">
              {slot.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slot.imageUrl} alt={slot.name} className="w-full h-40 object-cover" />
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-neutral-500">{slot.arrivalTime} · {slot.category}</p>
                    <p className="text-sm font-bold text-white uppercase tracking-wide">{slot.name}</p>
                  </div>
                  <span className="text-[11px] text-neutral-300 shrink-0">₹{slot.estimatedCostPerHead}</span>
                </div>
                {slot.note && <p className="text-[11px] text-neutral-400 font-sans leading-relaxed">{slot.note}</p>}
                <div className="flex gap-3 text-[10px] text-neutral-500">
                  <span>{formatDuration(slot.durationMinutes)}</span>
                  {slot.link && <a href={slot.link} target="_blank" rel="noreferrer" className="text-[#DC143C] uppercase tracking-widest">Directions</a>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link href="/" className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-[#DC143C]">
            Plan your own outing on Hangout
          </Link>
        </div>
      </div>
    </main>
  );
}
