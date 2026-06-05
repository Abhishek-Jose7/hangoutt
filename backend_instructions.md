# HANGOUT — Backend Instructions
**Architecture, Business Logic & Implementation Reference · v1.1**

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [Authentication Layer](#4-authentication-layer)
5. [Database Schema](#5-database-schema)
6. [Module Specifications](#6-module-specifications)
7. [Groq Itinerary Engine](#7-groq-itinerary-engine)
8. [Validation Layer](#8-validation-layer)
9. [Error Handling](#9-error-handling)
10. [Security Requirements](#10-security-requirements)
11. [Logging](#11-logging)
12. [Caching Strategy](#12-caching-strategy)
13. [Performance Targets](#13-performance-targets)
14. [Definition of Done](#14-definition-of-done)

---

## 1. Core Principles

> These rules are non-negotiable. Any code that violates them must be refactored before merging.

| Principle | Rule |
|---|---|
| Never trust frontend data | All user input validated server-side with Zod before any DB access |
| Authentication on every route | Every Server Action and Route Handler verifies a valid Clerk session |
| Business logic on backend | Midpoint, scoring, Groq calls, and itinerary assembly never run on the client |
| Repository pattern | No raw SQL inside Server Actions or Route Handlers — all DB access through repositories |
| Database is source of truth | Never trust client-sent IDs or derived state; always re-fetch from DB |
| Fail loudly, recover gracefully | Throw typed errors at the logic layer; catch and format at the handler layer |
| No sensitive data in logs | Never log passwords, tokens, API keys, individual coordinates, or budget amounts |
| Groq API key is server-side only | The `GROQ_API_KEY` env var must never appear in any client bundle |

---

## 2. Tech Stack

| Component | Technology | Version / Notes |
|---|---|---|
| Framework | Next.js | 14+ with App Router |
| Language | TypeScript | Strict mode enabled |
| Auth | Clerk | SDK: `@clerk/nextjs` |
| Database | Cloudflare D1 | SQLite dialect; accessed via Drizzle ORM |
| ORM | Drizzle ORM | Type-safe D1 bindings; `drizzle-kit` for migrations |
| Storage | Cloudflare R2 | S3-compatible; profile images and QR codes |
| Maps | Ola Maps API | REST API; no official SDK — wrapped in `src/lib/maps/` |
| **AI / Itinerary** | **Groq SDK (`groq-sdk`)** | **`llama-3.3-70b-versatile`; JSON mode** |
| Validation | Zod | v3+; used in all validators |
| Testing | Vitest + Testing Library | Unit tests for all business logic |

---

## 3. Folder Structure

> Every module follows the same pattern: `schema → repository → service → action/handler`.

```
src/
  app/
    api/
      webhooks/clerk/route.ts       ← Clerk user sync webhook
      maps/route.ts                 ← Ola Maps proxy (protects API key)
      itinerary/generate/route.ts   ← Groq itinerary generation endpoint
    (auth)/
      sign-in/page.tsx
      sign-up/page.tsx
    (app)/
      dashboard/page.tsx
      groups/[id]/page.tsx
      planner/[groupId]/page.tsx
    actions/
      groups.ts         ← createGroup, updateGroup, deleteGroup, archiveGroup
      members.ts        ← joinGroup, leaveGroup, removeMember, transferOwnership
      budgets.ts        ← submitBudget, updateBudget
      locations.ts      ← saveLocation, updateLocation
      planner.ts        ← generatePlan (triggers scoring → Groq pipeline)
      votes.ts          ← createVote, updateVote, countVotes, closeVoting
  lib/
    auth/
      getCurrentUser.ts   ← Clerk session → internal User object
      requireAuth.ts      ← throws UnauthorizedError if no session
    db/
      schema.ts           ← Drizzle table definitions (all tables)
      client.ts           ← D1 binding initialisation
      migrations/         ← Drizzle migration files (committed to repo)
    maps/
      olaClient.ts        ← base HTTP client for Ola Maps; handles auth headers
      geocoding.ts        ← geocodeAddress(), reverseGeocode()
      places.ts           ← searchNearbyVenues(), getVenueDetails()
      distance.ts         ← getDistanceMatrix()
    groq/
      client.ts           ← Groq SDK initialisation (server-only)
      itineraryService.ts ← buildPrompt(), callGroq(), parseResponse(), retryOnce()
      prompts.ts          ← system prompt and user prompt templates
      types.ts            ← GroqItinerary, GroqSlot, GroqResponse TypeScript types
    algorithms/
      midpoint.ts         ← calculateMidpoint()
      scoring.ts          ← scoreVenue(), rankVenues()
    validators/
      group.schema.ts
      budget.schema.ts
      location.schema.ts
      vote.schema.ts
      itinerary.schema.ts ← Zod schema for validating Groq JSON output
    repositories/
      user.repository.ts
      group.repository.ts
      member.repository.ts
      budget.repository.ts
      location.repository.ts
      vote.repository.ts
      plan.repository.ts    ← save and retrieve generated itinerary plans
      history.repository.ts
    services/
      planner.service.ts        ← orchestrates full pipeline: score → Groq → save
      recommendation.service.ts ← venue fetching and scoring
    types/
      group.types.ts
      planner.types.ts
      groq.types.ts
      api.types.ts
  middleware.ts   ← Clerk auth middleware (protects all /(app)/* routes)
```

---

## 4. Authentication Layer

### 4.1 Clerk Integration

All session management is delegated to Clerk. Hangout stores only a shadow user record in D1 for foreign-key relationships.

- `middleware.ts` protects all routes under `/(app)/*` using Clerk's `clerkMiddleware()`.
- **Public routes:** `/`, `/sign-in`, `/sign-up`, `/join/[code]`, `/api/webhooks/clerk`
- **Protected routes:** everything under `/(app)/` and all Server Actions.
- All Server Actions call `requireAuth()` as their first line. This calls `auth()` from `@clerk/nextjs/server` and throws `UnauthorizedError` if no valid session exists.

### 4.2 User Synchronisation

Clerk fires a `user.created` webhook on first sign-up. The handler at `/api/webhooks/clerk` runs `syncUser()`:

1. Verify Svix webhook signature — reject with 401 if invalid.
2. Check if a user record with this `clerkId` already exists in D1.
3. If not: `INSERT` new user record with `id`, `clerkId`, `email`, `name`, `imageUrl`.
4. If yes: `UPDATE` `email`, `name`, `imageUrl` (handles Clerk profile changes).
5. Return 200. Handler is idempotent — safe to replay.

### 4.3 `getCurrentUser()`

Every protected action that needs the internal user record calls this helper:

1. Call `auth()` to get `clerkUserId`.
2. Call `userRepository.findByClerkId(clerkUserId)`.
3. Throw `NotFoundError` if user record doesn't exist (handles edge case where webhook failed).
4. Return the full internal `User` object.

---

## 5. Database Schema

### 5.1 Tables Overview

| Table | Primary Key | Purpose |
|---|---|---|
| `users` | `id` (UUID) | Internal user records, synced from Clerk |
| `groups` | `id` (UUID) | Planning groups |
| `group_members` | `id` (UUID) | Group membership and roles |
| `invites` | `id` (UUID) | Invite codes with expiry |
| `budgets` | `id` (UUID) | Per-user budget within a group |
| `locations` | `id` (UUID) | Per-user location within a group |
| `venues_cache` | `id` (UUID) | Cached Ola Maps venue results (TTL 1 hour) |
| `plans` | `id` (UUID) | Generated Groq itinerary plans — one row per itinerary |
| `plan_slots` | `id` (UUID) | Individual time slots within a plan |
| `votes` | `id` (UUID) | Member votes on itinerary plans |
| `history` | `id` (UUID) | Completed outings |

### 5.2 `plans` Table Schema

```sql
CREATE TABLE plans (
  id          TEXT PRIMARY KEY,           -- UUID
  group_id    TEXT NOT NULL REFERENCES groups(id),
  plan_index  INTEGER NOT NULL,           -- 1, 2, 3, or 4
  name        TEXT NOT NULL,              -- e.g. "Chill & Bowl"
  tagline     TEXT NOT NULL,              -- e.g. "A relaxed afternoon..."
  total_estimated_cost_per_head INTEGER NOT NULL,
  total_duration_minutes INTEGER NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, plan_index)
);
```

### 5.3 `plan_slots` Table Schema

```sql
CREATE TABLE plan_slots (
  id                        TEXT PRIMARY KEY,
  plan_id                   TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  slot_order                INTEGER NOT NULL,    -- 1, 2, 3...
  venue_id                  TEXT NOT NULL,       -- Ola Maps place ID
  venue_name                TEXT NOT NULL,
  category                  TEXT NOT NULL,       -- VenueCategory enum
  arrival_time              TEXT NOT NULL,       -- e.g. "12:00 PM"
  duration_minutes          INTEGER NOT NULL,
  travel_to_next_minutes    INTEGER,             -- null for last slot
  estimated_cost_per_head   INTEGER NOT NULL,
  note                      TEXT NOT NULL,       -- Groq-generated contextual note
  UNIQUE(plan_id, slot_order)
);
```

### 5.4 Critical Unique Constraints

- `budgets`: `UNIQUE(group_id, user_id)` — one budget per user per group.
- `locations`: `UNIQUE(group_id, user_id)` — one location per user per group.
- `votes`: `UNIQUE(group_id, user_id)` — one vote per user per group session.
- `group_members`: `UNIQUE(group_id, user_id)` — cannot join same group twice.
- `invites`: `UNIQUE(invite_code)` — globally unique codes.
- `plans`: `UNIQUE(group_id, plan_index)` — enforces at most 4 plans per group.

---

## 6. Module Specifications

### 6.1 Groups Module

| Function | Inputs | Auth Check | Side Effects |
|---|---|---|---|
| `createGroup()` | `name, type, description?` | Must be authenticated | INSERT group; INSERT group_member with role OWNER; generate inviteCode |
| `updateGroup()` | `groupId, fields` | Must be OWNER | UPDATE group fields; bump updatedAt |
| `deleteGroup()` | `groupId` | Must be OWNER | SET status = DELETED; notify members |
| `archiveGroup()` | `groupId` | Must be OWNER | SET status = ARCHIVED |
| `getGroup()` | `groupId` | Must be a member | SELECT group + member count + budget summary |
| `getUserGroups()` | (none) | Must be authenticated | SELECT all groups where user is a member, ordered by updatedAt DESC |

### 6.2 Membership Module

| Function | Key Logic |
|---|---|
| `joinGroup(inviteCode)` | Validate invite not expired; validate user not already a member; validate group not at maxMembers; INSERT member with role MEMBER. |
| `leaveGroup(groupId)` | If user is OWNER: throw error — must transfer ownership first. Else DELETE member record. |
| `removeMember(groupId, targetUserId)` | Caller must be OWNER. Cannot remove self. DELETE member record. |
| `transferOwnership(groupId, newOwnerId)` | Caller must be OWNER. New owner must be current MEMBER. UPDATE roles atomically in a DB transaction. |

### 6.3 Budget Module

- `submitBudget(groupId, maxBudget)`: Validate groupId; user is a member; `50 ≤ maxBudget ≤ 100000`. `UPSERT` on conflict (groupId, userId).
- `updateBudget(groupId, maxBudget)`: Same as submit — UPSERT handles both insert and update.
- `getGroupBudgetSummary(groupId)`: Returns `{ min, avg, max, total, submittedCount, totalMembers }`. **Never returns individual member amounts to any client.**

### 6.4 Location Module

- `saveLocation(groupId, lat, lng)`: Validate coordinate bounds; validate user is a member. UPSERT location record.
- `updateLocation(groupId, lat, lng)`: UPSERT — idempotent.
- `getGroupLocations(groupId)`: Returns full coordinate list to OWNER only (for map display). All other members receive only the computed midpoint.

### 6.5 Midpoint Engine (`src/lib/algorithms/midpoint.ts`)

```typescript
export function calculateMidpoint(locations: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (locations.length < 2) throw new InsufficientLocationsError();
  return {
    lat: locations.reduce((sum, l) => sum + l.lat, 0) / locations.length,
    lng: locations.reduce((sum, l) => sum + l.lng, 0) / locations.length,
  };
}
```

- Result is not persisted — recalculated on demand.
- Used as the search origin for all Ola Maps venue queries.

### 6.6 Ola Maps Integration

All Ola Maps calls are proxied through `/api/maps` to keep the API key server-side only.

| Function | Ola Maps Endpoint | Used For |
|---|---|---|
| `searchNearbyVenues(lat, lng, category, radius)` | `POST /places/v1/nearbysearch` | Venue discovery around midpoint |
| `getVenueDetails(placeId)` | `GET /places/v1/details` | Rating, hours, price level |
| `geocodeAddress(address)` | `GET /places/v1/geocode` | Address → coordinates |
| `reverseGeocode(lat, lng)` | `GET /places/v1/reverse-geocode` | Coordinates → readable address |
| `getDistanceMatrix(origins, destinations)` | `POST /routing/v1/distancematrix` | Travel time/distance for scoring |

**Caching:** All venue search results are cached in `venues_cache` with a 1-hour TTL. Cache key: `{category}:{lat_2dp}:{lng_2dp}`. Stale entries are skipped and re-fetched transparently.

### 6.7 Recommendation Engine (`src/lib/services/recommendation.service.ts`)

This service narrows the full venue pool to a **curated shortlist of 10–15 venues** that become the Groq context.

**Pipeline:**

1. Fetch all submitted locations for the group.
2. Calculate midpoint.
3. For each enabled venue category: check `venues_cache`; if stale or missing, call `searchNearbyVenues()`.
4. For each candidate venue, compute all four score components (distance, budget, rating, preference).
5. Sum weighted components into `finalScore`.
6. Sort descending; return top 10–15 venues.

**Edge cases:**
- Fewer than 2 locations → return `{ error: 'INSUFFICIENT_LOCATIONS' }`.
- No venues found within radius for a category → expand radius 2× and retry once.
- Ola Maps API fails → return cached results if available, else surface `MAPS_API_ERROR`.

### 6.8 Voting Module

- `createVote(groupId, planId)`: One vote per user. Throws `VOTE_CLOSED` if voting session is closed.
- `updateVote(groupId, planId)`: Replaces existing vote. Allowed only while status is OPEN.
- `countVotes(groupId)`: Returns `{ [planId]: count }` map. Never reveals who voted for what.
- `getWinner(groupId)`: Returns `planId` with highest count. Returns `null` on tie (creator breaks tie).
- `closeVoting(groupId)`: OWNER only. Sets voting session status to CLOSED.
- Auto-close: A scheduled check (Vercel Cron) closes voting sessions 24 hours after opening.

---

## 7. Groq Itinerary Engine

This is the core AI subsystem. It lives in `src/lib/groq/` and is called by `planner.service.ts` after the recommendation engine returns its shortlist.

### 7.1 Environment Variables

```bash
GROQ_API_KEY=gsk_...          # Server-side only. Never expose to client.
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_MAX_TOKENS=2048
GROQ_TEMPERATURE=0.7
```

### 7.2 Groq Client Initialisation (`src/lib/groq/client.ts`)

```typescript
import Groq from 'groq-sdk';

// This file is server-only. Never import from client components.
export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});
```

Mark this file with `'server-only'` at the top to prevent accidental client import:

```typescript
import 'server-only';
import Groq from 'groq-sdk';
// ...
```

### 7.3 System Prompt (`src/lib/groq/prompts.ts`)

```typescript
export const ITINERARY_SYSTEM_PROMPT = `
You are a group outing planner. Given a list of available venues and group context, 
generate exactly 3 or 4 distinct itinerary plans.

STRICT RULES:
- Return ONLY valid JSON. No preamble, no markdown, no explanation.
- Generate 3 or 4 itineraries (never fewer than 3).
- Each itinerary must have 3 to 5 venue slots.
- Each itinerary must include at least one meal slot (category CAFE or RESTAURANT).
- No venue may appear in more than one itinerary.
- Total estimated cost per head must not exceed the groupAvgBudget.
- Each itinerary must have a unique name (2–4 words) and a tagline (one sentence, max 12 words).
- Slot arrival times must be realistic (start from 11:00 AM by default unless specified).
- Include at least 15 minutes travel buffer between consecutive venue slots.
- The "note" field for each slot must be specific and helpful — why this venue, what to order or do.
- Itineraries must differ meaningfully in vibe, category mix, or price point.
- If groupType is DATE: romantic or intimate tone, max 2 people in mind.
- If groupType is FAMILY: family-friendly venues, avoid late-night venues.
- If groupType is WORK: professional tone, suitable for colleagues.

REQUIRED JSON STRUCTURE:
{
  "itineraries": [
    {
      "id": "plan_1",
      "name": "Short Catchy Name",
      "tagline": "One sentence describing the vibe.",
      "totalEstimatedCostPerHead": 450,
      "totalDurationMinutes": 240,
      "slots": [
        {
          "order": 1,
          "venueId": "venue_id_from_input",
          "venueName": "Venue Name",
          "category": "CAFE",
          "arrivalTime": "11:00 AM",
          "durationMinutes": 60,
          "travelToNextMinutes": 15,
          "estimatedCostPerHead": 200,
          "note": "Specific note about this venue and why it fits here."
        }
      ]
    }
  ]
}
`.trim();
```

### 7.4 User Prompt Builder (`src/lib/groq/prompts.ts`)

```typescript
export function buildItineraryPrompt(context: ItineraryPromptContext): string {
  return JSON.stringify({
    groupContext: {
      groupName: context.groupName,
      groupType: context.groupType,
      memberCount: context.memberCount,
      groupMinBudget: context.groupMinBudget,
      groupAvgBudget: context.groupAvgBudget,
      preferredCategories: context.preferredCategories,
      midpointAddress: context.midpointAddress,
    },
    availableVenues: context.venues.map(v => ({
      id: v.id,
      name: v.name,
      category: v.category,
      rating: v.rating,
      distanceFromMidpoint: `${v.distanceKm.toFixed(1)} km`,
      estimatedCostPerHead: v.estimatedCostPerHead,
      openNow: v.openNow,
      address: v.address,
    })),
  }, null, 2);
}
```

### 7.5 Core Generation Function (`src/lib/groq/itineraryService.ts`)

```typescript
import 'server-only';
import { groqClient } from './client';
import { ITINERARY_SYSTEM_PROMPT, buildItineraryPrompt } from './prompts';
import { itineraryResponseSchema } from '../validators/itinerary.schema';
import type { ItineraryPromptContext, GroqItineraryResponse } from './types';

export async function generateItineraries(
  context: ItineraryPromptContext
): Promise<GroqItineraryResponse> {
  const userPrompt = buildItineraryPrompt(context);

  const callGroq = async (): Promise<GroqItineraryResponse> => {
    const completion = await groqClient.chat.completions.create({
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      max_tokens: 2048,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ITINERARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new GroqEmptyResponseError();

    const parsed = JSON.parse(raw);
    const validated = itineraryResponseSchema.parse(parsed); // throws ZodError if invalid
    return validated;
  };

  try {
    return await callGroq();
  } catch (err) {
    if (isRetryable(err)) {
      // Single retry with 2-second delay
      await sleep(2000);
      return await callGroq();
    }
    throw err;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof SyntaxError) return true; // malformed JSON
  if (err instanceof Error && err.message.includes('429')) return true; // rate limit
  if (err instanceof Error && err.message.includes('timeout')) return true;
  return false;
}
```

### 7.6 Groq Output Validation (`src/lib/validators/itinerary.schema.ts`)

All Groq output is validated with Zod before being saved to the database or returned to the client. If Zod validation fails, the error is logged and a retry is triggered.

```typescript
import { z } from 'zod';

const SlotSchema = z.object({
  order: z.number().int().min(1).max(5),
  venueId: z.string().min(1),
  venueName: z.string().min(1),
  category: z.enum(['CAFE','RESTAURANT','PARK','ARCADE','BOWLING','ESCAPE_ROOM','MOVIE','MALL','DESSERT','SPORTS','MUSEUM']),
  arrivalTime: z.string().min(1),
  durationMinutes: z.number().int().min(15).max(300),
  travelToNextMinutes: z.number().int().min(0).max(120).nullable(),
  estimatedCostPerHead: z.number().int().min(0),
  note: z.string().min(10),
});

const ItinerarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(40),
  tagline: z.string().min(5).max(120),
  totalEstimatedCostPerHead: z.number().int().min(0),
  totalDurationMinutes: z.number().int().min(60),
  slots: z.array(SlotSchema).min(3).max(5),
});

export const itineraryResponseSchema = z.object({
  itineraries: z.array(ItinerarySchema).min(3).max(4),
});
```

### 7.7 Full Planning Pipeline (`src/lib/services/planner.service.ts`)

```
generatePlan(groupId) called from Server Action
  │
  ├─ 1. requireAuth() — throw if not authenticated
  ├─ 2. Verify caller is a member of groupId
  ├─ 3. Check all members have submitted location (≥ 2 required)
  ├─ 4. Check all members have submitted budget
  │
  ├─ 5. calculateMidpoint(locations)
  ├─ 6. recommendation.service: fetch + score venues → top 10–15
  │
  ├─ 7. groq/itineraryService.generateItineraries(context)
  │       ├─ Build prompt with group context + venue list
  │       ├─ Call Groq API (llama-3.3-70b-versatile, JSON mode)
  │       ├─ Validate response with Zod itineraryResponseSchema
  │       └─ Retry once on retryable errors
  │
  ├─ 8. Save plans to DB (plans table + plan_slots table)
  │       └─ Wrapped in a DB transaction — all plans saved atomically
  │
  ├─ 9. Open voting session for this group
  ├─ 10. Trigger in-app notification: "Plans are ready — time to vote!"
  └─ 11. Return { success: true, plans: [...] }
```

### 7.8 Error Handling for Groq

| Error Scenario | Code | Behaviour |
|---|---|---|
| Groq timeout (>10s) | `GROQ_TIMEOUT` | Retry once; if still fails, return error with user message |
| Invalid JSON from Groq | `GROQ_PARSE_ERROR` | Log raw response; retry once with stricter JSON instruction |
| Zod validation failure on Groq output | `GROQ_INVALID_SCHEMA` | Log failure + raw output; retry once |
| Rate limit (429) | `GROQ_RATE_LIMITED` | Wait 2 seconds; retry once |
| Groq API unavailable (5xx) | `GROQ_UNAVAILABLE` | Return error immediately; do not retry |
| `GROQ_API_KEY` missing | `GROQ_MISCONFIGURED` | Throw at startup; crash fast (misconfiguration, not runtime error) |

All Groq errors are surfaced to the client with a human-readable message. Stack traces are never included.

---

## 8. Validation Layer

All inputs validated with Zod before any database or business logic runs. Schemas in `src/lib/validators/`.

| Schema | Key Rules |
|---|---|
| `CreateGroupSchema` | `name`: min 3, max 60; `groupType`: enum; `description`: optional max 300 |
| `UpdateGroupSchema` | Partial of CreateGroupSchema; `groupId`: UUID required |
| `SubmitBudgetSchema` | `groupId`: UUID; `maxBudget`: integer, min 50, max 100000 |
| `SaveLocationSchema` | `groupId`: UUID; `lat`: -90 to 90; `lng`: -180 to 180 |
| `CreateVoteSchema` | `groupId`: UUID; `planId`: UUID |
| `JoinGroupSchema` | `inviteCode`: string, exactly 8 alphanumeric characters |
| `UpdateProfileSchema` | `name`: optional 2–80 chars; `favoriteActivities`: optional VenueCategory enum array |
| `itineraryResponseSchema` | Full Zod validation of Groq JSON output (see Section 7.6) |

**Rule:** If Zod parse fails, return `{ success: false, error: { code: 'VALIDATION_ERROR', fields: zodError.flatten() } }` immediately. The database is never touched.

---

## 9. Error Handling

### 9.1 Standard Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "GROUP_NOT_FOUND",
    "message": "The requested group does not exist."
  }
}
```

Stack traces are never included in responses.

### 9.2 Error Code Registry

| Code | HTTP Equiv. | Trigger Condition |
|---|---|---|
| `UNAUTHORIZED` | 401 | No valid Clerk session |
| `FORBIDDEN` | 403 | Authenticated but lacks permission |
| `NOT_FOUND` | 404 | Resource does not exist or is soft-deleted |
| `VALIDATION_ERROR` | 422 | Zod schema parse failure |
| `DUPLICATE` | 409 | Unique constraint violation |
| `INVITE_EXPIRED` | 410 | Invite code past expiry date |
| `INSUFFICIENT_LOCATIONS` | 400 | Fewer than 2 locations submitted |
| `VOTE_CLOSED` | 400 | Attempt to vote after session is closed |
| `MAPS_API_ERROR` | 502 | Ola Maps API returned error or timed out |
| `GROQ_TIMEOUT` | 504 | Groq API took >10 seconds |
| `GROQ_PARSE_ERROR` | 502 | Groq returned malformed JSON |
| `GROQ_INVALID_SCHEMA` | 502 | Groq output failed Zod validation |
| `GROQ_RATE_LIMITED` | 429 | Groq rate limit hit |
| `GROQ_UNAVAILABLE` | 502 | Groq API returned 5xx |
| `GROQ_MISCONFIGURED` | 500 | `GROQ_API_KEY` env var missing at startup |
| `INTERNAL_ERROR` | 500 | Unexpected server-side exception |

---

## 10. Security Requirements

| Control | Implementation |
|---|---|
| Authentication | Clerk session verified on every Server Action via `requireAuth()` |
| Authorisation | Resource-level checks before every mutation |
| Rate limiting | Vercel Edge Middleware: 100 req/min per userId; 20 req/min for auth routes |
| Input sanitisation | Zod strips unknown fields; no raw user strings passed to SQL |
| Ola Maps API key | Stored in Vercel env vars; proxied via `/api/maps` Route Handler |
| **Groq API key** | **`GROQ_API_KEY` in Vercel env vars (server-side); file marked `'server-only'`; never in client bundle** |
| Location privacy | Individual coordinates never returned to non-owner clients |
| Budget privacy | Individual amounts never returned to any client; only aggregates surfaced |
| Invite security | Random 8-char alphanumeric codes; not guessable by enumeration |
| Webhook verification | Clerk webhook signature verified via Svix before processing |
| SQL injection | Drizzle ORM uses parameterised queries exclusively |

---

## 11. Logging

### Log These Events

- User sign-in and sign-out (`userId`, timestamp)
- Group created, deleted, archived (`groupId`, `creatorId`)
- Member joins or leaves (`groupId`, `userId`, method)
- Budget submitted or updated (`groupId`, `userId` — **no amount**)
- Location submitted or updated (`groupId`, `userId` — **no coordinates**)
- Groq generation triggered (`groupId`, `memberCount`, venueCount passed to Groq)
- Groq generation succeeded (`groupId`, `itineraryCount`, latencyMs)
- Groq generation failed (`groupId`, `errorCode`, attempt number)
- Vote submitted (`groupId`, `userId` — **no planId choice**)
- Ola Maps API call (`endpoint`, `latencyMs`, `statusCode`)
- All `INTERNAL_ERROR` events with request context

### Never Log

- Passwords, tokens, API keys (including `GROQ_API_KEY`)
- Raw coordinates (lat/lng)
- Individual budget amounts
- Who voted for which plan
- Full Groq prompts in production (may contain group member data)

---

## 12. Caching Strategy

| Data | Cache Location | TTL | Invalidation |
|---|---|---|---|
| Venue search results | `venues_cache` D1 table | 1 hour | On TTL expiry |
| Geocoding results | D1 or in-memory LRU | 24 hours | On TTL expiry |
| Groq itinerary plans | `plans` + `plan_slots` D1 tables | Permanent (user can regenerate) | Explicit regeneration by group member |
| Group budget summary | Computed at query time | No cache | N/A — fast aggregation |
| Midpoint calculation | In-memory per request | Request lifetime | N/A |

**Groq regeneration rule:** A group can regenerate its itineraries at any time before voting closes. Regeneration deletes the previous plans and runs the full pipeline again. Regeneration requires at least one of: new member added, budget updated, or location updated since last generation.

---

## 13. Performance Targets

| Operation | Target (p95) | Strategy |
|---|---|---|
| Group create / fetch | < 100ms | Simple D1 queries with indexes on `groupId`, `userId` |
| Budget / location submit | < 150ms | UPSERT with unique constraint; single round-trip |
| Venue scoring (recommendation engine) | < 500ms | Parallel category searches; cached venue data |
| **Groq itinerary generation** | **< 3 seconds** | **`llama-3.3-70b-versatile` at Groq speeds; streaming response to client** |
| Plan save to DB (post-Groq) | < 200ms | Single DB transaction; bulk insert slots |
| Midpoint calculation | < 10ms | Pure arithmetic; no I/O |
| Vote submit / count | < 100ms | Simple inserts and `COUNT()` queries |
| Ola Maps API call (uncached) | < 1 second | Timeout set to 5s; fallback to cache |

---

## 14. Definition of Done

> A backend feature is considered complete only when **all** of the following criteria are met.

- [ ] Database schema exists with migrations committed to the repo.
- [ ] Zod validation schema defined and applied at the action/handler entry point.
- [ ] Authentication check present on all protected operations.
- [ ] Authorisation check present on all resource-level mutations.
- [ ] Repository functions used for all database access — no raw SQL in actions.
- [ ] Error handling returns correct error codes in the standard response format.
- [ ] Sensitive data (coordinates, individual budgets, vote choices, Groq API key) not exposed to clients.
- [ ] Relevant events logged without sensitive data.
- [ ] Unit tests written for all business logic (algorithms, validators, services, Groq prompt builder).
- [ ] Integration test for the happy path of each module, including the Groq pipeline.
- [ ] Groq error scenarios (timeout, parse failure, rate limit) tested with mocked responses.
- [ ] API tested manually against success and all defined error cases.
- [ ] `GROQ_API_KEY` confirmed absent from all client bundle chunks (run `next build` and inspect).
- [ ] Documentation updated if any spec changes.
