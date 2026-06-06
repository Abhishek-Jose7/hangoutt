import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});
