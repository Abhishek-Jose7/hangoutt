'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useCreateRoom } from '@/hooks/useRoom';
import { Sparkles, MoonStar, Heart, Compass, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { Mood } from '@/types';

const moods: { value: Mood; icon: React.ComponentType<{ className?: string }>; label: string; desc: string }[] = [
  { value: 'fun', icon: Sparkles, label: 'Fun', desc: 'Lively & social' },
  { value: 'chill', icon: MoonStar, label: 'Chill', desc: 'Relaxed pace' },
  { value: 'romantic', icon: Heart, label: 'Romantic', desc: 'Intimate' },
  { value: 'adventure', icon: Compass, label: 'Adventure', desc: 'Explore' },
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
      setError('Give your hangout a name');
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
    <div className="flex-1 flex flex-col justify-center items-center p-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[640px] z-10"
      >
        <div className="text-center mb-6">
          <h1 className="display-text text-3xl font-bold mb-2">Create Room</h1>
          <p className="text-[var(--color-text-secondary)] text-sm">
            Configure your space and invite the group.
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="room-name" className="block text-[13px] font-semibold mb-2 text-center">
                Room Name
              </label>
              <input
                id="room-name"
                type="text"
                placeholder="Saturday Brunch Squad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                className="input text-center text-lg h-12 w-full bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold mb-3 text-center">Select Mood</label>
              <div className="grid grid-cols-2 gap-3">
                {moods.map((m) => {
                  const Icon = m.icon;
                  const isSelected = mood === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMood(m.value)}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-[var(--color-accent-glow)] border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-muted)]'
                          : 'bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-elevated)]'
                      }`}
                    >
                      <Icon className={`h-6 w-6 mb-2 ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`} />
                      <span className="font-semibold text-sm mb-1">{m.label}</span>
                      <span className="text-[11px] text-[var(--color-text-tertiary)]">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="p-3 text-center rounded-xl bg-[rgba(248,113,113,0.1)] border border-[rgba(248,113,113,0.2)] text-[#f87171] text-[13px]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={createRoom.isPending}
              className="btn-primary w-full h-12 text-base font-bold shadow-lg"
            >
              {createRoom.isPending ? 'Creating...' : (
                <>
                  <Plus className="h-5 w-5 mr-1" /> Create Hangout Room
                </>
              )}
            </button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
