# Implementation Summary

## Task

Implement SplitKub MVP 1.1 plus settlement routing and unlocked shared participant selection: multiple receipts, one payer per receipt, paid/owed/net summaries, direct or collector payment routes, anonymous shared bills, friend participation editing, private Realtime updates, and 90-day retention.

## Result

SplitKub now supports multiple receipts in one split session. Each receipt has its own payer and items, while the summary derives how much every participant paid, owes, and should receive or pay. The owner can select direct net-based routes or a collector who receives every noncollector's gross owed amount and reimburses every noncollector payer's gross paid amount, with receipt breakdowns. Owners can create capability links when Supabase is configured; friends open a single trust-based link, select their name, and update only that participant's item assignments. Local-only mode remains usable without Supabase.

Multiple friends may now select the same participant name. Each browser session remembers its own choice, and deleting that participant clears the choice without deleting friend memberships.

## Implementation Plan

Extend the domain and calculation engine first, migrate V1 local data without destructive writes, add normalized Supabase storage/RPC/RLS/Realtime infrastructure, then replace the single-bill UI with owner and friend flows. Preserve integer money, deterministic remainder allocation, QR browser-only behavior, clipboard/image fallbacks, mascot branding, and mobile-first accessibility.

## Changes Made

- Added `SplitSession`, receipts, receipt payers, participant PromptPay, structural session actions, and deterministic paid/owed/net calculation with conservation invariants.
- Added V3 local persistence and copy-on-write V1/V2 migration to direct mode. Older keys remain until a server-confirmed V3 snapshot is safely stored.
- Preserved legacy global PromptPay in a dedicated pending record. The owner must explicitly assign it to a participant or discard it before creating a share link.
- Added owner multi-receipt editing, payer selection, receipt-specific item splitting, paid/owed/net summary, receipt breakdowns, and per-recipient PromptPay.
- Added deterministic direct transfers, collector gross collection/reimbursement transfers, destination-aware PromptPay and QR sharing, owner routing settings, and friend-personalized transfer views.
- Added a shared exact-rational display layer for Summary, route rows, copied text, and PNG. It preserves every ledger route's endpoints, order, and kind; direct payer rounding deltas go only on that payer's last existing outgoing route, while collector collections use max(ledger amount, ceiling of aggregate exact owed). No displayed payment falls below its ledger amount; reimbursements and stored/calculated paid/owed/net values stay unchanged.
- Added `/b/[publicId]` using the Next.js 16 async params convention. Capability secrets remain in URL fragments rather than paths or query parameters.
- Added Supabase anonymous auth, normalized private tables, hashed owner/friend tokens, fixed-search-path SECURITY DEFINER RPCs, least-privilege grants/RLS, revision checking, receipt-scoped participation updates, private Realtime policy, and daily 90-day expiry cleanup.
- Added a serialized Realtime subscription controller that cleans up old channels, rejects stale callbacks, reconnects after manual refresh/online recovery, and reports live only after `SUBSCRIBED`.
- Updated copy text and PNG rendering for receipts, receipt payers, paid/owed/net totals, PromptPay recipients, and an explicitly selected QR recipient when several people must receive money. QR choices are tied to the current transfer-destination set; only a sole actual destination is auto-selected, never the collector by default.
- PNG person cards now show rounded `ต้องโอน` / `จะรับ` instructions from the same display transfer rows as the route list; exact ledger net remains secondary and explicitly labeled `ยอดสุทธิในบัญชี`.
- THB sessions with a valid result and no transfer destinations can copy the no-transfers summary without requiring PromptPay; QR image sharing remains disabled when there is nobody to receive money.
- Added feature-flagged Supabase configuration, local Supabase config, pgTAP security assertions, environment template, deployment documentation, and `document/SUPABASE_LOCAL_SETUP.md` for Windows local/cloud setup.
- Added an additive routing migration with owner-only revision-checked updates, same-bill collector FK, direct defaults for existing rows, and pgTAP validation/security assertions. The friend participation RPC is unchanged.
- Added remote snapshot normalization only for old snapshots lacking both routing fields; partial routing snapshots are rejected. A separate additive capability RPC lets collector create/update fail with `migration_required` before writing to an older backend, and a post-write check refuses a downgraded collector response.
- Hardened shared-link opening and Realtime lifecycle: a friend-token visit follows the role returned by the RPC; an existing owner gets an ephemeral owner workspace with no friend token saved as owner recovery. Fragment changes restart opening and invalidate late responses. Realtime channel removal is one-shot/non-reentrant, terminal subscription errors use `realtime_unavailable`, and both owner/friend fetch a canonical snapshot after `SUBSCRIBED` with stale-generation guards.
- Added migration 004 to remove the exclusive participant-choice index and change the member FK to clear only `participant_id` when a participant is removed. The owner RPC still checks revision and keeps settlement validation; the friend choice RPC still locks the bill and derives identity from the authenticated member row. A stale participation request succeeds without a revision bump only if its requested assignment state is already true.
- Added migration 005 with an authenticated selection-bound friend toggle RPC. Each request validates the explicit participant against the bill, updates the member's selected identity, and applies only that participant's assignment under the same bill lock; the legacy RPC remains available for older clients. The browser now sends its tab-local selected participant ID so two tabs sharing one anonymous auth session cannot toggle each other's person.
- The friend client stores each bill's chosen participant ID in sessionStorage, re-selects that ID for the current anonymous user after opening a link, clears it when a canonical snapshot removes that participant, and ignores late responses after a link change. An old backend returning the former exclusive-choice error now prompts for the migration.

