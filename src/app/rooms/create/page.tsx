'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, Heart, MoonStar, Sparkles } from 'lucide-react';
import { useCreateRoom } from '@/hooks/useRoom';
import type { Mood } from '@/types';
import { WebsiteHero, WebsitePage } from '@/components/site/WebsiteLayout';

const moods: { value: Mood; icon: React.ComponentType<{ className?: string }>; label: string; desc: string }[] = [
  { value: 'fun', icon: Sparkles, label: 'Fun', desc: 'Lively social energy' },
  { value: 'chill', icon: MoonStar, label: 'Chill', desc: 'Slow and relaxed pace' },
  { value: 'romantic', icon: Heart, label: 'Romantic', desc: 'Intimate and cozy' },
  { value: 'adventure', icon: Compass, label: 'Adventure', desc: 'Explore new places' },
];

export default function CreateRoomPage() {
  const router = useRouter();
  const createRoom = useCreateRoom();
  const [name, setName] = useState('');
  const [mood, setMood] = useState<Mood>('fun');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give your room a clear name.');
      return;
    }

    setError('');
    try {
      const room = await createRoom.mutateAsync({ name: name.trim(), mood });
      router.push(`/rooms/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    }
  };

  return (
    <WebsitePage>
      <WebsiteHero>
          <div className="saas-grid-2 relative z-[1]">
            <div className="space-y-4">
              <span className="section-kicker">New Planning Room</span>
              <h1 className="saas-title">Create A Structured Planning Space</h1>
              <p className="saas-lead">
                Name the room, set the mood, and generate a share link for your group. Everything else flows through the same controlled process.
              </p>

              <div className="saas-list">
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Step 1: Define room identity.</div>
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Step 2: Set mood profile.</div>
                <div className="saas-list-item text-sm text-[var(--color-text-secondary)]">Step 3: Invite and collect member constraints.</div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="panel p-6 space-y-6">
              <div>
                <label htmlFor="room-name" className="block text-sm font-semibold mb-2">Room Name</label>
                <input
                  id="room-name"
                  type="text"
                  placeholder="Saturday City Crew"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  className="input"
                  autoFocus
                />
              </div>

              <div>
                <p className="block text-sm font-semibold mb-2">Mood Profile</p>
                <div className="grid grid-cols-2 gap-3">
                  {moods.map((entry) => {
                    const Icon = entry.icon;
                    const active = mood === entry.value;
                    return (
                      <button
                        key={entry.value}
                        type="button"
                        onClick={() => setMood(entry.value)}
                        className={`rounded-xl border p-4 text-left transition-all ${
                          active
                            ? 'border-[var(--color-accent)] bg-[rgba(220,20,60,0.16)]'
                            : 'border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)] hover:border-[var(--color-border-default)]'
                        }`}
                      >
                        <Icon className="h-5 w-5 mb-2 text-[var(--color-accent-strong)]" />
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{entry.label}</p>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{entry.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

              <button type="submit" className="btn-primary w-full" disabled={createRoom.isPending}>
                {createRoom.isPending ? 'Creating room...' : 'Create Room'}
              </button>
            </form>
          </div>
      </WebsiteHero>
    </WebsitePage>
  );
}
