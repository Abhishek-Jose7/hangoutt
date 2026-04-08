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

---

## 📜 License

[MIT License](LICENSE)
