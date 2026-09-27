# Claims Handling Platform — Architecture Plan (for approval)

Anything that goes beyond the brief is tagged **[assumption]** (brief ambiguous, simplest reading taken) or **[addition]** (not in the brief, justified in one line). Each is vetoable on its own.

Threat model for the SQL: an agent holds the publishable key and a valid JWT, so they can call PostgREST and Storage directly and bypass the mobile app. Nothing in the data-isolation story relies on the app behaving.

Names: workspaces `web`, `mobile`, `@claims/shared`, `@claims/supabase`. Expo linking scheme `claimsagent`. Bucket `claim-files`. Package versions: latest stable at scaffold time, reported in the Phase 0 summary.

---

## 1. Proposed file tree

```
claims-adjustment-system/
├── .npmrc                      # node-linker=hoisted (Expo + pnpm). Set first; verified in Phase 0 by `expo start`.
├── .nvmrc                      # 22
├── .gitignore                  # node_modules, .next, .expo, .env*, !.env.example, apps/mobile/{ios,android} (CNG output), google-services.json
├── .prettierrc                 # root Prettier + prettier-plugin-tailwindcss (tailwindStylesheet → apps/web/app/globals.css; Tailwind v4 has no config file)
├── eslint.base.mjs             # shared flat config: typescript-eslint strict, no-explicit-any: error
├── eslint.config.mjs           # root: base, lints packages/* (apps have their own, see below — flat-config globs are relative to the config file)
├── tsconfig.base.json          # strict, noUncheckedIndexedAccess, isolatedModules, noEmit, target/lib es2022, module esnext, moduleResolution bundler
├── package.json                # private; "packageManager": "pnpm@<installed>"; scripts dev/build/lint/typecheck/test → turbo; db:* → supabase CLI
├── pnpm-workspace.yaml         # apps/*, packages/*; onlyBuiltDependencies (pnpm 10 `approve-builds` output, committed)
├── turbo.json                  # dev (persistent, no cache); build (inputs incl. .env*, env allow-list, outputs .next/**); lint; typecheck; test
├── README.md
├── docs/PLAN.md                # this file
│
├── apps/
│   ├── web/
│   │   ├── package.json        # next, react, tailwindcss, @supabase/ssr, @supabase/supabase-js, expo-server-sdk, zod, server-only, @claims/*; devDeps: vitest (since the 2026-09-27 amendment to (t))
│   │   ├── next.config.ts      # transpilePackages: ['@claims/shared', '@claims/supabase']
│   │   ├── tsconfig.json       # extends base; jsx, DOM lib, "@/*" paths
│   │   ├── vitest.config.mts   # "@" alias + include lib/**/*.test.ts (2026-09-27)
│   │   ├── eslint.config.mjs   # base + eslint-config-next + prettier
│   │   ├── postcss.config.mjs  # @tailwindcss/postcss
│   │   ├── components.json     # shadcn/ui
│   │   ├── vercel.json         # framework: nextjs (Root Directory = apps/web is a dashboard setting)
│   │   ├── .env.example
│   │   ├── middleware.ts       # session refresh + signed-in gate for pages only (named proxy.ts if the installed Next major requires it); the admin gate is the (admin) layout + pages + RLS since the 2026-09-27 amendment to (j)
│   │   ├── app/
│   │   │   ├── layout.tsx, globals.css
│   │   │   ├── (admin)/page.tsx            # RSC overview at "/" → getDashboardMetrics() (replaced the root redirect('/claims') page)
│   │   │   ├── login/page.tsx              # client form → browser client signInWithPassword
│   │   │   ├── not-authorised/page.tsx     # signed-in non-admins land here; sign-out button
│   │   │   ├── (admin)/layout.tsx          # RSC: requireAdminPage(), the first admin check since the 2026-09-27 amendment to (j) (each page calls it too); nav; sign-out
│   │   │   ├── (admin)/claims/page.tsx     # RSC table; searchParams parsed with adminClaimsQuerySchema → listAdminClaims()
│   │   │   ├── (admin)/claims/[id]/page.tsx# RSC detail → getAdminClaimDetail() (includes signed file URLs)
│   │   │   ├── (admin)/agents/page.tsx     # RSC → listAgentsWithCounts()
│   │   │   └── api/
│   │   │       ├── me/push-token/route.ts                  # POST
│   │   │       ├── claims/route.ts                         # GET, POST
│   │   │       ├── claims/[id]/route.ts                    # GET, PATCH
│   │   │       ├── claims/[id]/submit/route.ts             # POST
│   │   │       ├── claims/[id]/files/route.ts              # POST (signed upload URL)
│   │   │       ├── claims/[id]/files/[fileId]/route.ts     # DELETE
│   │   │       └── admin/
│   │   │           ├── claims/route.ts                     # GET
│   │   │           ├── claims/[id]/route.ts                # GET
│   │   │           ├── claims/[id]/status/route.ts         # POST
│   │   │           ├── claims/[id]/assign/route.ts         # POST
│   │   │           ├── claims/[id]/notes/route.ts          # POST
│   │   │           └── agents/route.ts                     # GET
│   │   ├── components/
│   │   │   ├── ui/                 # shadcn primitives
│   │   │   ├── claims-table.tsx    # server component; sort headers rewrite searchParams
│   │   │   ├── claims-filters.tsx  # server; a plain GET form: status/assignee/agent/date → searchParams (works without JS)
│   │   │   ├── pagination.tsx
│   │   │   ├── claim-actions.tsx   # client; status (+message) / assign / note → apiFetch('/api/admin/…') → router.refresh()
│   │   │   ├── claim-timeline.tsx  # claim_events
│   │   │   ├── notes-panel.tsx     # internal vs agent_visible visually distinct
│   │   │   ├── file-gallery.tsx    # <img> for jpeg/png; open-in-new-tab tile for PDF and HEIC (browsers do not decode HEIC)
│   │   │   ├── details-kv.tsx      # details jsonb as key/value
│   │   │   └── status-badge.tsx
│   │   └── lib/
│   │       ├── api-client.ts       # apiFetch() for client components: browser client getSession() → Authorization: Bearer
│   │       ├── api/auth.ts         # requireUser(req, opts?) / requireAdmin(req, opts?): bearer token → getClaims(token) locally, or getUser(token) for the admin mutations → { user: { id, email }, profile, db }
│   │       ├── api/auth.test.ts    # requireUser/requireAdmin through their public surface with the bearer client faked (2026-09-27)
│   │       ├── api/handler.ts      # route(fn): try/catch → { error } JSON; parseBody / parseQuery with zod; ok(data)
│   │       ├── api/errors.ts       # ApiError; API code ↔ HTTP status; PostgrestError/SQLSTATE → code
│   │       ├── api/page-auth.ts    # requireAdminPage(): RSC variant over the cookie client; redirects instead of throwing
│   │       ├── queries/claims.ts   # listAgentClaims, getAgentClaim, listAdminClaims, getAdminClaimDetail — (db, params) → DTO
│   │       ├── queries/profiles.ts # getOwnProfile, listAgentsWithCounts
│   │       ├── storage.ts          # signFileUrls(db, files): 10-min signed download URLs; url null when the object is missing
│   │       ├── push.ts             # sendClaimPush(): expo-server-sdk; DeviceNotRegistered → null token (service client; only importer of it)
│   │       └── supabase/
│   │           ├── browser.ts      # createBrowserClient (login page, api-client)
│   │           ├── server.ts       # cookie client over next/headers for RSC (setAll wrapped in try/catch: RSC cannot set cookies)
│   │           ├── middleware.ts   # cookie client over NextRequest/NextResponse
│   │           └── service.ts      # imports 'server-only'; SUPABASE_SERVICE_ROLE_KEY
│   │
│   └── mobile/
│       ├── package.json            # "main": "expo-router/entry"; expo, expo-router, expo-image-picker, expo-document-picker, expo-file-system,
│       │                           # expo-notifications, expo-device, expo-linking, expo-constants, async-storage, react-native-url-polyfill,
│       │                           # @supabase/supabase-js, zod, react-hook-form, @hookform/resolvers, @claims/*  (expo-dev-client added in Phase 5)
│       ├── app.config.ts           # scheme 'claimsagent', bundle ids, plugins (expo-router, expo-notifications, image/document picker), extra.eas.projectId
│       ├── eas.json                # development / preview / production profiles, each on the EAS environment of the same name;
│       │                           # EXPO_PUBLIC_API_URL in preview/production (development takes .env via `expo start`); node + pnpm pinned
│       ├── metro.config.js         # watchFolders=[monorepoRoot]; resolver.nodeModulesPaths=[app node_modules, root node_modules]
│       ├── babel.config.js         # babel-preset-expo
│       ├── tsconfig.json           # extends [base, expo/tsconfig.base]; strict re-asserted
│       ├── eslint.config.mjs       # base + eslint-config-expo/flat + prettier
│       ├── .env.example
│       ├── app/
│       │   ├── _layout.tsx                 # SessionProvider; splash until session resolves; Stack.Protected; notification-tap → /claims/[id]
│       │   ├── (auth)/sign-in.tsx, sign-up.tsx, forgot-password.tsx
│       │   ├── reset-password.tsx          # deep-link target (outside the guard): exchangeCodeForSession(code) → updateUser({ password })
│       │   ├── (app)/_layout.tsx           # registers push token after sign-in; signOut() helper
│       │   ├── (app)/index.tsx             # own claims grouped by status + status filter chips
│       │   ├── (app)/claims/new.tsx
│       │   ├── (app)/claims/[id]/index.tsx # detail: status, admin messages, files; "Edit & resubmit" when info_requested
│       │   └── (app)/claims/[id]/edit.tsx  # ClaimForm in edit mode (draft or info_requested)
│       ├── components/
│       │   ├── claim-form.tsx      # react-hook-form + zodResolver(createClaimSchema); state survives a failed save; Save draft / Submit
│       │   ├── attachments.tsx     # library / camera / PDF pickers → upload with progress; add/remove only while draft
│       │   ├── status-badge.tsx
│       │   └── error-banner.tsx    # network-error state with Retry
│       └── lib/
│           ├── supabase.ts         # createMobileClient({ storage: AsyncStorage }); AppState → startAutoRefresh/stopAutoRefresh
│           ├── session.tsx         # SessionProvider (onAuthStateChange); useSession(): undefined = loading, null = signed out
│           ├── api.ts              # apiFetch(): EXPO_PUBLIC_API_URL + Bearer from getSession(); parses { error }; retries network errors
│           ├── upload.ts           # expo-file-system/legacy createUploadTask PUT to the signed URL with progress; retry on same URL
│           └── notifications.ts    # setNotificationHandler; registerPushToken() → POST /api/me/push-token
│
└── packages/
    ├── shared/                     # raw TS; dependency: zod only
    │   ├── package.json            # name @claims/shared; "exports": { ".": "./src/index.ts" }; devDeps: vitest
    │   ├── tsconfig.json, vitest.config.ts
    │   └── src/
    │       ├── index.ts
    │       ├── constants.ts        # CLAIM_STATUSES, USER_ROLES, NOTE_VISIBILITIES, CLAIM_EVENT_TYPES, CLAIM_TYPES (edit here),
    │       │                       # EDITABLE_STATUSES, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, STORAGE_BUCKET
    │       ├── transitions.ts      # TRANSITIONS table, canTransition(from, to, actor), nextStatuses(from, actor), isEditable(status)
    │       ├── transitions.test.ts # every (from, to, actor) triple asserted
    │       ├── schemas/claim.ts    # claimDetailsSchema (permissive record), createClaimSchema, updateClaimSchema, submittableClaimSchema, agentClaimsQuerySchema
    │       ├── schemas/file.ts     # createFileUploadSchema
    │       ├── schemas/admin.ts    # adminClaimsQuerySchema, changeStatusSchema, assignClaimSchema, createNoteSchema
    │       ├── schemas/me.ts       # pushTokenSchema
    │       ├── schemas/schemas.test.ts
    │       └── api-types.ts        # API_ERROR_CODES, ApiErrorBody, Paginated<T>, Profile, ClaimSummary, ClaimDetail, ClaimFile, ClaimNote,
    │                               # ClaimEvent, AdminClaimSummary, AdminClaimDetail, AgentWithCounts
    │
    └── supabase/                   # also the Supabase CLI project dir (CLI run with `--workdir packages`, decision m)
        ├── package.json            # name @claims/supabase; deps: @supabase/supabase-js, @supabase/ssr; subpath exports only, no barrel
        ├── tsconfig.json
        ├── config.toml             # written by `supabase init`; committed
        ├── seed.sql                # empty
        ├── types.ts                # GENERATED by `pnpm db:types`; committed; never hand-edited
        ├── browser.ts              # createBrowserClient — @supabase/ssr (web client components)
        ├── server.ts               # createCookieClient({ cookies: { getAll, setAll } }) — @supabase/ssr; adapter injected, no next/* import
        ├── service.ts              # createServiceClient — persistSession false
        ├── bearer.ts               # createBearerClient({ accessToken }) — global Authorization header; no session persistence
        ├── mobile.ts               # createMobileClient({ storage }) — flowType 'pkce', detectSessionInUrl false; no RN imports
        └── migrations/
            ├── 20260902000001_profiles.sql          # Phase 1
            ├── 20260902000002_claims.sql            # Phase 2
            ├── 20260902000003_storage_bucket.sql    # Phase 2
            ├── 20260902000004_storage_policies.sql  # Phase 2
            └── 20260902000005_release_push_token.sql # Phase 5 [addition], see §2.4
```

