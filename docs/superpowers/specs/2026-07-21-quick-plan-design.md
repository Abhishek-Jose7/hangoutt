# Quick Plan — Single-Location Itinerary Generator

**Date:** 2026-07-21
**Status:** Design (pending user approval)

## Problem

Group planner requires: create group → invite members → collect each member's location/budget/vibes → admin generates. Heavy for a user who already knows where they want to go and just wants itinerary ideas for that spot.

**Quick Plan** = single user, one known location + direct params (headcount, budget, tags) → 4 itineraries from the same engine → save favorite to history.

## Goals

- Reuse `executePlanningEngine` unchanged. No planner stage-logic change (archetypes, constraint stack, scoring, clustering, budget×1.10 ceiling all untouched).
- Three location modes: anchor zone, exact point, single must-visit venue.
- Logged-in, save-per-plan to existing `history` table.
- Reuse planner rate limit (admin emails bypass).

## Non-Goals

- No group creation, invites, member detail collection.
- No new scoring/generator (would fork planner logic → drift). Rejected.
- No throwaway group rows in D1 (pollution + cleanup burden). Rejected.
- No true single-zone hard-lock in engine (engine spreads plans across ~4 spaced zones near centroid; anchor-zone mode seeds centroid = zone center, plans radiate to that zone + neighbors — accepted behavior, not a bug).

## Approach: Synthetic-Group Adapter

Engine takes plain args (verified line 3549): `groupData, presentMembers, budgetSummary, presentLocations, preferredCategories, vibes, historyEntries, lowestBudget, options`. Derives everything from `memberCoords = presentLocations.map(lat/lng)`. No DB handle, no module-scope group state.

New `quickPlan.service.ts` synthesizes those args from quick-plan input and calls the engine directly. Nothing persisted until the user saves.

## Data Flow

```
/quick-plan form
  → generateQuickPlanAction(input)         [server action, auth + rate-limit]
    → quickPlanService.generate(input)
        1. resolve location by mode → { lat, lng, locationName, meetupZone?, anchorVenueId? }
        2. synthesize:
             groupData      = { id:`quick_<uuid>`, name, groupType, outingDate, outingTime, vibes, ... }  (in-memory, no row)
             presentMembers = headcount clones [{ userId, clerkId, ... }]
             presentLocations = [{ userId, lat, lng, locationName }]   // one point; all members share it
             budgetSummary  = { min, avg, max } from budget (perPerson → as-is; total → /headcount)
             preferredCategories = mapTagsToCategories(tags)
             vibes = tags∩vibeVocab
        3. executePlanningEngine(...)  ← UNCHANGED
        4. return 4 PlanWithSlots (in-memory)
  → results grid (reuse plan card) → Save button per plan
    → saveQuickPlanAction(plan)
      → worker POST /internal/quick-plan/save  → history row (groupId NULL, source='QUICK')
```

## Location Mode Resolution

| Mode | Input | Resolves to | Engine effect |
|------|-------|-------------|---------------|
| Anchor zone | zone name (Bandra) | centroid = zone center coords; `meetupZone` set | plans favor that zone + neighbors |
| Exact point | address / map pin | geocode via existing maps lib → lat/lng | plans radiate from point into nearest zones |
| Single venue | must-visit place | venue coords (from places DB or geocode); `anchorVenueId` set, seeded into first slot / `usedPlaceIds` | engine fills rest of crawl around it |

Geocoding + venue lookup reuse existing `src/lib/maps/places` helpers. No new external calls beyond what planner already makes.

## Persistence (existing history table)

- Reuse `history`. `groupId` nullable, new `source` value `'QUICK'` (existing rows implicitly `'GROUP'`).
- Migration `0021_quick_plan_source.sql`: `ALTER TABLE history ADD COLUMN source TEXT DEFAULT 'GROUP';` — remote D1 + local.db + schema.ts. (Only if `source` column absent; verify first.)
- Save-per-plan: user picks 1 of 4 → `saveQuickPlanAction` → worker `POST /internal/quick-plan/save` writes one history row (venues_json, participants_json synthesized, total_cost_per_head, etc — same shape as group history so `/users/history` + share + feedback all work).
- Quick plans appear in existing history list; share link (#66) + post-outing feedback (#67) work unchanged since they key off history rows.

## Rate Limiting

Reuse planner's existing per-user daily generation limit via the same cost-control worker endpoints. Admin emails (abhishekjose780@gmail.com, johannjoseph232006@gmail.com) bypass. `generateQuickPlanAction` passes `{ clerkId, ip, email }` like `route.ts` does.

## Entry Points

- Dedicated page `src/app/(app)/quick-plan/page.tsx` (client) — form + results grid.
- Dashboard shortcut card linking to `/quick-plan`.
- Both inside `(app)` auth group — logged-in only, Clerk-gated (no middleware change).

## Components / Files

**New**
- `src/lib/services/quickPlan.service.ts` — synthesis + engine call
- `src/actions/quickPlan.ts` — `generateQuickPlanAction`, `saveQuickPlanAction`
- `src/app/(app)/quick-plan/page.tsx` — form + results
- `src/components/QuickPlanForm.tsx` — mode selector, headcount, budget (per-person/total toggle), tags, location input
- migration `0021_quick_plan_source.sql` (if needed)

**Modified**
- `src/lib/services/planner.service.ts` — export `executePlanningEngine` (already has `...ForEval` wrapper exported; use that, likely zero change)
- `workers/api.ts` — `POST /internal/quick-plan/save`
- `src/lib/db/schema.ts` — `history.source` column
- dashboard page — shortcut card

## Error Handling

- Invalid/out-of-region coords → same `validateCoordinates` reject as planner ("outside supported Mumbai/Navi Mumbai/Thane region").
- Geocode failure → surface "couldn't find that location, try a nearby landmark".
- No plans within budget → same `ValidationError` as planner ("raise budget or adjust preferences").
- Rate limit hit → same 429 path as planner.
- Save failure → toast, keep results on screen (not lost).

## Testing

- Unit: `mapTagsToCategories`, budget normalization (per-person vs total), each location-mode resolver → correct synthetic `presentLocations`.
- Integration: `quickPlanService.generate` for all 3 modes returns 4 valid plans within budget×1.10.
- Manual: form → generate → save → appears in history → share link works → feedback works.

## Open Risks

- Engine samples 4 spaced zones; anchor-zone mode can't hard-lock to exactly one zone without an engine flag. Accepted (spec non-goal). If user wants hard-lock later, add opt-in `forceZone` param to engine — separate change.
- Synthetic `groupData` must include every field the engine reads (outingDate, outingTime, groupType, vibes, generationOptions). Enumerate from engine + `buildFallbackItineraryData` reads during impl; default any missing.

