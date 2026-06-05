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
  creatorId: text('creator_id')
    .notNull()
    .references(() => users.id),
  inviteCode: text('invite_code').notNull().unique(), // 8 characters
  status: text('status').default('ACTIVE').notNull(), // Enum: ACTIVE | ARCHIVED | DELETED
  votingStatus: text('voting_status').default('CLOSED').notNull(), // Enum: OPEN | CLOSED
  maxMembers: integer('max_members').default(20).notNull(),
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
  role: text('role').default('MEMBER').notNull(), // Enum: OWNER | MEMBER
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

// 8. Plans Table (Generated itineraries)
export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(), // UUID
  groupId: text('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  planIndex: integer('plan_index').notNull(), // 1, 2, 3, or 4
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  totalEstimatedCostPerHead: integer('total_estimated_cost_per_head').notNull(),
  totalDurationMinutes: integer('total_duration_minutes').notNull(),
  generatedAt: text('generated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  uniqueGroupPlanIndex: uniqueIndex('plans_group_plan_idx').on(table.groupId, table.planIndex),
}));

// 9. Plan Slots Table
export const planSlots = sqliteTable('plan_slots', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  slotOrder: integer('slot_order').notNull(), // 1, 2, 3...
  venueId: text('venue_id').notNull(), // Ola Maps place ID
  venueName: text('venue_name').notNull(),
  category: text('category').notNull(), // VenueCategory enum string
  arrivalTime: text('arrival_time').notNull(), // e.g. "12:00 PM"
  durationMinutes: integer('duration_minutes').notNull(),
  travelToNextMinutes: integer('travel_to_next_minutes'), // null for last slot
  estimatedCostPerHead: integer('estimated_cost_per_head').notNull(),
  note: text('note').notNull(),
}, (table) => ({
  uniquePlanSlotOrder: uniqueIndex('plan_slots_plan_slot_idx').on(table.planId, table.slotOrder),
}));

// 10. Votes Table
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

// 11. Outing History Table
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
