BEGIN;

CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  username text NOT NULL,
  name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('part-timer','pm','admin')),
  grade text NOT NULL DEFAULT 'junior' CHECK (grade IN ('junior','senior','lead','junior_emcee','senior_emcee')),
  password_hash text NOT NULL,
  phone text NOT NULL DEFAULT '',
  discord text NOT NULL DEFAULT '',
  avatar_path text,
  verified boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','APPROVED','REJECTED')),
  verification_photo_path text,
  verified_at timestamptz,
  verified_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users ((lower(email)));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON users ((lower(username)));

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  title text NOT NULL,
  venue text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  application_deadline timestamptz,
  status text NOT NULL DEFAULT 'upcoming',
  headcount integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  transport_options jsonb NOT NULL DEFAULT '{"bus":true,"own":true}'::jsonb,
  rate jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  session jsonb NOT NULL DEFAULT '{}'::jsonb,
  break_enabled boolean NOT NULL DEFAULT false,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time >= start_time)
);
CREATE INDEX IF NOT EXISTS jobs_start_time_idx ON jobs(start_time);
CREATE INDEX IF NOT EXISTS jobs_application_deadline_idx ON jobs(application_deadline);

CREATE TABLE IF NOT EXISTS job_applications (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_snapshot text NOT NULL DEFAULT '',
  transport text NOT NULL DEFAULT 'Own Transport',
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','approved','rejected')),
  wants_loading boolean NOT NULL DEFAULT false,
  applied_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);
CREATE INDEX IF NOT EXISTS job_applications_status_idx ON job_applications(job_id, status);

CREATE TABLE IF NOT EXISTS job_attendance (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  in_at timestamptz,
  out_at timestamptz,
  break_in_at timestamptz,
  break_out_at timestamptz,
  late_minutes integer NOT NULL DEFAULT 0,
  break_minutes integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);

CREATE TABLE IF NOT EXISTS job_loading_config (
  job_id text PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  quota integer NOT NULL DEFAULT 0 CHECK (quota >= 0),
  price numeric(12,2) NOT NULL DEFAULT 0,
  closed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_loading_members (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applied boolean NOT NULL DEFAULT false,
  present boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);
CREATE INDEX IF NOT EXISTS job_loading_members_present_idx ON job_loading_members(job_id, present);

CREATE TABLE IF NOT EXISTS job_early_call_config (
  job_id text PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  threshold_hours numeric(8,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_early_call_members (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applied boolean NOT NULL DEFAULT false,
  present boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);

CREATE TABLE IF NOT EXISTS job_adjustments (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  adjustment_time timestamptz NOT NULL DEFAULT now(),
  by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_adjustments_job_user_idx ON job_adjustments(job_id, user_id);

CREATE TABLE IF NOT EXISTS job_full_timers (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (job_id, user_id)
);

CREATE TABLE IF NOT EXISTS job_events (
  job_id text PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  started_at timestamptz,
  ended_at timestamptz,
  scanner_lat double precision,
  scanner_lng double precision,
  scanner_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parking_receipts (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_snapshot text NOT NULL DEFAULT '',
  amount numeric(12,2),
  note text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'SUBMITTED',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parking_receipts_job_user_idx ON parking_receipts(job_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key text,
  notification_time timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  read boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'info'
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_uidx
  ON notifications(user_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_time_idx ON notifications(user_id, notification_time DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  audit_time timestamptz NOT NULL DEFAULT now(),
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  actor text NOT NULL DEFAULT 'guest',
  role text NOT NULL DEFAULT 'guest',
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs(audit_time DESC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS idempotency_requests (
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing','completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (actor_user_id, route_key, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idempotency_expires_idx ON idempotency_requests(expires_at);

CREATE TABLE IF NOT EXISTS legacy_blob_migrations (
  legacy_blob_id text PRIMARY KEY,
  bucket text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  byte_size bigint,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