`@claims/supabase` has no barrel because `server.ts`/`service.ts` must never reach the Metro bundle or a client component; mobile imports only `@claims/supabase/types` and `@claims/supabase/mobile`.

---

## 2. Database schema (SQL)

Conventions: every policy is `to authenticated`; `anon` gets nothing. `auth.uid()` and `is_admin()` are wrapped in `(select …)` so Postgres evaluates them once per statement. Every function pins `set search_path = ''` and schema-qualifies names. Migrations run as `postgres` via `supabase db push`.

Isolation invariants the SQL makes provable:

| #   | Invariant                                                                                                                                                       | Enforced by                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| I1  | An agent reads/writes only rows where `claims.agent_id = auth.uid()`                                                                                            | SELECT/INSERT/UPDATE/DELETE policies; `is_admin()` is the only widening                                                    |
| I2  | An agent can never read an `internal` note                                                                                                                      | the visibility predicate is inside the only agent SELECT policy on `claim_notes`                                           |
| I3  | An agent can never read `claim_events` **[assumption]**                                                                                                         | no agent SELECT policy (a `note_added` event would reveal that internal notes exist)                                       |
| I4  | Nobody — agent, admin, service role, SQL editor — can UPDATE/DELETE/TRUNCATE `claim_events`                                                                     | no policies + BEFORE triggers that raise                                                                                   |
| I5  | Only DB triggers insert `claim_events`; no JWT role (`service_role` included) can forge the log                                                                 | INSERT/UPDATE/DELETE/TRUNCATE revoked from `anon`, `authenticated` and `service_role`; audit triggers are SECURITY DEFINER |
| I6  | An agent cannot set `id`, `agent_id`, `created_at`, `updated_at`, `assigned_to` on a claim, nor `profiles.role`                                                 | column-level GRANTs **[addition]** + guard trigger                                                                         |
| I7  | Agent transitions ⊂ {draft→submitted, info_requested→submitted} (owner only); admin transitions ⊂ the workflow diagram — for direct PostgREST callers too       | guard trigger `claims_guard_update` **[addition]**                                                                         |
| I8  | An agent cannot forge `storage_path` into another claim's folder                                                                                                | `storage_path` derived by a BEFORE INSERT trigger; column not in the INSERT grant; CHECK on the prefix                     |
| I9  | Storage objects are reachable only for paths registered in `claim_files` on a claim the caller may see; an upload URL is signed only while the claim is `draft` | `storage.objects` policies join on `claim_files.storage_path = objects.name`                                               |

### 2.1 Phase 1 — `20260902000001_profiles.sql`

