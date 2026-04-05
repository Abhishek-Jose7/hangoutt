'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useUserRooms } from '@/hooks/useRoom';
import type { Room } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface LocalEvent {
  title: string;
  venue: string;
  dateText: string;
  category: string;
}

const statusColors: Record<string, string> = {
  lobby: 'badge-info',
  planning: 'badge-warning',
  generating: 'badge-accent',
  voting: 'badge-accent',
  confirmed: 'badge-success',
  archived: 'badge-danger',
};

const statusLabels: Record<string, string> = {
  lobby: 'Waiting',
  planning: 'Planning',
  generating: 'Generating',
  voting: 'Voting',
  confirmed: 'Confirmed',
  archived: 'Archived',
};

export default function DashboardPage() {
  const router = useRouter();
  const { data: rooms, isLoading } = useUserRooms();
  const [eventsData, setEventsData] = useState<{ area: string; date: string; events: LocalEvent[] } | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');

  const refreshEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      setEventsError('');
      const res = await fetch('/api/events/local');
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || 'Failed to fetch events');
      }
      const data = await res.json();
      setEventsData(data);
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[800px] z-10 space-y-6"
      >
        <div className="text-center mb-8">
          <h1 className="display-text text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-[var(--color-text-secondary)] text-sm">
            Manage your past and active hangout rooms centrally.
          </p>
        </div>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="font-semibold text-lg">Top Events Near You</h2>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {eventsData?.area || 'Mumbai'} • {eventsData?.date || 'Today'}
              </p>
            </div>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => void refreshEvents()} loading={eventsLoading}>
              Refresh
            </Button>
          </div>

          {eventsLoading && !eventsData ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : eventsError && !eventsData ? (
            <div className="py-6 border border-dashed border-[var(--color-border-strong)] rounded-xl text-center bg-[var(--color-bg-base)] space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">{eventsError}</p>
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => void refreshEvents()}>
                Try again
              </Button>
            </div>
          ) : !eventsData?.events?.length ? (
            <div className="py-6 border border-dashed border-[var(--color-border-strong)] rounded-xl text-center bg-[var(--color-bg-base)]">
              <p className="text-sm text-[var(--color-text-secondary)]">No event feed available right now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {eventsError ? (
                <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[var(--color-warning)] flex items-center justify-between gap-3">
                  <span>{eventsError}</span>
                  <Button variant="secondary" className="h-8 px-3 text-[11px]" onClick={() => void refreshEvents()}>
                    Retry
                  </Button>
                </div>
              ) : null}
              <div className="space-y-2">
                {eventsData.events.map((event, idx) => (
                  <div key={`${event.title}-${idx}`} className="p-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{event.title}</p>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">{event.category}</span>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 truncate">{event.venue}</p>
                    <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{event.dateText}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            <h2 className="font-semibold text-lg">Your Rooms</h2>
            <Link href="/rooms/create" className="btn-primary py-2 px-4 h-9 text-xs">
              + New Room
            </Link>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              [1, 2].map((i) => (
                <div key={i} className="h-16 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl animate-pulse" />
              ))
            ) : !rooms || rooms.length === 0 ? (
              <div className="py-12 border border-dashed border-[var(--color-border-strong)] rounded-xl text-center bg-[var(--color-bg-base)]">
                <span className="text-3xl mb-3 block">🎯</span>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">No rooms active</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">Start by creating a new hangout room</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(rooms as Room[]).map((room) => (
                  <div
                    key={room.id}
                    onClick={() => router.push(`/rooms/${room.id}`)}
                    className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] hover:border-[var(--color-border-strong)] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-[15px] truncate max-w-[150px]">{room.name}</h3>
                      <span className={`badge ${statusColors[room.status] || 'badge-info'}`}>
                        {statusLabels[room.status] || room.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-mono">
                      <span>{room.mood}</span>
                      <span>•</span>
                      <span>{room.currency}</span>
                      <span>•</span>
                      <span>{new Date(room.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const code = (form.elements.namedItem('code') as HTMLInputElement).value;
              if (code.trim()) router.push(`/rooms/join/${code.trim()}`);
            }}
            className="flex flex-col sm:flex-row items-center gap-3"
          >
            <div className="flex-1 w-full text-center sm:text-left">
              <h3 className="font-semibold text-sm mb-1">Join a Room</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">Enter an invite code to join.</p>
            </div>
            <div className="flex w-full sm:w-auto gap-2">
              <input
                name="code"
                type="text"
                placeholder="Code"
                className="input w-full sm:w-[140px] text-center sm:text-left"
                maxLength={10}
              />
              <button type="submit" className="btn-secondary px-4">
                Join
              </button>
            </div>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
