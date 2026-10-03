# Database security checks

The pgTAP suite runs with `supabase test db`. `shared_bills_security.test.sql` verifies RLS and grants, fixed search paths, receipt-scoped participation, private Realtime and expiry cleanup; `settlement_routing_security.test.sql` checks collector constraints and validation; `shared_bill_capabilities.test.sql` checks the versioned capability RPC and its grants.

For a local run, install Docker and the current Supabase CLI, then run `supabase start` followed by `supabase test db`. Applying the migration to a project also requires the `pgcrypto` and `pg_cron` extensions. A live Supabase project must additionally enable anonymous sign-ins, expose the `api` schema through API settings, and disable public Realtime channels. No service-role credential is needed or accepted by the frontend.

The SQL policy test is a defense-in-depth catalog check; it is not a substitute for staging tests that exercise create/join/owner recovery, concurrent revision conflicts, duplicate participant claims, cross-receipt item IDs, and 90-day expiry behavior using separate anonymous sessions.