```sql
create type public.user_role as enum ('agent', 'admin');

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  role             public.user_role not null default 'agent',
  full_name        text not null default '',
  expo_push_token  text,
  created_at       timestamptz not null default now(),   -- [addition] orders the agents page
  updated_at       timestamptz not null default now(),   -- [addition]
  constraint profiles_full_name_length check (char_length(full_name) <= 200)
);

create index profiles_role_idx on public.profiles (role);

-- Generic updated_at maintenance (reused by claims).
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile on sign-up. full_name comes from signUp({ options: { data: { full_name } } }).
-- role is never read from metadata, so a client cannot self-assign admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 200), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The single role predicate used by every policy. SECURITY DEFINER so it reads profiles without re-entering
-- the profiles policies (avoids "infinite recursion detected in policy").
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Privileges. Supabase grants ALL to anon/authenticated by default; take it back and re-grant exactly what is needed.
-- Column-level UPDATE means role/id/created_at are never client-settable, before RLS is even evaluated.
revoke all on table public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, expo_push_token) on public.profiles to authenticated;
-- no INSERT (trigger only), no DELETE (cascade from auth.users only)

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- admins see every profile (agents page, assignment dropdown, push-token lookup)
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert/delete policies. Admins never update other profiles through PostgREST (it would expose role);
-- the one such write (push-token invalidation) uses the service role, see §2.4.
-- Promote an admin by hand:  update public.profiles set role = 'admin' where id = '<auth user uuid>';
```

### 2.2 Phase 2 — `20260902000002_claims.sql`