## Architecture Decisions

- One session uses one currency: THB or USD. Money remains an integer in satang or cents; no exchange-rate conversion is performed.
- Friend access is intentionally trust-based. A link holder can select another participant name, but cannot change receipt structure, prices, participants, or payers.
- Participant selection is not exclusive or an authentication boundary: multiple devices can edit the same participant's item assignments. sessionStorage holds each tab's preference; every toggle explicitly supplies that participant and the server atomically validates and applies the action rather than trusting a mutable shared per-user selection.
- Realtime is only a change notification. Clients always refetch a validated canonical snapshot and apply revisions monotonically.
- A successful Realtime subscription also triggers a canonical refresh to close the gap between initial link opening and joining the channel; old-channel callbacks and late fetches cannot replace a newer link or connection generation.
- QR images remain browser-memory-only and are never uploaded. PromptPay is persisted per participant.
- Shared mode uses only a client-safe Supabase publishable key plus RLS/RPCs; no service-role or secret key is shipped to the browser.
- Shared data expires 90 days after creation, independent of later edits.
- Direct routes use stable participant-order greedy debtor/creditor pairing; no globally minimal transfer count is claimed. Collector routes are gross and intentionally do not net. Transfer lists are derived and never persisted.
- Display route amounts may be one or more minor units above the ledger to avoid showing less than exact rational debt. The difference cannot add, remove, reorder, or retarget a route; payment instructions use displayed amounts while the paid/owed/net ledger remains available separately. The image cache includes item split inputs so a changed raw fraction invalidates the image.

## Tests

`npm run test` passed: 25 files, 127 tests. Coverage includes per-bill friend selection storage and deleted-ID reconciliation, tab-bound friend participation RPC arguments, old-backend choice-error mapping, multi-receipt arithmetic and invariants, deterministic direct and gross collector routing, consistent exact-rational payment display across Summary/copy/PNG (fractional, exact, multi-item, endpoint/order preservation, no-decrease behavior, collector reimbursement, person-card display-vs-ledger amounts), ledger regressions, old/partial remote snapshot compatibility, capability preflight and downgrade detection, destination-aware share and QR rules, actual owner role without token persistence, invalid references/payers, V1/V2→V3 recovery, PromptPay preservation and explicit resolution, token-fragment parsing, distinct shared-link/expiry/Realtime errors, monotonic snapshots, one-shot/non-reentrant Realtime channel cleanup, dirty-notification refresh draining, stale subscription suppression, receipt payer labels, clipboard/image sharing, mascot fallback, and toast behavior.

## Validation

- `npm run test`: passed, 127/127 tests.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed with Next.js 16.3.7; `/` is static and `/b/[publicId]` is dynamic.
- `git diff --check`: passed; Git emitted only non-failing Windows line-ending warnings.
- HTTP smoke checks returned 200 for `/` and `/b/<publicId>`.

## Review Findings

Independent test and final PR review found no remaining P0/P1/P2 issues. Corrective reviews fixed unsafe storage hydration, uncertain legacy PromptPay ownership, premature V1 retirement, Realtime status/recovery, stale revision responses, missing receipt-payer labels, and ambiguous QR ownership.

## Problems Found and Fixed

- Guarded localStorage access so restricted storage cannot leave the app stuck loading.
- Made remote snapshot application monotonic and structural owner writes revision-checked.
- Persisted server-confirmed V3 data synchronously before removing compatible V1/V2 copies.
- Required explicit assignment/discard of migrated PromptPay so payment data cannot silently move to the wrong participant or disappear.
- Replaced one-shot Realtime subscription handling with serialized teardown/reconnect and stale-callback filtering.
- Added receipt payer and selected QR owner labels to generated images.

## Remaining Concerns

- The SQL migrations and pgTAP security tests, including the unlocked-selection and same-anonymous-user two-tab tests, were not executed. The installed Supabase CLI could not write its telemetry file under the sandboxed user profile; SQL was reviewed statically only. True cross-connection selection/deletion races remain unverified in this environment.
- Anonymous auth, RPCs, private Realtime, expiry cleanup, and two-browser collaboration still require an end-to-end test against a configured Supabase project.
- Physical mobile viewport, native share dialog, QR download, and live reconnect behavior were not exercised on a real device because no browser automation surface was available.
- The share feature remains disabled until the documented Supabase settings and environment variables are configured.

## Files Changed

Current friend-selection changes include `supabase/migrations/202610030004_unlocked_participant_selection.sql`, `supabase/migrations/202610040001_selection_bound_friend_participation.sql`, `supabase/tests/unlocked_participant_selection.test.sql`, `supabase/tests/selection_bound_participation.test.sql`, `src/components/FriendBillClient.tsx`, `src/lib/friendSelection.ts`, shared adapters/errors and tests, plus README and setup documentation. Earlier core changes include `src/types/bill.ts`, `src/lib/calculateBill.ts`, `src/lib/billState.ts`, `src/lib/storage.ts`, owner/friend UI components, shared adapters/controllers, `src/lib/supabase/`, `supabase/`, sharing/image utilities, tests, `.env.example`, and package dependency files.

## Final Status

Implementation and local repository validation are complete. Live Supabase deployment/configuration and physical-device QA remain required before production release. No commit or deployment was made.
