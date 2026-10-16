create table if not exists public.learning_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists learning_items_user_updated on public.learning_items (user_id, updated_at);

alter table public.learning_items enable row level security;

drop policy if exists "own rows select" on public.learning_items;
drop policy if exists "own rows insert" on public.learning_items;
drop policy if exists "own rows update" on public.learning_items;
drop policy if exists "own rows delete" on public.learning_items;

create policy "own rows select" on public.learning_items
  for select to authenticated using (auth.uid() = user_id);

create policy "own rows insert" on public.learning_items
  for insert to authenticated with check (auth.uid() = user_id);

create policy "own rows update" on public.learning_items
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows delete" on public.learning_items
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.learning_items from anon;
grant select, insert, update, delete on public.learning_items to authenticated;
