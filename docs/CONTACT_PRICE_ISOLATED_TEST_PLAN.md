# Contact for price — isolated test environment plan (2026-10-27)

**Status: a plan only. Nothing in it has been run.** No Docker install, no project creation, no Edge Function deploy, no R2 setup, no test data. Each step marked **[APPROVAL]** needs an explicit yes first. Production `.env`, `web/.env.local` and the CLI link (`supabase/.temp/linked-project.json`, ref `waksddinkjbrggxkfofk`) are unchanged by this plan; their fingerprints are recorded in section 5.

## 1. What this machine has (read-only inspection, 2026-10-27)

| Item | Finding | Consequence |
|---|---|---|
| Free disk | C: 171.5 GB free of 427 GB | Plenty |
| RAM | **7.9 GB** total, 4 logical cores (i5-7300U) | Tight. Docker/WSL must be capped (4 GB) and heavy services excluded |
| Virtualization | Firmware virtualization **enabled**; no hypervisor running; WSL and Windows Hyper-V/VirtualMachinePlatform feature state could not be read without admin | Enabling WSL 2 may need admin + a reboot |
| Docker | **Not installed** | Needed for `supabase start` |
| `wsl.exe`, `winget` | present | `winget install Docker.DockerDesktop` possible |
| `psql` | **not installed** | Use `supabase db query --db-url …` (works without psql) |
| Supabase CLI | 2.116.0 (2.122.0 available; do not upgrade as part of this) | Fine |
| `supabase/config.toml` | does not exist in the repo | `supabase init` would create it in the repo; avoided below |
| Node | v24.16.0 (PGlite suites already run here) | Fine |
| Shell env vars `SUPABASE*`, `EXPO_PUBLIC*`, `NEXT_PUBLIC*` | none set | Nothing leaks in from the shell |
| `.env*.local` | git-ignored in root and `web/` | Dev-only env files are safe to create |

Already available without Docker: the PGlite harness (`supabase/tests/*.test.mjs`) runs the real migration chain plus 0085-0089 on a real in-memory Postgres (PGlite 0.5.10). It proves SQL behaviour but not Auth, PostgREST, Storage, Realtime, RLS through the API, or any screen. The local stack is only needed for **app/website behaviour**.

## 2. Plan: local Supabase with Docker Desktop

### Disk and memory budget
| Part | Approx. size |
|---|---|
| Docker Desktop install | 2.5-3 GB |
| WSL 2 utility VM disk (grows with use, capped by you) | 3-6 GB |
| Supabase images, trimmed set (db, auth, rest, kong/gateway, storage, studio optional) | 3-5 GB (full default set 8-10 GB) |
| Database volume (empty schema + test rows) | < 0.5 GB |
| **Total** | **~10-15 GB of 171 GB free** |

Memory: write `%UserProfile%\.wslconfig` with `[wsl2] memory=4GB`, `processors=2`, `swap=4GB` **[APPROVAL, it is a user-level file]**, and start the stack with unneeded services excluded so it stays near 2-2.5 GB.

### Steps (nothing run yet)
1. **[APPROVAL] Install Docker Desktop** with the WSL 2 backend (`winget install -e --id Docker.DockerDesktop`), reboot if asked, start it, sign in is not required.
2. **Use a separate working directory, not the repo**, so the repo's link and files are never touched:
   ```
   mkdir C:\suuq-local ; cd C:\suuq-local
   supabase init            # creates C:\suuq-local\supabase\config.toml ONLY
   ```
   Edit that `config.toml`: `project_id = "suuq-local"`, `[auth] site_url` stays local. Leave `[auth.email] enable_confirmations = false` for quick sign-up.
3. **[APPROVAL] Start the stack** (trimmed):
   ```
   supabase start -x studio,imgproxy,vector,logflare,mailpit,edge-runtime
   ```
   Add `realtime` to the excluded list only if chat is not under test; keep `storage` only if images are. It prints the local API URL `http://127.0.0.1:54321`, DB URL `postgresql://postgres:postgres@127.0.0.1:54322/postgres` and a **local** anon key (the well-known demo keys; they only work against this stack).
