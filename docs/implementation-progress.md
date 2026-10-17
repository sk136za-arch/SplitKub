# MVP 3–4 implementation progress

## 2026-10-17 — Milestone 0A (implemented; awaiting owner acceptance)

Owner approved the eight summarized architecture/product decisions and incremental implementation. See [approved architecture](architecture-mvp3-mvp4.md).

### Starting baseline

- Vitest: 173 passed, 1 failed (30 files).
- ESLint: 3 errors in GroupsWorkspace and PaymentTracking.
- TypeScript: passed with incremental output disabled.
- Local database tests unavailable: Docker API permission denied. No production database was accessed.
- The supplied MVP implementation plan was already untracked; preserve it.

### Scope

- Correct the join-response test fixture to include `participantId`, matching migration `202610170003`. Keep strict response validation and explicitly test rejection of a missing identity field.
- Subscribe to browser-local group changes through React's external-store API, including changes from another tab.
- Separate asynchronous payment-actor selection from action state; reset identity scope and ignore responses after identity changes/unmount.
- Add local-only Playwright regressions for anonymous editing/persistence/copy/close and group cross-tab synchronization, on desktop and mobile.
- Add repeatable typecheck/E2E commands and keep unit discovery separate from browser tests.
- Document migration prerequisite and E2E safety boundaries.

### Additional baseline security repair

- Dependency audit identified vulnerabilities in the original Next.js 16.3.7 and source-map-js 1.2.1.
- Updated Next.js and eslint-config-next to 16.3.8, constrained to the 16.3 patch line; updated source-map-js to 1.2.2 through the lockfile. No major/minor framework migration.
- Added Playwright, Testing Library and happy-dom as development-only dependencies. No cloud infrastructure changes.

### Validation / review

| Check | Final result |
| --- | --- |
| `npm run test -- --pool=threads --maxWorkers=1 --no-file-parallelism` | PASS: 31 files, 180 tests |
| `npm run lint` | PASS: no errors |
| `npm run typecheck` | PASS, including after the final production build |
| `npm run test:e2e` | PASS: 4 tests (desktop and mobile), against an isolated production build |
| Production `next build` inside E2E startup | PASS: Next.js 16.3.8 / Turbopack; all existing routes compiled |
| `npm audit --omit=dev --json` | PASS: zero reported production vulnerabilities |
| `git diff --check` | PASS |
| Independent `codex review --uncommitted` | No discrete correctness findings; reviewer also verified unit tests, lint and typecheck |

The first browser build failed due to a Turbopack subprocess failure in the restricted environment. A cached failure persisted on the first unrestricted retry. Removing only the verified workspace `.next/cache` directory and rebuilding outside the sandbox succeeded. The first executable browser run found an ambiguous test button selector; scoped it to the item form. Final desktop/mobile runs pass. The independent review preceded that selector-only correction; the reviewer could not run E2E, so the final browser result above is the implementation validation, not a claim of independent E2E verification.

### Remaining limitations

- Full dependency audit still reports five high-severity development-tool dependency entries through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces@3.0.3`. Production-only audit is clean. The suggested forced remedy downgrades ESLint's Next configuration across major versions; do not apply that blindly. Track an upstream-compatible remediation before release hardening.
- Database tests were not rerun: no SQL/schema changes in this milestone; Docker access remains unverified. Online shared-bill security and concurrency require local/staging Supabase checks before their relevant milestones.
- Browser tests intentionally cover local anonymous sharing by copied summary, not real online sharing or real LINE delivery.
- No deployment, production changes, paid provisioning, outgoing LINE messages, or commits were performed.

Next: owner acceptance of 0A, then milestone 1 (permanent identity and persistent groups). Do not begin milestone 1 in this delivery.
