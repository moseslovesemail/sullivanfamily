# Private shared application — implementation gates

This is a proposed implementation plan, not a statement of implemented functionality.

## 1. Access before real data

Use invitation-only individual accounts and a maintained authentication library. No shared passwords, public registration, hard-coded credentials, demo-account fallback or client-side-only access checks. Session cookies must be HttpOnly, Secure and appropriately SameSite; include CSRF protections, login rate limiting, session expiry and immediate access revocation. Check family membership and record-level permissions on every read and write.

The supported adult controls who can access medical information. Household administrators do not automatically gain unrestricted medical access. Record consent and separate care-record permissions from ordinary school, meal and transport permissions. Helpers see only assigned operational details. Do not collect child accounts or unnecessary child identifiers. Do not put sensitive content in email subjects, lock-screen notifications or server logs.

## 2. Shared roster

Use one PostgreSQL task source for Today, Tomorrow, Week and each person's page. Suggested entities: family, user/membership, person, location, availability, task, task_assignment, recurrence_rule/exception, appointment, handover, shopping_item, expense and consent/audit_event.

Task assignment should distinguish unassigned, offered, accepted, completed and cancelled. Naming a driver is not confirmation that they accepted. Support reassignments, an unavailable state, travel-time buffers, overlap warnings and optimistic concurrency so two people cannot silently claim the same job.

Record event times with their Pacific/Auckland timezone and correct daylight-saving conversion. Store date-only school/meal fields as dates, not accidental midnight UTC timestamps. Recurrences need exceptions for holidays, teacher-only days, illness, changes and cancellations; do not assume every weekday is a school day. Generate occurrences idempotently.

## 3. Care-record safeguards

Appointments record their source, entered-by, last-updated, confirmation state, transport, support and linked household tasks. Rescheduling must flag dependent transport and childcare tasks for reconfirmation.

Medication recording must be separately permissioned and disabled until reviewed and tested. Store exact prescribed text, source/verification date, authorised users, scheduled occurrence, actual recorded administration time and an append-only correction history. The absence of a log means unknown, not not-taken. Do not calculate doses, suggest treatment, create an unverified schedule or automatically mark medicine taken. Prevent duplicate confirmation and surface concurrent edits. Do not treat push/email delivery as reliable medication or emergency monitoring.

## 4. Budgets and practical work

Support a weekly NZD budget plus expenses in integer cents, payer and explicit reimbursement status. Receipts are optional, private and never public URLs. Shared shopping and meals should stay simple. Do not compare support people by dollar contributions or imply that task counts measure burden.

## 5. Reliability and launch

Tests must cover unauthenticated access, helper/medical permission boundaries, family-record isolation, revocation, stale writes, simultaneous claiming, recurring exceptions, daylight-saving transitions, appointment changes and medication-log corrections. Establish backups and perform a restore test, document hosting region and data handling, provide export/deletion and use a visible saved/sync state. Restrict the launch to a small invited family group after real access controls and persistence are verified.

No real-world arrangements should depend on the current demo. Agree a phone/contact fallback before relying on the private system for time-critical transport or school pickups.
