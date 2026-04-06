'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useRoom } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/lib/realtime';
import { useRoomStore } from '@/store/useRoomStore';
import { WebsiteHero, WebsitePage } from '@/components/site/WebsiteLayout';

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
      <WebsitePage>
          <WebsiteHero className="text-center">
            <div className="relative z-[1] w-full">
              <span className="section-kicker">Room Handshake</span>
              <h1 className="saas-title mt-4">Routing To The Right Stage</h1>
              <p className="saas-lead mx-auto mt-3">
                We are checking room status and sending you to the correct workflow state.
              </p>
              <div className="mt-8 h-2 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
                <div className="h-full bg-[var(--color-accent)] animate-pulse" />
              </div>
            </div>
          </WebsiteHero>
      </WebsitePage>
    );
  }

  return null;
}
