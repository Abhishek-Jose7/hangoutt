'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Sparkles, Timer, Train } from 'lucide-react';
import { useRoom } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Button } from '@/components/ui/Button';

const messages = [
  'Ranking candidate places...',
  'Calculating fair travel splits...',
  'Composing itinerary paths...',
  'Verifying budget fit...',
  'Finalizing options for voting...',
];

export default function GeneratingPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  const { data: room } = useRoom(roomId);
  const status = useRoomStore((s) => s.status);
  const setRoom = useRoomStore((s) => s.setRoom);
  const [messageIndex, setMessageIndex] = useState(0);

  useRoomRealtime(roomId);

  useEffect(() => {
    if (room) setRoom(room);
  }, [room, setRoom]);

  useEffect(() => {
    if (status === 'voting') router.push(`/rooms/${roomId}/voting`);
    if (status === 'confirmed') router.push(`/rooms/${roomId}/confirmed`);
    if (status === 'planning') router.push(`/rooms/${roomId}/planning`);
  }, [status, roomId, router]);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/itineraries`);
        const data = await res.json();

        if (res.status === 202 && data?.status === 'generating') return;
        if (res.ok && Array.isArray(data) && data.length > 0) {
          useRoomStore.getState().setStatus('voting');
        }
      } catch {
        // no-op
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [roomId]);

  return (
    <div className="saas-page">
      <div className="saas-shell saas-section space-y-6">
        <section className="saas-hero">
          <div className="saas-grid-2 relative z-[1] items-start">
            <div className="space-y-5">
              <span className="section-kicker">Generation In Progress</span>
              <h1 className="saas-title">Building Candidate Itineraries</h1>
              <p className="saas-lead">
                The system is balancing commute fairness, budget constraints, and place quality before publishing options for team voting.
              </p>

              <div className="relative h-[80px] rounded-2xl border border-[var(--color-border-default)] bg-[rgba(255,255,255,0.02)] overflow-hidden">
                <div className="absolute left-4 right-4 top-1/2 h-[2px] bg-[rgba(255,255,255,0.1)] -translate-y-1/2" />
                {[0, 1, 2, 3, 4].map((dot) => (
                  <div
                    key={dot}
                    className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] -translate-y-1/2"
                    style={{ left: `${12 + dot * 21}%` }}
                  />
                ))}
                <Train className="absolute top-1/2 -translate-y-1/2 text-[var(--color-accent-strong)] h-6 w-6 animate-pulse" style={{ left: `${14 + (messageIndex % 5) * 21}%` }} />
              </div>

              <p className="text-sm text-[var(--color-text-secondary)] inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--color-accent-strong)]" />
                {messages[messageIndex]}
              </p>
            </div>

            <aside className="panel p-5 space-y-4">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Status Controls</p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                This usually finishes quickly. If needed, you can refresh the state or go back to planning.
              </p>
              <div className="space-y-2">
                <Button variant="secondary" className="w-full" onClick={() => router.refresh()}>
                  Refresh Status
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => router.push(`/rooms/${roomId}/planning`)}>
                  Return To Planning
                </Button>
              </div>

              <div className="saas-band">
                <p className="text-sm font-medium text-[var(--color-text-primary)] inline-flex items-center gap-2">
                  <Timer className="h-4 w-4 text-[var(--color-accent)]" />
                  Expected Completion
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">Around 20-30 seconds depending on room size.</p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
