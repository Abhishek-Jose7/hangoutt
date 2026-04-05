'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useRoom } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';

export default function RoomEntryPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = params.id as string;
  const { data: room, isLoading } = useRoom(roomId);
  const status = useRoomStore((s) => s.status);
  const setRoom = useRoomStore((s) => s.setRoom);
  const setIsAdmin = useRoomStore((s) => s.setIsAdmin);

  useRoomRealtime(roomId);

  useEffect(() => {
    if (room) {
      setRoom(room);
      setIsAdmin(room.is_admin);
    }
  }, [room, setRoom, setIsAdmin]);

  useEffect(() => {
    if (!room) return;

    const currentStatus = room.status || status;
    const path = `/rooms/${roomId}`;

    switch (currentStatus) {
      case 'lobby':
        router.replace(`${path}/lobby`);
        break;
      case 'planning':
        router.replace(`${path}/planning`);
        break;
      case 'generating':
        router.replace(`${path}/generating`);
        break;
      case 'voting':
        router.replace(`${path}/voting`);
        break;
      case 'confirmed':
        router.replace(`${path}/confirmed`);
        break;
      default:
        router.replace(`${path}/lobby`);
    }
  }, [room, status, roomId, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen hero-gradient">
        <div className="container-base section-base max-w-[760px]">
          <div className="card max-w-md mx-auto p-10 text-center">
            <div className="text-4xl animate-pulse-station mb-4">⚡</div>
            <p className="text-[var(--color-text-secondary)]">Loading room...</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
