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
  venueId: string;
  venueName: string;
  category: VenueCategory;
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
  memberCount: number;
  groupMinBudget: number;
  groupAvgBudget: number;
  preferredCategories: VenueCategory[];
  midpointAddress: string;
  venues: Venue[];
}
