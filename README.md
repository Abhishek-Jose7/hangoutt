# ⚡ Smart AI Hangout Planner

Plan group hangouts in Mumbai with AI-powered itineraries, fair travel time calculations, and real-time multiplayer voting — all while maintaining an exceptional, high-end "warm editorial" UI design.

![Hangout Planner Preview](https://via.placeholder.com/1200x630.png?text=Smart+AI+Hangout+Planner+-+Dark+Mesh+Gradient)

## ✨ Core Features

1. **Smart Location Hub**: Automatically discovers the fairest meeting point across Mumbai's complex local train network using advanced geometric algorithms (Center Point, Most Efficient, Fairest Travel, Cultural Vibe matches).
2. **AI-Powered Plans**: Integrates beautifully with **Groq** and **Tavily Semantic Search** to generate 4 beautifully curated itineraries tailored to your group's collective budgets and specific moods.
3. **Multiplayer Voting**: Real-time room state, synchronized voting, and admin-controlled confirmation flows powered continuously by Supabase Postgres Subscriptions and Zustand.
4. **Transit & Budget Optimization**: Applies specific Haversine distance computations and train interchange penalties internally to ensure fair routing for everyone.

---

## 🛠️ Tech Stack & Architecture

- **Framework:** Next.js 16.2.2 (App Router with API Serverless Functions)
- **Database / Realtime:** Supabase (PostgreSQL with Realtime broadcasts)
- **Authentication:** Clerk (with secure Svix Webhook syncing to Supabase)
- **Styling:** TailwindCSS v4 with custom tokens, animations, and Framer Motion logic.
- **Search & AI:** Groq (LLaMA-3 for Itineraries), Typesense (primary venue index search), Tavily API (web fallback venue discovery)
- **Geocoding:** Rate-limited OpenStreetMap Nominatim.
- **Caching:** Upstash Redis.
- **State Management:** Zustand, TanStack Query.

---

## 🚀 Getting Started

### 1. Requirements

- Node.js 18.0.0+ 
- A Supabase project
- A Clerk project
- API Keys for: Groq (supports role-based keys via `GROQ_API_KEY_GENERATOR`, `GROQ_API_KEY_RETRY`, `GROQ_API_KEY_OVERSEER`; each can be comma-separated and rotates per role; or legacy `GROQ_API_KEYS`), Typesense (optional), Tavily, Upstash Redis

### 2. Installation

Clone the repository and install the required dependencies:

```bash
git clone https://github.com/your-username/hangout.git
cd hangout
npm install
```

### 3. Database Setup

Using your Supabase Dashboard's SQL Editor, run the full database migration located exactly at:
`src/migrations/001_initial.sql`

*This schema constructs the Users, Rooms, Members, Options, and Voting tables while immediately activating Supabase Realtime Replications.*

### 4. Environments

Copy the `.env.local.example` configuration over to your `.env.local` environment map and fill in your variables securely:

```bash
cp .env.local.example .env.local
```

Make sure **Clerk webhook secrets**, **Supabase Service Keys**, and all **AI keys** are never directly exposed to the browser. Everything routing externally executes within `/api/*` handlers locally.

### 5. Running the Application

Launch the development server:

```bash
npm run dev
```

Point your browser to [http://localhost:3000](http://localhost:3000) and start your first room!

### 6. Itinerary CLI Scripts

This repo includes two itinerary CLIs:

- `npm run itinerary` -> `scripts/itinerary-cli.ts`
- `npm run itinerary:discovery` -> `scripts/itinerary-discovery-cli.ts`

Both scripts support interactive user input. If you run them without args, they prompt for location, mood, budget, start time, and profile, then print the generated itinerary.

### One-Line Quick Runs (All 3 Scripts)

- `npm run itinerary:demo`
	- Runs a stable standard itinerary demo (`searchPlaces` + deterministic engine + Groq review).
- `npm run itinerary:discovery:demo`
	- Runs the discovery-layer itinerary demo (Tavily discovery -> OSM/Typesense merge -> deterministic engine + Groq review).
- `npm run typesense:live-sync -- --areas "Bandra West,Borivali"`
	- Runs one live Tavily -> Typesense ingestion cycle for the listed areas (discover, validate, dedupe, upsert).

#### A) Standard Itinerary Script (`itinerary`)

Show help:

```bash
npm run itinerary -- --help
```

Run sample:

```bash
npm run itinerary:demo
```

Run interactive (prompts for user input):

```bash
npm run itinerary
```

Run custom:

```bash
npm run itinerary -- Borivali -m fun -b 1000 -t 12:00 -p chill_walk --strict --trace
```

How it works:

1. Resolves the hub location (geocode + fallback coordinates).
2. Calls the unified search pipeline (`searchPlaces`) that combines and filters venue candidates.
3. Validates places (distance, grounding, and quality checks).
4. Builds a deterministic itinerary flow from the validated places.
5. Sends the deterministic plan to Groq reviewer/retry loop for final realism corrections.

#### B) Discovery-Layer Script (`itinerary:discovery`)

Show help:

```bash
npm run itinerary:discovery -- --help
```

Run sample:

```bash
npm run itinerary:discovery:demo
```

Run interactive (prompts for user input):

```bash
npm run itinerary:discovery
```

Run custom:

```bash
npm run itinerary:discovery -- Borivali -m fun -b 1000 -t 12:00 -p chill_walk --no-trace
```

How it works:

1. Resolves the hub/midpoint area first.
2. Uses Tavily as a discovery layer with adaptive strict -> relaxed fallback to find concrete venue names near the area.
3. Geocodes each discovered name and keeps only nearby valid venues.
4. Fetches structured OSM and Typesense candidates in parallel.
5. Merges all sources, deduplicates by name similarity, ranks with only a small Tavily boost.
6. Runs final place validation, deterministic itinerary generation, and Groq review.

When to use which:

- Use `itinerary` for the default end-to-end planning path.
- Use `itinerary:discovery` when you want explicit source tracing and Tavily discovery behavior separated from structured retrieval.

---

## 📂 Project Structure Highlights

- **`src/app/api/`**: All backend logic tightly secured. Endpoints cover room manipulations, safe Supabase admin writes, Clerk Webhooks, API rate-limiting via Upstash, and AI generation.
- **`src/app/rooms/[id]/`**: Component breakdown mirroring specific multiplayer room states (`lobby`, `planning`, `generating`, `voting`, `confirmed`). 
- **`src/lib/`**: Heavy computational engines (Transit mapping, Haversine equations, Groq itinerary generation).
- **`src/hooks/useRoom.ts`**: Unified frontend TanStack hook layers enforcing optimistic UI.

---

## 🔎 Typesense Venue Sync Pipeline

This project includes a server-side ingestion script at `scripts/typesense-sync.mjs` (wired to `npm run typesense:sync`) that builds and refreshes the `venues` collection from real OpenStreetMap data.

### Pipeline Stages

1. **Geocode area to centroid**
	 - Uses Nominatim with area + city + country.
2. **Fetch OSM places from Overpass**
	 - Queries venue-focused tags (`amenity`, `leisure`, `tourism`, `shop`).
	 - Includes retry + mirror fallback for reliability.
3. **Clean and normalize**
	 - Drops rows missing `name`, `lat`, `lng`.
	 - De-duplicates by normalized name + geo bucket.
4. **Transform to Typesense schema**
	 - Maps OSM tags to `type`, `tags`, `area`, and inferred `mood`.
	 - Builds stable `id`, cost estimate, rating fallback, popularity score, and map URL.
5. **Bulk upsert import**
	 - Uses `/documents/import?action=upsert` so existing docs update cleanly.

### Required `venues` Schema

Ensure your Typesense collection uses this shape:

```json
{
	"name": "venues",
	"fields": [
		{ "name": "id", "type": "string" },
		{ "name": "name", "type": "string" },
		{ "name": "description", "type": "string", "optional": true },
		{ "name": "tags", "type": "string[]", "optional": true, "facet": true },
		{ "name": "area", "type": "string", "optional": true, "facet": true },
		{ "name": "mood", "type": "string[]", "optional": true, "facet": true },
		{ "name": "type", "type": "string", "facet": true },
		{ "name": "estimated_cost", "type": "int32", "optional": true },
		{ "name": "lat", "type": "float" },
		{ "name": "lng", "type": "float" },
		{ "name": "rating", "type": "float", "optional": true },
		{ "name": "popularity", "type": "int32", "optional": true },
		{ "name": "url", "type": "string", "optional": true }
	]
}
```

### Environment Variables (Important)

Set these in `.env.local` (or runtime env):

- `TYPESENSE_HOST`
- `TYPESENSE_PROTOCOL` (typically `https`)
- `TYPESENSE_PORT` (typically `443`)
- `TYPESENSE_COLLECTION` (typically `venues`)
- `TYPESENSE_API_KEY` (search/import if key permissions allow)
- `TYPESENSE_ADMIN_API_KEY` (recommended for import/upsert)

Use strict `.env` syntax:

```dotenv
TYPESENSE_HOST=edzboajp2fuk0wlsp-1.a2.typesense.net
TYPESENSE_PROTOCOL=https
TYPESENSE_PORT=443
TYPESENSE_COLLECTION=venues
TYPESENSE_API_KEY=...
TYPESENSE_ADMIN_API_KEY=...
```

Do not add spaces around `=` and do not paste shell commands like `curl ...` into `.env.local`.

### Commands

Dry-run (safe, no import):

```bash
npm run typesense:sync -- --area "Bandra West" --city "Mumbai" --dry-run --skip-schema-check
```

Dry-run with remote schema check:

```bash
npm run typesense:sync -- --area "Bandra West" --city "Mumbai" --dry-run
```

Real upsert import:

```bash
npm run typesense:sync -- --area "Bandra West" --city "Mumbai"
```

Larger radius + capped docs:

```bash
npm run typesense:sync -- --area "Powai" --city "Mumbai" --radius 3500 --limit 600 --batch-size 150
```

### Full CLI Reference

- `--area <name>`: required target locality.
- `--city <name>`: default `Mumbai`.
- `--country <name>`: default `India`.
- `--radius <meters>`: default `2800`.
- `--limit <count>`: default `450` transformed docs.
- `--batch-size <count>`: default `100` import batch size.
- `--timeout <seconds>`: default `50` for Overpass query.
- `--collection <name>`: default `TYPESENSE_COLLECTION` or `venues`.
- `--dry-run`: generate docs only; no import write.
- `--skip-schema-check`: skip remote collection schema validation.
- `--help`: print usage.

### What the Script Validates

- Required fields and types before import.
- Optional remote schema compatibility (unless skipped).
- Import response line-by-line to report failed rows.

### Scheduling / Automation

Single area, every 6 hours:

```bash
0 */6 * * * cd /path/to/hangout && npm run typesense:sync -- --area "Bandra West" --city "Mumbai" >> /var/log/hangout-typesense-sync.log 2>&1
```

Multiple areas, nightly:

```bash
0 2 * * * cd /path/to/hangout && for area in "Bandra West" "Powai" "Andheri West" "Lower Parel"; do npm run typesense:sync -- --area "$area" --city "Mumbai"; done >> /var/log/hangout-typesense-sync.log 2>&1
```

## Live Tavily -> Typesense Continuous Sync

This repo now includes a continuous learning ingestion worker at [scripts/tavily-typesense-live-sync.mjs](scripts/tavily-typesense-live-sync.mjs).

Purpose:

1. Discover fresh venues from Tavily every cycle.
2. Validate/geocode/clean those candidates.
3. Fuzzy-merge with existing Typesense docs.
4. Upsert stable venue records so the store improves over time.
5. Apply popularity boosts for repeated discoveries and stale decay for long-unseen entries.

### Run Commands

One-shot cycle (good for cron):

```bash
npm run typesense:live-sync -- --areas "Bandra West,Borivali,Andheri West"
```

Continuous worker loop:

```bash
npm run typesense:live-worker -- --areas "Bandra West,Borivali" --interval-hours 4
```

Dry-run preview (no writes):

```bash
npm run typesense:live-dry -- --areas "Bandra West"
```

### How The Live Sync Works

1. Scheduler/worker loop runs every `--interval-hours` for active areas.
2. For each area, it generates smart Tavily queries (cafes, restaurants, activities, outdoor).
3. It extracts only concrete venue names from Tavily results (filters vague list-like phrases).
4. Each candidate is geocoded with Nominatim and rejected if outside area radius.
5. It normalizes fields (`name`, `type`, `area`, `tags`, `mood`) and infers `estimated_cost` + `cost_range`.
6. It computes `confidence_score` and `hangout_score` for initial quality gating.
7. It fuzzy-matches against existing Typesense docs (e.g. Blue Tokai naming variants) to avoid duplicates.
8. It upserts with stable IDs (`sha1(normalized_name + area)` for new Tavily-origin docs).
9. It boosts recurring venues across runs (popularity signal) and decays stale unseen candidates.

### Recommended Runtime Querying

Your planner can keep querying Typesense as usual using `filter_by` and optional `sort_by` for quality fields when available.
Example:

```text
filter_by=area:=`Bandra West` && type:=[cafe,restaurant,activity,outdoor]
sort_by=popularity:desc,rating:desc
```

### Optional Fields

If your Typesense schema supports additional fields (or wildcard schema), the live sync also writes:

- `confidence_score`
- `hangout_score`
- `cost_range_min`
- `cost_range_max`
- `cost_range_label`
- `source`
- `discovery_hits`
- `last_seen`

If these fields are not present, the worker still upserts core venue fields and remains compatible.

### Troubleshooting

- `Missing TYPESENSE_HOST environment variable`
	- Fix `.env.local` formatting (`KEY=value`, no spaces around `=`).
- `collection not found`
	- Ensure `TYPESENSE_COLLECTION=venues` exists in your cluster.
- `schema is incompatible`
	- Update collection fields to match the required schema block above.
- `Overpass ... timeout`
	- Re-run command; script already retries across mirrors.
- `import failed` for some rows
	- Check the reported row error; usually type mismatch or malformed field data.

### Recommended Workflow

1. Run dry-run with `--skip-schema-check` to confirm OSM fetch and transformation.
2. Run dry-run without skip to confirm collection schema compatibility.
3. Run live import for one area.
4. Automate recurring sync via cron for priority areas.

### populator 
# Single area
node scripts/tavily-groq-discover.mjs "Andheri" --mood fun

# All 22 Mumbai areas
node scripts/tavily-groq-discover.mjs --all

# Dry run (preview only)
node scripts/tavily-groq-discover.mjs "Bandra" --dry-run

---

## 🗺️ Ola Maps Ingestion & Demo Scripts

This project includes a direct integration with **Ola Maps Places API** for high-reliability, zero-hallucination data discovery + generation.

### 1. Ola to Typesense Ingestion Pipeline
We built a hyper-focused ingestion script that sidesteps OSINT tools (like Tavily) and hits the Ola Maps Places API directly to populate Typesense:

```bash
node scripts/ola-to-typesense.mjs
```
**What this does:**
1. Dynamically maps over all areas listed in `src/lib/stations.json`.
2. Searches for experiential venues (VR, Go Karting, Arcades, Aesthetic Cafes) using the Ola Maps `textsearch` endpoint.
3. Automatically classifies output, normalizes tags, and upserts natively into Typesense.

*(Make sure your `.env.local` contains `OLA_MAPS_API_KEY`, `TYPESENSE_HOST`, and `TYPESENSE_API_KEY`)*

### 2. Ola + Groq Interactive Itinerary Demo
Test out the end-to-end AI Engine locally within your terminal using Ola Maps as the primary venue provider.

```bash
node scripts/ola-itinerary.mjs
```
Or with arguments:
```bash
node scripts/ola-itinerary.mjs "Bandra" "fun" 2500
```
**What this does:**
1. Scrapes realtime venue objects directly via Ola Maps for your targeted Mood & Area.
2. Cross-references constraints (Filters venues exceeding `BUDGET * 0.7`).
3. Uses Typesense as a resilient fallback if the live API returns too few venues.
4. Feeds the candidate array into **Groq LLaMA-3-70B** to stitch the structure into a beautiful, highly constrained cohesive hangout story.

---

## 📜 License

[MIT License](LICENSE)