```sql
create type public.claim_status    as enum ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'info_requested');
create type public.note_visibility as enum ('internal', 'agent_visible');

-- ---------- claims ----------
create table public.claims (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.profiles (id) on delete restrict,
  assigned_to    uuid references public.profiles (id) on delete set null,
  status         public.claim_status not null default 'draft',
  title          text not null,
  description    text not null default '',
  claim_type     text not null,                 -- free-form; pick-list is CLAIM_TYPES in @claims/shared; deliberately no CHECK
  incident_date  date,                          -- nullable: drafts may be incomplete (decision o)
  policy_number  text,
  claimant_name  text,
  details        jsonb not null default '{}'::jsonb,   -- extension point; validated by claimDetailsSchema (permissive record)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint claims_title_length         check (char_length(title) between 1 and 200),
  constraint claims_description_length   check (char_length(description) <= 20000),
  constraint claims_claim_type_length    check (char_length(claim_type) between 1 and 100),
  constraint claims_policy_number_length check (policy_number is null or char_length(policy_number) <= 100),
  constraint claims_claimant_name_length check (claimant_name is null or char_length(claimant_name) <= 200),
  constraint claims_details_is_object    check (jsonb_typeof(details) = 'object')
);

create index claims_agent_id_idx    on public.claims (agent_id, created_at desc);
create index claims_status_idx      on public.claims (status, created_at desc);
create index claims_assigned_to_idx on public.claims (assigned_to) where assigned_to is not null;
create index claims_created_at_idx  on public.claims (created_at desc);

create trigger claims_set_updated_at
  before update on public.claims
  for each row execute function public.set_updated_at();

-- ---------- claim_files ----------
create table public.claim_files (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references public.claims (id) on delete restrict,
  uploaded_by   uuid not null references public.profiles (id) on delete restrict,
  storage_path  text not null default '' unique, -- set by trigger, never by the client (I8); '' default only so the
                                                --   generated Insert type marks it optional (the INSERT grant excludes it)
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null,
  created_at    timestamptz not null default now(),

  constraint claim_files_mime_allowed    check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')),
  constraint claim_files_size            check (size_bytes > 0 and size_bytes <= 26214400),   -- 25 MiB, same literal as the bucket (open question 3)
  constraint claim_files_name_length     check (char_length(file_name) between 1 and 255),
  constraint claim_files_path_convention check (storage_path like claim_id::text || '/' || id::text || '-%')
);

create index claim_files_claim_id_idx on public.claim_files (claim_id);

-- storage_path = {claim_id}/{file_id}-{sanitised_file_name}, decided by the DB, not the caller.
-- Column defaults (id) are applied before BEFORE ROW triggers run, so new.id is populated here.
create or replace function public.claim_files_set_path()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_name text;
begin
  v_name := regexp_replace(new.file_name, '[^A-Za-z0-9._-]+', '_', 'g');
  v_name := left(trim(both '._' from v_name), 120);
  if v_name = '' then v_name := 'file'; end if;
  new.storage_path := new.claim_id::text || '/' || new.id::text || '-' || v_name;
  return new;
end;
$$;

create trigger claim_files_set_path
  before insert on public.claim_files
  for each row execute function public.claim_files_set_path();

-- ---------- claim_notes ----------
create table public.claim_notes (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims (id) on delete restrict,
  author_id   uuid not null references public.profiles (id) on delete restrict,
  body        text not null,
  visibility  public.note_visibility not null default 'internal',   -- default to the safe value
  created_at  timestamptz not null default now(),
  constraint claim_notes_body_length check (char_length(body) between 1 and 10000)
);

create index claim_notes_claim_id_idx on public.claim_notes (claim_id, created_at);

-- ---------- claim_events (append-only audit log) ----------
-- bigint identity, not uuid: deterministic timeline order when several events share one transaction timestamp.
-- ON DELETE RESTRICT everywhere an audit row points: the append-only triggers make cascade / set null impossible,
-- so deleting a claim or a user with history is a deliberate manual operation.
-- event_type: the brief requires status_changed, assigned, note_added (every admin action + every status change).
-- [addition] created, updated (column names only), file_reserved, file_removed so the admin timeline is complete.
-- Veto = drop the four values here and the corresponding trigger branches below.
create table public.claim_events (
  id          bigint generated always as identity primary key,
  claim_id    uuid not null references public.claims (id) on delete restrict,
  actor_id    uuid references public.profiles (id) on delete restrict,   -- null only when no JWT (SQL editor); never null via the app
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint claim_events_type check (event_type in
    ('created', 'updated', 'status_changed', 'assigned', 'note_added', 'file_reserved', 'file_removed')),
  constraint claim_events_payload_is_object check (jsonb_typeof(payload) = 'object')
);

create index claim_events_claim_id_idx on public.claim_events (claim_id, id);

-- ============================================================
-- Guards (BEFORE triggers)
-- ============================================================

-- I6 + I7. RLS cannot compare OLD and NEW, so the exact transition rules live here (mirrored and unit-tested in
-- @claims/shared transitions.ts; each copy has a comment pointing at the other).
-- Two actors, not two roles: the claim's OWNER (agent_id = caller, whatever their role — an admin may sign in on mobile)
-- may make the agent transitions; an ADMIN may make the admin transitions. Both may hold for one caller.
-- Custom SQLSTATEs let the route handler map precisely: CL001 invalid transition, CL002 forbidden field change.
-- auth.uid() is null for the SQL editor and the service role: those callers get admin rules.
create or replace function public.claims_guard_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_uid   uuid    := auth.uid();
  v_admin boolean := (v_uid is null) or (select public.is_admin());
  v_owner boolean := coalesce(old.agent_id = v_uid, false);
  v_ok    boolean := false;
begin
  if new.agent_id <> old.agent_id then
    raise exception 'agent_id is immutable' using errcode = 'CL002';
  end if;

  if not v_admin and new.assigned_to is distinct from old.assigned_to then
    raise exception 'only admins can assign claims' using errcode = 'CL002';
  end if;

  if new.status is distinct from old.status then
    v_ok :=
      (v_owner and (
        (old.status = 'draft'          and new.status = 'submitted') or
        (old.status = 'info_requested' and new.status = 'submitted')
      ))
      or
      (v_admin and (
        (old.status = 'submitted'    and new.status = 'under_review') or
        (old.status = 'under_review' and new.status in ('approved', 'rejected', 'info_requested'))
      ));
    if not v_ok then
      raise exception 'invalid transition % -> %', old.status, new.status using errcode = 'CL001';
    end if;
  end if;

  return new;
end;
$$;

create trigger claims_guard_update
  before update on public.claims
  for each row execute function public.claims_guard_update();

-- I4: claim_events is append-only for every role, including postgres and service_role (triggers ignore RLS bypass).
create or replace function public.claim_events_block_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'claim_events is append-only' using errcode = 'CL003';
end;
$$;

create trigger claim_events_no_update   before update   on public.claim_events for each row       execute function public.claim_events_block_mutation();
create trigger claim_events_no_delete   before delete   on public.claim_events for each row       execute function public.claim_events_block_mutation();
create trigger claim_events_no_truncate before truncate on public.claim_events for each statement execute function public.claim_events_block_mutation();

-- ============================================================
-- Audit log (AFTER triggers). SECURITY DEFINER because no JWT role has INSERT on claim_events (I5): the insert runs
-- as the function owner (postgres), who owns the table, so RLS does not apply and no INSERT policy is needed.
-- actor_id = auth.uid() from the caller's JWT, which is why every claims/notes/files write uses a user-scoped client.
-- ============================================================

create or replace function public.claims_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid := auth.uid();
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.claim_events (claim_id, actor_id, event_type, payload)
    values (new.id, v_actor, 'created', jsonb_build_object('status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.claim_events (claim_id, actor_id, event_type, payload)
    values (new.id, v_actor, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.claim_events (claim_id, actor_id, event_type, payload)
    values (new.id, v_actor, 'assigned', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;

  -- [addition] Content edits: column names only, no values.
  v_changed := array_remove(array[
    case when new.title         is distinct from old.title         then 'title' end,
    case when new.description   is distinct from old.description   then 'description' end,
    case when new.claim_type    is distinct from old.claim_type    then 'claim_type' end,
    case when new.incident_date is distinct from old.incident_date then 'incident_date' end,
    case when new.policy_number is distinct from old.policy_number then 'policy_number' end,
    case when new.claimant_name is distinct from old.claimant_name then 'claimant_name' end,
    case when new.details       is distinct from old.details       then 'details' end
  ], null);
  if cardinality(v_changed) > 0 then
    insert into public.claim_events (claim_id, actor_id, event_type, payload)
    values (new.id, v_actor, 'updated', jsonb_build_object('columns', to_jsonb(v_changed)));
  end if;

  return new;
end;
$$;

create trigger claims_log_change
  after insert or update on public.claims
  for each row execute function public.claims_log_change();

create or replace function public.claim_notes_log_added()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.claim_events (claim_id, actor_id, event_type, payload)
  values (new.claim_id, auth.uid(), 'note_added', jsonb_build_object('note_id', new.id, 'visibility', new.visibility));
  return new;
end;
$$;

create trigger claim_notes_log_added
  after insert on public.claim_notes
  for each row execute function public.claim_notes_log_added();

-- A claim_files row is a RESERVATION (signed URL issued); the bytes arrive later, outside the DB's view.
create or replace function public.claim_files_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.claim_events (claim_id, actor_id, event_type, payload)
    values (new.claim_id, auth.uid(), 'file_reserved',
            jsonb_build_object('file_id', new.id, 'file_name', new.file_name, 'mime_type', new.mime_type, 'size_bytes', new.size_bytes));
    return new;
  else
    insert into public.claim_events (claim_id, actor_id, event_type, payload)
    values (old.claim_id, auth.uid(), 'file_removed', jsonb_build_object('file_id', old.id, 'file_name', old.file_name));
    return old;
  end if;
end;
$$;

create trigger claim_files_log_change
  after insert or delete on public.claim_files
  for each row execute function public.claim_files_log_change();

-- ============================================================
-- Privileges (I5, I6, I8). Column lists are the first line of defence; policies and triggers the second and third.
-- PostgREST rejects the whole request (42501) if a client names a column outside the grant, so handlers build
-- insert/update objects strictly from zod output.
-- ============================================================
revoke all on table public.claims, public.claim_files, public.claim_notes, public.claim_events
  from anon, authenticated;
-- I5: service_role bypasses RLS and holds ALL by default; take back every write on the audit log (SELECT kept).
revoke insert, update, delete, truncate on public.claim_events from service_role;

grant select on public.claims to authenticated;
grant insert (agent_id, title, description, claim_type, incident_date, policy_number, claimant_name, details)
  on public.claims to authenticated;                                   -- status/assigned_to not settable on insert (defaults apply)
grant update (title, description, claim_type, incident_date, policy_number, claimant_name, details, status, assigned_to)
  on public.claims to authenticated;                                   -- id, agent_id, created_at, updated_at never updatable
-- no DELETE on claims for any JWT role (decision n)

grant select, delete on public.claim_files to authenticated;
grant insert (claim_id, uploaded_by, file_name, mime_type, size_bytes) on public.claim_files to authenticated;   -- storage_path excluded
-- no UPDATE on claim_files

grant select on public.claim_notes to authenticated;
grant insert (claim_id, author_id, body, visibility) on public.claim_notes to authenticated;
-- no UPDATE/DELETE on notes: corrections are new notes

grant select on public.claim_events to authenticated;                  -- narrowed to admins by policy (I3)
-- no INSERT/UPDATE/DELETE on claim_events for any JWT role, service_role included (I4, I5)

-- ============================================================
-- RLS. Every table. Policies are permissive and OR together; each is written to be read in isolation.
-- ============================================================
alter table public.claims       enable row level security;
alter table public.claim_files  enable row level security;
alter table public.claim_notes  enable row level security;
alter table public.claim_events enable row level security;

-- ---------- claims ----------
create policy claims_select_agent on public.claims
  for select to authenticated
  using (agent_id = (select auth.uid()));

create policy claims_select_admin on public.claims
  for select to authenticated
  using ((select public.is_admin()));

-- create own drafts, unassigned. Admins are not excluded (brief: do not hard-block admins on mobile).
create policy claims_insert_agent on public.claims
  for insert to authenticated
  with check (
    agent_id = (select auth.uid())
    and status = 'draft'
    and assigned_to is null
  );

-- edit own claim only while draft / info_requested (USING = old row); may only land on draft, info_requested
-- (edit) or submitted (submit) (WITH CHECK = new row). claims_guard_update narrows to the exact transitions.
create policy claims_update_agent on public.claims
  for update to authenticated
  using (
    agent_id = (select auth.uid())
    and status in ('draft', 'info_requested')
  )
  with check (
    agent_id = (select auth.uid())
    and status in ('draft', 'info_requested', 'submitted')
  );

-- admin: update any claim; transitions narrowed by the guard trigger.
create policy claims_update_admin on public.claims
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- no DELETE policy for anyone.

-- ---------- claim_files ----------
create policy claim_files_select_agent on public.claim_files
  for select to authenticated
  using (exists (
    select 1 from public.claims c
    where c.id = claim_files.claim_id and c.agent_id = (select auth.uid())
  ));

create policy claim_files_select_admin on public.claim_files
  for select to authenticated
  using ((select public.is_admin()));

-- attach and remove only while draft (decision p); uploaded_by must be the caller.
create policy claim_files_insert_agent on public.claim_files
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.claims c
      where c.id = claim_files.claim_id
        and c.agent_id = (select auth.uid())
        and c.status = 'draft'
    )
  );

create policy claim_files_delete_agent on public.claim_files
  for delete to authenticated
  using (exists (
    select 1 from public.claims c
    where c.id = claim_files.claim_id
      and c.agent_id = (select auth.uid())
      and c.status = 'draft'
  ));

-- no admin insert/delete of files; no UPDATE for anyone.

-- ---------- claim_notes ----------
-- I2: the ONLY policy that returns a note to a non-admin carries visibility = 'agent_visible'.
create policy claim_notes_select_agent on public.claim_notes
  for select to authenticated
  using (
    visibility = 'agent_visible'
    and exists (
      select 1 from public.claims c
      where c.id = claim_notes.claim_id and c.agent_id = (select auth.uid())
    )
  );

create policy claim_notes_select_admin on public.claim_notes
  for select to authenticated
  using ((select public.is_admin()));

create policy claim_notes_insert_admin on public.claim_notes
  for insert to authenticated
  with check ((select public.is_admin()) and author_id = (select auth.uid()));

-- no agent insert (agents respond by editing + resubmitting); no UPDATE/DELETE for anyone.

-- ---------- claim_events ----------
-- I3/I4/I5: admins read; nobody inserts/updates/deletes through PostgREST. Triggers write as definer.
create policy claim_events_select_admin on public.claim_events
  for select to authenticated
  using ((select public.is_admin()));
```

### 2.3 Phase 2 — `20260902000003_storage_bucket.sql` and `20260902000004_storage_policies.sql`

