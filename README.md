# Hangout (v2.0) — Experience-First Outing Planner

Hangout is a collaborative group planning platform designed to coordinate and optimize group outings. The platform collects participant location, budget, and activity preferences, calculates geographic midpoints, and utilizes Groq (llama-3.3-70b-versatile) to generate personalized, narrative-driven 3-4 day itineraries matching three distinct budget tiers.

---

## 🛠️ Technology Stack

* **Framework**: Next.js 16 App Router (React 19)
* **Authentication**: Clerk (with internal database user sync webhooks)
* **Database**: Cloudflare D1 (SQLite)
* **ORM**: Drizzle ORM
* **Maps Integration**: MapLibre GL JS (via OpenStreetMap & CartoDB Dark Matter dark-mode tiles) & Ola Maps Places/Geocoding API
* **AI Engine**: Groq SDK (`llama-3.3-70b-versatile` in JSON mode)
* **Validation**: Zod (all entry inputs & AI schema outputs)

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application locally.

---

## 🗄️ Database Management & Migrations

We use **Drizzle ORM** with **Drizzle Kit** to manage schema migrations. The database falls back to a local SQLite file (`./local.db`) during Next.js standalone runs, and binds to **Cloudflare D1** in Pages/Workers environments.

For complete, detailed instructions on schemas, environments, query recipes, and gotchas, see the dedicated 📂 [Drizzle Database Guide](file:///c:/Users/abhis/Documents/GitHub/hangoutt/drizzle/README.md).

### Quick Commands Cheat Sheet

| Task | Command | Target Database |
| :--- | :--- | :--- |
| **Modify Schema** | Edit [schema.ts](file:///c:/Users/abhis/Documents/GitHub/hangoutt/src/lib/db/schema.ts) | — |
| **Generate Migration** | `npm run db:generate` | Diff snapshot and create SQL migration |
| **Apply to Local SQLite** | `npm run db:migrate` | Local next dev database (`./local.db`) |
| **Apply to Local D1** | `npm run db:d1:local` | Wrangler local emulator D1 sandbox |
| **Apply to Remote D1** | `npm run db:d1:remote` | Live Cloudflare production database |
| **Visual DB Inspector** | `npm run db:studio` | Drizzle Studio web inspector (port `4983`) |

---

## 🔍 Direct CLI SQL Queries

You can execute raw SQL commands directly from your terminal using Wrangler's CLI.

* **Local D1 Sandbox**:
  ```bash
  npx wrangler d1 execute hangout-dev --local --command "SELECT * FROM users LIMIT 5;"
  ```
* **Remote Production D1**:
  ```bash
  npx wrangler d1 execute hangout-dev --remote --command "SELECT * FROM users LIMIT 5;"
  ```


---

## 📂 Project Architecture

```
src/
  app/              ← Next.js App Router (Pages, layouts, API Route Handlers)
  actions/          ← Server Actions (Delegated to Service Layer; handles revalidation)
  lib/
    auth/           ← requireAuth and getCurrentUser Clerk helper functions
    db/             ← schema, migration scripts, and Drizzle Client instances
    groq/           ← Groq Client and Itinerary prompt templates
    maps/           ← Ola Maps HTTP proxies
    algorithms/     ← Coordinate midpointing and scoring (Venues + Experiences)
    validators/     ← Zod validation schemas
    repositories/   ← Repository Layer (CRUD and direct database transactions)
    services/       ← Service Layer (Orchestration, aggregate calculators, permissions)
```

---

## 🗺️ Interactive Cartography (Map Console)

The homepage features a full-screen, high-performance interactive map built with MapLibre GL JS:
* **Dark-Mode Visuals**: Powered by CartoDB Dark Matter tiles tailored for the "Mumbai Noir" aesthetic.
* **Interactive HUD Layout**:
  * **Top-Right HUD**: Drag to pan / mouse wheel to zoom instructions.
  * **Left Rail**: Categories menu Selector with a vertical `• LIFESTYLE` text decorator.
  * **Bottom-Center**: Horizontal map control buttons capsule (Recenter `MapPin`, Target, Zoom `+`/`-`).
  * **Bottom-Right**: Selected Venue Details card showing the active midpoint junction, connections, phone, and quick-info with a styled thumbnail image.
  * **Right Column**: Scrollable carousel of recommendations matching the selected category.
* **Smart Camera Control**: Dynamic panning/flying camera transition when markers or carousel cards are clicked.
* **Responsive Layout**: Adapts gracefully to mobile viewports with a stacked responsive overlay format.
