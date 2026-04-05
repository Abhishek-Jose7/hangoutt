'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, Timer, Train } from 'lucide-react';
import { useRoom } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { Card } from '@/components/ui/Card';

const messages = [
  'Finding the best spots near you...',
  'Calculating fair travel times...',
  'Matching places to your vibe...',
  'Building your perfect day...',
  'Almost there...',
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
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll for itinerary generation status (backup path to Realtime)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/itineraries`);
        const data = await res.json();

        if (res.status === 202 && data?.status === 'generating') {
          return;
        }

        if (res.ok && Array.isArray(data) && data.length > 0) {
          useRoomStore.getState().setStatus('voting');
        }
      } catch {
        // silent
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [roomId]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 hero-gradient mesh-gradient">
      <Card className="w-full max-w-[560px] p-8 sm:p-10 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] mb-6">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" /> AI itinerary generation in progress
        </div>

        {/* Animated Train Line */}
        <div className="relative mx-auto w-64 h-20 mb-10">
          {/* Line */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-[var(--color-border-default)] -translate-y-1/2" />

          {/* Station Dots */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 w-3 h-3 rounded-full bg-[var(--color-accent)]"
              style={{
                left: `${i * 20}%`,
                transform: 'translate(-50%, -50%)',
              }}
              animate={{
                scale: [0.8, 1.3, 0.8],
                opacity: [0.3, 1, 0.3],
              }}
              transition={{
                duration: 1.5,
                delay: i * 0.25,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}

          {/* Moving Train */}
          <motion.div
            className="absolute top-1/2 -translate-y-1/2"
            animate={{ x: [-10, 240, -10] }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <Train className="h-6 w-6 text-[var(--color-accent)]" />
          </motion.div>
        </div>

        <motion.h2
          className="display-text text-2xl mb-4"
          key={messageIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
        >
          {messages[messageIndex]}
        </motion.h2>

        <p className="text-sm text-[var(--color-text-tertiary)] inline-flex items-center gap-2">
          <Timer className="h-4 w-4" /> This usually takes about 20 seconds
        </p>
      </Card>
    </div>
  );
}
