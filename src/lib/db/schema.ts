import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// 1. Users Table (synced from Clerk)
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  preferredBudgetMin: integer('preferred_budget_min').default(0),
  preferredBudgetMax: integer('preferred_budget_max').default(100000),
  favoriteActivities: text('favorite_activities'), // Comma-separated or JSON list of VenueCategory enums
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 2. Groups Table
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull(),
  description: text('description'),
  groupType: text('group_type').notNull(), // Enum: FRIENDS | DATE | FAMILY | WORK | CUSTOM
  vibes: text('vibes'), // JSON array of selected outing vibes (e.g. ["CHILL", "CREATIVE"])
  creatorId: text('creator_id')
    .notNull()
    .references(() => users.id),
  inviteCode: text('invite_code').notNull().unique(), // 8 characters
  status: text('status').default('CREATED').notNull(), // Enum: CREATED | COLLECTING_DETAILS | READY_TO_GENERATE | GENERATING | VOTING | COMPLETED | ARCHIVED
  votingStatus: text('voting_status').default('CLOSED').notNull(), // Enum: OPEN | CLOSED
  maxMembers: integer('max_members').default(20).notNull(),
  winningPlanId: text('winning_plan_id'),
  outingDate: text('outing_date'), // e.g. "2026-06-15"
  outingTime: text('outing_time'), // e.g. "18:00"
  isFastTrack: integer('is_fast_track').default(0).notNull(), // 0 = normal, 1 = 30s timers
  timerExpiresAt: text('timer_expires_at'), // ISO timestamp when current phase timer expires
  generationOptions: text('generation_options'), // JSON string list of selected options for Generate Again
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 3. Group Members Table
export const groupMembers = sqliteTable('group_members', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').default('MEMBER').notNull(), // Enum: ADMIN | MEMBER
  vibes: text('vibes'), // JSON array of user-specific outing vibes (e.g. ["CHILL", "CREATIVE"])
  isPresent: integer('is_present').default(1).notNull(), // 0 = false, 1 = true
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueGroupUser: uniqueIndex('group_members_group_user_idx').on(table.groupId, table.userId),
}));

// 4. Invites Table
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  inviteCode: text('invite_code').notNull().unique(),
  expiresAt: integer('expires_at').notNull(), // Unix timestamp
  revoked: integer('revoked').default(0).notNull(), // 0 = false, 1 = true
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 5. Budgets Table
export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  maxBudget: integer('max_budget').notNull(),
  travelIncluded: integer('travel_included').default(1).notNull(), // 0 = No, 1 = Yes
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueGroupUserBudget: uniqueIndex('budgets_group_user_idx').on(table.groupId, table.userId),
}));

// 6. Locations Table
export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  locationName: text('location_name'), // Readable address or name
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueGroupUserLocation: uniqueIndex('locations_group_user_idx').on(table.groupId, table.userId),
}));

// 7. Venues Cache Table (for Ola Maps requests)
export const venuesCache = sqliteTable('venues_cache', {
  id: text('id').primaryKey(), // UUID
  category: text('category').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  cacheKey: text('cache_key').notNull().unique(), // format: "{category}:{lat_2dp}:{lng_2dp}"
  data: text('data').notNull(), // JSON serialized venues string
  expiresAt: integer('expires_at').notNull(), // Unix timestamp
});

// 8. Experience Taxonomy & Catalog Tables
export const experienceCategories = sqliteTable('experience_categories', {
  id: text('id').primaryKey(), // e.g., "CONCERT", "WORKSHOP", "POTTERY"
  name: text('name').notNull(),
  description: text('description'),
});

export const experienceSources = sqliteTable('experience_sources', {
  id: text('id').primaryKey(), // e.g., "BOOKMYSHOW", "TAVILY"
  name: text('name').notNull(),
  reliabilityWeight: real('reliability_weight').default(1.0).notNull(),
  lastFetchedAt: text('last_fetched_at'),
  totalRecords: integer('total_records').default(0).notNull(),
});

