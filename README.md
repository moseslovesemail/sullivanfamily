# Private Family Support — v2

A small, invitation-only family coordination application. This repository contains generic source code only. Never commit account invitations, encryption keys, actual addresses, children's routines or health information.

## Available

- Individual accounts with single-use invitations, usernames and passphrases.
- Owner/backup coordinator, lead coordinator, family member and restricted helper roles.
- A shared server-side roster with Today, Tomorrow, Week and Tasks views; refreshes every 15 seconds while open.
- AM/PM display and explicit AM/PM time selection in the Pacific/Auckland timezone.
- Assign, accept, claim, release and complete tasks. Changed arrangements require fresh confirmation. Version checks reject conflicting edits.
- Shared operational handovers, privately saved locations and Google Maps directions links.
- Account access revocation, replacement invitations, passphrase changes and owner-only roster export.
- Google Calendar draft links. Optional read-only OAuth connection, private event preview and explicit event copying after Google credentials are configured.

## Important boundaries

Calendar copies are NOT live or two-way synchronisation. Later appointment changes and cancellations must be updated manually. Timed Google Calendar drafts use a one-hour placeholder; review their duration and destination calendar before saving.

No medication administration, medical records, emergency alerting, recurring task generation, automated reminders or full budget module is included in this release. Obtain consent before recording another person's private information. Helpers see only their own assigned tasks, including any notes on those tasks, and associated saved places.

The app starts with an empty roster. Old browser-local demo tasks are deliberately not imported. Invitations and account names are bootstrapped from private deployment configuration, not this repository. Google account authorisation is separate from family sign-in.

## Runtime

Node.js 22.13 or later; no npm runtime dependencies. SQLite is persisted on a Railway volume mounted at `/data`. Run exactly one application replica. Startup refuses to use ephemeral container storage. JSON records and Google tokens are encrypted using an independently configured 32-byte DATA_KEY; passphrases use salted scrypt hashes. This does not constitute a security certification.

Required variables: NODE_ENV=production, APP_ORIGIN (the exact HTTPS origin), DATA_DIR=/data, DATA_KEY (32 random bytes encoded as base64), INITIAL_INVITES (initial names, roles and SHA-256 invitation-token hashes).

INITIAL_INVITES is read only when the database is first created. It must include an owner. Actual single-use invitation tokens are distributed privately; only their hashes are configured. Retain DATA_KEY securely and separately from volume backups. Losing or replacing it prevents decryption of existing records.

Run `npm run check` for JavaScript syntax checks. Deployment health: GET /healthz should return status ok and mode private. GET /api/state without a session must be denied.

## Operations

See [Google and operations setup](docs/setup.md). Enable Railway volume backups and test recovery before relying on the system for real family coordination. Do not wipe or detach the database volume. Do not change the data key on an existing installation. The application is a small private pilot, not audited clinical software.
