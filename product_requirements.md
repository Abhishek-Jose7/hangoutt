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
- Outings default to boring, repetitive venue lists (e.g. Cafe -> Bowling -> Cafe) instead of unique, memorable experiences.
- Venue and event discovery is fragmented across Google Maps, BookMyShow, Eventbrite, and social media.
- Travel fairness is ignored — the person farthest from the chosen venue bears a disproportionate burden.
- Plans collapse at the last minute because no one owns the confirmation step.

### Existing Tool Gaps

| Tool | What It Does | What It Misses |
|---|---|---|
| Google Maps | Venue discovery and navigation | Group coordination, budgets, voting, structured event/experience integration |
| WhatsApp | Group communication | Structured decisions, venue and event details |
| Splitwise | Post-outing expense splitting | Pre-outing collaborative planning and activity discovery |
| Doodle | Scheduling polls | Location selection, budget limits, venue and event curation |
| Ticket / Event Sites (BookMyShow, Eventbrite) | Ticket booking and event listings | Collaborative itinerary planning, midpoint calculations, group voting |

Hangout combines location intelligence, budget-aware experience and venue discovery, Groq-powered narrative itinerary generation, and group voting into one flow that takes under five minutes from group creation to confirmed plan.

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
| 8 | System | Searches local experiences near midpoint (D1 database records) and nearby venues via Ola Maps | Candidate pools gathered for both experiences and venues |
| 9 | System | Scores and ranks experiences and venues separately | Shortlist of top 10-15 experiences and top 10-15 venues selected |
| 10 | **Groq LLM** | **Receives top experiences + top venues + group context (with optional date vibes)** | **Generates 3–4 distinct itinerary plans built around primary experiences** |
| 11 | Members | View itineraries in the Planner | Each itinerary shown as a time-slotted, narrative plan card |
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
- Derived aggregates (computed at query time, not stored): `groupMinBudget` (the minimum of all submitted budgets), `groupAvgBudget`, `groupTotalBudget`, `groupMaxBudget`.
- Budget updates are allowed any time before voting begins.
- **Privacy rule:** Individual amounts are never exposed to other members. Only aggregate stats are shown.
- **Budget Tiering System:** Rather than forcing all plans to the absolute minimum budget (which overly constrains higher-spending participants), Hangout generates options across three distinct budget tiers. Itineraries must be categorized and clearly labeled in the UI:
  1. **Budget Friendly (Fits Everyone):** The total cost per head must strictly fit under the minimum budget cap submitted by any participant:
     $$\text{Itinerary Cost Per Head} \leq \min_{m \in \text{Members}} (m.\text{maxBudget}) = \text{groupMinBudget}$$
     This guarantees that at least 1-2 recommended plans are 100% financially accessible to all participants.
  2. **Balanced (Fits Most Members):** The total cost per head fits the average/median budget cap of the group. It may exceed the lowest budget cap but fits the majority of the members:
     $$\text{Itinerary Cost Per Head} \leq \text{groupAvgBudget}$$
  3. **Premium (Exceeds Some Budgets):** The total cost per head allows premium/luxury experiences, capping at the maximum budget submitted by any participant:
     $$\text{Itinerary Cost Per Head} \leq \max_{m \in \text{Members}} (m.\text{maxBudget}) = \text{groupMaxBudget}$$
     This gives groups options for special outings, indicating clearly in the UI which members' caps are exceeded.
- The Groq prompt receives `groupMinBudget`, `groupAvgBudget`, and `groupMaxBudget` along with instructions to generate at least one itinerary targeting each tier, labeling them accordingly.

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

### 6.8 Venue Discovery & Experience Taxonomy

#### 6.8.1 Venue Discovery
Source: **Ola Maps Places API** (Nearby Search endpoint).
Category filter enums and query mapping:
- `CAFE` (cafe, 3 km radius)
- `RESTAURANT` (restaurant, 3 km radius)
- `PARK` (park, 5 km radius)
- `ARCADE` (arcade game center, 5 km radius)
- `BOWLING` (bowling alley, 10 km radius)
- `ESCAPE_ROOM` (escape room, 10 km radius)
- `MOVIE` (movie theatre, 5 km radius)
- `MALL` (shopping mall, 5 km radius)
- `DESSERT` (dessert shop, 3 km radius)
- `SPORTS` (sports complex, 10 km radius)
- `MUSEUM` (museum, 10 km radius)

