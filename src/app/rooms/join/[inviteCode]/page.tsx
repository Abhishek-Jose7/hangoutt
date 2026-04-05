'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function JoinRoomPage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.inviteCode as string;
  const [status, setStatus] = useState<'loading' | 'preview' | 'joining' | 'error'>('loading');
  const [roomPreview, setRoomPreview] = useState<{ id: string; name: string; mood: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function lookupRoom() {
      try {
        const res = await fetch(`/api/rooms/${inviteCode}/preview`);
        if (!res.ok) {
          const err = await res.json();
          setError(err.error?.message || 'Room not found');
          setStatus('error');
          return;
        }
        const data = await res.json();
        setRoomPreview(data);
        setStatus('preview');
      } catch {
        setError('Failed to look up room');
        setStatus('error');
      }
    }
    lookupRoom();
  }, [inviteCode]);

  const handleJoin = async () => {
    if (!roomPreview) return;
    setStatus('joining');
    try {
      const res = await fetch(`/api/rooms/${roomPreview.id}/join`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error?.message || 'Failed to join');
        setStatus('error');
        return;
      }
      router.push(`/rooms/${roomPreview.id}`);
    } catch {
      setError('Failed to join room');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen hero-gradient">
      <motion.div
        className="container-base section-base max-w-[760px]"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >
        <Card className="p-10 w-full max-w-md text-center mx-auto">
          {status === 'loading' && (
            <motion.div variants={fadeInUp}>
              <div className="text-4xl mb-4 animate-pulse-station">🔍</div>
              <p className="text-[var(--color-text-secondary)]">Looking up room...</p>
            </motion.div>
          )}

          {status === 'preview' && roomPreview && (
            <>
              <motion.div variants={fadeInUp} className="text-4xl mb-4">🎉</motion.div>
              <motion.h2 variants={fadeInUp} className="display-text text-2xl mb-2">
                {roomPreview.name}
              </motion.h2>
              <motion.p variants={fadeInUp} className="text-[var(--color-text-secondary)] mb-6">
                <span className="capitalize">{roomPreview.mood}</span> hangout
              </motion.p>
              <motion.div variants={fadeInUp}>
                <Button onClick={handleJoin} className="w-full" id="confirm-join-btn">
                  Join This Room
                </Button>
              </motion.div>
            </>
          )}

          {status === 'joining' && (
            <motion.div variants={fadeInUp}>
              <div className="text-4xl mb-4 animate-pulse-station">🚀</div>
              <p className="text-[var(--color-text-secondary)]">Joining room...</p>
            </motion.div>
          )}

          {status === 'error' && (
            <>
              <motion.div variants={fadeInUp} className="text-4xl mb-4">😬</motion.div>
              <motion.p variants={fadeInUp} className="text-[var(--color-danger)] mb-6">
                {error}
              </motion.p>
              <motion.div variants={fadeInUp}>
                <Link href="/dashboard" className="btn-secondary">
                  Back to Dashboard
                </Link>
              </motion.div>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
