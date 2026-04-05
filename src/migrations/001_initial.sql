-- Smart Hangout Planner — Initial migration
-- Run this in Supabase SQL Editor

-- ── Users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- ── Rooms ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  invite_code  TEXT UNIQUE NOT NULL,
  admin_id     TEXT REFERENCES users(id),
  mood         TEXT DEFAULT 'fun',
  status       TEXT DEFAULT 'lobby',
  currency     TEXT DEFAULT 'INR',
  expires_at   TIMESTAMPTZ DEFAULT now() + INTERVAL '48 hours',
  created_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

-- ── Room Members ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_members (
  room_id        UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        TEXT REFERENCES users(id),
  budget         DECIMAL(10,2),
  lat            DECIMAL(8,4),
  lng            DECIMAL(9,4),
  location_name  TEXT,
  nearest_station TEXT,
  joined_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- ── Itinerary Options ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS itinerary_options (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               UUID REFERENCES rooms(id),
  option_number         SMALLINT,
  hub_name              TEXT,
  hub_lat               DECIMAL(8,4),
  hub_lng               DECIMAL(9,4),
  hub_strategy          TEXT,
  plan                  JSONB NOT NULL,
  total_cost_estimate   DECIMAL(10,2),
  max_travel_time_mins  INTEGER,
  avg_travel_time_mins  INTEGER,
  travel_fairness_score DECIMAL(4,2),
  generation_method     TEXT,
  ai_model_version      TEXT,
  generated_at          TIMESTAMPTZ DEFAULT now()
);

-- ── Votes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             UUID REFERENCES rooms(id),
  itinerary_option_id UUID REFERENCES itinerary_options(id),
  user_id             TEXT REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, user_id)
);

-- ── Confirmed Itinerary ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS confirmed_itinerary (
  room_id             UUID PRIMARY KEY REFERENCES rooms(id),
  itinerary_option_id UUID REFERENCES itinerary_options(id),
  confirmed_at        TIMESTAMPTZ DEFAULT now(),
  confirmed_by        TEXT REFERENCES users(id)
);

-- ── Hangout History ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hangout_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID REFERENCES rooms(id),
  actual_date   DATE,
  rating        SMALLINT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rooms_invite_code ON rooms(invite_code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_options_room_id ON itinerary_options(room_id);
CREATE INDEX IF NOT EXISTS idx_votes_room_option ON votes(room_id, itinerary_option_id);

-- ── Enable Realtime ───────────────────────────────────────────
-- Note: Also enable these in Supabase Dashboard → Database → Replication
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE itinerary_options;
