import { type Experience } from '../repositories/experience.repository';

export type VenueCategory =
  | 'CAFE'
  | 'RESTAURANT'
  | 'PARK'
  | 'ARCADE'
  | 'BOWLING'
  | 'ESCAPE_ROOM'
  | 'MOVIE'
  | 'MALL'
  | 'DESSERT'
  | 'SPORTS'
  | 'MUSEUM';

export interface Venue {
  id: string;
  name: string;
  category: VenueCategory;
  rating: number;
  distanceKm: number;
  estimatedCostPerHead: number;
  openNow: boolean;
  address: string;
}

export interface ItinerarySlot {
  order: number;
  venueId: string | null;
  experienceId?: string | null; // Optional
  venueName: string | null; // Restored for frontend compatibility
  name?: string; // Optional
  category: string;
  arrivalTime: string;
  durationMinutes: number;
  travelToNextMinutes: number | null;
  estimatedCostPerHead: number;
  note: string;
}

export interface GeneratedItinerary {
  id: string;
  name: string;
  tagline: string;
  budgetTier?: 'BUDGET_FRIENDLY' | 'BALANCED' | 'PREMIUM'; // Optional for mock data compatibility
  totalEstimatedCostPerHead: number;
  totalDurationMinutes: number;
  slots: ItinerarySlot[];
}

export interface ItineraryResponse {
  itineraries: GeneratedItinerary[];
}

export interface ItineraryPromptContext {
  groupName: string;
  groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM';
  vibes: string[];
  memberCount: number;
  groupMinBudget: number;
  groupAvgBudget: number;
  groupMaxBudget: number;
  preferredCategories: string[];
  midpointAddress: string;
  venues: Venue[];
  experiences: (Experience & { distanceKm: number })[];
}
