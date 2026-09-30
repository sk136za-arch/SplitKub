# Implementation Summary

## Task

Build SplitKub MVP 1 from the approved plan, including THB/USD bills.

## Result

A client-side Next.js bill splitter is implemented. Users can add and edit items and people, assign each item, calculate and inspect totals, enter PromptPay for THB, preview a local QR image, and share or copy the summary.

## Implementation Plan

Implement integer money and calculation first, then reducer and versioned browser storage, UI flow, payment and share handling, and validation.

## Changes Made

- Added Next.js App Router, TypeScript, Tailwind CSS, ESLint, and Vitest setup.
- Added money parsing/formatting, deterministic split calculation, bill reducer, storage validation, and PromptPay validation.
- Added responsive landing, bill editor, mobile split cards, desktop matrix, summary, payment, and share UI.
- Corrected large-amount money parsing, display formatting, and edit-input conversion to preserve accepted safe-integer satang/cents exactly.
- Added Thai national-ID checksum validation and expanded PromptPay checksum tests.
- Increased split chip and select/clear touch targets to at least 44px and enabled long labels to wrap in mobile and desktop split views.
- Prevented unstarted first visits from writing an empty bill; explicit empty starts are marked and restored, while clear removes only the SplitKub key.
- Added checked aggregate totals with an accessible overflow message instead of rendering an inexact amount.
- Added stable duplicate participant labels across split controls, summary headings, and shared text; raised danger and remaining action targets to at least 44px.
- Made duplicate labels collision-proof by prefixing every participant in the bill when raw names repeat; applied the same labels to participant CRUD names and accessible action labels.
- Gave the header brand link a 44px minimum target and guarded localStorage access so hydration always reaches ready state.

## Architecture Decisions

- Values are integer satang or cents; currency is fixed after the first item is added.
- A new item selects existing participants. New participants are not assigned to prior items.
- Uploaded QR files remain only in page memory through an object URL.

## Tests

Unit tests cover money input and aggregate safe-integer boundaries, equal and uneven splits, per-item assignment, reducer behavior, storage corruption/empty-start/clear/accessor-failure behavior, participant label collisions, and PromptPay checksum validation.

## Validation

Final validation passed: `npm run test` (6 files, 31 tests), `npm run lint`, `npm run build`, and `git diff --check`. Earlier corrective builds exposed an optional `started` envelope type omission and the ES2017 target's BigInt literal syntax limitation; both were corrected before successful builds. Dependency audit reported zero vulnerabilities after upgrading Next.js and Vitest.

## Review Findings

The PromptPay field originally hid the summary while editing; it now preserves the result and includes a valid number in shared text. Next.js 16 required native flat ESLint configuration and a client hydration rule exemption. Corrective review found large-value floating precision risks, missing Thai ID checksum validation, undersized split controls, long-name wrapping gaps, empty-first-visit persistence, aggregate overflow display, duplicate-name ambiguity/collisions, and localStorage accessor failures; fixes and targeted tests were added.

## Problems Found and Fixed

- Replaced vulnerable Next.js 15 / Vitest 3 dependencies with patched Next.js 16 / Vitest 5.
- Updated ESLint configuration for Next.js 16 and resolved its React effect lint errors.
- Replaced floating-point money conversions with integer/BigInt string handling and added maximum-boundary round-trip coverage.
- Validated 13-digit Thai national IDs with their checksum and replaced the invalid passing fixture.
- Made split controls meet a 44px minimum touch target and wrapped long item/participant names.
- Made persistence conditional on an explicit start or non-empty bill, tagged explicit starts for restore, and tested empty legacy payloads and key clearing.
- Added checked-sum behavior and an accessible overflow state, stable participant labels, and 44px danger/checkbox/action targets.
- Prevented participant-label collisions involving names that resemble suffix labels, and used labels for participant-list text and edit/delete accessible names.
- Added safe storage accessor resolution with `finally`-guarded hydration readiness and expanded tests for accessor exceptions.

## Remaining Concerns

Independent browser checks covered the main bill flow and target responsive widths without console errors or horizontal overflow. Actual QR-file upload and the native share/clipboard actions remain unverified. QR images intentionally remain only on the current page and are not embedded in shared text.

## Files Changed

Application source under `src/`, tool configuration, `package.json`, `package-lock.json`, and `README.md`.

## Final Status

Implementation complete. Independent testing and review found no remaining P1/P2 blocker.