4. **Load the schema into the local DB only**: copy the repo's `supabase/migrations/*.sql` and, in order, `supabase/proposed/0085…0087` (and `0088`, `0089` for review) into `C:\suuq-local\supabase\migrations\`, then `supabase db reset` **run from `C:\suuq-local`** (local-only by construction, it targets the local container). Never `supabase db push --linked`, `supabase link`, or `supabase functions deploy` from the repo during testing.
5. **App/website pointing** (dev-only, git-ignored; section 4 explains why this cannot reach production):
   - repo root `.env.development.local`: `EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321` (Android emulator) or `http://<PC LAN IP>:54321` (device) , `EXPO_PUBLIC_SUPABASE_ANON_KEY=<local anon key>`, `EXPO_PUBLIC_CONTACT_PRICE_LOCAL=true`
   - `web/.env.development.local`: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>`, `NEXT_PUBLIC_CONTACT_PRICE_LOCAL=true`
   - `npx expo start -c` / `npm run dev` in `web/`. The mobile app needs a development build (`npx expo run:android`), not Expo Go.
6. **Test data**: create two local users through the local sign-up screen; create listings through the app or `supabase db query --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres "<sql>"`. **[APPROVAL before the first write.]**
7. **Photos / R2**: publishing needs an uploaded photo. Without R2, insert test listings by SQL with any `images` URL (see `docs/CONTACT_PRICE_LOCAL_TEST.md`). Do **not** deploy `r2-presign` or touch the R2 bucket; configuring a separate test bucket is a separate decision **[APPROVAL]**. `supabase functions serve` (local only, `--env-file` with a throw-away test bucket) is the only acceptable way to run an Edge Function, and only after that approval.
8. **Cleanup**: `supabase stop --no-backup` (from `C:\suuq-local`), delete `C:\suuq-local`, delete both `.env.development.local` files, `docker system prune -a --volumes` (asks first), optionally uninstall Docker Desktop and remove `.wslconfig`. The repo itself needs no cleanup because it was never modified by the stack.

### Fallback if 8 GB proves too little
Keep using the PGlite suites for all SQL claims and run the website only (`next dev`) against a stack started with `-x` for everything except db/auth/rest/kong. Or use a hosted second project; the free tier already allows only two and the second one (`ulrgkqjjiclulnuotifh`) has not been inspected and must not be written to.

## 3. Safe-verification checklist (run before the first write, all read-only)

| # | Check | Command / evidence | Pass condition |
|---|---|---|---|
| 1 | Project URL in app env | `Select-String SUPABASE_URL .env.development.local, web\.env.development.local` | host is `127.0.0.1` / `10.0.2.2` / private LAN IP only |
| 2 | Project ref is not production | `findstr /i waksddinkjbrggxkfofk` over both dev env files and `C:\suuq-local` | no match |
| 3 | Production files unchanged | compare SHA-256 of `.env`, `web/.env.local`, `supabase/.temp/linked-project.json` with section 5 | identical |
| 4 | CLI link still production and untouched | `Get-Content supabase\.temp\linked-project.json` | same JSON as section 5 (it must **not** have been re-linked) |
| 5 | The DB you will write to is the container | `supabase db query --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres "select inet_server_addr(), inet_server_port(), current_database(), (select count(*) from public.listings)"` | `127.0.0.1`/`172.x`, port 5432 inside the container, `listings` count **0** (production has 8) |
| 6 | Credentials are local | the anon key in the dev env files equals the key printed by `supabase status` (from `C:\suuq-local`) | equal; it is not the production key from `.env` |
| 7 | Docker shows only the local stack | `docker ps --format "{{.Names}}"` | names end in `_suuq-local` |
| 8 | No Edge Function destination | `supabase functions list` is **not** run from the repo; no `functions deploy` in shell history for this session; `r2-presign` URL in the dev env is absent or local | none deployed |
| 9 | Flag is truly on only locally | the sell form shows "How do you charge?" with the dev env files, and does **not** with them removed | both observed |
| 10 | Git is clean of secrets | `git status --short` shows no `.env*` entries | none |

## 4. Why the local flag cannot authorize production writes

`CONTACT_PRICE_ENABLED` is only a user-interface switch; it grants no database right. What stops production use is layered:

1. The shipped value is `false`; store builds have no development bundle (`__DEV__` false) and `next build` sets `NODE_ENV=production`, so the override never turns on there. Nothing was added to `eas.json`, `.env.example` or deployment config (a test asserts it).
2. **Changed 2026-10-27:** the override now requires an **allow-listed local address** (`localhost`, `127.0.0.1`, `[::1]`, `10.0.2.2`, private `10.x`/`192.168.x`/`172.16-31.x`, `*.local`). Before, it only refused URLs containing the exact lower-case production ref, so an upper-case host, a custom domain, a proxy, or the other hosted project would have passed. The production ref is still refused as a second check, in any letter case. Both copies (`data/contactPriceFlag.ts`, `web/src/lib/contactPriceFlag.ts`) and `tests/contactPriceSafeguards.test.ts` (positive and negative cases, including `localhost@<prod>` and `127.0.0.1.evil.com`) cover it.
3. **Honest limit:** the production database already contains 0085/0086, so it *accepts* contact-price listings from any client that sends one directly. The flag does not and cannot prevent that; the protections for production are (a) keeping the shipped flag `false` and (b) not pointing a development build at production. 0087 (pending-offer accept guard) is not yet live in production.

## 5. Fingerprints of the production-facing files (recorded 2026-10-27, unchanged by this work)

| File | SHA-256 prefix |
|---|---|
| `.env` | `db59efdb514bab52…` |
| `web/.env.local` | `d9feffbdff8b1c33…` |
| `supabase/.temp/linked-project.json` | `4364a666d8959da1…` |
