'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ── Room Hooks ──────────────────────────────────────────────

const ROOM_REFETCH_MS = 5000;

async function fetchRoomData(roomId: string) {
  const res = await fetch(`/api/rooms/${roomId}`);
  if (!res.ok) throw new Error('Failed to fetch room');
  return res.json();
}

export function useRoom(roomId: string | undefined) {
  return useQuery({
    queryKey: ['room', roomId],
    queryFn: () => fetchRoomData(roomId as string),
    enabled: !!roomId,
    refetchInterval: ROOM_REFETCH_MS,
  });
}

export function useRoomMembers(roomId: string | undefined) {
  return useQuery({
    queryKey: ['room', roomId],
    queryFn: () => fetchRoomData(roomId as string),
    select: (data) => data.members || [],
    enabled: !!roomId,
    refetchInterval: ROOM_REFETCH_MS,
  });
}

export function useItineraries(roomId: string | undefined) {
  return useQuery({
    queryKey: ['room', roomId, 'itineraries'],
    queryFn: async () => {
      const res = await fetch(`/api/rooms/${roomId}/itineraries`);
      if (!res.ok) throw new Error('Failed to fetch itineraries');
      return res.json();
    },
    enabled: !!roomId,
  });
}

export function useVotes(roomId: string | undefined) {
  return useQuery({
    queryKey: ['room', roomId, 'votes'],
    queryFn: async () => {
      const res = await fetch(`/api/rooms/${roomId}/votes`);
      if (!res.ok) throw new Error('Failed to fetch votes');
      return res.json();
    },
    enabled: !!roomId,
    refetchInterval: 3000,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; mood?: string; currency?: string }) => {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to create room');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

export function useJoinRoom() {
  return useMutation({
    mutationFn: async (data: {
      roomId: string;
      budget: number;
      lat: number;
      lng: number;
      location_name: string;
      nearest_station: string;
      display_name: string;
    }) => {
      const res = await fetch(`/api/rooms/${data.roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget: data.budget,
          lat: data.lat,
          lng: data.lng,
          location_name: data.location_name,
          nearest_station: data.nearest_station,
          display_name: data.display_name,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to join room');
      }
      return res.json();
    },
  });
}

export function useUpdateMemberInfo(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      budget?: number;
      lat?: number;
      lng?: number;
      location_name?: string;
      nearest_station?: string;
    }) => {
      const res = await fetch(`/api/rooms/${roomId}/members/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to update info');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['room', roomId, 'members'] });
    },
  });
}

export function useStartPlanning(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rooms/${roomId}/start-planning`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to start planning');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId] });
    },
  });
}

export function useGenerateItineraries(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data?: { meetup_start_time?: string }) => {
      const res = await fetch(`/api/rooms/${roomId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to generate');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['room', roomId, 'itineraries'] });
    },
  });
}

export function useCastVote(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itineraryOptionId: string) => {
      const res = await fetch(`/api/rooms/${roomId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary_option_id: itineraryOptionId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to vote');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId, 'votes'] });
    },
  });
}

export function useConfirmItinerary(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itineraryOptionId: string) => {
      const res = await fetch(`/api/rooms/${roomId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary_option_id: itineraryOptionId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to confirm');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId] });
    },
  });
}

export function useRemoveMember(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberUserId: string) => {
      const res = await fetch(`/api/rooms/${roomId}/members/${memberUserId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to remove member');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId] });
      queryClient.invalidateQueries({ queryKey: ['room', roomId, 'members'] });
    },
  });
}

export function useUserRooms() {
  return useQuery({
    queryKey: ['rooms'],
    queryFn: async () => {
      const res = await fetch('/api/rooms');
      if (!res.ok) throw new Error('Failed to fetch rooms');
      return res.json();
    },
  });
}