Up to 50 candidates fetched per category. Deduplicated by place ID before scoring. If no results within radius, expand 2× and retry once.

#### 6.8.2 Experience Discovery & Taxonomy
Source: **D1 Experiences Database** (populated by the background Ingestion Pipeline).
A dedicated experience taxonomy is established to prioritize unique events worth leaving the house for:
- `CONCERT`, `LIVE_MUSIC`, `COMEDY`, `THEATRE`
- `EXHIBITION`, `ART_GALLERY`, `MUSEUM`, `AQUARIUM`
- `WORKSHOP`, `POTTERY`, `PAINTING`
- `BOOK_EVENT`, `BOOKSTORE_EVENT`
- `FOOD_FESTIVAL`, `FLEA_MARKET`, `NIGHT_MARKET`
- `CONVENTION`, `COMIC_CON`, `ANIME_EVENT`, `GAMING_EVENT`, `BOARD_GAME_EVENT`
- `SPORTS_EVENT`, `LOCAL_EVENT`, `SEASONAL_EVENT`, `CULTURAL_EVENT`
- `OUTDOOR_EXPERIENCE`, `SCENIC_EXPERIENCE`
- `FREE_EXPERIENCE` (Public Art Installations, Heritage Walks, Community Events, Bookstore Browsing, Public Lectures, Beach Events, Open-Air Exhibitions)

#### 6.8.3 Group Vibe System
Group Type and Vibe are maintained as two completely separate concepts. Group Type defines the social context ("who is going"), while Vibes define the outing mood ("what kind of outing they want"). Any group outing can select **one or more vibes** (multi-select).

**Vibes Taxonomy**:
- `CHILL` (Boosts: Parks, Scenic Walks, Coffee Shops, Dessert Cafes)
- `CREATIVE` (Boosts: Pottery/Painting Workshops, Bookstore Events, Hands-on Craft Workshops)
- `FOODIE` (Boosts: Food Festivals, Night Markets, Group Dining, Street Food, Dessert Cafes)
- `CULTURAL` (Boosts: Museums, Art Galleries, Exhibitions, Heritage Walks, Book Events)
- `COMPETITIVE` (Boosts: Board Game Events, Arcades, Sports Events, Escape Rooms)
- `ADVENTUROUS` (Boosts: Outdoor Experiences, Interactive Games, Escape Rooms)
- `ROMANTIC` (Boosts: Live Music, Scenic Experiences, Fine Dining, Cultural Events, Scenic Walks)
- `LUXURY` (Boosts: Fine Dining, Premium Theatre, Orchestras, Art Gallery Previews)
- `BUDGET` (Boosts: Free Experiences, Flea Markets, Street Food Festivals, Public Parks)

By decoupling these, a user can plan a `FRIENDS` outing with `CREATIVE` vibe (producing Pottery $\rightarrow$ Cafe $\rightarrow$ Board Games), or a `FRIENDS` outing with `COMPETITIVE` vibe (producing Bowling $\rightarrow$ Arcade $\rightarrow$ Food), or a `DATE` outing with `CULTURAL` vibe (producing Museum $\rightarrow$ Bookstore $\rightarrow$ Coffee) without category explosion.

---

### 6.9 Recommendation Engine (Pre-Groq Filtering)

The system decoples the scoring of venues and experiences. The **Venue Engine** and **Experience Engine** run independently, sending their respective top shortlists to the **Planning Engine** to compose the final Groq prompt context.

#### 6.9.1 Venue Scoring Formula
Calculated per candidate venue:
$$\text{venueScore} = (\text{distanceScore} \times 0.40) + (\text{budgetScore} \times 0.30) + (\text{ratingScore} \times 0.20) + (\text{preferenceScore} \times 0.10)$$

Where:
- `distanceScore`: $1 - (\text{distanceKm} / \text{maxDistanceKm})$; venues beyond max score 0.
- `budgetScore`: $1$ if estimated cost $\leq$ `groupMinBudget`; linear decay to $0$ if cost exceeds `groupMinBudget`. (Strictly $0$ if cost exceeds `groupMinBudget`).
- `ratingScore`: $\text{venue.rating} / 5.0$.
- `preferenceScore`: Fraction of members who favor this venue's category.

