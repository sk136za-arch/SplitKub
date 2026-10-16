# SplitKub MVP1 design QA

## Comparison target

- Source visual truth: `C:/Users/sk136/Downloads/splitkub.png` (user-supplied SplitKub product reference).
- Intended implementation: local development server at `http://localhost:3000/`.
- Intended viewport/state: desktop landing page at the initial, no-account state; then browser-local empty workspace.

## Evidence status

- Implementation screenshot: unavailable.
- Browser attempts: Codex In-app Browser and Chrome both returned `net::ERR_CONNECTION_TIMED_OUT` for `http://localhost:3000`; an In-app Browser attempt to the development machine network address also timed out.
- The local Next development server reported ready at port 3000. The browser sandbox could not reach it, so no browser-rendered screenshot, viewport pixels, CSS dimensions, device scale factor, primary interaction trace, or console inspection could be captured.
- Full-view and focused-region comparisons were not performed. Comparing the source against code alone would be invalid.

## Findings

- [P0] Browser-rendered implementation cannot be captured.
  - Location: local preview verification.
  - Evidence: all supported browser navigation attempts timed out before a page rendered.
  - Impact: typography, responsive layout, design-token application, image composition, navigation behavior, and form flow cannot be visually verified against the reference.
  - Fix: make the local development server reachable from the Codex browser sandbox, then capture matching desktop and mobile views and rerun this comparison.

## Required fidelity surfaces

- Fonts and typography: blocked pending rendered capture.
- Spacing and layout rhythm: blocked pending rendered capture.
- Colors and visual tokens: blocked pending rendered capture.
- Image quality and asset fidelity: blocked pending rendered capture. The existing project mascot and icon are used; no generated assets were introduced.
- Copy and content: blocked pending rendered capture.

## Implementation checklist

1. Restore browser access to the local preview.
2. Capture the landing page and empty/populated local workspace at desktop and mobile breakpoints.
3. Test create bill → add people → add receipt/items → summary flow in-browser.
4. Compare captures side-by-side with the supplied source reference; fix any P0/P1/P2 differences and update this report.

## Follow-up polish

- Add a visual comparison pass once local-browser networking is available.

final result: blocked