export const experiences = sqliteTable('experiences', {
  id: text('id').primaryKey(), // UUID
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category')
    .notNull()
    .references(() => experienceCategories.id),
  city: text('city').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  ticketPrice: integer('ticket_price').default(0).notNull(), // INR
  capacity: integer('capacity'),
  source: text('source')
    .notNull()
    .references(() => experienceSources.id),
  sourceUrl: text('source_url').notNull(),
  imageUrl: text('image_url'),
  rating: real('rating'),
  popularityScore: real('popularity_score').default(0.0).notNull(), // Normalised 0.0 - 1.0
  isRecurring: integer('is_recurring').default(0).notNull(), // Boolean (0 or 1)
  isActive: integer('is_active').default(1).notNull(), // Active state for events
  trendingScore: real('trending_score').default(0.0).notNull(), // Trending algorithm score
  firstSeen: text('first_seen').default(sql`CURRENT_TIMESTAMP`).notNull(), // Track discovery date
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const experienceCache = sqliteTable('experience_cache', {
  id: text('id').primaryKey(), // UUID
  cacheKey: text('cache_key').notNull().unique(),
  payload: text('payload').notNull(), // JSON
  expiresAt: text('expires_at').notNull(),
});

// 9. Plans Table (Generated itineraries)
export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  planIndex: integer('plan_index').notNull(), // 1, 2, 3, or 4
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  meetupZone: text('meetup_zone').notNull(), // Meetup zone name (e.g., Dadar)
  budgetTier: text('budget_tier').default('BALANCED').notNull(), // BUDGET_FRIENDLY | BALANCED | PREMIUM
  totalEstimatedCostPerHead: integer('total_estimated_cost_per_head').notNull(),
  totalDurationMinutes: integer('total_duration_minutes').notNull(),
  score: real('score').default(0.0).notNull(),
  // Plan Score Breakdown
  experienceScore: real('experience_score').default(0.0).notNull(),
  travelScore: real('travel_score').default(0.0).notNull(),
  budgetScore: real('budget_score').default(0.0).notNull(),
  fairnessScore: real('fairness_score').default(0.0).notNull(),
  popularityScore: real('popularity_score').default(0.0).notNull(),
  groupTypeMatchScore: real('group_type_match_score').default(0.0).notNull(),
  vibeMatchScore: real('vibe_match_score').default(0.0).notNull(),
  compositeScore: real('composite_score').default(0.0).notNull(),
  // Group Travel Aggregate Metrics
  avgTrainTime: integer('avg_train_time').default(0).notNull(),
  avgCabTime: integer('avg_cab_time').default(0).notNull(),
  avgTrainCost: integer('avg_train_cost').default(0).notNull(),
  avgCabCost: integer('avg_cab_cost').default(0).notNull(),
  longestTravelTime: integer('longest_travel_time').default(0).notNull(),
  shortestTravelTime: integer('shortest_travel_time').default(0).notNull(),
  travelFairnessScore: real('travel_fairness_score').default(1.0).notNull(),
  mandatoryCost: integer('mandatory_cost').default(0).notNull(),
  optionalCostMin: integer('optional_cost_min').default(0).notNull(),
  optionalCostMax: integer('optional_cost_max').default(0).notNull(),
  whyRecommended: text('why_recommended'), // JSON array of reasons
  avgAutoTime: integer('avg_auto_time').default(0).notNull(),
  avgAutoCost: integer('avg_auto_cost').default(0).notNull(),
  avgTotalTime: integer('avg_total_time').default(0).notNull(),
  avgTotalCost: integer('avg_total_cost').default(0).notNull(),
  avgWalkTime: integer('avg_walk_time').default(0).notNull(),
  generatedAt: text('generated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueGroupPlanIndex: uniqueIndex('plans_group_plan_idx').on(table.groupId, table.planIndex),
}));

// 10. Plan Slots Table
export const planSlots = sqliteTable('plan_slots', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  slotOrder: integer('slot_order').notNull(), // 1, 2, 3...
  venueId: text('venue_id'), // Nullable if experience
  experienceId: text('experience_id').references(() => experiences.id), // Nullable if venue
  venueName: text('venue_name'), // Deprecated, kept to avoid interactive rename prompt
  name: text('name').notNull(), // Sourced from venue name or experience title
  category: text('category').notNull(), // Category name string
  arrivalTime: text('arrival_time').notNull(), // e.g. "12:00 PM"
  durationMinutes: integer('duration_minutes').notNull(),
  travelToNextMinutes: integer('travel_to_next_minutes'), // null for last slot
  estimatedCostPerHead: integer('estimated_cost_per_head').notNull(),
  note: text('note').notNull(),
  travelToNextCost: integer('travel_to_next_cost'),
  imageUrl: text('image_url'),
  link: text('link'),
}, (table) => ({
  uniquePlanSlotOrder: uniqueIndex('plan_slots_plan_slot_idx').on(table.planId, table.slotOrder),
}));

// 11. Votes Table
export const votes = sqliteTable('votes', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueGroupUserVote: uniqueIndex('votes_group_user_idx').on(table.groupId, table.userId),
}));

