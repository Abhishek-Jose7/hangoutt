'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Navbar } from '@/components/layout/Navbar';
import { useUserRooms } from '@/hooks/useRoom';
import type { Room } from '@/types';

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

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function DashboardPage() {
  const router = useRouter();
  const { data: rooms, isLoading } = useUserRooms();

  return (
    <div className="min-h-screen">
      <Navbar
        rightContent={
          <Link href="/rooms/create" className="btn-primary py-2 px-5 text-sm h-10 shadow-none">
            + Initialize Room
          </Link>
        }
      />

      {/* Content */}
      <main className="container-base section-base">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
          className="space-y-6"
        >
          <motion.div variants={fadeInUp} className="card p-6">
            <h1 className="display-text text-3xl mb-2">Your Rooms</h1>
            <p className="text-[var(--color-text-secondary)]">
              Manage active and past hangout sessions in one place.
            </p>
          </motion.div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="card p-6 animate-pulse"
                >
                  <div className="h-5 bg-[var(--color-bg-subtle)] rounded w-1/2 mb-3" />
                  <div className="h-4 bg-[var(--color-bg-subtle)] rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : !rooms || rooms.length === 0 ? (
            <motion.div
              variants={fadeInUp}
              className="card p-12 text-center"
            >
              <div className="text-5xl mb-4">🎯</div>
              <h3 className="text-lg font-semibold mb-2">
                No rooms yet
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                Create a room and invite your friends to start planning
              </p>
              <Link href="/rooms/create" className="btn-primary">
                Create Your First Room
              </Link>
            </motion.div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {(rooms as Room[]).map((room, i) => (
                <motion.div
                  key={room.id}
                  variants={fadeInUp}
                  custom={i}
                  className="card p-6 cursor-pointer h-full"
                  onClick={() => router.push(`/rooms/${room.id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-lg">{room.name}</h3>
                    <span className={`badge ${statusColors[room.status] || 'badge-info'}`}>
                      {statusLabels[room.status] || room.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                    <span className="capitalize">🎭 {room.mood}</span>
                    <span>💰 {room.currency}</span>
                    <span>
                      🕐 {new Date(room.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Join via code */}
          <motion.div
            variants={fadeInUp}
            className="card p-6 flex flex-col sm:flex-row items-center gap-4"
          >
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Have an invite code?</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Enter the code to join a friend&apos;s room
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const code = (form.elements.namedItem('code') as HTMLInputElement).value;
                if (code.trim()) router.push(`/rooms/join/${code.trim()}`);
              }}
              className="flex gap-2 w-full sm:w-auto"
            >
              <input
                name="code"
                type="text"
                placeholder="Enter invite code"
                className="input w-48"
                maxLength={10}
                id="invite-code-input"
              />
              <button type="submit" className="btn-primary py-2.5" id="join-room-btn">
                Join
              </button>
            </form>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
