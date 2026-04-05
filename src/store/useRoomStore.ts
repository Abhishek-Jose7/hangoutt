'use client';

import { create } from 'zustand';
import type { RoomStatus, Mood, Room } from '@/types';

interface RoomState {
  room: Room | null;
  status: RoomStatus;
  mood: Mood;
  isAdmin: boolean;
  
  setRoom: (room: Room | null) => void;
  setStatus: (status: RoomStatus) => void;
  setMood: (mood: Mood) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  room: null,
  status: 'lobby',
  mood: 'fun',
  isAdmin: false,

  setRoom: (room) =>
    set({
      room,
      status: room?.status ?? 'lobby',
      mood: (room?.mood as Mood) ?? 'fun',
    }),
  setStatus: (status) => set({ status }),
  setMood: (mood) => set({ mood }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  reset: () =>
    set({
      room: null,
      status: 'lobby',
      mood: 'fun',
      isAdmin: false,
    }),
}));