#### 6.9.2 Experience Scoring Formula
Calculated per experience record:
$$\text{experienceScore} = (\text{distanceScore} \times 0.20) + (\text{ticketCostScore} \times 0.15) + (\text{popularityScore} \times 0.10) + (\text{preferenceScore} \times 0.10) + (\text{conversationQualityScore} \times 0.15) + (\text{freshnessScore} \times 0.15) + (\text{weatherSuitabilityScore} \times 0.15) + \text{groupTypeBoost} + \text{vibeBoost} + \text{availabilityBonus}$$

Scoring components:
1. **Distance Score**: Centered on the group's midpoint. $1 - (\text{distanceKm} / \text{maxRadius})$.
2. **Ticket Cost Score**: $1.0$ if the event is free (`FREE_EXPERIENCE`); $1.0 - (\text{price} / \text{groupMaxBudget})$ if price $\leq$ `groupMaxBudget`; $0$ if price exceeds `groupMaxBudget` (or filters into respective budget friendly / premium categories).
3. **Popularity Score**: Normalized score ($0.0$ to $1.0$) tracking ticket velocities and event capacities.
4. **Group Type Match Score (groupTypeBoost)**:
   - **DATE**: Museums, Art Galleries, Exhibitions, Aquariums, Pottery/Painting Workshops, Live Music, Scenic Walks (+0.40); Fine Dining, Theatre (+0.20); Large crowded festivals, competitive sports (-0.20).
   - **FRIENDS**: Concerts, Live Music, Comedy, Night Markets, Conventions, Gaming, Sports (+0.40); Board Games, Food Festivals (+0.20); Museums (-0.20).
   - **FAMILY**: Museums, Aquariums, Parks, Cultural/Seasonal Events (+0.40); Board Games, Family Workshops (+0.20); Nightlife (-0.20).
   - **WORK**: Team Activities, Workshops, Escape Rooms, Group Dining (+0.40); Cafes (+0.20); Romantic/Late-Night (-0.20).
5. **Vibe Match Score (vibeBoost)**: Applies a $+0.30$ boost to categories matching any of the selected group vibes defined in Section 6.8.3 (cumulative if an experience matches multiple selected vibes, capped at a maximum boost of $+0.60$).
6. **Availability Score (availabilityBonus)**: Multiplier (1.5x) if the event falls directly on the group's proposed meetup date.
7. **Weather Suitability Score (weatherSuitabilityScore)**:
   - Evaluates suitability based on real-time weather forecasts for the event date.
   - If heavy rain, extreme heat, or severe weather is forecast: applies a heavy penalty ($-0.50$) to outdoor activities (`OUTDOOR_EXPERIENCE`, `SCENIC_EXPERIENCE`, `FOOD_FESTIVAL`, `NIGHT_MARKET`, `FLEA_MARKET`, `PARK`) and a boost ($+0.40$) to indoor activities (`MUSEUM`, `ART_GALLERY`, `AQUARIUM`, `ESCAPE_ROOM`, `BOWLING`, `THEATRE`, `MALL`, `CAFE`, `RESTAURANT`).
8. **Conversation Quality Score (conversationQualityScore)**:
   - Measures how much the experience naturally fosters conversation and group interaction:
     * **High Conversation Quality** (Pottery, Painting, Museum, Art Gallery, Board Game Event, Workshops): $+0.30$ boost. (Specifically boosted for `DATE` group type to prevent silent/awkward meetups).
     * **Low Conversation Quality** (Movie, Concert): $-0.20$ penalty for Date and Work groups where interaction is the primary objective.
9. **Experience Freshness Score (freshnessScore)**:
   - To prevent users from getting identical repeating suggestions (e.g. "Museum, Museum, Museum" every week), the engine tracks the group history:
     * **Last Recommended**: Applies a penalty ($-0.30$) if the experience or venue was recommended in the group's last 2 generated plans.
     * **Last Selected**: Applies a penalty ($-0.50$) if the experience or venue was selected in the last 30 days.
     * **Last Visited**: Applies a penalty ($-0.80$) if the experience or venue was visited in the last 60 days.

Output: The Planning Engine takes the top 10–15 venues and top 10–15 experiences, validates them against individual budget caps, and formats them as input payload for Groq.

