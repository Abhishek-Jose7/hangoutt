import { z } from 'zod';

// ── Room Status ─────────────────────────────────────────────
export const RoomStatusEnum = z.enum([
  'lobby',
  'planning',
  'generating',
  'voting',
  'confirmed',
  'archived',
]);
export type RoomStatus = z.infer<typeof RoomStatusEnum>;

// ── Mood ────────────────────────────────────────────────────
export const MoodEnum = z.enum(['fun', 'chill', 'romantic', 'adventure']);
export type Mood = z.infer<typeof MoodEnum>;

// ── User ────────────────────────────────────────────────────
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

// ── Room ────────────────────────────────────────────────────
export const RoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  invite_code: z.string(),
  admin_id: z.string(),
  mood: MoodEnum,
  status: RoomStatusEnum,
  currency: z.string().default('INR'),
  expires_at: z.string(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Room = z.infer<typeof RoomSchema>;

// ── Room Member ─────────────────────────────────────────────
export const RoomMemberSchema = z.object({
  room_id: z.string().uuid(),
  user_id: z.string(),
  budget: z.number().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  location_name: z.string().nullable(),
  nearest_station: z.string().nullable(),
  joined_at: z.string(),
});
export type RoomMember = z.infer<typeof RoomMemberSchema>;

export type RoomMemberWithUser = RoomMember & {
  users: Pick<User, 'name' | 'avatar_url' | 'email'>;
};

// ── Itinerary Stop ──────────────────────────────────────────
export const ItineraryStopSchema = z.object({
  stop_number: z.number().int().min(1),
  place_name: z.string(),
  place_type: z.enum(['cafe', 'activity', 'restaurant', 'outdoor']),
  start_time: z.string(),
  duration_mins: z.number().int().positive(),
  estimated_cost_per_person: z.number().min(0),
  walk_from_previous_mins: z.number().min(0),
  vibe_note: z.string(),
});
export type ItineraryStop = z.infer<typeof ItineraryStopSchema>;

// ── AI Itinerary Response ───────────────────────────────────
export const AIItineraryResponseSchema = z.object({
  stops: z.array(ItineraryStopSchema).min(2).max(5),
  total_cost_per_person: z.number().min(0),
  contingency_buffer: z.number().min(0),
  day_summary: z.string(),
});
export type AIItineraryResponse = z.infer<typeof AIItineraryResponseSchema>;

// ── Itinerary Option ────────────────────────────────────────
export const ItineraryOptionSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid(),
  option_number: z.number().int().min(1).max(4),
  hub_name: z.string(),
  hub_lat: z.number(),
  hub_lng: z.number(),
  hub_strategy: z.enum([
    'geometric',
    'minimax_transit',
    'min_total_transit',
    'cultural_hub',
  ]),
  plan: AIItineraryResponseSchema,
  total_cost_estimate: z.number(),
  max_travel_time_mins: z.number().int(),
  avg_travel_time_mins: z.number().int(),
  travel_fairness_score: z.number().min(0).max(1),
  generation_method: z.enum(['ai', 'rule_based_fallback']),
  ai_model_version: z.string().nullable(),
  generated_at: z.string(),
});
export type ItineraryOption = z.infer<typeof ItineraryOptionSchema>;

// ── Vote ────────────────────────────────────────────────────
export const VoteSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid(),
  itinerary_option_id: z.string().uuid(),
  user_id: z.string(),
  created_at: z.string(),
});
export type Vote = z.infer<typeof VoteSchema>;

// ── Confirmed Itinerary ─────────────────────────────────────
export const ConfirmedItinerarySchema = z.object({
  room_id: z.string().uuid(),
  itinerary_option_id: z.string().uuid(),
  confirmed_at: z.string(),
  confirmed_by: z.string(),
});
export type ConfirmedItinerary = z.infer<typeof ConfirmedItinerarySchema>;

// ── Station ─────────────────────────────────────────────────
export const StationLineEnum = z.enum(['western', 'central', 'harbour']);
export type StationLine = z.infer<typeof StationLineEnum>;

export const StationSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  line: z.array(StationLineEnum),
  zone: z.number().int().min(1).max(3),
});
export type Station = z.infer<typeof StationSchema>;

// ── API Request Schemas ─────────────────────────────────────
export const CreateRoomRequestSchema = z.object({
  name: z.string().min(1).max(100),
  mood: MoodEnum.optional().default('fun'),
  currency: z.string().optional().default('INR'),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const UpdateMemberLocationSchema = z.object({
  budget: z.number().positive().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  location_name: z.string().optional(),
  nearest_station: z.string().optional(),
});
export type UpdateMemberLocation = z.infer<typeof UpdateMemberLocationSchema>;

export const UpdateRoomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  mood: MoodEnum.optional(),
  status: RoomStatusEnum.optional(),
});
export type UpdateRoomRequest = z.infer<typeof UpdateRoomSchema>;

export const VoteRequestSchema = z.object({
  itinerary_option_id: z.string().uuid(),
});
export type VoteRequest = z.infer<typeof VoteRequestSchema>;

export const ConfirmRequestSchema = z.object({
  itinerary_option_id: z.string().uuid(),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

// ── API Error Shape ─────────────────────────────────────────
export interface APIError {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

// ── Hub Candidate ───────────────────────────────────────────
export interface HubCandidate {
  name: string;
  lat: number;
  lng: number;
  station: string;
  strategy: 'geometric' | 'minimax_transit' | 'min_total_transit' | 'cultural_hub';
  travelTimes: number[];
  maxTravelTime: number;
  avgTravelTime: number;
  fairnessScore: number;
}

// ── Place (from Tavily or Overpass) ─────────────────────────
export interface Place {
  name: string;
  type: 'cafe' | 'activity' | 'restaurant' | 'outdoor';
  lat?: number;
  lng?: number;
  description: string;
  estimated_cost?: number;
  source: 'tavily' | 'osm_fallback';
  relevance_score: number;
  url?: string;
}

// ── Vote Count ──────────────────────────────────────────────
export interface VoteCount {
  itinerary_option_id: string;
  count: number;
}

// ── Lat/Lng ─────────────────────────────────────────────────
export interface LatLng {
  lat: number;
  lng: number;
}
