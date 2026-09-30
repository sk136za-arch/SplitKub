# Implementation Summary

## Task

Make SplitKub sharing payment-first, then add a dismissible success toast and a recognizable mascot brand across the app and summary PNG.

## Result

The payment panel precedes the sharing actions. THB text copying requires a valid PromptPay number; image sharing requires an uploaded QR for either currency. Successful text copying now raises an accessible three-second toast. The PNG includes the bill total, per-person totals, currency, uploaded QR, a valid PromptPay number when applicable, and the mascot brand mark.

## Implementation Plan

Extract payment readiness and share text from the page, add clipboard fallbacks, render the PNG with browser Canvas, and connect Web Share file support to a download fallback. Verify mobile-relevant failure paths and existing bill behavior.

Add a reusable toast whose timer restarts on each successful copy and cleans up when dismissed or unmounted. Use the generated full-body mascot on the landing page and summary image, and its transparent bust crop for the compact header and browser icons.

## Changes Made

- Added `src/lib/share.ts` for sharing eligibility, normalized PromptPay text, clipboard fallback, and share cancellation detection.
- Added `src/lib/summaryImage.ts` for a 1080px branded PNG with dynamic height, duplicate-name labels, readable payment section, and uploaded QR.
- Moved sharing controls below the payment inputs. Disabled controls explain their required input; the copy failure path shows selectable text.
- The PNG is prepared after a 200ms quiet period and cached by currency, PromptPay, QR URL, total, and rendered participant fields. The share click uses only an image whose cache key still matches the current bill.
- When native file sharing is available, preparation creates the actual PNG `File` and checks it with `navigator.canShare`; the button label reflects that result. The click immediately invokes `navigator.share` with the prepared file. Otherwise, the download path uses only the Blob. Cancelling the native share dialog does not trigger a download.
- Replacing a QR first revokes and clears the previous image, so an invalid type or oversized replacement cannot leave a stale payment QR active. QR decode/export failures expose a retryable accessible status instead of creating an incomplete image. Temporary download object URLs are revoked.
- Added focused tests for payment rules, share text, browser clipboard paths, QR decode/export, and dynamic image height.
- Added `SuccessToast` with a three-second resettable timer, keyboard-accessible close button, polite live status, and mobile safe-area placement. Copy errors and manual-copy text remain inline.
- Added transparent mascot assets in `public/brand/`, a compact header icon, a reserved-size landing image, and Next.js icon metadata.
- The summary renderer loads the QR and mascot together; a mascot failure falls back to the text wordmark, while a QR failure still prevents exporting an incomplete payment image.

## Architecture Decisions

- QR images remain in browser memory, as in MVP 1. The PNG is generated locally after payment inputs settle and is never uploaded to a server.
- THB text copying is enabled only for a valid PromptPay number. Uploaded-QR-only bills are shared as an image because plain text cannot include the QR.
- USD image sharing uses the uploaded QR and never displays a PromptPay number.

## Tests

`npm run test` passed: 9 files, 49 tests. Tests cover THB/USD payment readiness, duplicate participant labels, compact PromptPay text, Clipboard API/legacy/manual paths, cancellation, native file-share capability checks, canvas size limits, cache-key invalidation, QR decode failure, QR drawing/export, mascot failure fallback, and toast timer reset/cleanup.

## Validation

`npm run lint`, `npm run build`, and `git diff --check` passed. The build completed with Next.js 16.3.7. The line-ending notices from Git on Windows are non-failing warnings.

## Review Findings

The previous share button only attempted Web Share text or secure-context Clipboard API and did not include the uploaded QR. The new flow includes the payment method and remains usable over local HTTP through legacy/manual copy and PNG download.

## Problems Found and Fixed

The first test run exposed Vitest's lack of the Next.js `@/` path alias for the new library modules; imports were changed to relative paths. A duplicate-name test expectation was aligned with the project's existing numbered label format.

## Remaining Concerns

Native share dialogs and mobile download behavior depend on the device/browser and have not yet been exercised on a physical phone. PNG rendering was tested with a mocked canvas and QR, and should receive an on-device visual check.
The toast and brand layout should also receive a physical mobile visual check, especially at 375px and with the software keyboard open.

## Files Changed

`src/app/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`, `src/components/SuccessToast.tsx`, `src/lib/share.ts`, `src/lib/summaryImage.ts`, `src/__tests__/share.test.ts`, `src/__tests__/successToast.test.ts`, `public/brand/splitkub-mascot.png`, `public/brand/splitkub-icon.png`, and this summary.

## Final Status

Implementation and repository checks complete. No commit or deployment was made.
