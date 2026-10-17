# SplitKub MVP 3–4: approved architecture

Approved by the owner in this chat on 2026-10-17. Implementation proceeds one milestone at a time with review between milestones.

## Decisions

- Retain Next.js App Router, React, Supabase Auth/Postgres, private tables and explicitly authorized RPCs. Read the installed Next.js guides before implementing framework features.
- Preserve anonymous, local-first one-time splitting. Do not automatically import or rewrite legacy bills or local groups.
- Add durable recurring tables in the existing database. Legacy shared bills retain their existing fixed 90-day lifecycle; recurring history must not participate in that deletion cascade.
- Use Google OAuth for permanent accounts, then LINE Login for optional account linking. Anonymous identity upgrades and existing-account collisions require explicit handling.
- Bind persistent members through expiring, single-use invitations. Members see their own balances; owner and collector see the complete bill.
- Launch monthly THB recurring bills with one collector, Bangkok timezone, 09:00 generation, end-of-day due dates, last-day clamping and no automatic historical backfill. Validate due day is not before generation day.
- Snapshot issued amounts, participants, collector details and template version. Exact integer shares sum to the bill total. Do not reuse the one-time display layer's upward rounding as recurring debt.
- Payment claims require manual collector/owner confirmation or rejection. Retain an append-only audit trail; never describe claims or slips as bank verification.
- LINE notifications are opt-in, one-to-one: created, one day before due, one/three days overdue, and payment updates. Quiet hours: 21:00–09:00. Suppress reminders while a claim awaits review.
- Use Postgres uniqueness/transactions for generation, pg_cron for scheduling, and a leased transactional outbox for bounded notification dispatch. Persist provider retry keys and respect their deduplication window.

## Delivery sequence

0A. Repair baseline checks, add isolated anonymous-flow browser regressions, record decisions.
1. Permanent identity, persistent groups, invitations and authorization.
2. Exact issued balances, payment transitions and audit.
3. Versioned templates and calendar preview.
4. Transactional recurring generation and concurrency verification.
5. Complete recurring dashboard/detail/history UI and MVP 3 acceptance.
6. LINE link/unlink and verified webhook, with sending disabled.
7. Outbox, preferences, reminders, retries and quotas.
8. Staging restore rehearsal, operational hardening and release review.

Each milestone requires relevant tests, lint, typecheck, production build and a separate review pass; resolve findings before marking it complete. Database/security/concurrency gates cannot be replaced by mocked frontend tests.

## Approval boundaries and unresolved deployment inputs

Implementation approval does not authorize paid provisioning, deployment, production migration/data changes or production LINE messages. Request specific approval when each is concrete and reviewable.

Confirm actual hosting/subscriptions, deployed migration history, Auth configuration, staging availability, backup/restore capability, LINE channels/provider ownership, budget ceiling and data-retention/deletion policy before launch.

Rollback defaults to disabling generation/sending and rolling back application behavior while preserving issued bills, payment records and audit history. Additive migrations remain; do not drop production history as rollback.
