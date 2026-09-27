create table if not exists public.gowar_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{5}$'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists gowar_rooms_expires_at_idx
  on public.gowar_rooms (expires_at);

alter table public.gowar_rooms enable row level security;
revoke all on table public.gowar_rooms from anon, authenticated;
grant all on table public.gowar_rooms to service_role;
