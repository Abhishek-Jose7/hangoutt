'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, CircleDot, Compass, RefreshCcw, Users } from 'lucide-react';
import { useUserRooms } from '@/hooks/useRoom';
import type { Room } from '@/types';
import { WebsiteHero, WebsitePage, WebsiteSection } from '@/components/site/WebsiteLayout';

interface LocalEvent {
  id: string;
  title: string;
  subtitle?: string;
  dateText: string;
  category: string;
  kind?: 'event' | 'movie' | 'activity';
  imageUrl?: string;
  sourceUrl?: string;
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

  const typedRooms = useMemo(() => (rooms as Room[] | undefined) || [], [rooms]);
  const activeRooms = useMemo(() => typedRooms.filter((r) => r.status !== 'archived'), [typedRooms]);
  const confirmedRooms = useMemo(() => typedRooms.filter((r) => r.status === 'confirmed'), [typedRooms]);

  return (
    <WebsitePage>
      <WebsiteHero>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 relative z-[1]">
            <div className="space-y-3">
              <span className="section-kicker">Operations Dashboard</span>
              <h1 className="saas-title">Rooms, Events, And Decisions</h1>
              <p className="saas-lead">
                Manage your active planning rooms, monitor readiness, and jump into any flow from a single control surface.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <Link href="/rooms/create" className="btn-primary sm:min-w-[190px] text-center">Create Room</Link>
              <button
                type="button"
                onClick={() => void refreshEvents()}
                className="btn-secondary sm:min-w-[190px]"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh Feed
              </button>
            </div>
          </div>
      </WebsiteHero>

      <WebsiteSection className="saas-grid-4">
          <div className="saas-kpi">
            <p className="saas-kpi-label">Total Rooms</p>
            <p className="saas-kpi-value">{typedRooms.length}</p>
          </div>
          <div className="saas-kpi">
            <p className="saas-kpi-label">Active Rooms</p>
            <p className="saas-kpi-value">{activeRooms.length}</p>
          </div>
          <div className="saas-kpi">
            <p className="saas-kpi-label">Confirmed Plans</p>
            <p className="saas-kpi-value">{confirmedRooms.length}</p>
          </div>
          <div className="saas-kpi">
            <p className="saas-kpi-label">Event Signals</p>
            <p className="saas-kpi-value">{eventsData?.events?.length || 0}</p>
          </div>
      </WebsiteSection>

      <WebsiteSection className="saas-grid-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Local Event Feed</p>
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mt-1">
                  {eventsData?.area || 'Mumbai'} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">{eventsData?.date || 'Today'}</span>
                </h2>
              </div>
              <button type="button" className="btn-secondary h-[40px] px-4" onClick={() => void refreshEvents()}>
                <RefreshCcw className="h-4 w-4" />
                Reload
              </button>
            </div>

            <div className="panel p-5">
              {eventsLoading && !eventsData ? (
                <div className="space-y-2">
                  <div className="h-14 rounded-xl skeleton" />
                  <div className="h-14 rounded-xl skeleton" />
                  <div className="h-14 rounded-xl skeleton" />
                </div>
              ) : eventsError && !eventsData ? (
                <div className="saas-band">
                  <p className="text-sm text-[var(--color-danger)]">{eventsError}</p>
                </div>
              ) : (
                <div className="saas-list">
                  {(eventsData?.events || []).map((event, idx) => (
                    <article key={event.id || `${event.title}-${idx}`} className="saas-list-item">
                      <div className="flex gap-3 items-start">
                        <div className="w-28 h-16 rounded-lg overflow-hidden border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.03)] shrink-0">
                          {event.imageUrl ? (
                            <img
                              src={event.imageUrl}
                              alt={event.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                              No Poster
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{event.title}</p>
                            <span className="badge badge-info">{event.category}</span>
                          </div>
                          <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">
                            {event.subtitle || 'Trending now in your area'}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-[var(--color-text-tertiary)]">{event.dateText}</p>
                            {event.sourceUrl ? (
                              <a
                                href={event.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-[var(--color-accent-strong)] hover:text-[var(--color-accent)]"
                              >
                                Open
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!eventsData?.events?.length ? (
                    <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">No event feed available right now.</div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Quick Join</p>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">Enter an invite code to jump directly into a room.</p>
            </div>

            <div className="panel p-5 space-y-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const code = (form.elements.namedItem('code') as HTMLInputElement).value;
                  if (code.trim()) router.push(`/rooms/join/${code.trim()}`);
                }}
                className="space-y-3"
              >
                <input
                  name="code"
                  type="text"
                  placeholder="Invite code"
                  className="input"
                  maxLength={10}
                />
                <button type="submit" className="btn-primary w-full">Join Room</button>
              </form>

              <div className="saas-band">
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-3">Status Legend</p>
                <div className="flex flex-wrap gap-2">
                  <span className="badge badge-info">Waiting</span>
                  <span className="badge badge-warning">Planning</span>
                  <span className="badge badge-accent">Voting</span>
                  <span className="badge badge-success">Confirmed</span>
                </div>
              </div>
            </div>
          </aside>
      </WebsiteSection>

      <WebsiteSection className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Workspace Rooms</p>
              <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mt-1">Room Directory</h2>
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)] inline-flex items-center gap-2">
              <Users className="h-3.5 w-3.5" />
              Live Status Tracking
            </div>
          </div>

          <div className="panel p-5">
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-12 rounded-xl skeleton" />
                <div className="h-12 rounded-xl skeleton" />
                <div className="h-12 rounded-xl skeleton" />
              </div>
            ) : typedRooms.length === 0 ? (
              <div className="saas-band text-center py-10">
                <p className="text-lg font-semibold text-[var(--color-text-primary)]">No rooms yet</p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">Create your first room to start collaborative planning.</p>
              </div>
            ) : (
              <div className="saas-table">
                {typedRooms.map((room) => (
                  <button
                    type="button"
                    key={room.id}
                    onClick={() => router.push(`/rooms/${room.id}`)}
                    className="saas-row text-left w-full"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{room.name}</p>
                      <p className="text-xs text-[var(--color-text-tertiary)] mt-1 inline-flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {new Date(room.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)] uppercase tracking-[0.12em] inline-flex items-center gap-1">
                      <Compass className="h-3.5 w-3.5" />
                      {room.mood}
                    </div>
                    <div>
                      <span className={`badge ${statusColors[room.status] || 'badge-info'}`}>
                        {statusLabels[room.status] || room.status}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--color-text-tertiary)] inline-flex items-center gap-1">
                      <CircleDot className="h-3 w-3" />
                      {room.currency}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
      </WebsiteSection>
    </WebsitePage>
  );
}
