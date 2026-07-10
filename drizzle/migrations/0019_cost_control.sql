-- Itinerary cache
CREATE TABLE `itinerary_cache` (
  `key` text PRIMARY KEY NOT NULL,
  `planner_version` text NOT NULL,
  `group_id` text NOT NULL,
  `plan_ids_json` text NOT NULL,
  `plan_payload_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at` text NOT NULL,
  `hits` integer DEFAULT 0 NOT NULL,
  `generation_time_ms` integer DEFAULT 0 NOT NULL,
  `estimated_cost_cents` integer DEFAULT 0 NOT NULL
);
CREATE INDEX `itinerary_cache_expires_idx` ON `itinerary_cache` (`expires_at`);
CREATE INDEX `itinerary_cache_version_idx` ON `itinerary_cache` (`planner_version`);

-- Rate limit windows
CREATE TABLE `rate_limit_windows` (
  `id` text PRIMARY KEY NOT NULL,
  `subject_kind` text NOT NULL,
  `subject_id` text NOT NULL,
  `operation` text NOT NULL,
  `window_start_unix` integer NOT NULL,
  `window_size_sec` integer NOT NULL,
  `count` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX `rate_limit_unique_idx` ON `rate_limit_windows` (
  `subject_kind`, `subject_id`, `operation`, `window_start_unix`, `window_size_sec`
);

-- Inflight requests
CREATE TABLE `inflight_requests` (
  `key` text PRIMARY KEY NOT NULL,
  `operation` text NOT NULL,
  `subject_id` text,
  `started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at_unix` integer NOT NULL
);
CREATE INDEX `inflight_expires_idx` ON `inflight_requests` (`expires_at_unix`);

-- Cost ledger
CREATE TABLE `cost_ledger` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text,
  `group_id` text,
  `operation` text NOT NULL,
  `provider` text NOT NULL,
  `units` integer DEFAULT 1 NOT NULL,
  `cost_cents` integer DEFAULT 0 NOT NULL,
  `metadata` text,
  `cache_hit` integer DEFAULT 0 NOT NULL,
  `at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `cost_ledger_user_idx` ON `cost_ledger` (`user_id`);
CREATE INDEX `cost_ledger_group_idx` ON `cost_ledger` (`group_id`);
CREATE INDEX `cost_ledger_at_idx` ON `cost_ledger` (`at`);
CREATE INDEX `cost_ledger_operation_idx` ON `cost_ledger` (`operation`);

-- Usage daily rollup
CREATE TABLE `usage_daily_rollup` (
  `id` text PRIMARY KEY NOT NULL,
  `day_utc` text NOT NULL,
  `subject_kind` text NOT NULL,
  `subject_id` text NOT NULL,
  `plans_generated` integer DEFAULT 0 NOT NULL,
  `cache_hits` integer DEFAULT 0 NOT NULL,
  `cache_misses` integer DEFAULT 0 NOT NULL,
  `ai_calls` integer DEFAULT 0 NOT NULL,
  `external_calls` integer DEFAULT 0 NOT NULL,
  `cost_cents` integer DEFAULT 0 NOT NULL,
  `time_saved_ms` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX `usage_daily_unique_idx` ON `usage_daily_rollup` (`day_utc`, `subject_kind`, `subject_id`);
CREATE INDEX `usage_daily_day_idx` ON `usage_daily_rollup` (`day_utc`);
