-- ============================================================================
-- 0001_profiles_style_profile
-- ============================================================================
-- Persist the whole style profile, not just the bio.
--
-- Before this, js/supabaseClient.js wrote only identity columns plus `bio`.
-- The other 32 fields the Manage Account panel collects — sizes, fit, style,
-- budget, the things that actually change a recommendation — lived only in
-- Clerk metadata and the browser's localStorage. That meant they could not be
-- read server-side, and clearing site data on a machine where Clerk had not
-- yet hydrated lost them.
--
-- One jsonb column rather than 33 typed ones, deliberately: the question set
-- is still changing, and this way adding a question is a client change, not a
-- migration. If a field later becomes something we filter or aggregate on, it
-- earns promotion to its own column with an index.
--
-- Safe to run more than once.
-- ============================================================================

alter table public.profiles
  add column if not exists style_profile jsonb not null default '{}'::jsonb;

comment on column public.profiles.style_profile is
  'Style profile from the Manage Account panel (js/profile.js brief()). Keys are the camelCase field keys in ShopAIProfile.FIELDS. Values are strings or arrays of strings.';

-- Backfill the bio that was already being stored, so existing rows are not
-- left with an empty object while the bio sits in its own column.
update public.profiles
   set style_profile = jsonb_build_object('bio', bio)
 where bio is not null
   and bio <> ''
   and (style_profile is null or style_profile = '{}'::jsonb);

-- Lets us ask "who has told us their sizes" without scanning every row.
create index if not exists profiles_style_profile_gin
  on public.profiles using gin (style_profile jsonb_path_ops);

-- ----------------------------------------------------------------------------
-- Row level security
-- ----------------------------------------------------------------------------
-- The table is reached from the browser with the publishable key and a Clerk
-- session token, so RLS is the only thing standing between one user's profile
-- and everyone else's. These policies are written to be safe to re-run.
--
-- Rows are keyed by clerk_user_id, and Clerk's third-party auth integration
-- puts the Clerk user id in the JWT `sub` claim.
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (clerk_user_id = auth.jwt() ->> 'sub');

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (clerk_user_id = auth.jwt() ->> 'sub');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (clerk_user_id = auth.jwt() ->> 'sub')
  with check (clerk_user_id = auth.jwt() ->> 'sub');
