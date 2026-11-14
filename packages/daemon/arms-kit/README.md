# The backend kit

This product has a backend of its own: a Supabase project that the studio runs on this Mac beside the sandbox.
It gives sign-up and sign-in, a Postgres database, file storage and realtime. This folder is the client for it.
The code here is the project's from now on; change it when the product needs it.

## What the studio does, and what you do

- You write the schema as SQL in `supabase/migrations/` and demo rows in `supabase/seed.sql`, then call the
  `apply_schema` tool. The studio applies them; you have no database address and no admin key, and need none.
- The studio writes the backend's address and its publishable key into `.env.local`, under the names this
  framework reads. Both are public. Read them only through this kit, never as literals in the code.
- In production the same names are set to a hosted Supabase project's URL and publishable key, and the same
  migrations are pushed to it (`supabase db push`). Nothing in the code changes.

## Rules the studio checks when it applies a schema

1. Every table in `public` has row level security on and at least one policy. The publishable key ships in
   what a browser downloads, so the policies are the only thing between one user's rows and another's.
2. Every view in `public` is made `with (security_invoker = true)`. Without it a view reads as its owner and
   walks past every policy.
3. A migration that is in is not edited. Change what it made with a new file, numbered after it.
4. The seed is applied again whenever it changes: write every insert `on conflict do nothing`.

If any statement fails or a rule is broken, nothing is applied and the database is as it was.

## Writing the schema

```sql
-- supabase/migrations/0001_ledger.sql
create table public.entries (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  memo text not null,
  amount integer not null,
  created_at timestamptz not null default now()
);
alter table public.entries enable row level security;
create policy "owners read their entries" on public.entries for select to authenticated using (owner = (select auth.uid()));
create policy "owners write their entries" on public.entries for insert to authenticated with check (owner = (select auth.uid()));
grant select, insert, update, delete on public.entries to authenticated;
```

- Say who a row belongs to in the row (`owner uuid default auth.uid()`), and write policies against it. Wrap
  `auth.uid()` in `(select ...)` so it is worked out once a query and not once a row.
- For something shared (a club, a room, a team), keep a membership table and write the policy as "the asker
  is a member": `using (exists (select 1 from public.members m where m.club_id = entries.club_id and m.user_id = (select auth.uid())))`.
  A policy on the membership table that reads the membership table recurses; give that one a
  `security definer` function to ask through, in a schema the API does not expose (`create schema private`).
- Grant what each role may do, in the migration: `to authenticated` for signed-in users, `to anon` only for
  what a visitor who has not signed in may see. Do not rely on defaults.
- A profile per user is a `public.profiles` row made by a trigger on `auth.users`, not by the client.
- Demo rows in the seed belong to nobody who can sign in. Design so that a new user reaches them the way a
  real one would (joins the demo club by its code), or sees a true empty state. Do not insert into `auth.users`.
- Realtime: `alter publication supabase_realtime add table public.entries;` and the client's `channel()`.
  The same policies decide who hears a change.
- Files: a bucket made in a migration (`insert into storage.buckets (id, name) values ('receipts', 'receipts') on conflict do nothing`)
  and policies on `storage.objects`.

## Signing in

`supabase.auth.signUp({ email, password })` signs the new user in at once here (mail confirmation is off on
this Mac; mail the backend would send is caught and never leaves it). `signInWithPassword`, `signOut`,
`getSession` and `onAuthStateChange` are the rest. Keep the session in one place (a context at the root) and
send a signed-out visitor to the sign-in screen from there. Every screen that shows a user's data has a state
for "not signed in" and one for "session ended".

Signing in with Kakao or Google is offered beside email and password, never instead of it, and only for the
providers the kit's `logins` lists (the studio's own developer apps, shared by its prototypes; none listed
means email only): `supabase.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: window.location.origin } })`.
The person leaves for the provider and comes back signed in; `onAuthStateChange` tells the product. When the
product ships it registers developer apps of its own; the code does not change.

Each provider's button says which provider it is: `data-login="kakao"` (React Native: `dataSet={{ login: 'kakao' }}`).
The studio presses it and reads the request the product makes of its backend: the provider has to be the
button's, and `redirectTo` has to be where the product is running, taken from `window.location.origin` and
never written out (the product runs at one address in the owner's browser, another when the studio checks it,
and a third in production). A person who signs in this way has no password and may have no name the product
chose: the profile trigger reads `raw_user_meta_data` (`name`, `avatar_url`) and the product copes without them.

Never put a password, a token or the address of the backend in the code or in a fixture.