// 12. Outing History Table
export const history = sqliteTable('history', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id),
  outingDate: text('outing_date').notNull(),
  groupName: text('group_name').notNull(),
  planName: text('plan_name').notNull(),
  planTagline: text('plan_tagline').notNull(),
  venuesJson: text('venues_json').notNull(), // JSON list of venues
  participantsJson: text('participants_json').notNull(), // JSON list of user details
  totalCostPerHead: integer('total_cost_per_head').notNull(),
  winningCategories: text('winning_categories'), // JSON array of category strings for analytics
  winningBudgetTier: text('winning_budget_tier'), // BUDGET_FRIENDLY | BALANCED | PREMIUM
  winningActivities: text('winning_activities'), // JSON array of activity name strings for analytics
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 13. Member Travel Metrics Table
export const memberTravelMetrics = sqliteTable('member_travel_metrics', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  trainTime: integer('train_time').notNull(), // in minutes
  trainCost: integer('train_cost').notNull(), // in INR
  cabTime: integer('cab_time').notNull(), // in minutes
  cabCost: integer('cab_cost').notNull(), // in INR
  walkTime: integer('walk_time').notNull(), // in minutes
  autoTime: integer('auto_time').default(0).notNull(),
  autoCost: integer('auto_cost').default(0).notNull(),
  totalTime: integer('total_time').default(0).notNull(),
  totalCost: integer('total_cost').default(0).notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 14. Zones Table
export const zones = sqliteTable('zones', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(), // Andheri, Bandra, etc.
  centerLat: real('center_lat').notNull(),
  centerLng: real('center_lng').notNull(),
  radius: real('radius').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 15. Places Table
export const places = sqliteTable('places', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  rating: real('rating'),
  reviewCount: integer('review_count').default(0).notNull(),
  sourceName: text('source_name').notNull(), // OLA, etc.
  sourcePlaceId: text('source_place_id').notNull(),
  lastVerified: text('last_verified').notNull(),
  verifiedAt: text('verified_at').notNull(),
  isFeatured: integer('is_featured').default(0).notNull(),
  isHidden: integer('is_hidden').default(0).notNull(),
  boostFactor: real('boost_factor').default(1.0).notNull(),
  firstSeen: text('first_seen').default(sql`CURRENT_TIMESTAMP`).notNull(),
  businessStatus: text('business_status').default('OPERATIONAL').notNull(),
  openingHoursJson: text('opening_hours_json'),
  phone: text('phone'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 16. Place Categories Table
export const placeCategories = sqliteTable('place_categories', {
  id: text('id').primaryKey(),
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
}, (table) => ({
  uniquePlaceCat: uniqueIndex('place_categories_place_cat_idx').on(table.placeId, table.category),
}));

// 17. Place Costs Table
export const placeCosts = sqliteTable('place_costs', {
  placeId: text('place_id').primaryKey().references(() => places.id, { onDelete: 'cascade' }),
  mandatoryCost: integer('mandatory_cost').default(0).notNull(),
  optionalCostMin: integer('optional_cost_min').default(0).notNull(),
  optionalCostMax: integer('optional_cost_max').default(0).notNull(),
});

// 18. Place Scores Table
export const placeScores = sqliteTable('place_scores', {
  placeId: text('place_id').primaryKey().references(() => places.id, { onDelete: 'cascade' }),
  popularity: real('popularity').default(0.0).notNull(),
  budgetFriendliness: real('budget_friendliness').default(0.0).notNull(),
  conversation: real('conversation').default(0.0).notNull(),
  groupSuitability: real('group_suitability').default(0.0).notNull(),
  dateSuitability: real('date_suitability').default(0.0).notNull(),
  friendsSuitability: real('friends_suitability').default(0.0).notNull(),
  familySuitability: real('family_suitability').default(0.0).notNull(),
  weatherSuitability: real('weather_suitability').default(0.0).notNull(),
  uniqueness: real('uniqueness').default(0.0).notNull(),
  experienceScore: real('experience_score').default(0.0).notNull(),
  overall: real('overall').default(0.0).notNull(),
});

// 19. Itinerary Templates Table
export const itineraryTemplates = sqliteTable('itinerary_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // BUDGET_FRIENDLY, BALANCED, PREMIUM, etc.
  slot1Categories: text('slot1_categories').notNull(), // JSON list
  slot2Categories: text('slot2_categories').notNull(),
  slot3Categories: text('slot3_categories').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 20. Ranking Metrics Table (Learning System)
export const rankingMetrics = sqliteTable('ranking_metrics', {
  placeId: text('place_id').primaryKey().references(() => places.id, { onDelete: 'cascade' }),
  timesGenerated: integer('times_generated').default(0).notNull(),
  timesViewed: integer('times_viewed').default(0).notNull(),
  timesVoted: integer('times_voted').default(0).notNull(),
  timesWon: integer('times_won').default(0).notNull(),
});

// 21. Zone Fallbacks Table
export const zoneFallbacks = sqliteTable('zone_fallbacks', {
  id: text('id').primaryKey(),
  zoneName: text('zone_name').notNull(), // Andheri, Bandra, etc.
  name: text('name').notNull(),
  category: text('category').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  estimatedCostPerHead: integer('estimated_cost_per_head').notNull(),
  mandatoryCost: integer('mandatory_cost').notNull(),
  optionalCostMin: integer('optional_cost_min').notNull(),
  optionalCostMax: integer('optional_cost_max').notNull(),
  address: text('address'),
  rating: real('rating'),
});

// 22. Featured Places Table
export const featuredPlaces = sqliteTable('featured_places', {
  id: text('id').primaryKey(),
  listName: text('list_name').notNull(), // e.g. "Best Board Game Cafes", "Best Workshops", etc.
  placeId: text('place_id').references(() => places.id, { onDelete: 'cascade' }),
  experienceId: text('experience_id').references(() => experiences.id, { onDelete: 'cascade' }),
  description: text('description'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 23. Featured Experiences (Top 50 trending events)
export const featuredExperiences = sqliteTable('featured_experiences', {
  id: text('id').primaryKey(),
  experienceId: text('experience_id')
    .notNull()
    .references(() => experiences.id, { onDelete: 'cascade' }),
  score: real('score').default(0.0).notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// 24. Zone Coverage Table (materialized coverage matrix — recomputed nightly + after discovery)
export const zoneCoverage = sqliteTable('zone_coverage', {
  id: text('id').primaryKey(),
  zoneName: text('zone_name').notNull(),
  category: text('category').notNull(),
  countViable: integer('count_viable').default(0).notNull(),
  countTotal: integer('count_total').default(0).notNull(),
  deficitScore: real('deficit_score').default(0.0).notNull(),
  lastRecomputedAt: text('last_recomputed_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueZoneCat: uniqueIndex('zone_coverage_zone_cat_idx').on(table.zoneName, table.category),
  deficitIdx: index('zone_coverage_deficit_idx').on(table.deficitScore),
}));

// 25. Discovery Queue Table (priority work queue for background venue discovery)
export const discoveryQueue = sqliteTable('discovery_queue', {
  id: text('id').primaryKey(),
  zoneName: text('zone_name').notNull(),
  zoneLat: real('zone_lat').notNull(),
  zoneLng: real('zone_lng').notNull(),
  zoneRadius: integer('zone_radius').default(3000).notNull(),
  category: text('category').notNull(),
  priorityScore: real('priority_score').default(0.0).notNull(),
  reason: text('reason').default('scheduled_refresh').notNull(),
  status: text('status').default('PENDING').notNull(), // PENDING | IN_PROGRESS | COMPLETED | FAILED
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastAttemptedAt: text('last_attempted_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  statusPriorityIdx: index('discovery_queue_status_priority_idx').on(table.status, table.priorityScore),
  zoneCatIdx: index('discovery_queue_zone_cat_idx').on(table.zoneName, table.category),
}));

// 26. API Budget Table (daily quota tracking per source)
export const apiBudget = sqliteTable('api_budget', {
  id: text('id').primaryKey(),
  dayUtc: text('day_utc').notNull(), // e.g. "2026-06-30"
  source: text('source').notNull(),  // "reactive" | "predictive" | "maintenance"
  callsUsed: integer('calls_used').default(0).notNull(),
  callsLimit: integer('calls_limit').default(1000).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueDaySource: uniqueIndex('api_budget_day_source_idx').on(table.dayUtc, table.source),
}));

// 27. Venue Feedback Table (post-outing user ratings per venue)
export const venueFeedback = sqliteTable('venue_feedback', {
  id: text('id').primaryKey(),
  historyId: text('history_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  placeId: text('place_id'),
  rating: integer('rating').notNull(), // 1-5
  wouldVisitAgain: integer('would_visit_again').default(0).notNull(), // 0|1
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  placeIdx: index('venue_feedback_place_idx').on(table.placeId),
  historyIdx: index('venue_feedback_history_idx').on(table.historyId),
}));

// 28. Itinerary Feedback Table (post-outing user rating for the whole plan)
export const itineraryFeedback = sqliteTable('itinerary_feedback', {
  id: text('id').primaryKey(),
  historyId: text('history_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: text('plan_id'),
  overallRating: integer('overall_rating').notNull(), // 1-5
  travelRating: integer('travel_rating').default(3).notNull(), // 1-5
  favoriteSlotId: text('favorite_slot_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  historyIdx: index('itinerary_feedback_history_idx').on(table.historyId),
  uniqueUserHistory: uniqueIndex('itinerary_feedback_user_history_idx').on(table.userId, table.historyId),
}));

