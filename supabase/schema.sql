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

create or replace function public.ping() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;

create table if not exists public.search_feedback (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  lang text not null check (char_length(lang) between 2 and 8),
  mode text not null check (char_length(mode) between 1 and 16),
  query text not null check (char_length(query) between 1 and 300),
  section text check (section is null or char_length(section) <= 300),
  rank int check (rank is null or rank between 1 and 50),
  vote smallint not null check (vote in (-1, 0, 1)),
  client text check (client is null or char_length(client) <= 40)
);

create index if not exists search_feedback_created on public.search_feedback (created_at);

alter table public.search_feedback enable row level security;

drop policy if exists "anyone can add search feedback" on public.search_feedback;

create policy "anyone can add search feedback" on public.search_feedback
  for insert to anon, authenticated with check (true);

revoke all on public.search_feedback from anon, authenticated;
grant insert on public.search_feedback to anon, authenticated;
grant usage on sequence public.search_feedback_id_seq to anon, authenticated;

create or replace function public.search_feedback_summary(since timestamptz default '1970-01-01')
returns table (lang text, mode text, query text, section text, ups bigint, downs bigint, misses bigint)
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (coalesce(f.client, f.id::text), f.lang, f.mode, lower(btrim(f.query)), coalesce(f.section, ''))
      f.lang, f.mode, lower(btrim(f.query)) as query, f.section, f.vote
    from public.search_feedback f
    where f.created_at >= search_feedback_summary.since
    order by coalesce(f.client, f.id::text), f.lang, f.mode, lower(btrim(f.query)), coalesce(f.section, ''), f.created_at desc, f.id desc
  )
  select l.lang, l.mode, l.query, l.section,
    count(*) filter (where l.section is not null and l.vote = 1),
    count(*) filter (where l.section is not null and l.vote = -1),
    count(*) filter (where l.section is null and l.vote = -1)
  from latest l
  group by l.lang, l.mode, l.query, l.section
  having count(*) filter (where l.vote <> 0) >= 1
  order by l.lang, l.mode, l.query, l.section
$$;

revoke all on function public.search_feedback_summary(timestamptz) from public;
grant execute on function public.search_feedback_summary(timestamptz) to anon, authenticated;
