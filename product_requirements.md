# HANGOUT — Product Requirements Document
**Version 1.1 · MVP Scope**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Goals](#3-product-goals)
4. [Target Audience](#4-target-audience)
5. [Core User Flow](#5-core-user-flow)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Technical Architecture](#8-technical-architecture)
9. [MVP Scope](#9-mvp-scope)
10. [Phased Roadmap](#10-phased-roadmap)
11. [MVP Launch Criteria](#11-mvp-launch-criteria)

---

## 1. Executive Summary

Hangout is a collaborative group planning platform that eliminates the friction of organising group outings. Instead of juggling multiple chat threads, manually searching venue options, calculating travel fairness, and arguing over budgets, users create a planning group and let Hangout coordinate everything automatically.

The platform collects each participant's location, budget, and activity preferences, runs them through a midpoint and scoring engine, then passes the shortlisted venues to **Groq's LLM API** to generate **3–4 distinct, narrative-quality itineraries** per group. Members then vote on their preferred plan and lock in a final outing.

Hangout is not a maps app, not a chat app, and not an expense tracker. It is the coordination layer that connects all three into a single, sub-five-minute decision-making workflow.

---

## 2. Problem Statement

Planning a group outing involves a predictable set of recurring problems:

- Participants live in different parts of the city — finding a fair central location requires manual effort most people skip.
- Individual spending capacities vary widely — one person's "cheap" is another's expensive.
- Group decisions via chat are slow and inconclusive, favouring whoever is most persistent.
- Venue discovery is fragmented across Maps, Zomato, Google, and social media.
- Travel fairness is ignored — the person farthest from the chosen venue bears a disproportionate burden.
- Plans collapse at the last minute because no one owns the confirmation step.

### Existing Tool Gaps

| Tool | What It Does | What It Misses |
|---|---|---|
| Google Maps | Venue discovery and navigation | Group coordination, budgets, voting |
| WhatsApp | Group communication | Structured decisions, venue data |
| Splitwise | Post-outing expense splitting | Pre-outing planning and discovery |
| Doodle | Scheduling polls | Location selection, budget, venue data |

Hangout combines location intelligence, budget-aware venue filtering, Groq-powered itinerary generation, and group voting into one flow that takes under five minutes from group creation to confirmed plan.

---

## 3. Product Goals

### 3.1 Primary Goals (MVP)

- Reduce group planning time from 30–60 minutes to under 5 minutes.
- Automatically generate optimised, human-readable meetup plans based on real group constraints.
- Ensure fair travel distribution so no single participant bears excessive burden.
- Respect individual budget constraints — never recommend venues outside group affordability.
- Use Groq LLM to produce genuinely useful, varied itineraries — not just sorted venue lists.
- Deliver a mobile-first experience that requires no onboarding or tutorial.

### 3.2 Success Metrics

| Metric | Target | Measurement Method |
|---|---|---|
| Group creation time | < 60 seconds | Analytics event tracking |
| Time from group creation to plan | < 5 minutes | Session funnel analysis |
| Invitation acceptance rate | > 70% | Invite link click-through rate |
| Plan completion rate | > 60% | Voting → confirmed plan conversion |
| 30-day user retention | > 25% | Cohort retention analysis |
| Mobile usage share | > 70% | Device type breakdowns |
| Itinerary satisfaction rating | > 4.0 / 5.0 | Post-outing rating prompt |
| Groq generation success rate | > 98% | API error monitoring |
| Groq itinerary latency (p95) | < 3 seconds | Backend timing logs |

---

## 4. Target Audience

### 4.1 Primary — College Students

- Frequent group outings (2–4× per month)
- Budget-sensitive (₹200–₹700 per outing per head)
- Large, fluid friend groups (5–15 people)
- Desire quick, low-effort decisions
- High mobile usage, low tolerance for complex UX

### 4.2 Secondary — Young Professionals (22–30)

- Limited time — need fast, reliable plans
- Geographically dispersed friend networks
- Higher per-head budgets (₹700–₹2,000)
- Value quality and variety over lowest price

### 4.3 Tertiary — Couples

- Date planning and activity discovery use case
- Two-person midpoint is simpler but the recommendation + itinerary flow adds real value
- Budget-conscious for regular outings, flexible for special occasions

### 4.4 Future — Corporate Teams

- Team lunches, off-sites, celebration events
- Larger groups with strict budget approvals
- Will require receipt / expense documentation (Phase 2+)

---

## 5. Core User Flow

> The entire flow — from group creation to a confirmed, voted-on plan — must be completable in a single mobile session without switching apps.

| Step | Actor | Action | System Response |
|---|---|---|---|
| 1 | User | Signs in via Clerk | User record synced to D1 database |
| 2 | Creator | Creates group (name, type, description) | Group created; unique 8-char invite code generated |
| 3 | Creator | Shares invite link or QR code | Invite tracked; 7-day expiry set |
| 4 | Member | Joins via link | GroupMember record created; creator notified |
| 5 | Each member | Enters maximum budget | Budget stored; group aggregate updated |
| 6 | Each member | Submits location (GPS / map pin / address) | Coordinates validated and stored |
| 7 | System | Calculates geographic midpoint | Arithmetic mean of all coordinates |
| 8 | System | Searches venues near midpoint via Ola Maps | Up to 50 candidates fetched per category |
| 9 | System | Scores and ranks all candidates | Top 10–15 venues selected as context |
| 10 | **Groq LLM** | **Receives top venues + group context** | **Generates 3–4 distinct named itinerary plans** |
| 11 | Members | View itineraries in the Planner | Each itinerary shown as a time-slotted, named plan card |
| 12 | Members | Vote on preferred itinerary | Votes tallied; one vote per user; live counts shown |
| 13 | System | Declares winner by majority | Winning plan confirmed; all members notified |
| 14 | Group | Meets up | Post-outing, plan saved to history |

---

## 6. Functional Requirements

### 6.1 Authentication

Provider: **Clerk**. All session management is delegated to Clerk; Hangout stores only a shadow user record in D1.

- Email + password signup and sign-in
- Google OAuth sign-in
- Password reset via email
- Automatic session management and refresh
- Clerk webhook triggers user sync to local D1 database on first sign-in
- All protected routes reject unauthenticated requests with HTTP 401

### 6.2 User Profile

| Field | Type | Constraints |
|---|---|---|
| id | UUID | Internal primary key |
| clerkId | String | Unique — links to Clerk user |
| email | String | Validated format |
| name | String | 2–80 characters |
| imageUrl | String (URL) | Nullable; sourced from Clerk or R2 |
| preferredBudgetMin | Integer (INR) | ≥ ₹0 |
| preferredBudgetMax | Integer (INR) | ≤ ₹100,000 |
| favoriteActivities | String[] | Array of VenueCategory enums |
| createdAt | Timestamp | Auto-set on insert |
| updatedAt | Timestamp | Auto-set on update |

### 6.3 Groups

| Field | Type | Constraints |
|---|---|---|
| id | UUID | Auto-generated |
| name | String | 3–60 characters, not blank |
| description | String | Optional, max 300 characters |
| groupType | Enum | `FRIENDS` \| `DATE` \| `FAMILY` \| `WORK` \| `CUSTOM` |
| creatorId | UUID (FK) | References users.id |
| inviteCode | String (8 chars) | Unique, alphanumeric, auto-generated |
| status | Enum | `ACTIVE` \| `ARCHIVED` \| `DELETED` |
| maxMembers | Integer | Default 20 |
| createdAt | Timestamp | Auto-set |
| updatedAt | Timestamp | Auto-set |

**Business rules:**
- Only the OWNER can edit, delete, or archive the group.
- Deleted groups are soft-deleted (status = DELETED) and hidden from queries but retained for audit.
- Invite codes expire after 7 days and can be revoked and reissued by the OWNER at any time.
- A user cannot be a member of the same group twice (unique constraint on groupId + userId).
- If the OWNER wants to leave, they must transfer ownership first.

### 6.4 Group Membership

| Role | Permissions |
|---|---|
| OWNER | Edit group, delete group, remove members, transfer ownership, revoke invites, view all member data |
| MEMBER | View group, submit budget, submit location, vote, leave group |

### 6.5 Budget Collection

- One budget entry per user per group (enforced by UNIQUE constraint at DB level).
- Budget range: ₹50 minimum — ₹100,000 maximum.
- Derived aggregates (computed at query time, not stored): `groupMinBudget`, `groupAvgBudget`, `groupTotalBudget`, `groupMaxBudget`.
- Budget updates are allowed any time before voting begins.
- **Privacy rule:** Individual amounts are never exposed to other members. Only aggregate stats are shown. The Groq prompt receives only `groupMinBudget` and `groupAvgBudget` — never individual amounts.

### 6.6 Location Collection

Three input methods, all producing a `(latitude, longitude)` pair:

1. **GPS** — Browser Geolocation API; requires user permission.
2. **Map Pin** — User drops a pin on an embedded Ola Map.
3. **Address Search** — User types an address; Ola Maps geocoding returns coordinates.

**Validation:** Latitude: -90 to +90. Longitude: -180 to +180.

**Privacy rule:** Individual coordinates are never exposed to non-owner clients. Members see only the computed midpoint.

### 6.7 Midpoint Engine

**Version 1 (MVP):** Arithmetic mean of all submitted coordinates.

```
midpoint.lat = Σ(member.lat) / count
midpoint.lng = Σ(member.lng) / count
```

Requires minimum 2 locations. Throws `INSUFFICIENT_LOCATIONS` error if fewer.

**Version 2 (post-MVP):** Weighted Haversine midpoint with travel-time fairness scoring using Ola Maps Distance Matrix, penalising configurations that create uneven travel times across members.

### 6.8 Venue Discovery

Source: **Ola Maps Places API** (Nearby Search endpoint).

| Category Enum | Ola Maps Query Term | Default Search Radius |
|---|---|---|
| CAFE | cafe | 3 km |
| RESTAURANT | restaurant | 3 km |
| PARK | park | 5 km |
| ARCADE | arcade game center | 5 km |
| BOWLING | bowling alley | 10 km |
| ESCAPE_ROOM | escape room | 10 km |
| MOVIE | movie theatre | 5 km |
| MALL | shopping mall | 5 km |
| DESSERT | dessert shop | 3 km |
| SPORTS | sports complex | 10 km |
| MUSEUM | museum | 10 km |

Up to 50 candidates fetched per category. Deduplicated by place ID before scoring. If no results within radius, expand 2× and retry once.

### 6.9 Recommendation Engine (Pre-Groq Filtering)

The scoring engine narrows the full venue pool down to a **curated shortlist of 10–15 venues** that become the context for Groq. It does not generate the itineraries — that is Groq's job.

**Scoring formula (per venue):**

```
finalScore = (distanceScore × 0.40) + (budgetScore × 0.30) + (ratingScore × 0.20) + (preferenceScore × 0.10)
```

| Component | Calculation | Range |
|---|---|---|
| distanceScore | `1 - (distanceKm / maxDistanceKm)`; venues beyond max score 0 | 0–1 |
| budgetScore | 1 if estimatedCost ≤ groupMinBudget; linear decay above min, 0 if above groupAvgBudget | 0–1 |
| ratingScore | `venue.rating / 5.0` | 0–1 |
| preferenceScore | Fraction of members who listed this category as a preference | 0–1 |

Output: top 10–15 venues, sorted by finalScore descending, passed to the Groq Itinerary Engine.

### 6.10 Groq Itinerary Engine ⭐

This is the core AI feature. After venue scoring, the backend calls **Groq's API** (`groq-sdk`) to generate **3–4 complete, named, human-readable itinerary plans** for the group.

#### What Groq Receives (the prompt context)

```json
{
  "groupContext": {
    "groupName": "Koramangala Crew",
    "groupType": "FRIENDS",
    "memberCount": 5,
    "groupMinBudget": 300,
    "groupAvgBudget": 520,
    "preferredCategories": ["CAFE", "BOWLING", "RESTAURANT"],
    "midpointAddress": "Koramangala 5th Block, Bengaluru"
  },
  "availableVenues": [
    {
      "id": "venue_abc",
      "name": "Third Wave Coffee",
      "category": "CAFE",
      "rating": 4.6,
      "distanceFromMidpoint": "0.4 km",
      "estimatedCostPerHead": 180,
      "openNow": true,
      "address": "100 Feet Rd, Koramangala"
    }
    // ... up to 15 venues
  ]
}
```

#### What Groq Returns (structured JSON)

Groq is instructed to respond **only** in the following JSON structure (no preamble, no markdown):

```json
{
  "itineraries": [
    {
      "id": "plan_1",
      "name": "Chill & Bowl",
      "tagline": "A relaxed afternoon with good coffee and friendly competition",
      "totalEstimatedCostPerHead": 480,
      "totalDurationMinutes": 270,
      "slots": [
        {
          "order": 1,
          "venueId": "venue_abc",
          "venueName": "Third Wave Coffee",
          "category": "CAFE",
          "arrivalTime": "12:00 PM",
          "durationMinutes": 60,
          "travelToNextMinutes": 15,
          "estimatedCostPerHead": 180,
          "note": "Great spot to kick things off — known for their cold brew and comfortable seating."
        }
      ]
    }
  ]
}
```

#### Itinerary Generation Rules (enforced in the system prompt)

- Generate **exactly 3 or 4** itineraries. Never fewer than 3.
- Each itinerary must have **3–5 venue slots**.
- Every itinerary must include **at least one meal** (RESTAURANT or CAFE).
- **No venue may appear in more than one itinerary.**
- Total estimated cost per head must not exceed `groupAvgBudget`.
- Each itinerary must have a **unique name and tagline** that reflects its character (e.g. "Budget Bites & Beats", "The Long Afternoon").
- Time slots must be realistic — include at least 15 minutes travel buffer between venues.
- Venue notes must be genuine and helpful (why this venue fits, what to expect), not generic filler.
- Itineraries must be meaningfully different from each other in vibe, category mix, or cost level.
- If `groupType` is `DATE`, generate itineraries suited for two people with a romantic or intimate tone. If `FAMILY`, prioritise family-friendly venues.

#### Groq API Configuration

| Setting | Value |
|---|---|
| Model | `llama-3.3-70b-versatile` |
| Max Tokens | 2,048 |
| Temperature | 0.7 |
| Response Format | JSON mode (forced) |
| Timeout | 10 seconds |
| Retry on failure | 1 retry with exponential backoff |

#### Groq Error Handling

| Failure Scenario | Fallback Behaviour |
|---|---|
| Groq API timeout (>10s) | Retry once; if second attempt fails, return `GROQ_TIMEOUT` error to client with "Plan generation is taking longer than usual — try again" message |
| Invalid JSON returned | Log malformed response; retry once with explicit JSON instruction added to prompt |
| Rate limit hit (429) | Queue and retry after 2 seconds; surface graceful loading state to user |
| Groq API down | Return `GROQ_UNAVAILABLE` error; suggest retrying in a few minutes |

### 6.11 Voting System

- Members vote on **complete itineraries** (not individual venues).
- **One vote per user** per group planning session, enforced by UNIQUE(groupId, userId) constraint.
- Users may change their vote while voting is OPEN.
- Voting closes automatically 24 hours after opening, or when OWNER manually calls `closeVoting()`.
- Winner determined by simple majority. Ties resolved by creator pick.
- Vote counts (not individual choices) are visible to all members in real time.

### 6.12 Invitation System

- Invite code: 8-character alphanumeric string, case-insensitive, globally unique.
- Invite link format: `hangout.app/join/[inviteCode]`
- QR code generated client-side from the invite link.
- Invites expire after 7 days. Expired invites return a clear error with option to request a fresh link from the group owner.
- OWNER can revoke and reissue the invite code at any time.
- Future: WhatsApp deeplink share, SMS share.

### 6.13 In-App Notifications

Triggered events:
- Member joins group
- Another member submits budget or location
- All members have submitted — plan generation unlocked
- Itineraries have been generated (Groq complete)
- Voting opens
- Voting closes and winner is declared

Push notifications (FCM) are a Phase 2 feature.

### 6.14 History

- Every confirmed and completed plan is saved to the History module.
- Records contain: date, group name, winning itinerary name and tagline, venue list, participants, estimated total cost per head.
- Filterable by group, by date range.
- Frequently visited venues tracked per user for future preference weighting in the scoring engine.

---

## 7. Non-Functional Requirements

| Category | Requirement | Target |
|---|---|---|
| Performance | Initial page load (LCP on 4G) | < 3 seconds |
| Performance | Groq itinerary generation (p95) | < 3 seconds |
| Performance | Venue search + scoring | < 2 seconds |
| Performance | API response time (p95, non-Groq) | < 500ms |
| Availability | Monthly uptime SLA | 99% |
| Scalability | Concurrent active users (MVP) | 1,000 |
| Scalability | Registered users (6-month target) | 10,000+ |
| Security | Authentication coverage | 100% of protected routes |
| Security | Rate limiting | 100 req/min per user |
| Security | Input validation | All inputs validated server-side via Zod |
| Security | Groq API key | Server-side only; never in client bundle |
| Accessibility | Mobile responsiveness | All screens usable at 320px width |
| Accessibility | Keyboard navigation | All interactive elements reachable |
| Accessibility | Colour contrast | WCAG AA compliance |

---

## 8. Technical Architecture

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router) | RSC + streaming |
| Backend | Next.js Server Actions + Route Handlers | Collocated; type-safe |
| Authentication | Clerk | Sessions, OAuth, webhooks |
| Database | Cloudflare D1 (SQLite) | Edge-deployed via Drizzle ORM |
| Storage | Cloudflare R2 | Profile images, QR codes |
| Maps / Places | Ola Maps API | Geocoding, nearby search, distance matrix |
| **AI / Itinerary** | **Groq API (`groq-sdk`)** | **LLM-powered itinerary generation** |
| Hosting | Vercel | Edge deployment, preview environments |
| Validation | Zod | Runtime type safety on all server inputs |

---

## 9. MVP Scope

### Included

- Authentication (email + Google OAuth)
- User profiles with activity preferences and budget range
- Group creation, editing, deletion, archival
- Invite link and QR code generation
- Per-member budget submission with privacy-preserving aggregate display
- Location collection (GPS, map pin, address search)
- Arithmetic midpoint calculation
- Ola Maps venue search (all 11 categories)
- 4-factor recommendation scoring engine
- **Groq-powered itinerary generation (3–4 plans per group)**
- **Named, taglined, time-slotted itineraries with venue notes**
- In-app voting with live results
- Plan history and past outing records
- In-app notifications (no push)
- Mobile-responsive UI

### Explicitly Excluded from MVP

- AI/ML personalisation beyond Groq itineraries
- Real-time chat
- Expense splitting and receipt tracking
- Google Calendar / iCal integration
- Push notifications (FCM)
- WhatsApp / SMS share
- Weather-aware planning adjustments
- Hotel or accommodation suggestions
- Corporate team features (approvals, expense codes)

---

## 10. Phased Roadmap

| Phase | Timeline | Features |
|---|---|---|
| MVP (1.0) | Month 1–3 | All items in Section 9 MVP Scope |
| Phase 2 | Month 4–6 | Expense splitting, push notifications (FCM), WhatsApp share, Google Calendar sync |
| Phase 3 | Month 7–9 | Groq personalisation (user history weighting), weather-aware plan adjustments, dynamic itinerary regeneration |
| Phase 4 | Month 10–12 | Hotel suggestions, multi-city trip planning, travel mode |
| Phase 5 | Year 2 | Corporate team planning, event management, analytics dashboard |

---

## 11. MVP Launch Criteria

> The product is launch-ready only when **all** of the following are satisfied.

- [ ] Users can create a group and receive a working invite link.
- [ ] Members can join via invite link within the 7-day expiry window.
- [ ] All members can independently submit budgets and locations.
- [ ] Midpoint is calculated and displayed on the group map view.
- [ ] Venue search returns at least 10 scored results across 3+ categories.
- [ ] Groq generates 3–4 valid, distinct itinerary plans for any group with 2+ locations.
- [ ] Each Groq itinerary has a unique name, tagline, time-slotted slots, and per-slot notes.
- [ ] Groq errors (timeout, API down) are handled gracefully with user-facing messages.
- [ ] Members can vote and the winning itinerary is declared correctly.
- [ ] Confirmed plans are saved and retrievable from history.
- [ ] All core flows are fully functional on iOS Safari and Android Chrome.
- [ ] No P0 or P1 bugs open.
- [ ] Lighthouse performance score ≥ 80 on mobile.
- [ ] Groq API key is server-side only and never exposed in client bundles.
- [ ] All API endpoints return correct responses for both success and defined error cases.