Two files because the CLI applies each file in one transaction: if the platform ever rejects `create policy on storage.objects`, the bucket must not be rolled back with it.

```sql
-- 20260902000003_storage_bucket.sql — private bucket.
-- The mime allow-list and size cap are enforced by storage-api on every upload, including uploads through
-- signed upload URLs. This is the "storage bucket policy" the brief asks for; the next file adds "which path".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-files', 'claim-files', false,
  26214400,                                                      -- 25 MiB (open question 3)
  array['image/jpeg', 'image/png', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

```sql
-- 20260902000004_storage_policies.sql — storage.objects already has RLS enabled by Supabase.
-- I9: every object must correspond to a claim_files row (storage_path = object name). The route handler inserts
-- that row before requesting the signed upload URL, so only API-registered paths are uploadable.

-- agent: sign an upload URL for own claim while draft. storage-api evaluates THIS policy when
-- createSignedUploadUrl() is called.
create policy claim_files_storage_insert_agent on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'claim-files'
    and exists (
      select 1
      from public.claim_files f
      join public.claims c on c.id = f.claim_id
      where f.storage_path = objects.name
        and f.uploaded_by = (select auth.uid())
        and c.agent_id   = (select auth.uid())
        and c.status = 'draft'
    )
  );

-- agent: read (signed download URLs) for own claims
create policy claim_files_storage_select_agent on storage.objects
  for select to authenticated
  using (
    bucket_id = 'claim-files'
    and exists (
      select 1
      from public.claim_files f
      join public.claims c on c.id = f.claim_id
      where f.storage_path = objects.name
        and c.agent_id = (select auth.uid())
    )
  );

-- agent: remove only while draft. The route deletes the object BEFORE the row because this policy needs the row to exist.
create policy claim_files_storage_delete_agent on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'claim-files'
    and exists (
      select 1
      from public.claim_files f
      join public.claims c on c.id = f.claim_id
      where f.storage_path = objects.name
        and c.agent_id = (select auth.uid())
        and c.status = 'draft'
    )
  );

-- admin: read every REGISTERED object (signed download URLs for the dashboard). The join keeps I9 true for admins
-- too: an object whose row was pruned (decision f) is unreachable by anyone.
create policy claim_files_storage_select_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'claim-files'
    and (select public.is_admin())
    and exists (select 1 from public.claim_files f where f.storage_path = objects.name)
  );

