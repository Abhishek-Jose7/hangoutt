'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { motion } from 'framer-motion';
import { useCreateRoom } from '@/hooks/useRoom';
import { Sparkles, MoonStar, Heart, Compass, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Mood } from '@/types';

const moods: { value: Mood; icon: React.ComponentType<{ className?: string }>; label: string; desc: string }[] = [
  { value: 'fun', icon: Sparkles, label: 'Fun', desc: 'Lively and social' },
  { value: 'chill', icon: MoonStar, label: 'Chill', desc: 'Relaxed pace' },
  { value: 'romantic', icon: Heart, label: 'Romantic', desc: 'Intimate setting' },
  { value: 'adventure', icon: Compass, label: 'Adventure', desc: 'Explore together' },
];

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

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
    <div className="min-h-screen">
      <Navbar />

      <main className="container-base section-base">
        <motion.form
          onSubmit={handleSubmit}
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          className="max-w-[760px] mx-auto space-y-6"
        >
          <motion.div variants={fadeInUp} className="text-center card p-6">
            <h1 className="display-text text-[36px] sm:text-[44px] mb-2">Create New Room</h1>
            <p className="text-[var(--color-text-secondary)] text-[15px]">
              Configure your room and invite your group to start planning.
            </p>
          </motion.div>

          <Card className="p-6 sm:p-8 space-y-6">
            {/* Room Name */}
            <motion.div variants={fadeInUp}>
              <label htmlFor="room-name" className="block text-sm font-medium mb-2">
                Room Name
              </label>
              <Input
                id="room-name"
                type="text"
                placeholder="Saturday Brunch Squad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </motion.div>

            {/* Mood Selector */}
            <motion.div variants={fadeInUp}>
              <label className="block text-sm font-medium mb-3">Mood</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {moods.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMood(m.value)}
                      className={`h-[82px] rounded-xl border px-4 text-left transition-all flex items-center gap-3 ${
                        mood === m.value
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-glow)] shadow-[0_0_0_2px_var(--color-accent-muted)]'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)]'
                      }`}
                      id={`mood-${m.value}`}
                    >
                      <span className="w-9 h-9 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                        <Icon className="h-4 w-4 text-[var(--color-accent)]" />
                      </span>
                      <span>
                        <span className="block font-semibold text-sm text-[var(--color-text-primary)]">{m.label}</span>
                        <span className="block text-xs text-[var(--color-text-secondary)]">{m.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {error ? (
              <motion.div
                variants={fadeInUp}
                className="p-3 rounded-xl bg-[rgba(248,113,113,0.12)] border border-[rgba(248,113,113,0.25)] text-[var(--color-danger)] text-sm"
              >
                {error}
              </motion.div>
            ) : null}

            <motion.div variants={fadeInUp}>
              <Button
                type="submit"
                className="w-full"
                loading={createRoom.isPending}
                icon={!createRoom.isPending ? <Plus className="h-4 w-4" /> : null}
                id="create-room-submit"
              >
                {createRoom.isPending ? 'Creating Room...' : 'Create Room'}
              </Button>
            </motion.div>
          </Card>
        </motion.form>
      </main>
    </div>
  );
}
