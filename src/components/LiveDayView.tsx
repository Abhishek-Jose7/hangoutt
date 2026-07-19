'use client';

import { useEffect, useState } from 'react';
import { MapPin, Navigation, Coins, Clock, Radio } from 'lucide-react';

interface DaySlot {
  slotOrder: number;
  name: string;
  venueName?: string;
  category: string;
  arrivalTime: string;
  durationMinutes: number;
  estimatedCostPerHead: number;
  note?: string;
  link?: string;
  meetupZone?: string;
}

interface LiveDayViewProps {
  planName: string;
  meetupZone?: string;
  outingDate?: string; // "YYYY-MM-DD"
  slots: DaySlot[];
}

// Parse "6:00 PM" against a base Date → epoch ms.
function parseSlotTime(base: Date, timeStr: string): number | null {
  const m = timeStr?.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const d = new Date(base);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
}

function directionsUrl(slot: DaySlot, zone?: string) {
  if (slot.link) return slot.link;
  const q = encodeURIComponent(`${slot.venueName || slot.name} ${zone || slot.meetupZone || 'Mumbai'}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export default function LiveDayView({ planName, meetupZone, outingDate, slots }: LiveDayViewProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  const ordered = [...slots].sort((a, b) => a.slotOrder - b.slotOrder);

  // Only render on the outing day. If no date set, always show (fallback).
  const isOutingDay = (() => {
    if (!outingDate) return true;
    const today = new Date();
    const y = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}` === outingDate;
  })();

  if (!isOutingDay || ordered.length === 0) return null;

  const base = new Date();
  const timeline = ordered.map((s) => {
    const start = parseSlotTime(base, s.arrivalTime);
    const end = start != null ? start + (s.durationMinutes || 0) * 60000 : null;
    return { slot: s, start, end };
  });

  let currentIdx = -1;
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    if (t.start != null && t.end != null && now >= t.start && now < t.end) {
      currentIdx = i;
      break;
    }
  }
  // Before first slot → current is none, next is first. After all → done.
  const firstStart = timeline[0]?.start;
  const beforeStart = firstStart != null && now < firstStart;
  const lastEnd = timeline[timeline.length - 1]?.end;
  const afterEnd = lastEnd != null && now >= lastEnd;

  const nextIdx = (() => {
    if (afterEnd) return -1;
    if (beforeStart) return 0;
    if (currentIdx >= 0) return currentIdx + 1 < timeline.length ? currentIdx + 1 : -1;
    // between slots: find first upcoming
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].start != null && now < (timeline[i].start as number)) return i;
    }
    return -1;
  })();

  // Running spend: sum of slots whose window has started.
  const spentSoFar = timeline.reduce((sum, t) => {
    if (t.start != null && now >= t.start) return sum + (t.slot.estimatedCostPerHead || 0);
    return sum;
  }, 0);
  const totalSpend = ordered.reduce((sum, s) => sum + (s.estimatedCostPerHead || 0), 0);

  const current = currentIdx >= 0 ? timeline[currentIdx].slot : null;
  const next = nextIdx >= 0 ? timeline[nextIdx].slot : null;

  return (
    <div className="border border-[#DC143C]/30 rounded-[8px] bg-[#0e0e0e]/90 backdrop-blur-md shadow-lg p-5 space-y-5 font-mono">
      <div className="flex items-center justify-between border-b border-[#353534] pb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#DC143C] flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 animate-pulse" /> Live Day-Of · {planName}
        </span>
        <span className="text-[9px] text-neutral-500 uppercase tracking-widest">
          {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Current slot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#1c1b1b] border border-[#00E1AB]/20 rounded-[6px] p-4 space-y-2">
          <span className="text-[9px] uppercase tracking-widest text-[#00E1AB] flex items-center gap-1">
            <Radio className="h-3 w-3" /> {afterEnd ? 'Outing Complete' : beforeStart ? 'Starting Soon' : 'Right Now'}
          </span>
          {current ? (
            <>
              <h4 className="text-sm font-bold text-white uppercase">{current.name}</h4>
              <p className="text-[10px] text-neutral-400 uppercase tracking-widest">{current.category} · {current.arrivalTime}</p>
              <a href={directionsUrl(current, meetupZone)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] text-[#DC143C] uppercase tracking-widest mt-1">
                <Navigation className="h-3 w-3" /> Directions
              </a>
            </>
          ) : (
            <p className="text-[11px] text-neutral-500 font-sans">
              {beforeStart ? 'Head to the first venue.' : afterEnd ? 'Hope it went great!' : 'On the move to the next stop.'}
            </p>
          )}
        </div>

        {/* Next venue */}
        <div className="bg-[#1c1b1b] border border-[#353534] rounded-[6px] p-4 space-y-2">
          <span className="text-[9px] uppercase tracking-widest text-neutral-400 flex items-center gap-1">
            <MapPin className="h-3 w-3 text-[#DC143C]" /> Up Next
          </span>
          {next ? (
            <>
              <h4 className="text-sm font-bold text-white uppercase">{next.name}</h4>
              <p className="text-[10px] text-neutral-400 uppercase tracking-widest">{next.category} · {next.arrivalTime}</p>
              <a href={directionsUrl(next, meetupZone)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] text-[#DC143C] uppercase tracking-widest mt-1">
                <Navigation className="h-3 w-3" /> Directions
              </a>
            </>
          ) : (
            <p className="text-[11px] text-neutral-500 font-sans">No more stops.</p>
          )}
        </div>
      </div>

      {/* Running spend tracker */}
      <div className="bg-[#1c1b1b] border border-[#353534] rounded-[6px] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-neutral-400 flex items-center gap-1">
            <Coins className="h-3 w-3 text-[#DC143C]" /> Spend So Far
          </span>
          <span className="text-[11px] text-white font-bold">₹{spentSoFar} / ₹{totalSpend}</span>
        </div>
        <div className="h-1.5 w-full bg-stone-900 rounded-full overflow-hidden">
          <div className="h-full bg-[#DC143C]" style={{ width: `${totalSpend > 0 ? Math.min(100, (spentSoFar / totalSpend) * 100) : 0}%` }} />
        </div>
      </div>

      {/* Full timeline */}
      <div className="space-y-1.5">
        {timeline.map((t, i) => {
          const done = t.end != null && now >= t.end;
          const active = i === currentIdx;
          return (
            <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-[4px] text-[11px] ${active ? 'bg-[#00E1AB]/10 border border-[#00E1AB]/20' : 'bg-transparent'}`}>
              <span className={`h-2 w-2 rounded-full shrink-0 ${done ? 'bg-neutral-600' : active ? 'bg-[#00E1AB] animate-pulse' : 'bg-[#DC143C]/50'}`} />
              <span className="text-neutral-500 w-16 shrink-0"><Clock className="h-3 w-3 inline mr-1" />{t.slot.arrivalTime}</span>
              <span className={`uppercase tracking-wide ${done ? 'text-neutral-600 line-through' : 'text-white'}`}>{t.slot.name}</span>
              <span className="text-neutral-500 ml-auto">₹{t.slot.estimatedCostPerHead}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
