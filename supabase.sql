create table if not exists public.roblox_servers (
  job_id text primary key,
  place_id text not null,
  player_count integer not null check (player_count >= 0),
  last_seen timestamptz not null default now()
);

alter table public.roblox_servers enable row level security;

-- The Node.js service uses the Supabase service-role key, so it can read/write this table securely.
-- No public RLS policy is created.

create index if not exists roblox_servers_last_seen_idx
  on public.roblox_servers(last_seen);
