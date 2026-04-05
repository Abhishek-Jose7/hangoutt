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
- **Search & AI:** Groq (LLaMA-3 for Itineraries) & Tavily API (Geospatial place discovery)
- **Geocoding:** Rate-limited OpenStreetMap Nominatim.
- **Caching:** Upstash Redis.
- **State Management:** Zustand, TanStack Query.

---

## 🚀 Getting Started

### 1. Requirements

- Node.js 18.0.0+ 
- A Supabase project
- A Clerk project
- API Keys for: Groq (supports multiple keys orchestration via `GROQ_API_KEYS`), Tavily, Upstash Redis

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

## 📜 License

[MIT License](LICENSE)