### 6.10 Groq Itinerary Engine ⭐

This is the core AI feature. After venue scoring, the backend calls **Groq's API** (`groq-sdk`) to generate **3–4 complete, named, human-readable itinerary plans** for the group.

#### What Groq Receives (the prompt context)

```json
{
  "groupContext": {
    "groupName": "Weekend Outing",
    "groupType": "DATE",
    "vibes": ["ROMANTIC", "CREATIVE"],
    "memberCount": 2,
    "groupMinBudget": 300,
    "groupAvgBudget": 600,
    "groupMaxBudget": 1000,
    "preferredCategories": ["MUSEUM", "CAFE", "LIVE_MUSIC"],
    "midpointAddress": "Indiranagar, Bengaluru"
  },
  "availableExperiences": [
    {
      "id": "exp_1",
      "title": "Clay Pottery Taster Session",
      "category": "POTTERY",
      "ticketPrice": 250,
      "rating": 4.8,
      "distanceFromMidpoint": "1.2 km",
      "address": "12th Main, Indiranagar"
    }
  ],
  "availableVenues": [
    {
      "id": "venue_abc",
      "name": "The Glen's Bakehouse",
      "category": "CAFE",
      "rating": 4.4,
      "distanceFromMidpoint": "0.6 km",
      "estimatedCostPerHead": 120,
      "openNow": true,
      "address": "80 Feet Rd, Indiranagar"
    }
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
      "name": "Artistic Romance",
      "tagline": "Craft a unique keepsake together, followed by cozy treats.",
      "budgetTier": "BUDGET_FRIENDLY",
      "totalEstimatedCostPerHead": 370,
      "totalDurationMinutes": 180,
      "slots": [
        {
          "order": 1,
          "experienceId": "exp_1",
          "venueId": null,
          "name": "Clay Pottery Taster Session",
          "category": "POTTERY",
          "arrivalTime": "02:00 PM",
          "durationMinutes": 90,
          "travelToNextMinutes": 15,
          "estimatedCostPerHead": 250,
          "note": "Get hands-on with a private pottery wheel taster class — perfect for building shared memories."
        },
        {
          "order": 2,
          "experienceId": null,
          "venueId": "venue_abc",
          "name": "The Glen's Bakehouse",
          "category": "CAFE",
          "arrivalTime": "03:45 PM",
          "durationMinutes": 60,
          "travelToNextMinutes": null,
          "estimatedCostPerHead": 120,
          "note": "Relax and chat about your pottery creations over their signature red velvet cupcakes."
        }
      ]
    }
  ]
}
```

#### Itinerary Generation Rules (enforced in the system prompt)

- **Prioritize Experiences**: Each itinerary must be built around a high-scoring Primary Experience (including `FREE_EXPERIENCE` alternatives). Venues are selected to complement the experience.
- **Narrative Story Flow**: Slots must follow a logical sequence that reads like a story, e.g., Primary Experience $\rightarrow$ Complementary Dining $\rightarrow$ Optional Secondary Activity/Scenic Walk.
- **Tiered Budgeting Options**: Rather than forcing all plans to the absolute minimum budget, generate options targeting three distinct budget tiers:
  * **BUDGET_FRIENDLY**: Total cost per head $\leq$ `groupMinBudget`.
  * **BALANCED**: Total cost per head $\leq$ `groupAvgBudget`.
  * **PREMIUM**: Total cost per head $\leq$ `groupMaxBudget`.
  * Generate **exactly 3 or 4** itineraries, including at least one plan representing each budget tier.
- Each itinerary must have **2–4 slots**.
- Every itinerary must include **at least one dining slot** (RESTAURANT or CAFE).
- **No venue or experience may appear in more than one itinerary.**
- Each itinerary must have a **unique name and tagline** reflecting its vibe and group activity profile.
- Time slots must be realistic — include at least 15 minutes travel buffer between consecutive slots.
- Notes must be tailored to the group configuration and the selected `vibe` (if any).
- If `groupType` is `DATE`, generate plans with romantic/intimate descriptions and prioritize experiences that foster **High Conversation Quality** (such as workshops, pottery, galleries, or museum tours). If `FAMILY`, prioritize family-friendly venues. If `WORK`, focus on team cohesion.

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
