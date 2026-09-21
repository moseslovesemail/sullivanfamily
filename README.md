# Family Support — demo bootstrap

A lightweight, mobile-first prototype for coordinating appointments, school routines, meals and practical household support.

**This is a fictional-data demo, not a private shared family app.** It has no authentication, database, cross-device sync, medication tracking or dependable reminders. Do not enter real health, child, school, location, contact or financial information.

## What works

- Today, tomorrow, Monday–Sunday week view, care, kids and all-task views.
- All roster views derive from one local task collection; gap and workload counts are calculated.
- Switch between four fictional helpers, claim/release tasks and mark completion.
- Add a fictional dated task and see it in the matching roster views.
- Same-browser local persistence and reset. A helper selector is **not** a login.
- Pacific/Auckland date handling and a mobile-friendly layout.

Shopping, budgets, contacts, availability, handovers, medication records and notifications are explicitly labelled as examples or future work. No invented clinical data or real family identifiers are included.

## Run

Node.js 22 or newer; no third-party runtime packages or npm install required.

```sh
npm start
# Open http://localhost:3000
npm run check
npm test
```

## Railway deployment configuration

The root Dockerfile runs the tested dependency-free demo. Railway configuration is in `railway.json`.

- Repository root: `/`
- Dockerfile: `Dockerfile`
- Start command: `node server.mjs`
- Health check: `/healthz`
- `APP_MODE=demo` (default; every other value is rejected)
- Railway supplies `PORT`; local default is `3000`.
- Do not attach a real-data database to this build.

The files are deployable configuration, not evidence that a Railway deployment has happened. Hosting charges depend on the account and usage.

## Privacy and technical boundaries

This demo is safe to publish as generic source code, **not** safe for storing private family information. Keep the future family application repository private as an additional precaution, but repository privacy does not replace authentication and server-side authorisation.

The server serves an exact asset allowlist, rejects writes, blocks embedding, sends no-store/noindex headers and uses a restrictive content security policy. These are defence-in-depth measures, not a login. Browser localStorage is not encrypted secure storage. There are no analytics, advertising, external fonts or AI services.

Never commit private data, secrets, uploaded documents, exports or environment files. Demo changes are local browser data. Reset demo replaces those local changes only; it does not affect another person's phone.

## Next build stage

See `docs/production-plan.md` for invite-only access, shared PostgreSQL records, explicit permissions, recurrence exceptions, audit history and medication-record safeguards. The original Next.js scaffold is not deployed by this bootstrap; the default entrypoint is the executable demo above.
