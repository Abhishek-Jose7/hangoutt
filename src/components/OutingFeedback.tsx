'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { submitOutingFeedback, VenueRating } from '@/actions/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface SlotInfo {
  id: string;
  name: string;
  placeId?: string | null;
  category: string;
}

interface OutingFeedbackProps {
  historyId: string;
  groupId: string;
  planId?: string;
  slots: SlotInfo[];
}

function StarRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[11px] text-neutral-400 font-mono uppercase tracking-widest">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(n)}
            className="text-lg leading-none focus:outline-none"
          >
            <span className={(hovered || value) >= n ? 'text-[#00E1AB]' : 'text-[#353534]'}>★</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TravelComfort({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = [
    { emoji: '😊', label: 'Easy', score: 5 },
    { emoji: '😐', label: 'OK', score: 3 },
    { emoji: '😞', label: 'Rough', score: 1 },
  ];
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[11px] text-neutral-400 font-mono uppercase tracking-widest">Travel</span>
      <div className="flex gap-2">
        {options.map(o => (
          <button
            key={o.score}
            type="button"
            onClick={() => onChange(o.score)}
            className={`flex flex-col items-center px-2 py-1 rounded-[4px] border text-xs font-mono transition-colors ${
              value === o.score
                ? 'border-[#00E1AB]/60 bg-[#00E1AB]/10 text-[#00E1AB]'
                : 'border-[#353534] text-neutral-500 hover:border-[#00E1AB]/30'
            }`}
          >
            <span className="text-base">{o.emoji}</span>
            <span className="text-[9px]">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OutingFeedback({ historyId, groupId, planId, slots }: OutingFeedbackProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [overallRating, setOverallRating] = useState(0);
  const [travelRating, setTravelRating] = useState(3);
  const [favoriteSlotId, setFavoriteSlotId] = useState<string | undefined>();
  const [venueRatings, setVenueRatings] = useState<Record<string, { rating: number; wouldVisitAgain: boolean }>>({});

  const venueSlots = slots.filter(s => s.placeId && !s.placeId.startsWith('fallback_'));

  function setVenueRating(placeId: string, rating: number) {
    setVenueRatings(prev => ({ ...prev, [placeId]: { ...prev[placeId], rating, wouldVisitAgain: prev[placeId]?.wouldVisitAgain ?? false } }));
  }

  function toggleWouldVisit(placeId: string) {
    setVenueRatings(prev => ({ ...prev, [placeId]: { ...prev[placeId], rating: prev[placeId]?.rating ?? 3, wouldVisitAgain: !prev[placeId]?.wouldVisitAgain } }));
  }

  function handleSubmit() {
    if (overallRating === 0) {
      toast.error('Please rate the overall experience first.');
      return;
    }

    const vr: VenueRating[] = venueSlots.map(s => ({
      placeId: s.placeId!,
      venueName: s.name,
      rating: venueRatings[s.placeId!]?.rating ?? 3,
      wouldVisitAgain: venueRatings[s.placeId!]?.wouldVisitAgain ?? false,
    }));

    startTransition(async () => {
      const res = await submitOutingFeedback(historyId, groupId, planId, {
        overallRating, travelRating, favoriteSlotId, venueRatings: vr,
      });
      if (res?.success === false) {
        toast.error('Could not save feedback. Try again.');
      } else {
        setSubmitted(true);
        toast.success('Thanks! Your feedback improves future recommendations.');
      }
    });
  }

  if (submitted) {
    return (
      <div className="text-center text-[11px] font-mono text-[#00E1AB]/60 py-4 uppercase tracking-widest">
        ✓ Feedback recorded
      </div>
    );
  }

  return (
    <Card className="border border-[#353534] rounded-[8px] bg-[#0e0e0e]/80 backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">
          How was your outing? <span className="text-neutral-600">(optional)</span>
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-neutral-500" /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />}
      </button>

      {open && (
        <div className="px-4 pb-5 space-y-5">
          {/* Overall + travel ratings */}
          <div className="bg-[#1c1b1b] border border-[#353534] rounded-[4px] px-4 divide-y divide-[#353534]">
            <StarRow label="Overall" value={overallRating} onChange={setOverallRating} />
            <TravelComfort value={travelRating} onChange={setTravelRating} />
          </div>

          {/* Per-venue ratings */}
          {venueSlots.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">Rate each stop</p>
              {venueSlots.map(slot => (
                <div key={slot.placeId} className="bg-[#1c1b1b] border border-[#353534] rounded-[4px] p-3 space-y-2">
                  <p className="text-[11px] font-mono font-bold text-white uppercase">{slot.name}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setVenueRating(slot.placeId!, n)}
                          className="text-base leading-none"
                        >
                          <span className={(venueRatings[slot.placeId!]?.rating ?? 0) >= n ? 'text-[#00E1AB]' : 'text-[#353534]'}>★</span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleWouldVisit(slot.placeId!)}
                      className={`text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-[3px] border transition-colors ${
                        venueRatings[slot.placeId!]?.wouldVisitAgain
                          ? 'border-[#00E1AB]/60 bg-[#00E1AB]/10 text-[#00E1AB]'
                          : 'border-[#353534] text-neutral-500'
                      }`}
                    >
                      Visit again?
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Favourite stop */}
          {slots.length > 1 && (
            <div className="space-y-2">
              <p className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#DC143C]">Favourite stop</p>
              <div className="flex flex-wrap gap-2">
                {slots.map(slot => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setFavoriteSlotId(slot.id === favoriteSlotId ? undefined : slot.id)}
                    className={`text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-[3px] border transition-colors ${
                      favoriteSlotId === slot.id
                        ? 'border-[#DC143C]/60 bg-[#DC143C]/10 text-[#DC143C]'
                        : 'border-[#353534] text-neutral-500 hover:border-[#353534]/80'
                    }`}
                  >
                    {slot.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="w-full h-9 text-[10px] font-mono font-bold uppercase tracking-widest bg-[#00E1AB]/10 text-[#00E1AB] border border-[#00E1AB]/20 hover:bg-[#00E1AB]/20 rounded-[4px]"
          >
            {isPending ? 'Saving...' : 'Submit Feedback'}
          </Button>
        </div>
      )}
    </Card>
  );
}