-- no UPDATE policy (objects are never overwritten; x-upsert is never sent); no admin insert/delete.
```

Fallback: ownership of `storage.buckets` / `storage.objects` has changed across Supabase releases. If `db push` rejects file 4, create the four policies by hand in Dashboard → Storage → Policies with the predicates above; if file 3 also failed, create the bucket there (private, 25 MiB, the four mime types). The README carries this.

### 2.4 Service-role usage

Exactly one operation uses the service-role key: `update profiles set expo_push_token = null where id = $1 and expo_push_token = $2` in `lib/push.ts` when Expo reports `DeviceNotRegistered`. It is a write to _another_ user's profile; there is deliberately no admin UPDATE policy on `profiles` because it would expose `role`. `lib/push.ts` is the only module that imports `lib/supabase/service.ts`.

**[addition]** One more cross-user write exists, and it does _not_ use the service role: `POST /api/me/push-token` first clears the token it is about to store from every other profile (a shared phone whose previous account never reached the sign-out API would otherwise keep receiving that account's pushes). The route is an agent route, and the brief reserves the service-role client for admin-only operations, so the write is `public.release_push_token(p_token)` — a SECURITY DEFINER function in `20260902000005_release_push_token.sql`, executable by `authenticated`, that updates only `expo_push_token`, only on rows other than the caller's, only where the row holds exactly that token — called through the caller's user-scoped client. Knowing a token already lets anyone push to that device via Expo's public API, so clearing it is not a new capability.

Everything else — every read and every admin mutation on `claims`, `claim_files`, `claim_notes` — uses a user-scoped client so the admin policies are exercised and `auth.uid()` in the audit triggers is the real actor. Signed upload and download URLs are created with the caller's user-scoped client and authorised by the `storage.objects` policies. The brief permits service role for admin operations; not using it there is a choice (decision d), not a constraint.

---

## 3. API route list

### Authentication in every handler

Handlers accept **bearer tokens only** and never read cookies (decision g). `lib/api/auth.ts` exports `requireUser(req, opts?)` and `requireAdmin(req, opts?)` (`opts.verification`, see step 2):

1. Read `Authorization: Bearer <jwt>`; missing → `UNAUTHENTICATED`.
2. `createBearerClient({ url, key, accessToken })` (publishable key as `apikey`, the JWT as global `Authorization`, no session persistence), then verify the token. Default (`verification: 'local'`, amended 2026-09-27): `db.auth.getClaims(accessToken)` checks the ES256 signature in-process against the project's key set, which auth-js fetches once per process and caches for 10 minutes (the endpoint is CDN-cached), so the warm path makes no request to the Auth server. `verification: 'server'`: `db.auth.getUser(accessToken)`, one round trip, sees revocation; used by the three admin mutation handlers. Either way invalid/expired → `UNAUTHENTICATED`, Auth server or JWKS endpoint unreachable → `INTERNAL`.
3. Read own `profiles` row through the same client (RLS: own row) → `profile`.
4. Return `{ user: { id, email }, profile, db }`. `requireAdmin` throws `FORBIDDEN` unless `profile.role === 'admin'`. Every `/api/admin/*` handler calls it first; the DB re-checks via `is_admin()` regardless.

Mobile sends the header from its Supabase session; the web dashboard's client components fetch the token from the browser client (`lib/api-client.ts`). Cookies are the transport for **pages** only (middleware and RSC via `@supabase/ssr`). Middleware does not run on `/api/*`. Agent routes add `.eq('agent_id', user.id)` in addition to RLS so "not yours" is a clean `NOT_FOUND`.

### Response and error shape

Success: `200 { data: T }` (`201` on create). Paginated lists: `{ data: T[], page, per_page, total }`. Every non-2xx: `{ error: { code, message } }`, extended **[addition]** with `details?` present only on `VALIDATION_ERROR` (flattened zod issues so the mobile form can show per-field errors). Codes are exported from `@claims/shared`:

| Code                    | HTTP | When                                                                                                                      |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`       | 401  | no/invalid bearer token                                                                                                   |
| `FORBIDDEN`             | 403  | non-admin on `/api/admin/*`; PG `42501`; guard `CL002`                                                                    |
| `NOT_FOUND`             | 404  | row not visible under RLS (identical for "not yours" and "does not exist")                                                |
| `VALIDATION_ERROR`      | 400  | zod failure; PG `23514` (check) / `22P02` (bad enum or uuid) / `23503` (foreign key, e.g. `assigned_to` is not a profile) |
| `INVALID_TRANSITION`    | 409  | `canTransition()` false, or guard `CL001`                                                                                 |
| `INVALID_STATE`         | 409  | edit/upload/delete on a claim whose status does not allow it                                                              |
| `FILE_TYPE_NOT_ALLOWED` | 415  | mime not in `ALLOWED_MIME_TYPES`                                                                                          |
| `FILE_TOO_LARGE`        | 413  | `size_bytes > MAX_FILE_SIZE_BYTES`                                                                                        |
| `INTERNAL`              | 500  | anything unmapped; logged server-side, generic message                                                                    |

### Routes

"Event" = `claim_events` rows written by the DB triggers as a consequence; handlers never insert events. "agent" = any authenticated user acting on a claim they own; "admin" = `requireAdmin`.

| Method | Path                            | Who               | Body / query (zod, `@claims/shared`)                                                                                                                                                                                                                              | Response `data`                                                                                                                                                                  | Event                                                                           | Push                                                        |
| ------ | ------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| POST   | `/api/me/push-token`            | any authenticated | `pushTokenSchema { expo_push_token: string \| null }` — `null` on sign-out **[addition]** so a shared device stops receiving the previous account's pushes; a non-null token is first cleared from other profiles via `release_push_token()` **[addition]**, §2.4 | `{ expo_push_token }`                                                                                                                                                            | —                                                                               | —                                                           |
| POST   | `/api/claims`                   | agent             | `createClaimSchema { title, claim_type, description?, incident_date?, policy_number?, claimant_name?, details? }`                                                                                                                                                 | `ClaimDetail` 201                                                                                                                                                                | `created`                                                                       | —                                                           |
| GET    | `/api/claims`                   | agent             | query `agentClaimsQuerySchema { status? }` **[addition]** for the grouped/filtered list                                                                                                                                                                           | `ClaimSummary[]` ordered `updated_at desc`, unpaginated (one agent's claims are few)                                                                                             | —                                                                               | —                                                           |
| GET    | `/api/claims/:id`               | agent             | —                                                                                                                                                                                                                                                                 | `ClaimDetail` = claim + `files` (10-min signed URLs; `url` null if the object never landed) + `notes` (RLS returns only `agent_visible`)                                         | —                                                                               | —                                                           |
| PATCH  | `/api/claims/:id`               | agent             | `updateClaimSchema` (create fields, all optional; `status` not accepted)                                                                                                                                                                                          | `ClaimDetail`                                                                                                                                                                    | `updated`                                                                       | —                                                           |
| POST   | `/api/claims/:id/submit`        | agent             | —                                                                                                                                                                                                                                                                 | `ClaimDetail`                                                                                                                                                                    | `status_changed` (+ `file_removed` for reservations whose object never arrived) | —                                                           |
| POST   | `/api/claims/:id/files`         | agent             | `createFileUploadSchema { file_name, mime_type, size_bytes }`                                                                                                                                                                                                     | `{ file: ClaimFile, upload: { signed_url, token, path, expires_at } }` 201                                                                                                       | `file_reserved`                                                                 | —                                                           |
| DELETE | `/api/claims/:id/files/:fileId` | agent             | —                                                                                                                                                                                                                                                                 | `{ id }`                                                                                                                                                                         | `file_removed`                                                                  | —                                                           |
| GET    | `/api/admin/claims`             | admin             | query `adminClaimsQuerySchema { status?, assigned_to?, agent_id?, from?, to?, sort = created_at, order = desc, page = 1, per_page = 25 (max 100) }`                                                                                                               | `Paginated<AdminClaimSummary>` (+ agent/assignee names)                                                                                                                          | —                                                                               | —                                                           |
| GET    | `/api/admin/claims/:id`         | admin             | —                                                                                                                                                                                                                                                                 | `AdminClaimDetail` = claim + agent/assignee profiles + `files` (signed URLs) + `notes` (both visibilities) + `events`                                                            | —                                                                               | —                                                           |
| POST   | `/api/admin/claims/:id/status`  | admin             | `changeStatusSchema { status, message? }`                                                                                                                                                                                                                         | `AdminClaimDetail`                                                                                                                                                               | `status_changed`; `note_added` if `message` (stored as an `agent_visible` note) | one push to the claim's agent, `data: { claim_id }`         |
| POST   | `/api/admin/claims/:id/assign`  | admin             | `assignClaimSchema { assigned_to: uuid \| null }`                                                                                                                                                                                                                 | `AdminClaimDetail`                                                                                                                                                               | `assigned`                                                                      | — (brief lists only status changes and agent-visible notes) |
| POST   | `/api/admin/claims/:id/notes`   | admin             | `createNoteSchema { body, visibility }`                                                                                                                                                                                                                           | `ClaimNote` 201                                                                                                                                                                  | `note_added`                                                                    | yes, iff `visibility = 'agent_visible'`                     |
| GET    | `/api/admin/agents`             | admin             | —                                                                                                                                                                                                                                                                 | `AgentWithCounts[] { id, full_name, created_at, counts: Record<ClaimStatus, number>, total }` — `profiles where role = 'agent'` + claim rows grouped in TS (no view to maintain) | —                                                                               | —                                                           |

Handler logic worth spelling out:

- **`PATCH /api/claims/:id`**: read claim (`NOT_FOUND` if RLS hides it) → `isEditable(status)` else `INVALID_STATE` → update with the zod output only.
- **`POST /api/claims/:id/submit`**: read → `canTransition(status, 'submitted', 'agent')` else `INVALID_TRANSITION` → `submittableClaimSchema.safeParse(row)` else `VALIDATION_ERROR` with field issues (decision o) → delete every `claim_files` row whose object is missing (only possible from `draft`; each logs `file_removed`) → `update set status = 'submitted'` (guard + audit triggers fire).
- **`POST /api/claims/:id/files`**: read → `status === 'draft'` else `INVALID_STATE` → mime/size checks → insert `claim_files` with `.select()` to get the trigger-derived `storage_path` → `createSignedUploadUrl(storage_path)` (2 h); on failure delete the row. Mobile PUTs bytes with `Content-Type: <mime>`; retry re-uses the same URL; an HTTP 409 on a retry means an earlier PUT landed and is treated as success.
- **`DELETE /api/claims/:id/files/:fileId`**: read file (RLS) → `draft`: `storage.remove([path])` then delete the row (a missing object is not an error) → otherwise `INVALID_STATE`.
- **`POST /api/admin/claims/:id/status`**: read claim + the agent's `expo_push_token` (admin profile SELECT policy) → `canTransition(claim.status, body.status, 'admin')` else `INVALID_TRANSITION` → update status → if `message`, insert an `agent_visible` note → `after(() => sendClaimPush(...))` so the push never delays the response → respond. Status update and note are two statements, not one transaction; status goes first because it is the one that matters.
- **`GET /api/admin/claims`** and the RSC `/claims` page both call `listAdminClaims(db, parsedQuery)` with `adminClaimsQuerySchema`. Date range applies to `created_at` **[assumption]**.

Web dashboard mutations call the same `/api/admin/*` routes from client components, then `router.refresh()`. A push failure is logged and the mutation still returns 200.

---

## 4. Key decisions and trade-offs

**(a) Route handlers, not Server Actions, for admin mutations.** The brief mandates the `/api/admin/claims/:id/{status,assign,notes}` routes. Server Actions would be a second mutation surface with a second copy of admin check + zod + push, or would leave those routes dead. One `handler.ts`, one error shape, one auth path, curl-testable. Cost: slightly more client boilerplate than `<form action>`.

**(b) RSC reads without duplicating GET logic.** `lib/queries/*.ts` are plain functions `(db, params) => Promise<DTO>` returning `@claims/shared` types. RSC pages call them with the cookie client; GET handlers call them with the bearer client. Same query, same RLS, same types.

**(c) Postgres enums for `status`, `role`, `visibility`; `text + CHECK` for `event_type`; plain `text` for `claim_type`.** Enums flow into `types.ts` as string-literal unions, so `Row['status']` is typed under `strict` with no casts. Cost: enum values can be added but never removed. `event_type` grows most often, so it is a CHECK. `claim_type` has no DB constraint because the brief wants the list editable in TS without a migration; for the same reason the zod schema validates it as `z.string().min(1).max(100)` and `CLAIM_TYPES` only populates the picker (`z.enum(CLAIM_TYPES)` would reject claims created before a list edit). Veto → `z.enum(CLAIM_TYPES)`, one line.

**(d) `claim_events` written by DB triggers, never by application code.** AFTER triggers write in the same transaction as the change, so the log cannot miss a write and cannot be forged. `actor_id = auth.uid()`, which is why every claims/notes/files write, including admin mutations, uses a user-scoped client rather than the service role the brief would permit. The admin "message to agent" on a status change is stored as an `agent_visible` note (own `note_added` event), so the normal visibility policy governs it **[assumption]**. Trade-off: the workflow table exists twice (SQL guard, TS `TRANSITIONS`); the shared test asserts every triple. `canTransition(from, to, actor)` takes `'agent'` (= claim owner) or `'admin'`, exactly like the guard.

**(e) Transition guard trigger and column-level grants [addition].** Mobile holds the publishable key and a JWT, so without the guard an agent could set any allowed-by-RLS status on their own claim in any order, and an admin JWT hitting PostgREST directly could skip `under_review`. RLS gives coarse enforcement (agents can only land on draft/info_requested/submitted), the route handlers enforce the exact table, and the ~40-line guard mirrors it for direct callers. Column grants stop `agent_id`, timestamps, `storage_path` and `profiles.role` from being client-settable at all. Veto either → the route handlers remain the only exact enforcement.

**(f) Signed upload URLs from the user-scoped client, authorised by storage RLS.** Insert the `claim_files` row first (RLS: own claim, draft; trigger derives `storage_path`), then `createSignedUploadUrl(path)`; storage-api checks the INSERT policy at signing time, and the bucket re-checks mime and size when bytes arrive. No service key involved. No "confirm upload" round-trip: a row whose object never arrived yields `url: null` and the UI shows "upload incomplete"; the submit route prunes such rows. Known window, accepted: a signed token (2 h) issued while draft is honoured after submit; the object then has no row and no SELECT policy can reach it. HEIC: browsers do not decode it in `<img>`, so the admin gallery shows it as an open-in-new-tab tile; the type stays allowed because the brief lists it.

**(g) Bearer-only route handlers.** The brief says handlers verify the caller by passing the bearer token to `getUser()`. Web client components fetch their access token from the browser client and send it as a bearer too, so there is no ambient credential, no CSRF surface, one auth path. Rejected alternative (vetoable): also accepting the cookie session in handlers, which needs a second auth branch plus an Origin/CSRF rule.

_Amended 2026-09-27._ Handlers still take bearer tokens only, but the default verification is now local: `requireUser(req)` calls `auth.getClaims(token)`, which checks the ES256 signature with WebCrypto against the project's JSON Web Key Set; auth-js 2.114 fetches that set once per process and caches it for 10 minutes (per process and keyed by storage key, so clients in the same function that use the default `sb-<ref>-auth-token` key — the bearer and Server Component clients — share one entry; the proxy's runtime keeps its own; the endpoint itself is CDN-cached), so the warm path makes no request to the Auth server. Measured today: the page functions run in Washington (iad1) and Supabase in Ohio, and every handler was spending one serial round trip on `getUser()` before its first query. What local verification cannot see is server-side revocation — a sign-out on another device, a ban, a password change — until the token expires (1 hour by default); PostgREST, which every query goes through, already accepts such a token for the same hour, so the online check protected reads from nothing. The three admin mutation handlers (`status`, `assign`, `notes`) call `requireAdmin(req, { verification: 'server' })` and keep the `getUser()` round trip, because a revoked admin must not be able to change a claim. The JWKS fetch failing surfaces as the same `AuthRetryableFetchError` → `INTERNAL` the Auth server outage did.

**(h) Expo password reset: PKCE.** Mobile client `flowType: 'pkce'`, AsyncStorage. `resetPasswordForEmail(email, { redirectTo })` where `redirectTo` is the literal `claimsagent://reset-password` in dev/preview/production builds and `Linking.createURL('reset-password')` only in Expo Go (yields `exp://<lan-ip>:8081/--/reset-password`). Supabase verifies server-side and redirects with `?code=`; `app/reset-password.tsx` calls `exchangeCodeForSession(code)` then `updateUser({ password })`. It also reads the full URL to surface `error_code=otp_expired` etc. Why PKCE over implicit: implicit puts tokens in the URL fragment. Cost: the link must be opened on the phone that requested it, in a real browser (some mail apps' in-app browsers do not follow the redirect to a custom scheme) — see open question 5. Exact dashboard values in §5.

**(i) Push: send tickets only, no receipt polling [assumption: "minimally" + "no queue"].** `lib/push.ts` runs inside Next's `after()`: `sendPushNotificationsAsync([{ to, title, body, data: { claim_id } }])`; a ticket with `details.error === 'DeviceNotRegistered'` nulls the token via the service client. Limitation, stated plainly: APNs/FCM-side invalidations arrive in Expo's _receipts_ ~15 min later, and a ticket only says `DeviceNotRegistered` once Expo has already learned it, so a token that dies between app launches costs one failed send before it is nulled (the app re-registers on every launch anyway). Opt-in upgrade (open question 4): a service-role-only `push_tickets` table storing ticket ids, drained through `getPushNotificationReceiptsAsync` on the next admin send.

**(j) Admin-only enforcement, three places plus the DB.** Middleware (matcher: every page path, not `/api`, `_next`, static): `getUser()` before any early return, cookies copied onto every redirect (otherwise a refresh that lands on a redirecting request logs the admin out); no user → `/login`; non-admin → `/not-authorised`; admin on `/login` → `/claims`. `(admin)/layout.tsx` and every admin page call `requireAdminPage()` (deduped per request with React `cache`): a layout's redirect ends only the layout's own render, not the page segment's, so the page-level call is what keeps a path the matcher misses from rendering admin data. `requireAdmin` in every admin handler. `is_admin()` in every admin policy. Rejected: stamping `role` into the JWT via an Auth Hook — dashboard-configured and stale until token refresh; not worth it at two roles.

_Amended 2026-09-27._ The middleware (`proxy.ts`) is no longer one of the three places: it is a session refresh plus a signed-in gate only — `getClaims()` (local signature check, still before any early return because it is what refreshes the session and writes cookies), no user → `/login`, signed-in on `/login` → `/`, everything else passes; the `profiles` role lookup is gone. Measured today on production: the proxy runs at the Vercel edge nearest the visitor (Mumbai, bom1) while pages run in Washington and Supabase in Ohio, so its `getUser()` + `profiles` pair cost ~0.4 s of the 1.1–1.6 s a warm admin page took, and the page repeated both checks anyway. The admin gate is therefore `(admin)/layout.tsx` and every admin page via `requireAdminPage()` — now `getClaims()` (local) + the `profiles` role check, run with `Promise.all` alongside the page's own queries rather than before them, which is safe because RLS limits every query to rows the caller could read anyway (an agent's own claims and own profile, nothing admin-only) and the redirect thrown by `requireAdminPage()` rejects the whole `Promise.all`, so none of it renders — plus `requireAdmin` in every admin handler and `is_admin()` in every admin policy. A signed-in agent who opens an admin URL now reaches the page function and is redirected to `/not-authorised` from there instead of from the edge.

**(k) Offset pagination** (`page`, `per_page` ≤ 100) via `.range()` + `count: 'exact'`, sort ∈ {created_at, updated_at, status, title}. Server-rendered from URL search params, so filters are shareable links. Keyset is faster at scale but hostile to "jump to page 7" and sortable columns.

**(l) Metro + pnpm hoisted + workspace packages.** `.npmrc`: `node-linker=hoisted`. `metro.config.js`: `watchFolders = [monorepoRoot]`, `resolver.nodeModulesPaths = [apps/mobile/node_modules, root/node_modules]`. `react`, `react-dom`, `@types/react` pinned to the identical exact version in both apps (the one `npx expo install --check` demands) so there is exactly one React under hoisting; Phase 0 verifies with `pnpm why react`. `@claims/*` `package.json` `exports` point at `./src/*.ts`; Metro transpiles TS from workspace packages; Next gets `transpilePackages`. No build step, no `dist/`. If the EAS build image ships a pnpm major that ignores `.npmrc`, the same setting goes in `pnpm-workspace.yaml` as `nodeLinker: hoisted`; `eas.json` pins `node` and `pnpm` versions per profile either way.

**(m) Supabase CLI directory = `packages/supabase`** by running the CLI with `--workdir packages` (it expects `<workdir>/supabase/{config.toml,migrations}`), which puts migrations exactly where the brief wants them with no symlinks. Root scripts: `db:link`, `db:new <name>`, `db:push`, `db:types` (`gen types --lang typescript --linked --schema public` written to a temp file then moved, so a failed run cannot truncate the committed `types.ts`). Hosted-only development: migrations are hand-written; `db diff`, `db pull`, `db reset`, `start` need Docker.

**(n) Claims are undeletable through any JWT** (`delete` not granted; audit FKs `on delete restrict`). No delete route exists in the brief; audit rows must not vanish. Deleting a user with claims also fails — a deliberate manual operation.

**(o) Draft nullability and "required at submit" [assumption].** `title` and `claim_type` are required to create a draft; `incident_date`, `policy_number`, `claimant_name` are nullable in the DB and required by `submittableClaimSchema`, which the submit route runs against the stored row. Kept in `packages/shared`, not a DB CHECK, so relaxing it is an edit, not a migration. Stated plainly: a caller hitting PostgREST directly can submit an incomplete claim; no isolation property depends on it. Veto → a `CL004` branch in the guard trigger.

**(p) Attachments only while `draft` [assumption].** The brief's file rules are one-sided ("allow removal while draft", `DELETE … only while draft`) and its `info_requested` text says "edit + resubmit" without mentioning attachments. One predicate, `status = 'draft'`, on the `claim_files` and storage policies. Consequence: an agent cannot attach a document an admin asks for in `info_requested`. See open question 6.

**(q) `assigned_to` may reference any profile; the dropdown lists `role = 'agent'`; an assignee gains no extra read access.** Literal reading. See open question 1.

**(r) Admins may edit claim content through PostgREST; no route exposes it.** The admin UPDATE policy is column-unrestricted because column grants cannot distinguish admins from agents. Not restricted because the brief does not ask for it.

**(s) Mobile choices.** Session storage: AsyncStorage (Supabase's documented Expo setup; `expo-secure-store` has a 2 KB value limit a session exceeds) with the `AppState` auto-refresh listener. Forms: react-hook-form + `zodResolver` **[addition]** so form state survives a failed request without hand-rolled code; no server-state library (plain `fetch` + `useState`, retry via the error banner). Uploads: `expo-file-system/legacy` `createUploadTask` — on current SDKs the package root exports the new File/Directory API, which has no upload-with-progress primitive. Expo Go for Phases 0–4 (handles `exp://` deep links, so password reset is testable); development build with `expo-dev-client` from Phase 5 (Expo Go cannot receive remote push or open `claimsagent://`). Notification taps use `useLastNotificationResponse()` so cold-start taps work, navigating only once the session has resolved.

**(t) zod v4; vitest** only in `packages/shared` (transition matrix, schema fixtures), running raw TS with no transform config.

_Amended 2026-09-27._ Also in `apps/web`: `lib/api/auth.test.ts` covers `requireUser`/`requireAdmin` through their public surface with `@claims/supabase/bearer` mocked, so header parsing, both verification modes, the error mapping and the profile lookup are the real code and auth-js's key-set cache is never exercised. `apps/web/vitest.config.mts` exists only to map the tsconfig `@/*` alias and to scope `test.include` to `lib/**/*.test.ts` (still raw TS, no transform config; `.mts` because the Next app's `package.json` is CommonJS and Vite warns about an ESM `.ts` config). The `test` script runs under the root `turbo run test`, which depends on `typecheck`.

**(u) Web sign-in uses the browser client** (`signInWithPassword`; `@supabase/ssr` writes cookies). No auth API route; clients talk to Supabase Auth directly **[assumption]**.

**(v) Tooling.** ESLint flat config: shared `eslint.base.mjs` + a real `eslint.config.mjs` per workspace (flat-config globs are relative to the defining file, so a re-exported root config scoped by `apps/web/**` would match nothing); `lint` scripts are `eslint .`. Turborepo `build` hashes `.env*` so an edited `.env.local` invalidates the cache. pnpm 10: `pnpm approve-builds` once and commit `onlyBuiltDependencies`. Root `packageManager` pin; Vercel honours it only with `ENABLE_EXPERIMENTAL_COREPACK=1`. Exact framework versions and the `middleware.ts`/`proxy.ts` naming are reported in the Phase 0 summary.

---

## 5. What is needed from you

### Environment variables

`apps/web/.env.example` → `.env.local`

| Variable                        | Where to get it                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase dashboard → Project Settings → API → Project URL                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → publishable key (`sb_publishable_…`; the legacy `anon` JWT also works)          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Project Settings → API Keys → secret key. Server-only; never `NEXT_PUBLIC_`                                   |
| `EXPO_ACCESS_TOKEN`             | expo.dev → Account → Access tokens. Optional; only if "Enhanced push security" is enabled on the Expo project |

`apps/mobile/.env.example` → `.env`

| Variable                        | Where to get it                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | as above                                                                                                                                                                                                                                       |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | as above (publishable/anon only)                                                                                                                                                                                                               |
| `EXPO_PUBLIC_API_URL`           | Web app base URL: `http://<mac-lan-ip>:3000` for a device on the LAN (development builds included: `expo start` serves their JS), `http://localhost:3000` on the simulator, the Vercel URL for preview/production (`env` blocks in `eas.json`) |

The EAS project ID is not an env var: `eas init` prints it; it is pasted into `extra.eas.projectId` in `app.config.ts` once.

### Supabase dashboard settings (cannot be done in migrations)

1. Create the project (or give me the ref). I need `supabase login` + `pnpm db:link` (prompts for the DB password).
2. **Authentication → URL Configuration** — Site URL: the web app URL (`http://localhost:3000` now, Vercel URL later). Redirect URLs: `claimsagent://reset-password`, and while using Expo Go also `exp://192.168.*.*:8081/--/reset-password` (adjust to your LAN subnet; `expo start` uses the LAN IP even for the simulator; the app logs the exact value at startup in dev; remove before production). To test reset on the simulator, open the emailed link inside it: `xcrun simctl openurl booted '<link>'`.
3. **Authentication → Providers → Email** — keep enabled; decide "Confirm email" (open question 2). Minimum password length ≥ 8 (zod mirrors it).
4. **Authentication → Email Templates → Reset Password** — the default template works with PKCE; wording changes only (open question 5).
5. **Authentication → SMTP** — the built-in sender is rate-limited to a few emails per hour; configure custom SMTP before anyone but you tests sign-up/reset.
6. **Storage** — bucket and policies come from migrations 3 and 4; verify `claim-files` shows as private after `db:push`. Fallback in §2.3.
7. **Promote your admin** — SQL editor: `update public.profiles set role = 'admin' where id = '<uuid from Authentication → Users>';`
8. **Push** (Phase 5) — an Expo account and `eas init`; iOS: a paid Apple Developer account (`eas credentials`); Android: the FCM V1 service-account JSON via `eas credentials` _and_ `google-services.json` at `apps/mobile/google-services.json` (gitignored) with `android.googleServicesFile` set. Remote push cannot be tested on the simulator.
9. **Vercel** (Phase 6) — Root Directory `apps/web`; "Include source files outside of the Root Directory in the Build Step" ON; Node 22.x; `ENABLE_EXPERIMENTAL_COREPACK=1`; the four web env vars.

### Tools to install

- **Supabase CLI**: `brew install supabase/tap/supabase` — required from Phase 1.
- **Docker Desktop** — only if you want `supabase start` / `db reset` / `db diff` locally. The plan assumes hosted-only development; the README documents both.
- **Development build tooling** (Phase 5): `eas build --profile development --platform ios` (cloud) or `npx expo run:ios` (local; needs CocoaPods; generates `apps/mobile/ios/`, which is gitignored so the project stays managed).

---

## 6. Open questions

1. **`assigned_to` semantics.** The brief says `GET /api/admin/agents` feeds the assignment dropdown, which reads as "assign a claim to a field agent"; the other common meaning is assigning an admin reviewer. Which is it? And if an agent can be the assignee, should they gain read access to that claim? (Changes the dropdown filter and one `claims` SELECT policy.)
2. **Email confirmation on sign-up: on or off?** On (Supabase default) means agents must open a confirmation deep link before first sign-in: one more mobile route and redirect URL. Off is simpler for an internal tool.
3. **Maximum file size.** 25 MiB assumed. It is a literal in the bucket row, a CHECK constraint and a shared constant, so it must be settled before Phase 2.
4. **Push receipts.** Default is tickets-only (decision i). Say so if you want the `push_tickets` receipt-polling upgrade in Phase 5 instead.
5. **Password-reset links: mail scanners and in-app browsers.** The default one-shot link can be consumed by Outlook Safe Links / Gmail prefetch before the agent taps it, and some mail apps' in-app browsers do not follow the redirect to `claimsagent://`. Default stays the brief's deep link plus an "open in Safari/Chrome" instruction. The robust alternative is a `{{ .TokenHash }}` template pointing at a tiny public page on the Vercel app with an "Open in app" button, and `verifyOtp({ type: 'recovery', token_hash })` on the phone — one extra web page, fixes both problems. Say the word and it goes into Phase 1.
6. **Attachments in `info_requested`.** Default is decision (p): attachments only while `draft`. Alternative: allow add and remove in `info_requested` too (one predicate change, but contradicts "only while draft", so it needs your explicit say-so).
