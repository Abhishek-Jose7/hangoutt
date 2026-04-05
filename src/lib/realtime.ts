'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useRoomStore } from '@/store/useRoomStore';
import type { RoomStatus } from '@/types';

export function useRoomRealtime(roomId: string | undefined) {
  const queryClient = useQueryClient();
  const setStatus = useRoomStore((s) => s.setStatus);

  useEffect(() => {
    if (!roomId) return;

    // 1. New member joins
    const membersChannel = supabaseBrowser
      .channel(`room:${roomId}:members`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['room', roomId, 'members'] });
        }
      )
      .subscribe();

    // 2. Member updates location/budget
    const memberUpdatesChannel = supabaseBrowser
      .channel(`room:${roomId}:member-updates`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['room', roomId, 'members'] });
        }
      )
      .subscribe();

    // 3. Room status changes
    const statusChannel = supabaseBrowser
      .channel(`room:${roomId}:status`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const newStatus = (payload.new as { status: RoomStatus }).status;
          setStatus(newStatus);
          queryClient.invalidateQueries({ queryKey: ['room', roomId] });
        }
      )
      .subscribe();

    // 4. New itinerary options
    const itinerariesChannel = supabaseBrowser
      .channel(`room:${roomId}:itineraries`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'itinerary_options',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['room', roomId, 'itineraries'] });
        }
      )
      .subscribe();

    // 5. Votes
    const votesChannel = supabaseBrowser
      .channel(`room:${roomId}:votes`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['room', roomId, 'votes'] });
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(membersChannel);
      supabaseBrowser.removeChannel(memberUpdatesChannel);
      supabaseBrowser.removeChannel(statusChannel);
      supabaseBrowser.removeChannel(itinerariesChannel);
      supabaseBrowser.removeChannel(votesChannel);
    };
  }, [roomId, queryClient, setStatus]);
}
