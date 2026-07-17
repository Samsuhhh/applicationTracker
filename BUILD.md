# CareerOS build — increment 1: the data layer

This turns applicationTracker into the CareerOS backend, additively. The existing live app
keeps working; this adds a D1 database + an `/api/applications` API alongside it.

**What Claude wrote this increment:** `schema.sql`, the `d1_databases` binding in
`wrangler.jsonc`, and the `/api/applications` CRUD routes in `worker.js`.

**What you run** (needs your Cloudflare login — Claude can't touch your account):

## 1. Create the D1 database

```bash
cd ~/Desktop/applicationTracker
npx wrangler d1 create careeros
```

It prints a `database_id`. Copy it into `wrangler.jsonc`, replacing
`PASTE_DATABASE_ID_AFTER_wrangler_d1_create`.

## 2. Apply the schema

```bash
# local dev copy first (safe, nothing remote touched):
npx wrangler d1 execute careeros --local --file=./schema.sql

# then the real remote database when you're ready:
npx wrangler d1 execute careeros --remote --file=./schema.sql
```

## 3. Run locally and test the API

```bash
npx wrangler dev
```

Then, in another terminal:

```bash
# create an application
curl -X POST http://localhost:8787/api/applications \
  -H 'content-type: application/json' \
  -d '{"company":"Riddle & Riddle","role":"Web Developer","status":"applied","pay":"$70-95k"}'

# list them
curl http://localhost:8787/api/applications
```

You should get JSON back, and the row persists in the local D1 file.

## 4. Deploy (when you're happy)

```bash
npx wrangler deploy
```

Behind Cloudflare Access, only you can reach it.

## Notes / safety

- **Nothing breaks:** the existing kanban (localStorage) and `/api/tailor-resume` are
  untouched. This increment only *adds* the D1 API. The frontend still uses localStorage
  until increment 2 migrates it.
- **Cost:** D1 free tier (5 GB, 5M reads/day) covers personal use — $0 expected.
- **Auth:** the API currently trusts whoever reaches it. That's fine *behind Cloudflare
  Access*; before exposing it publicly, add the agent API-token check (a later increment).

## What's next (increment 2)

- Migrate the kanban frontend from localStorage → the `/api/applications` API.
- Add the New Application form (with the JD field + "tailor now" toggle).
- Add the other CareerOS pages (materials, achievement library, research, prep).
- Then R2 for rendered files, then wire the SamOS career-manager to write here.

See `~/Desktop/SamOS/docs/cannibalize-plan.md` for the full build order and
`~/Desktop/SamOS/docs/careeros-web-schema.md` for the data model.
